import { createHmac } from "node:crypto";
import { DEFAULTS, type Algorithm } from "./types.js";

/**
 * RFC 4226. Internal building block for TOTP; kairos has no HOTP accounts.
 */
export function hotp(secret: Uint8Array, counter: bigint, algorithm: Algorithm = DEFAULTS.algorithm, digits: number = DEFAULTS.digits): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const hmac = createHmac(algorithm.toLowerCase(), secret).update(message).digest();

  // Dynamic truncation (section 5.3): the last 4 bits pick where to read a
  // 31-bit number from. Dropping the top bit avoids signed/unsigned confusion.
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const number = hmac.readUInt32BE(offset) & 0x7fffffff;
  hmac.fill(0);

  return String(number % 10 ** digits).padStart(digits, "0");
}
