import { describe, expect, it } from "vitest";
import { hotp } from "../src/otp/hotp.js";

// RFC 4226, Appendix D: the secret is the ASCII string "12345678901234567890".
const SECRET = Buffer.from("12345678901234567890");

const RFC4226_CODES = [
  "755224",
  "287082",
  "359152",
  "969429",
  "338314",
  "254676",
  "287922",
  "162583",
  "399871",
  "520489",
];

describe("hotp (RFC 4226 Appendix D)", () => {
  it.each(RFC4226_CODES.map((code, count) => ({ count, code })))(
    "count $count -> $code",
    ({ count, code }) => {
      expect(hotp(SECRET, BigInt(count))).toBe(code);
    },
  );

  it("produces 7 and 8 digit codes from the same truncated value", () => {
    // The RFC lists 137359152 as the truncated value for count 2.
    expect(hotp(SECRET, 2n, "SHA1", 8)).toBe("37359152");
    expect(hotp(SECRET, 2n, "SHA1", 7)).toBe("7359152");
  });
});
