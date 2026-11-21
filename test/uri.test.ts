import { describe, expect, it } from "vitest";
import type { Account } from "../src/account.js";
import { UriError } from "../src/errors.js";
import { format, parse } from "../src/uri/otpauth.js";

const SECRET = "JBSWY3DPEHPK3PXP";
const SECRET_HEX = "48656c6c6f21deadbeef";

describe("parse", () => {
  it("parses a full Google Authenticator style URI", () => {
    const account = parse(
      `otpauth://totp/ACME%20Co:john.doe@email.com?secret=${SECRET}&issuer=ACME%20Co&algorithm=SHA256&digits=8&period=60`,
    );
    expect(account.name).toBe("john.doe@email.com");
    expect(account.issuer).toBe("ACME Co");
    expect(account.secret.toString("hex")).toBe(SECRET_HEX);
    expect(account.algorithm).toBe("SHA256");
    expect(account.digits).toBe(8);
    expect(account.period).toBe(60);
  });

  it("applies the defaults when optional parameters are absent", () => {
    const account = parse(`otpauth://totp/alice?secret=${SECRET}`);
    expect(account).toMatchObject({
      name: "alice",
      issuer: "",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
    });
  });

  it("takes the issuer from the label prefix when there is no issuer parameter", () => {
    const account = parse(
      `otpauth://totp/Example:alice@example.com?secret=${SECRET}`,
    );
    expect(account.issuer).toBe("Example");
    expect(account.name).toBe("alice@example.com");
  });

  it("prefers the issuer parameter over the label prefix", () => {
    const account = parse(
      `otpauth://totp/Old:alice?secret=${SECRET}&issuer=New`,
    );
    expect(account.issuer).toBe("New");
    expect(account.name).toBe("alice");
  });

  it("accepts an encoded colon and spaces after the separator", () => {
    expect(
      parse(`otpauth://totp/Example%3Aalice?secret=${SECRET}`),
    ).toMatchObject({
      issuer: "Example",
      name: "alice",
    });
    expect(
      parse(`otpauth://totp/Example:%20alice?secret=${SECRET}`),
    ).toMatchObject({
      issuer: "Example",
      name: "alice",
    });
  });

  it("decodes percent-encoded and unicode labels", () => {
    const account = parse(
      `otpauth://totp/Caf%C3%A9%20Bank:z%C3%B6e%2Btest@example.com?secret=${SECRET}`,
    );
    expect(account.issuer).toBe("Café Bank");
    expect(account.name).toBe("zöe+test@example.com");
  });

  it("returns an empty name when the URI has no label", () => {
    expect(
      parse(`otpauth://totp/?secret=${SECRET}&issuer=Example`),
    ).toMatchObject({
      name: "",
      issuer: "Example",
    });
    expect(parse(`otpauth://totp?secret=${SECRET}`).name).toBe("");
  });

  it("is lenient about secret formatting, case of the type, and surrounding whitespace", () => {
    const account = parse(
      `  otpauth://TOTP/alice?secret=jbsw%20y3dp%20ehpk%203pxp&algorithm=sha512\n`,
    );
    expect(account.secret.toString("hex")).toBe(SECRET_HEX);
    expect(account.algorithm).toBe("SHA512");
  });

  it("accepts a padded secret and hyphenated algorithm names", () => {
    const account = parse(
      `otpauth://totp/a?secret=MZXW6YQ%3D&algorithm=SHA-256`,
    );
    expect(account.secret.toString("ascii")).toBe("foob");
    expect(account.algorithm).toBe("SHA256");
  });

  it("ignores unknown parameters", () => {
    const account = parse(
      `otpauth://totp/alice?secret=${SECRET}&image=https%3A%2F%2Fexample.com%2Flogo.png&foo=bar`,
    );
    expect(account.name).toBe("alice");
  });

  it("rejects hotp URIs with a clear message", () => {
    const attempt = () =>
      parse(`otpauth://hotp/Example:alice?secret=${SECRET}&counter=1`);
    expect(attempt).toThrow(UriError);
    expect(attempt).toThrow(/HOTP .* not supported/);
  });

  it("rejects other OTP types and a missing type", () => {
    expect(() => parse(`otpauth://steam/alice?secret=${SECRET}`)).toThrow(
      UriError,
    );
    expect(() => parse(`otpauth:///alice?secret=${SECRET}`)).toThrow(UriError);
  });

  it.each([
    ["empty string", ""],
    ["plain text", "not a uri"],
    ["wrong scheme", `https://totp/alice?secret=${SECRET}`],
    [
      "migration export",
      "otpauth-migration://offline?data=CjEKCkhlbGxvId6tvu8",
    ],
    ["missing secret", "otpauth://totp/alice?issuer=Example"],
    ["empty secret", "otpauth://totp/alice?secret="],
    ["invalid base32 secret", "otpauth://totp/alice?secret=NOT!BASE32"],
    ["impossible secret length", "otpauth://totp/alice?secret=ABC"],
    [
      "unknown algorithm",
      `otpauth://totp/alice?secret=${SECRET}&algorithm=MD5`,
    ],
    ["unsupported digits", `otpauth://totp/alice?secret=${SECRET}&digits=7`],
    ["non-numeric digits", `otpauth://totp/alice?secret=${SECRET}&digits=six`],
    ["zero period", `otpauth://totp/alice?secret=${SECRET}&period=0`],
    ["negative period", `otpauth://totp/alice?secret=${SECRET}&period=-30`],
    ["fractional period", `otpauth://totp/alice?secret=${SECRET}&period=30.5`],
    ["non-numeric period", `otpauth://totp/alice?secret=${SECRET}&period=abc`],
    ["malformed percent-encoding", `otpauth://totp/al%ZZice?secret=${SECRET}`],
  ])("rejects %s", (_label, uri) => {
    expect(() => parse(uri)).toThrow(UriError);
  });

  it("never echoes the secret in an error message", () => {
    for (const uri of [
      `otpauth://hotp/alice?secret=${SECRET}`,
      `otpauth://totp/alice?secret=${SECRET}&digits=7`,
      `otpauth://totp/alice?secret=${SECRET}1`,
      `otp://totp/alice?secret=${SECRET}`,
    ]) {
      try {
        parse(uri);
        expect.unreachable();
      } catch (error) {
        expect((error as Error).message).not.toContain(SECRET);
      }
    }
  });
});

describe("format", () => {
  const base: Account = {
    name: "alice@example.com",
    issuer: "Example",
    secret: Buffer.from(SECRET_HEX, "hex"),
    algorithm: "SHA1",
    digits: 6,
    period: 30,
  };

  it("produces a standard URI", () => {
    expect(format(base)).toBe(
      `otpauth://totp/Example:alice%40example.com?secret=${SECRET}&issuer=Example&algorithm=SHA1&digits=6&period=30`,
    );
  });

  it("omits the issuer when there is none", () => {
    expect(format({ ...base, issuer: "" })).toBe(
      `otpauth://totp/alice%40example.com?secret=${SECRET}&algorithm=SHA1&digits=6&period=30`,
    );
  });

  it.each<Partial<Account>>([
    {},
    { issuer: "" },
    { name: "work: admin", issuer: "" },
    { name: "a:b", issuer: "c:d" },
    { name: "Zoë & Co / 50% #1?", issuer: "Café Bank+" },
    { algorithm: "SHA512", digits: 8, period: 90 },
    { secret: Buffer.from("12345678901234567890123456789012", "ascii") },
  ])("round-trips %j", (overrides) => {
    const account = { ...base, ...overrides };
    expect(parse(format(account))).toEqual(account);
  });
});
