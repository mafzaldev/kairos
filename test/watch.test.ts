import { describe, expect, it } from "vitest";
import type { Account } from "../src/account.js";
import { frame, rows, type Row } from "../src/cli/commands/watch.js";
import { colors } from "../src/style.js";

const plain = colors(false);
const roomy = { columns: 80, rows: 24 };

function account(name: string, overrides: Partial<Account> = {}): Account {
  return {
    name,
    issuer: "",
    secret: Buffer.from("12345678901234567890"),
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    ...overrides,
  };
}

describe("rows", () => {
  it("computes every row for the same instant", () => {
    expect(
      rows([account("a"), account("b", { digits: 8, period: 60 })], 59_000),
    ).toEqual([
      { name: "a", code: "287082", seconds: 1, period: 30 },
      { name: "b", code: "84755224", seconds: 1, period: 60 },
    ]);
  });
});

describe("frame", () => {
  const list: Row[] = [
    { name: "GitHub:alice", code: "287082", seconds: 30, period: 30 },
    { name: "AWS:root", code: "94287082", seconds: 3, period: 60 },
  ];

  it("aligns names, codes and countdowns", () => {
    expect(frame(list, roomy, plain)).toEqual([
      "GitHub:alice  287 082    ██████████  30s",
      "AWS:root      9428 7082  █░░░░░░░░░   3s",
    ]);
  });

  it("never produces a line wider than the terminal", () => {
    const long = [{ ...list[0]!, name: "x".repeat(200) }];
    for (const columns of [40, 60]) {
      const [line] = frame(long, { columns, rows: 24 }, plain);
      expect(line!.length).toBeLessThanOrEqual(columns);
      expect(line).toContain("…");
    }
  });

  it("never produces more lines than fit", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      ...list[0]!,
      name: `account-${i}`,
    }));
    const lines = frame(many, { columns: 80, rows: 10 }, plain);
    expect(lines).toHaveLength(10);
    expect(lines.at(-1)).toBe("… 41 more");
  });

  it("highlights codes that are about to expire", () => {
    const lines = frame(list, roomy, colors(true));
    expect(lines[0]).not.toContain("\u001b[33m");
    expect(lines[1]).toContain("\u001b[33m");
  });
});
