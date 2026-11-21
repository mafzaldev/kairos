import { describe, expect, it } from "vitest";
import { Base32Error } from "../src/errors.js";
import { decode, encode } from "../src/otp/base32.js";

// RFC 4648, section 10.
const RFC4648_VECTORS: ReadonlyArray<[plain: string, encoded: string]> = [
  ["f", "MY======"],
  ["fo", "MZXQ===="],
  ["foo", "MZXW6==="],
  ["foob", "MZXW6YQ="],
  ["fooba", "MZXW6YTB"],
  ["foobar", "MZXW6YTBOI======"],
];

describe("decode", () => {
  it.each(RFC4648_VECTORS)(
    "decodes the RFC 4648 vector for %j",
    (plain, encoded) => {
      expect(decode(encoded).toString("ascii")).toBe(plain);
    },
  );

  it.each(RFC4648_VECTORS)("decodes %j without padding", (plain, encoded) => {
    expect(decode(encoded.replace(/=+$/, "")).toString("ascii")).toBe(plain);
  });

  it("accepts lowercase and mixed case", () => {
    expect(decode("mzxw6ytboi").toString("ascii")).toBe("foobar");
    expect(decode("MzXw6YtBoI").toString("ascii")).toBe("foobar");
  });

  it("ignores spaces and other whitespace", () => {
    expect(decode("MZXW 6YTB OI").toString("ascii")).toBe("foobar");
    expect(decode("  mzxw\t6ytb\noi  ").toString("ascii")).toBe("foobar");
    expect(decode("jbsw y3dp ehpk 3pxp").toString("hex")).toBe(
      decode("JBSWY3DPEHPK3PXP").toString("hex"),
    );
  });

  it("decodes the RFC 6238 SHA1 seed", () => {
    expect(decode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ").toString("ascii")).toBe(
      "12345678901234567890",
    );
  });

  it("decodes binary data, including zero bytes", () => {
    expect(decode("AAAAAAAA")).toEqual(Buffer.alloc(5));
    expect(decode("77777777")).toEqual(Buffer.alloc(5, 0xff));
  });

  it.each([
    ["digit 0", "MZXW0YTB"],
    ["digit 1", "MZXW1YTB"],
    ["digit 8", "MZXW8YTB"],
    ["digit 9", "MZXW9YTB"],
    ["hyphen", "MZXW-6YTB"],
    ["punctuation", "MZXW6YT!"],
    ["non-ASCII letter", "MZXW6YTÉ"],
  ])("rejects an invalid character (%s)", (_label, input) => {
    expect(() => decode(input)).toThrow(Base32Error);
  });

  it("reports the position of an invalid character without echoing the input", () => {
    expect(() => decode("MZXW1YTB")).toThrow(/position 5/);
    try {
      decode("MZXW1YTB");
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain("MZXW");
    }
  });

  it.each(["", "   ", "===="])("rejects an empty value (%j)", (input) => {
    expect(() => decode(input)).toThrow(/empty/);
  });

  it.each(["M", "MZX", "MZXW6Y", "MZXW6YTBO"])(
    "rejects the impossible length of %j",
    (input) => {
      expect(() => decode(input)).toThrow(/not a possible length/);
    },
  );

  it("rejects padding in the middle of the data", () => {
    expect(() => decode("MZXW=6YTB")).toThrow(Base32Error);
  });

  it("rejects the wrong amount of padding", () => {
    expect(() => decode("MZXW6===")).not.toThrow();
    expect(() => decode("MZXW6=")).toThrow(/padding/);
    expect(() => decode("MZXW6YTB=")).toThrow(/padding/);
  });
});

describe("encode", () => {
  it.each(RFC4648_VECTORS)("encodes %j without padding", (plain, encoded) => {
    expect(encode(Buffer.from(plain, "ascii"))).toBe(
      encoded.replace(/=+$/, ""),
    );
  });

  it("round-trips every byte value at several lengths", () => {
    for (let length = 1; length <= 40; length++) {
      const data = Buffer.from(
        Array.from({ length }, (_, i) => (i * 37 + length * 11) & 0xff),
      );
      expect(decode(encode(data))).toEqual(data);
    }
  });

  it("encodes an empty buffer as an empty string", () => {
    expect(encode(Buffer.alloc(0))).toBe("");
  });
});
