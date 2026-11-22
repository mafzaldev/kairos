import type { Account } from "../account.js";
import { Base32Error, UriError } from "../errors.js";
import * as base32 from "../otp/base32.js";
import { ALGORITHMS, DEFAULTS, MAX_PERIOD, type Algorithm } from "../otp/types.js";

const EXAMPLE = "otpauth://totp/Issuer:account?secret=BASE32SECRET";

function decodePart(raw: string): string {
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    throw new UriError("The account label in the URI has invalid percent-encoding.");
  }
}

// "Issuer:account". The colon may be literal or percent-encoded; a literal one wins.
function splitLabel(path: string): [issuer: string, name: string] {
  const raw = path.replace(/^\/+/, "");
  let at = raw.indexOf(":");
  let width = 1;
  if (at === -1) {
    at = raw.search(/%3a/i);
    width = 3;
  }
  if (at === -1) return ["", decodePart(raw)];
  return [decodePart(raw.slice(0, at)), decodePart(raw.slice(at + width))];
}

/**
 * Parses the "Key Uri Format" Google Authenticator uses. `name` comes back
 * empty when the URI has no label. Errors never quote the URI: it holds the secret.
 */
export function parse(text: string): Account {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    throw new UriError(`Not a valid URI. Expected something like ${EXAMPLE}`);
  }

  if (url.protocol !== "otpauth:") {
    throw new UriError(`Not an otpauth:// URI. Expected something like ${EXAMPLE}`);
  }

  const type = url.hostname.toLowerCase();
  if (type === "hotp") {
    throw new UriError("HOTP (counter-based) accounts are not supported: kairos only handles time-based TOTP codes.");
  }
  if (type !== "totp") {
    throw new UriError(`Not a TOTP setup URI. Expected something like ${EXAMPLE}`);
  }

  const query = url.searchParams;

  const algorithm = (query.get("algorithm") ?? DEFAULTS.algorithm).toUpperCase().replace("-", "");
  if (!ALGORITHMS.includes(algorithm as Algorithm)) {
    throw new UriError(`Unsupported algorithm in URI. Supported: ${ALGORITHMS.join(", ")}.`);
  }

  const digits = Number(query.get("digits") ?? DEFAULTS.digits);
  if (digits !== 6 && digits !== 8) {
    throw new UriError("Unsupported digits in URI. Supported: 6 or 8.");
  }

  const period = Number(query.get("period") ?? DEFAULTS.period);
  if (!Number.isInteger(period) || period <= 0 || period > MAX_PERIOD) {
    throw new UriError("Invalid period in URI. It must be a positive whole number of seconds.");
  }

  let secret: Buffer;
  try {
    secret = base32.decode(query.get("secret") ?? "");
  } catch (error) {
    if (!(error instanceof Base32Error)) throw error;
    throw new UriError(`The secret in the URI is missing or not valid. ${error.message}`);
  }

  const [labelIssuer, name] = splitLabel(url.pathname);
  return {
    name,
    issuer: query.get("issuer")?.trim() || labelIssuer,
    secret,
    algorithm: algorithm as Algorithm,
    digits,
    period,
  };
}

/** The result contains the secret in plaintext. */
export function format(account: Account): string {
  const name = encodeURIComponent(account.name);
  // Always separate with a literal colon when there is an issuer, or when the
  // name itself contains one, so a name with ":" survives a round trip.
  const path = account.issuer || account.name.includes(":") ? `${encodeURIComponent(account.issuer)}:${name}` : name;

  const query = [`secret=${base32.encode(account.secret)}`];
  if (account.issuer) query.push(`issuer=${encodeURIComponent(account.issuer)}`);
  query.push(`algorithm=${account.algorithm}`, `digits=${account.digits}`, `period=${account.period}`);
  return `otpauth://totp/${path}?${query.join("&")}`;
}
