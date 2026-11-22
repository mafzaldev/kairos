import type { Account } from "../account.js";
import { UriError } from "../errors.js";
import { ALGORITHMS, DEFAULTS } from "../otp/types.js";

/*
 * Google Authenticator's "Transfer accounts" screen shows QR codes that hold
 * otpauth-migration://offline?data=<base64>. The data is a protobuf message:
 *
 *   MigrationPayload
 *     1  repeated OtpParameters
 *     3  batch_size     how many QR codes the export was split into
 *     4  batch_index    which one this is, from 0
 *
 *   OtpParameters
 *     1  secret         raw bytes
 *     2  name           often "Issuer:account"
 *     3  issuer
 *     4  algorithm      1 SHA1, 2 SHA256, 3 SHA512, 4 MD5
 *     5  digits         1 six, 2 eight
 *     6  type           1 HOTP, 2 TOTP
 *
 * The period is not stored: Google Authenticator always uses 30 seconds.
 */

const DAMAGED = "This is not a readable Google Authenticator export code.";

const HOTP = 1;

export interface Export {
  accounts: Account[];
  /** Names of entries kairos cannot use: counter-based (HOTP) or MD5. */
  skipped: string[];
  part: number;
  parts: number;
}

export function isExport(text: string): boolean {
  return /^otpauth-migration:/i.test(text.trim());
}

// Just enough protobuf: yields each field as [number, value], where the value
// is a number (varint) or the raw bytes (strings, bytes, nested messages).
function* fields(data: Buffer): Generator<[number, number | Buffer]> {
  let at = 0;
  const varint = (): number => {
    let value = 0;
    for (let shift = 0; ; shift += 7) {
      const byte = data[at++];
      if (byte === undefined) throw new UriError(DAMAGED);
      value += (byte & 0x7f) * 2 ** shift;
      if (byte < 0x80) return value;
    }
  };

  while (at < data.length) {
    const key = varint();
    const field = Math.floor(key / 8);
    const wireType = key % 8;
    if (wireType === 0) {
      yield [field, varint()];
    } else if (wireType === 2) {
      const size = varint();
      if (at + size > data.length) throw new UriError(DAMAGED);
      yield [field, data.subarray(at, at + size)];
      at += size;
    } else {
      throw new UriError(DAMAGED);
    }
  }
}

function entry(data: Buffer, result: Export): void {
  let secret = Buffer.alloc(0);
  let name = "";
  let issuer = "";
  let algorithm = 1;
  let digits = 1;
  let type = 0;
  for (const [field, value] of fields(data)) {
    if (Buffer.isBuffer(value)) {
      if (field === 1) secret = Buffer.from(value);
      if (field === 2) name = value.toString().trim();
      if (field === 3) issuer = value.toString().trim();
    } else {
      if (field === 4) algorithm = value;
      if (field === 5) digits = value;
      if (field === 6) type = value;
    }
  }

  // The name usually repeats the issuer as a prefix: "GitHub:alice".
  const colon = name.indexOf(":");
  const prefix = name.slice(0, colon).trim();
  if (colon !== -1 && (!issuer || prefix.toLowerCase() === issuer.toLowerCase())) {
    issuer ||= prefix;
    name = name.slice(colon + 1).trim();
  }
  if (!name) {
    name = issuer || `account ${result.accounts.length + result.skipped.length + 1}`;
    issuer = "";
  }

  const hash = ALGORITHMS[(algorithm || 1) - 1];
  if (type === HOTP || !hash || secret.length === 0) {
    secret.fill(0);
    result.skipped.push(issuer ? `${issuer}:${name}` : name);
    return;
  }
  result.accounts.push({
    name,
    issuer,
    secret,
    algorithm: hash,
    digits: digits === 2 ? 8 : 6,
    period: DEFAULTS.period,
  });
}

/** Errors never quote the text: it holds every secret in the export. */
export function parse(text: string): Export {
  let data: Buffer;
  try {
    const encoded = new URL(text.trim()).searchParams.get("data") ?? "";
    // "+" is a base64 character, but reads as a space in a query string.
    data = Buffer.from(encoded.replaceAll(" ", "+"), "base64");
  } catch {
    throw new UriError(DAMAGED);
  }
  if (data.length === 0) throw new UriError(DAMAGED);

  const result: Export = { accounts: [], skipped: [], part: 1, parts: 1 };
  try {
    for (const [field, value] of fields(data)) {
      if (Buffer.isBuffer(value)) {
        if (field === 1) entry(value, result);
      } else {
        if (field === 3 && value > 0) result.parts = value;
        if (field === 4) result.part = value + 1;
      }
    }
  } catch (error) {
    for (const account of result.accounts) account.secret.fill(0);
    throw error;
  }
  return result;
}
