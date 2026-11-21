import { describe, expect, it } from "vitest";
import type { Account } from "../src/account.js";
import { toBytes } from "../src/prompts/prompts.js";
import {
  toAccount,
  validatePassword,
  validatePeriod,
  validateSecret,
} from "../src/prompts/validate.js";
import {
  findAccount,
  findExisting,
  sortAccounts,
} from "../src/vault/accounts.js";

function account(name: string, issuer = ""): Account {
  return {
    name,
    issuer,
    secret: Buffer.from("12345678901234567890"),
    algorithm: "SHA1",
    digits: 6,
    period: 30,
  };
}

const ACCOUNTS = [
  account("alice@example.com", "GitHub"),
  account("bob@example.com", "GitHub"),
  account("alice@example.com", "GitLab"),
  account("git"),
  account("Proton Mail"),
];

describe("findAccount", () => {
  const find = (query: string, fuzzy = true): string => {
    const found = findAccount(ACCOUNTS, query, fuzzy);
    return found.issuer ? `${found.issuer}:${found.name}` : found.name;
  };

  it("prefers an exact name over longer names that contain it", () => {
    expect(find("git")).toBe("git");
    expect(find("GIT")).toBe("git");
  });

  it("matches the issuer:name label", () => {
    expect(find("github:alice@example.com")).toBe("GitHub:alice@example.com");
    expect(find("gitlab alice@example.com")).toBe("GitLab:alice@example.com");
    expect(find("gitlab:al")).toBe("GitLab:alice@example.com");
  });

  it("matches an issuer that identifies one account", () => {
    expect(find("gitlab")).toBe("GitLab:alice@example.com");
  });

  it("matches by prefix, then substring, then subsequence", () => {
    expect(find("prot")).toBe("Proton Mail");
    expect(find("mail")).toBe("Proton Mail");
    expect(find("bob")).toBe("GitHub:bob@example.com");
    expect(find("ptnml")).toBe("Proton Mail");
  });

  it("only uses subsequence matching when fuzzy is enabled", () => {
    expect(() => find("ptnml", false)).toThrow(/No account matches/);
    expect(find("prot", false)).toBe("Proton Mail");
  });

  it("refuses ambiguous queries and names the candidates", () => {
    expect(() => find("github")).toThrow(/more than one account/);
    expect(() => find("alice")).toThrow(
      /GitHub:alice@example.com[\s\S]*GitLab:alice@example.com/,
    );
  });

  it("reports no match", () => {
    expect(() => find("zzz")).toThrow(/No account matches/);
    expect(() => find("   ")).toThrow(/No account matches/);
    expect(() => findAccount([], "git")).toThrow(/No account matches/);
  });
});

describe("account identity", () => {
  it("treats issuer + name as the identity, ignoring case", () => {
    expect(
      findExisting(ACCOUNTS, { name: "ALICE@example.com", issuer: "github" }),
    ).toBe(ACCOUNTS[0]);
    expect(
      findExisting(ACCOUNTS, { name: "alice@example.com", issuer: "" }),
    ).toBeUndefined();
    expect(
      findExisting(ACCOUNTS, { name: "git", issuer: "" }, ACCOUNTS[3]),
    ).toBeUndefined();
  });

  it("sorts by issuer, then name", () => {
    expect(sortAccounts(ACCOUNTS).map((a) => `${a.issuer}:${a.name}`)).toEqual([
      ":git",
      ":Proton Mail",
      "GitHub:alice@example.com",
      "GitHub:bob@example.com",
      "GitLab:alice@example.com",
    ]);
  });
});

describe("form field rules", () => {
  const secret = Buffer.from("12345678901234567890");

  it("applies the defaults to a minimal draft", () => {
    expect(toAccount({ name: "  alice ", secret })).toEqual({
      name: "alice",
      issuer: "",
      secret,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
    });
  });

  it("requires a name and a secret", () => {
    expect(() => toAccount({ name: "alice" })).toThrow(/Secret is required/);
    expect(() => toAccount({ name: "  ", secret })).toThrow(/Name is required/);
  });

  it("validates names, periods and secrets", () => {
    expect(() => toAccount({ name: "a".repeat(101), secret })).toThrow(
      /at most 100/,
    );
    expect(() => toAccount({ name: "tab\there", secret })).toThrow(
      /control characters/,
    );
    expect(() => toAccount({ name: "alice", secret, period: 0 })).toThrow(
      /positive whole/,
    );
    expect(validatePeriod(" 45 ")).toBeUndefined();
    expect(validatePeriod("1e3")).toMatch(/positive whole number/);
    expect(validatePeriod("0")).toMatch(/positive whole number/);
    expect(validatePeriod("99999999")).toMatch(/at most/);
    expect(validateSecret("   ")).toMatch(/required/);
    expect(validateSecret("MZXW6YT1")).toMatch(/position 8/);
    expect(validateSecret("mzxw 6ytb oi")).toBeUndefined();
  });

  it("requires a reasonably long master password", () => {
    expect(validatePassword("1234567")).toMatch(/at least 8/);
    expect(validatePassword("12345678")).toBeUndefined();
    expect(validatePassword()).toMatch(/at least 8/);
  });

  it("normalises equivalent unicode passwords to the same bytes", () => {
    // "é" as one code point and as "e" + combining accent.
    expect(toBytes("café")).toEqual(toBytes("café"));
  });
});
