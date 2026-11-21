import { describe, expect, it } from "vitest";
import { remaining, totp } from "../src/otp/totp.js";
import type { Algorithm } from "../src/otp/types.js";

// RFC 6238, Appendix B. Each algorithm uses the ASCII seed "1234567890" repeated
// to the HMAC's output length (20, 32 and 64 bytes).
const SEEDS: Record<Algorithm, Buffer> = {
  SHA1: Buffer.from("12345678901234567890"),
  SHA256: Buffer.from("12345678901234567890123456789012"),
  SHA512: Buffer.from(
    "1234567890123456789012345678901234567890123456789012345678901234",
  ),
};

const RFC6238_VECTORS: Array<{
  time: number;
  algorithm: Algorithm;
  code: string;
}> = [
  { time: 59, algorithm: "SHA1", code: "94287082" },
  { time: 59, algorithm: "SHA256", code: "46119246" },
  { time: 59, algorithm: "SHA512", code: "90693936" },
  { time: 1111111109, algorithm: "SHA1", code: "07081804" },
  { time: 1111111109, algorithm: "SHA256", code: "68084774" },
  { time: 1111111109, algorithm: "SHA512", code: "25091201" },
  { time: 1111111111, algorithm: "SHA1", code: "14050471" },
  { time: 1111111111, algorithm: "SHA256", code: "67062674" },
  { time: 1111111111, algorithm: "SHA512", code: "99943326" },
  { time: 1234567890, algorithm: "SHA1", code: "89005924" },
  { time: 1234567890, algorithm: "SHA256", code: "91819424" },
  { time: 1234567890, algorithm: "SHA512", code: "93441116" },
  { time: 2000000000, algorithm: "SHA1", code: "69279037" },
  { time: 2000000000, algorithm: "SHA256", code: "90698825" },
  { time: 2000000000, algorithm: "SHA512", code: "38618901" },
  { time: 20000000000, algorithm: "SHA1", code: "65353130" },
  { time: 20000000000, algorithm: "SHA256", code: "77737706" },
  { time: 20000000000, algorithm: "SHA512", code: "47863826" },
];

const key = (algorithm: Algorithm, digits = 8, period = 30) => ({
  secret: SEEDS[algorithm],
  algorithm,
  digits,
  period,
});

describe("totp (RFC 6238 Appendix B)", () => {
  it.each(RFC6238_VECTORS)(
    "$algorithm at T=$time -> $code",
    ({ time, algorithm, code }) => {
      expect(totp(key(algorithm), time * 1000)).toBe(code);
    },
  );
});

describe("time handling", () => {
  const sha1 = key("SHA1", 6);

  it("holds the code for the whole period and changes on the boundary", () => {
    const code = totp(sha1, 30_000);
    expect(code).toBe("287082");
    expect(totp(sha1, 59_999)).toBe(code);
    expect(totp(sha1, 60_000)).not.toBe(code);
  });

  it("honours a custom period", () => {
    expect(totp(key("SHA1", 6, 60), 119_000)).toBe(totp(sha1, 59_000));
  });

  it("counts down the seconds remaining in the period", () => {
    expect(remaining(30, 0)).toBe(30);
    expect(remaining(30, 1_000)).toBe(29);
    expect(remaining(30, 29_999)).toBe(1);
    expect(remaining(30, 30_000)).toBe(30);
    expect(remaining(60, 75_000)).toBe(45);
  });

  it("uses the system clock by default", () => {
    expect(totp(sha1)).toBe(totp(sha1, Date.now()));
  });
});
