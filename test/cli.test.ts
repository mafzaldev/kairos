import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PASSWORD,
  RFC_SECRET,
  RFC_SECRET_SHA512,
  createHarness,
  type Harness,
} from "./helpers.js";

const fixture = (name: string): string =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

let h: Harness;

beforeEach(() => {
  h = createHarness();
});

afterEach(() => {
  h.cleanup();
});

/** Asserts that no captured line looks like an uncaught exception. */
function expectNoStackTrace(): void {
  for (const line of [...h.out, ...h.err]) {
    expect(line).not.toMatch(/^\s+at .+:\d+:\d+\)?$/m);
    expect(line).not.toMatch(/node:internal|Error:\s/);
  }
}

describe("init", () => {
  it("creates a vault with the password typed at the prompt", async () => {
    expect(await h.kairos("init")).toBe(0);
    expect(h.asked).toEqual(["New master password"]);
    expect(existsSync(h.vaultPath)).toBe(true);
    expect(h.out.join("\n")).toContain(h.vaultPath);
  });

  it("refuses to replace an existing vault, before asking anything", async () => {
    await h.kairos("init");
    const before = readFileSync(h.vaultPath);
    h.reset();

    expect(await h.kairos("init")).toBe(1);
    expect(h.err.join("\n")).toMatch(/already exists/);
    expect(h.asked).toEqual([]);
    expect(readFileSync(h.vaultPath).equals(before)).toBe(true);
  });
});

describe("without a terminal", () => {
  beforeEach(async () => {
    await h.kairos("init");
    await h.add("alice");
    h.reset();
    h.ctx.interactive = false;
  });

  it.each([
    ["init"],
    ["add", "bob"],
    ["add-uri", `otpauth://totp/bob?secret=${RFC_SECRET}`],
    ["import-qr", fixture("totp.png")],
    ["list"],
    ["code", "alice"],
    ["watch"],
    ["remove", "alice"],
    ["rename", "alice", "bob"],
    ["export", "backup.kairos"],
    ["export", "--plain"],
    ["import", "backup.kairos"],
    ["passwd"],
  ])("kairos %s refuses to run and never prompts", async (...argv) => {
    const before = readFileSync(h.vaultPath);
    expect(await h.kairos(...argv)).toBe(1);
    expect(h.err).toHaveLength(1);
    expect(h.err[0]).toMatch(/needs an interactive terminal/);
    expect(h.asked).toEqual([]);
    expect(h.out).toEqual([]);
    expect(readFileSync(h.vaultPath).equals(before)).toBe(true);
    expectNoStackTrace();
  });

  it("still shows help and the version", async () => {
    expect(await h.kairos("--help")).toBe(0);
    expect(await h.kairos("--version")).toBe(0);
  });
});

describe("add", () => {
  beforeEach(async () => {
    await h.kairos("init");
    h.reset();
  });

  it("saves what was entered in the form, applying the defaults", async () => {
    expect(await h.add("alice", { issuer: "GitHub" })).toBe(0);
    expect(h.asked).toEqual(["Master password", "account form"]);
    expect(h.out).toEqual(["Added GitHub:alice."]);

    h.reset();
    expect(await h.kairos("code", "alice")).toBe(0);
    // SHA1, 6 digits, 30 s period: the tail of the RFC 6238 vector for T = 59.
    expect(h.out).toEqual(["GitHub:alice  287 082  ░░░░░░░░░░   1s"]);
  });

  it("pre-fills the name given on the command line and asks for the secret", async () => {
    await h.add("alice@example.com");
    expect(h.forms).toEqual([
      { name: "alice@example.com", issuer: undefined, secretLocked: false },
    ]);

    h.reset();
    h.answers.form = { name: "typed", secret: RFC_SECRET };
    await h.kairos("add");
    expect(h.forms[0]?.name).toBeUndefined();
    expect(h.out).toEqual(["Added typed."]);
  });

  it("honours every field of the form", async () => {
    const entry = {
      secret: RFC_SECRET_SHA512,
      algorithm: "SHA512",
      digits: 8,
      period: 30,
    } as const;
    expect(await h.add("big", entry)).toBe(0);

    h.reset();
    await h.kairos("code", "big");
    expect(h.out[0]).toContain("9069 3936");
  });

  it("saves nothing when the form is cancelled", async () => {
    h.answers.form = "cancel";
    expect(await h.kairos("add", "alice")).toBe(130);
    expect(h.err).toEqual(["Cancelled."]);

    h.reset();
    await h.kairos("list");
    expect(h.out).toEqual([]);
  });

  it("rejects a duplicate issuer and name, ignoring case", async () => {
    await h.add("alice", { issuer: "GitHub" });
    h.reset();
    expect(await h.add("ALICE", { issuer: "github" })).toBe(1);
    expect(h.err[0]).toMatch(/already exists/);

    // The same name under another issuer is a different account.
    expect(await h.add("alice", { issuer: "GitLab" })).toBe(0);
  });

  it("no longer accepts the secret or other fields as flags", async () => {
    expect(await h.kairos("add", "alice", "--secret", RFC_SECRET)).toBe(1);
    expect(h.err.join("\n")).toMatch(/unknown option '--secret'/);
    h.reset();
    expect(await h.kairos("add", "alice", "--yes")).toBe(1);
    expect(h.err.join("\n")).toMatch(/unknown option '--yes'/);
    expect(h.asked).toEqual([]);
  });

  it("needs a vault", async () => {
    h.cleanup();
    expect(await h.add("alice")).toBe(1);
    expect(h.err[0]).toMatch(/No vault found.*kairos init/);
    expect(h.asked).toEqual([]);
  });
});

describe("add-uri and import-qr", () => {
  const uri = `otpauth://totp/Example:alice@example.com?secret=${RFC_SECRET}&issuer=Example&digits=8`;

  beforeEach(async () => {
    await h.kairos("init");
    h.reset();
  });

  it("opens the form pre-filled from the URI, with the secret locked", async () => {
    expect(await h.kairos("add-uri", uri)).toBe(0);
    expect(h.forms).toEqual([
      { name: "alice@example.com", issuer: "Example", secretLocked: true },
    ]);
    expect(h.out).toEqual(["Added Example:alice@example.com."]);

    h.reset();
    await h.kairos("code", "example");
    expect(h.out[0]).toContain("9428 7082");
  });

  it("lets the user rename the account in the form", async () => {
    h.answers.form = { name: "work", issuer: "Acme" };
    expect(await h.kairos("add-uri", uri)).toBe(0);
    expect(h.out).toEqual(["Added Acme:work."]);
  });

  it("rejects hotp URIs with a clear error, before asking anything", async () => {
    const hotp = `otpauth://hotp/Example:alice@example.com?secret=${RFC_SECRET}&counter=0`;
    expect(await h.kairos("add-uri", hotp)).toBe(1);
    expect(h.err[0]).toMatch(/HOTP .* not supported/);
    expect(h.err.join("\n")).not.toContain(RFC_SECRET);
    expect(h.asked).toEqual([]);
    expectNoStackTrace();
  });

  it.each(["totp.png", "totp.jpg", "totp-transparent.png"])(
    "reads the QR code in %s into the same form",
    async (image) => {
      expect(await h.kairos("import-qr", fixture(image))).toBe(0);
      expect(h.forms).toEqual([
        { name: "alice@example.com", issuer: "Example", secretLocked: true },
      ]);

      h.reset();
      await h.kairos("code", "alice");
      expect(h.out[0]).toContain("287 082");
    },
  );

  it("rejects a QR code holding an hotp URI", async () => {
    expect(await h.kairos("import-qr", fixture("hotp.png"))).toBe(1);
    expect(h.err[0]).toMatch(/HOTP .* not supported/);
  });

  it.each([
    ["not-otp.png", /not an authenticator setup code/],
    ["blank.png", /No QR code found/],
    ["missing.png", /Could not read the image/],
  ])("reports a clear error for %s", async (image, message) => {
    expect(await h.kairos("import-qr", fixture(image))).toBe(1);
    expect(h.err[0]).toMatch(message);
    expect(h.asked).toEqual([]);
    expectNoStackTrace();
  });

  it("rejects a file that is not an image", async () => {
    const file = path.join(h.dir, "notes.txt");
    writeFileSync(file, "hello");
    expect(await h.kairos("import-qr", file)).toBe(1);
    expect(h.err[0]).toMatch(/Unsupported image format/);
  });
});

describe("list, code, rename and remove", () => {
  beforeEach(async () => {
    await h.kairos("init");
    await h.add("alice", { issuer: "GitHub" });
    await h.add("bob", { issuer: "GitHub" });
    await h.add("personal");
    h.reset();
  });

  it("lists names and issuers, never secrets", async () => {
    expect(await h.kairos("list")).toBe(0);
    expect(h.out).toEqual(["personal\t", "alice\tGitHub", "bob\tGitHub"]);
    expect(h.out.join("\n")).not.toContain(RFC_SECRET);
  });

  it("prints an aligned table on a terminal", async () => {
    h.ctx.tty = true;
    await h.kairos("ls");
    expect(h.out).toEqual([
      "NAME      ISSUER",
      "personal  -",
      "alice     GitHub",
      "bob       GitHub",
    ]);
  });

  it("matches accounts by partial and fuzzy name", async () => {
    for (const query of [
      "personal",
      "PERS",
      "sonal",
      "prsnl",
      "github:alice",
      "ali",
    ]) {
      h.reset();
      expect(await h.kairos("code", query), query).toBe(0);
      expect(h.out[0], query).toContain("287 082");
    }
  });

  it("refuses to guess between several matches", async () => {
    expect(await h.kairos("code", "github")).toBe(1);
    expect(h.err[0]).toMatch(/matches more than one account/);
    expect(h.err[0]).toContain("GitHub:alice");
    expect(h.err[0]).toContain("GitHub:bob");
    expect(h.out).toEqual([]);
  });

  it("reports an unknown account", async () => {
    expect(await h.kairos("code", "nobody")).toBe(1);
    expect(h.err[0]).toMatch(/No account matches "nobody"/);
  });

  it("prints a snapshot from watch when stdout is not a terminal", async () => {
    expect(await h.kairos("watch")).toBe(0);
    expect(h.out).toHaveLength(3);
    expect(h.out[0]).toMatch(/^personal {6}287 082 .* 1s$/);
  });

  it("renames an account", async () => {
    expect(await h.kairos("rename", "personal", "home")).toBe(0);
    expect(h.out).toEqual(["Renamed personal to home."]);
    h.reset();
    await h.kairos("list");
    expect(h.out).toContain("home\t");
    expect(h.out).not.toContain("personal\t");
  });

  it("refuses a rename that would collide", async () => {
    expect(await h.kairos("rename", "alice", "Bob")).toBe(1);
    expect(h.err[0]).toMatch(/"GitHub:Bob" already exists/);
    expect(await h.kairos("rename", "alice", "  ")).toBe(1);
  });

  it("allows a rename that only changes case", async () => {
    expect(await h.kairos("rename", "alice", "Alice")).toBe(0);
  });

  it("removes an account only after confirmation", async () => {
    h.answers.confirm = false;
    expect(await h.kairos("remove", "personal")).toBe(0);
    expect(h.asked.at(-1)).toMatch(/^Remove "personal"\?/);
    expect(h.err).toEqual(["Nothing was removed."]);
    h.reset();
    await h.kairos("list");
    expect(h.out).toHaveLength(3);

    h.reset();
    h.answers.confirm = true;
    expect(await h.kairos("rm", "personal")).toBe(0);
    expect(h.out).toEqual(["Removed personal."]);
    h.reset();
    await h.kairos("list");
    expect(h.out).toEqual(["alice\tGitHub", "bob\tGitHub"]);
  });

  it("does not fuzzy-match when removing, and has no --yes shortcut", async () => {
    expect(await h.kairos("remove", "prsnl")).toBe(1);
    expect(h.err[0]).toMatch(/No account matches/);
    h.reset();
    expect(await h.kairos("remove", "personal", "--yes")).toBe(1);
    expect(h.err.join("\n")).toMatch(/unknown option '--yes'/);
  });
});

describe("wrong password and damaged vaults", () => {
  beforeEach(async () => {
    await h.kairos("init");
    await h.add("alice");
    h.reset();
  });

  it("gives up after three wrong passwords, without a stack trace", async () => {
    h.answers.passwords = ["not the password"];
    for (const argv of [
      ["list"],
      ["code", "alice"],
      ["add", "x"],
      ["passwd"],
    ]) {
      h.reset();
      expect(await h.kairos(...argv)).toBe(1);
      expect(h.asked).toEqual([
        "Master password",
        "Master password",
        "Master password",
      ]);
      expect(h.err).toEqual([
        "Incorrect password. Try again.",
        "Incorrect password. Try again.",
        "error: Incorrect password.",
      ]);
      expect(h.out).toEqual([]);
      expectNoStackTrace();
    }
  });

  it("accepts the right password on a later attempt", async () => {
    h.answers.passwords = ["first guess", "second guess", PASSWORD];
    expect(await h.kairos("list")).toBe(0);
    expect(h.out).toEqual(["alice\t"]);
  });

  it("detects a corrupted vault and leaves it alone", async () => {
    const damaged = readFileSync(h.vaultPath);
    damaged[damaged.length - 40]! ^= 0xff;
    writeFileSync(h.vaultPath, damaged);

    expect(await h.kairos("list")).toBe(1);
    expect(h.err).toHaveLength(1);
    expect(h.err[0]).toMatch(/corrupted/);
    expect(h.err[0]).not.toMatch(/password/i);
    expectNoStackTrace();
    expect(readFileSync(h.vaultPath).equals(damaged)).toBe(true);
  });

  it("rejects a file that is not a vault", async () => {
    writeFileSync(h.vaultPath, "definitely not a vault");
    expect(await h.kairos("code", "alice")).toBe(1);
    expect(h.err[0]).toMatch(/not a kairos vault/);
  });
});

describe("export and import", () => {
  let backup: string;

  beforeEach(async () => {
    backup = path.join(h.dir, "backup.kairos");
    await h.kairos("init");
    await h.add("alice", { issuer: "GitHub" });
    await h.add("big", { secret: RFC_SECRET_SHA512, algorithm: "SHA512" });
    h.reset();
  });

  it("writes an encrypted backup that contains no plaintext", async () => {
    expect(await h.kairos("export", backup)).toBe(0);
    const raw = readFileSync(backup);
    expect(raw.subarray(0, 6).toString("ascii")).toBe("KAIROS");
    expect(raw.includes("alice")).toBe(false);
    expect(raw.includes("12345678901234567890")).toBe(false);
  });

  it("will not overwrite a backup without --force", async () => {
    await h.kairos("export", backup);
    h.reset();
    expect(await h.kairos("export", backup)).toBe(1);
    expect(h.err[0]).toMatch(/already exists.*--force/);
    expect(await h.kairos("export", backup, "--force")).toBe(0);
  });

  it("will not export over the vault itself", async () => {
    expect(await h.kairos("export", h.vaultPath, "--force")).toBe(1);
    expect(h.err[0]).toMatch(/vault itself/);
  });

  it("restores a backup into a new vault that has the same password", async () => {
    await h.kairos("export", backup);

    const other = createHarness();
    try {
      await other.kairos("init");
      other.reset();

      expect(await other.kairos("import", backup)).toBe(0);
      expect(other.asked).toEqual(["Master password"]);
      expect(other.out).toEqual(["Imported 2 new accounts."]);

      other.reset();
      await other.kairos("code", "alice");
      expect(other.out[0]).toContain("287 082");
      other.reset();
      await other.kairos("code", "big");
      expect(other.out[0]).toContain("693 936");
    } finally {
      other.cleanup();
    }
  });

  it("asks for the backup password when it differs from the vault password", async () => {
    await h.kairos("export", backup);

    const other = createHarness();
    try {
      other.answers.newPassword = "another master password";
      await other.kairos("init");
      other.reset();

      other.answers.passwords = [
        "another master password",
        "a wrong guess",
        PASSWORD,
      ];
      expect(await other.kairos("import", backup)).toBe(0);
      expect(other.asked).toEqual([
        "Master password",
        "Backup password",
        "Backup password",
      ]);
      expect(other.err).toEqual([
        "This backup was made with a different master password.",
        "Incorrect password. Try again.",
      ]);
      expect(other.out).toEqual(["Imported 2 new accounts."]);

      other.reset();
      other.answers.passwords = ["another master password", "never right"];
      expect(await other.kairos("import", backup)).toBe(1);
      expect(other.err.at(-1)).toBe("error: Incorrect password.");
    } finally {
      other.cleanup();
    }
  });

  it("is idempotent and reports conflicts instead of overwriting", async () => {
    await h.kairos("export", backup);
    await h.kairos("remove", "big");
    await h.kairos("remove", "alice");
    await h.add("alice", { issuer: "GitHub", secret: "JBSWY3DPEHPK3PXP" });
    h.reset();

    expect(await h.kairos("import", backup)).toBe(0);
    expect(h.out).toEqual(["Imported 1 new account."]);
    expect(h.err.join("\n")).toMatch(
      /Skipped 1 account .*--overwrite.*GitHub:alice/s,
    );

    h.reset();
    expect(await h.kairos("import", backup, "--overwrite")).toBe(0);
    expect(h.out).toEqual([
      "Imported 0 new accounts (1 replaced, 1 already present).",
    ]);

    h.reset();
    expect(await h.kairos("import", backup)).toBe(0);
    expect(h.out).toEqual(["Imported 0 new accounts (2 already present)."]);
    expect(h.err).toEqual([]);
  });

  it("rejects a missing or damaged backup before asking for a password", async () => {
    expect(await h.kairos("import", path.join(h.dir, "nope"))).toBe(1);
    expect(h.err[0]).toMatch(/Backup file not found/);

    h.reset();
    writeFileSync(backup, "garbage");
    expect(await h.kairos("import", backup)).toBe(1);
    expect(h.err[0]).toMatch(/corrupted or not a kairos vault/);
    expect(h.asked).toEqual([]);
  });

  it("prints plaintext URIs only after a warning and a confirmation", async () => {
    h.answers.confirm = false;
    expect(await h.kairos("export", "--plain")).toBe(0);
    expect(h.err[0]).toMatch(/every secret in plaintext/);
    expect(h.err.at(-1)).toBe("Nothing was exported.");
    expect(h.asked).toEqual(["Print all secrets in plaintext?"]);
    expect(h.out).toEqual([]);

    h.reset();
    h.answers.confirm = true;
    expect(await h.kairos("export", "--plain")).toBe(0);
    expect(h.asked).toEqual([
      "Print all secrets in plaintext?",
      "Master password",
    ]);
    expect(h.out).toEqual([
      `otpauth://totp/big?secret=${RFC_SECRET_SHA512}&algorithm=SHA512&digits=6&period=30`,
      `otpauth://totp/GitHub:alice?secret=${RFC_SECRET}&issuer=GitHub&algorithm=SHA1&digits=6&period=30`,
    ]);
  });

  it("requires a destination unless --plain is given, and not both", async () => {
    expect(await h.kairos("export")).toBe(1);
    expect(h.err[0]).toMatch(/kairos export <file>/);
    h.reset();
    expect(await h.kairos("export", backup, "--plain")).toBe(1);
    expect(existsSync(backup)).toBe(false);
    expect(h.out).toEqual([]);
  });
});

describe("passwd", () => {
  beforeEach(async () => {
    await h.kairos("init");
    await h.add("alice");
    h.reset();
  });

  it("changes the master password", async () => {
    h.answers.newPassword = "a different passphrase";
    expect(await h.kairos("passwd")).toBe(0);
    expect(h.asked).toEqual(["Master password", "New master password"]);

    h.reset();
    expect(await h.kairos("list")).toBe(1);
    expect(h.err.at(-1)).toBe("error: Incorrect password.");

    h.reset();
    h.answers.passwords = ["a different passphrase"];
    expect(await h.kairos("list")).toBe(0);
    expect(h.out).toEqual(["alice\t"]);
  });
});

describe("program", () => {
  it("prints the version from package.json", async () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    expect(await h.kairos("--version")).toBe(0);
    expect(h.out).toEqual([manifest.version]);
  });

  it("shows help without touching the vault", async () => {
    expect(await h.kairos("--help")).toBe(0);
    expect(h.out.join("\n")).toMatch(/Usage: kairos/);
    expect(existsSync(h.vaultPath)).toBe(false);
  });

  it("reports unknown commands and missing arguments as usage errors", async () => {
    expect(await h.kairos("frobnicate")).toBe(1);
    expect(h.err.join("\n")).toMatch(/unknown command/);
    h.reset();
    expect(await h.kairos("code")).toBe(1);
    expect(h.err.join("\n")).toMatch(/missing required argument/);
    expectNoStackTrace();
  });

  it("does not read a password from the environment", async () => {
    await h.kairos("init");
    await h.add("alice");
    h.reset();
    h.ctx.env.KAIROS_PASSWORD = PASSWORD;
    h.answers.passwords = ["not the password"];
    expect(await h.kairos("list")).toBe(1);
    expect(h.asked).toHaveLength(3);
  });

  it("never writes a secret to stdout or stderr outside export --plain", async () => {
    await h.kairos("init");
    await h.add("alice", { issuer: "GitHub" });
    await h.kairos("add-uri", `otpauth://totp/Ex:bob?secret=${RFC_SECRET}`);
    await h.kairos("list");
    await h.kairos("code", "alice");
    await h.kairos("watch");
    await h.kairos("rename", "alice", "carol");
    await h.kairos("export", path.join(h.dir, "b.kairos"));
    await h.kairos("import", path.join(h.dir, "b.kairos"));
    await h.kairos("remove", "carol");

    const everything = [...h.out, ...h.err].join("\n");
    expect(everything).not.toContain(RFC_SECRET);
    expect(everything).not.toContain("12345678901234567890");
    expect(everything).not.toContain(PASSWORD);
  });
});
