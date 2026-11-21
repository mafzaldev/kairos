import { hotp } from "./hotp.js";
import type { Algorithm } from "./types.js";

export interface TotpKey {
  secret: Uint8Array;
  algorithm: Algorithm;
  digits: number;
  period: number;
}

/**
 * RFC 6238: HOTP with the number of periods since the Unix epoch as the counter.
 * `now` is in milliseconds; passing it makes the result reproducible.
 */
export function totp(key: TotpKey, now = Date.now()): string {
  const counter = Math.floor(now / 1000 / key.period);
  return hotp(key.secret, BigInt(counter), key.algorithm, key.digits);
}

/** Seconds until the code changes, from 1 to `period`. */
export function remaining(period: number, now = Date.now()): number {
  return period - (Math.floor(now / 1000) % period);
}
