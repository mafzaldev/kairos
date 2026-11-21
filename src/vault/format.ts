import { createHash } from "node:crypto";
import type { Account } from "../account.js";
import { CorruptedError, KairosError } from "../errors.js";
import { ALGORITHMS } from "../otp/types.js";

/*
 * Vault file, version 1 (encrypted backups use the same format):
 *
 *   offset  size  field
 *   0       6     magic "KAIROS"
 *   6       1     format version (1)
 *   7       1     KDF id (1 = scrypt)
 *   8       1     scrypt log2(N)
 *   9       1     scrypt r
 *   10      1     scrypt p
 *   11      1     reserved (0)
 *   12      32    KDF salt
 *   44      12    AES-256-GCM IV
 *   56      16    AES-256-GCM tag
 *   72      n     ciphertext
 *   72+n    32    SHA-256 of bytes [0, 72+n)
 *
 * Bytes [0, 56) are the header, passed to GCM as additional authenticated data
 * so they cannot be altered. The trailing SHA-256 is not a security measure: it
 * tells a damaged file ("corrupted") apart from a failed decryption of an
 * intact one ("wrong password").
 *
 * The ciphertext decrypts to a list of records (integers big-endian):
 *
 *   u32  account count, then per account:
 *     u16 + bytes  name (UTF-8)
 *     u16 + bytes  issuer (UTF-8)
 *     u8           algorithm (1 = SHA1, 2 = SHA256, 3 = SHA512)
 *     u8           digits
 *     u32          period in seconds
 *     u16 + bytes  secret
 *
 * Binary rather than JSON so a secret goes straight from the decrypted buffer
 * into its own Buffer and never becomes a string, which could not be wiped.
 */

const MAGIC = Buffer.from("KAIROS");
const VERSION = 1;
const KDF_SCRYPT = 1;

export const SALT_SIZE = 32;
export const IV_SIZE = 12;
export const TAG_SIZE = 16;
const HEADER_SIZE = 12 + SALT_SIZE + IV_SIZE;
const CHECKSUM_SIZE = 32;

export interface ScryptParams {
  logN: number;
  r: number;
  p: number;
}

/** N = 2^17: about 128 MiB of memory per derivation. */
export const SCRYPT: ScryptParams = { logN: 17, r: 8, p: 1 };

const sha256 = (data: Buffer) => createHash("sha256").update(data).digest();

export function header(params: ScryptParams, salt: Buffer, iv: Buffer): Buffer {
  return Buffer.concat([MAGIC, Buffer.from([VERSION, KDF_SCRYPT, params.logN, params.r, params.p, 0]), salt, iv]);
}

export function pack(head: Buffer, tag: Buffer, ciphertext: Buffer): Buffer {
  const body = Buffer.concat([head, tag, ciphertext]);
  return Buffer.concat([body, sha256(body)]);
}

/** Checks the container and splits it into its fields. Decrypts nothing. */
export function unpack(file: Buffer) {
  if (!file.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new CorruptedError("missing KAIROS signature");
  }
  if (file.length < HEADER_SIZE + TAG_SIZE + CHECKSUM_SIZE) {
    throw new CorruptedError("file is truncated");
  }
  if (file[6] !== VERSION) {
    throw new KairosError(`Unsupported vault format version ${file[6]}. It was probably written by a newer kairos; please upgrade.`);
  }

  const body = file.subarray(0, -CHECKSUM_SIZE);
  if (!sha256(body).equals(file.subarray(-CHECKSUM_SIZE))) {
    throw new CorruptedError("checksum mismatch");
  }

  const params: ScryptParams = { logN: file[8]!, r: file[9]!, p: file[10]! };
  // The bounds stop a hostile header from demanding absurd amounts of memory.
  const sane = file[7] === KDF_SCRYPT && params.logN >= 1 && params.logN <= 22 && params.r >= 1 && params.r <= 32 && params.p >= 1 && params.p <= 16;
  if (!sane) {
    throw new CorruptedError("key derivation parameters out of range");
  }

  return {
    params,
    salt: body.subarray(12, 12 + SALT_SIZE),
    iv: body.subarray(12 + SALT_SIZE, HEADER_SIZE),
    head: body.subarray(0, HEADER_SIZE),
    tag: body.subarray(HEADER_SIZE, HEADER_SIZE + TAG_SIZE),
    ciphertext: body.subarray(HEADER_SIZE + TAG_SIZE),
  };
}

export function serialize(accounts: readonly Account[]): Buffer {
  const rows = accounts.map((account) => ({
    account,
    name: Buffer.from(account.name),
    issuer: Buffer.from(account.issuer),
  }));
  const size = rows.reduce((total, { account, name, issuer }) => total + 2 + name.length + 2 + issuer.length + 1 + 1 + 4 + 2 + account.secret.length, 4);

  // Written straight into one buffer, so the caller can wipe every copy of the secrets.
  const out = Buffer.alloc(size);
  let at = out.writeUInt32BE(accounts.length);
  for (const { account, name, issuer } of rows) {
    at = out.writeUInt16BE(name.length, at);
    at += name.copy(out, at);
    at = out.writeUInt16BE(issuer.length, at);
    at += issuer.copy(out, at);
    at = out.writeUInt8(ALGORITHMS.indexOf(account.algorithm) + 1, at);
    at = out.writeUInt8(account.digits, at);
    at = out.writeUInt32BE(account.period, at);
    at = out.writeUInt16BE(account.secret.length, at);
    at += account.secret.copy(out, at);
  }
  return out;
}

export function deserialize(data: Buffer): Account[] {
  let at = 0;
  const take = (size: number): number => {
    if (at + size > data.length) throw new CorruptedError("account data ends unexpectedly");
    at += size;
    return at - size;
  };
  // A copy, so the caller can wipe `data` without touching the result.
  const bytes = (): Buffer => {
    const size = data.readUInt16BE(take(2));
    const start = take(size);
    return Buffer.from(data.subarray(start, start + size));
  };

  const accounts: Account[] = [];
  try {
    const count = data.readUInt32BE(take(4));
    for (let i = 0; i < count; i++) {
      const name = bytes().toString();
      const issuer = bytes().toString();
      const algorithm = ALGORITHMS[data.readUInt8(take(1)) - 1];
      const digits = data.readUInt8(take(1));
      const period = data.readUInt32BE(take(4));
      const secret = bytes();
      if (!algorithm || (digits !== 6 && digits !== 8) || period === 0 || secret.length === 0) {
        secret.fill(0);
        throw new CorruptedError("an account record has invalid settings");
      }
      accounts.push({ name, issuer, secret, algorithm, digits, period });
    }
    if (at !== data.length) {
      throw new CorruptedError("unexpected data after the last account");
    }
  } catch (error) {
    for (const account of accounts) account.secret.fill(0);
    throw error;
  }
  return accounts;
}
