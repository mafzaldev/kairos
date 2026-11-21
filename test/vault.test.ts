import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Account } from "../src/account.js";
import { CorruptedError, WrongPasswordError } from "../src/errors.js";
import { newKey, open, seal } from "../src/vault/crypto.js";
import {
  SCRYPT,
  deserialize,
  serialize,
  type ScryptParams,
} from "../src/vault/format.js";
import * as paths from "../src/vault/paths.js";
import { Vault } from "../src/vault/vault.js";

// Cheap scrypt parameters keep the suite fast; the production default is checked separately.
const FAST: ScryptParams = { logN: 10, r: 8, p: 1 };
const PASSWORD = Buffer.from("correct horse battery staple");
const posixOnly = process.platform === "win32" ? it.skip : it;

function sampleAccounts(): Account[] {
  return [
    {
      name: "alice@example.com",
      issuer: "GitHub",
      secret: Buffer.from("12345678901234567890", "ascii"),
      algorithm: "SHA1",
      digits: 6,
      period: 30,
    },
    {
      name: "zoë",
      issuer: "",
      secret: Buffer.from("00ff10ef20df30cf", "hex"),
      algorithm: "SHA512",
      digits: 8,
      period: 60,
    },
  ];
}

/** Recomputes the trailing checksum so a deliberate edit looks like an intact file. */
function fixChecksum(file: Buffer): Buffer {
  const body = file.subarray(0, file.length - 32);
  return Buffer.concat([body, createHash("sha256").update(body).digest()]);
}

let dir: string;
let vaultPath: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "kairos-test-"));
  vaultPath = path.join(dir, "nested", "vault.enc");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("payload encoding", () => {
  it("round-trips accounts", () => {
    const accounts = sampleAccounts();
    expect(deserialize(serialize(accounts))).toEqual(accounts);
    expect(deserialize(serialize([]))).toEqual([]);
  });

  it("returns secrets that do not alias the decoded buffer", () => {
    const encoded = serialize(sampleAccounts());
    const decoded = deserialize(encoded);
    encoded.fill(0);
    expect(decoded[0]?.secret.toString("ascii")).toBe("12345678901234567890");
  });

  it("rejects truncated, padded and nonsensical data", () => {
    const encoded = serialize(sampleAccounts());
    expect(() => deserialize(encoded.subarray(0, encoded.length - 1))).toThrow(
      CorruptedError,
    );
    expect(() =>
      deserialize(Buffer.concat([encoded, Buffer.from([0])])),
    ).toThrow(CorruptedError);
    expect(() => deserialize(Buffer.alloc(2))).toThrow(CorruptedError);
    expect(() => deserialize(Buffer.from("ffffffff", "hex"))).toThrow(
      CorruptedError,
    );
  });
});

describe("vault round trip", () => {
  it("creates an empty vault and reopens it", async () => {
    const created = await Vault.create(vaultPath, PASSWORD, FAST);
    expect(created.accounts).toEqual([]);
    created.close();

    const reopened = await Vault.open(vaultPath, PASSWORD);
    expect(reopened.accounts).toEqual([]);
    reopened.close();
  });

  it("persists accounts across save and open", async () => {
    const vault = await Vault.create(vaultPath, PASSWORD, FAST);
    vault.accounts.push(...sampleAccounts());
    vault.save();
    vault.close();

    const reopened = await Vault.open(vaultPath, PASSWORD);
    expect(reopened.accounts).toEqual(sampleAccounts());
    reopened.close();
  });

  it("never writes secrets, names or the password in plaintext", async () => {
    const vault = await Vault.create(vaultPath, PASSWORD, FAST);
    vault.accounts.push(...sampleAccounts());
    vault.save();
    vault.close();

    const raw = readFileSync(vaultPath);
    for (const needle of [
      "12345678901234567890",
      "alice@example.com",
      "GitHub",
      "correct horse",
    ]) {
      expect(raw.includes(needle)).toBe(false);
    }
    expect(raw.subarray(0, 6).toString("ascii")).toBe("KAIROS");
  });

  it("uses a fresh IV for every save", async () => {
    const vault = await Vault.create(vaultPath, PASSWORD, FAST);
    const first = readFileSync(vaultPath);
    vault.save();
    const second = readFileSync(vaultPath);
    vault.close();

    expect(first.subarray(44, 56).equals(second.subarray(44, 56))).toBe(false);
    expect(first.subarray(12, 44).equals(second.subarray(12, 44))).toBe(true);
  });

  it("refuses to overwrite an existing vault", async () => {
    (await Vault.create(vaultPath, PASSWORD, FAST)).close();
    await expect(Vault.create(vaultPath, PASSWORD, FAST)).rejects.toThrow(
      /already exists/,
    );
  });

  it("wipes secrets on close", async () => {
    const vault = await Vault.create(vaultPath, PASSWORD, FAST);
    vault.accounts.push(...sampleAccounts());
    const secret = vault.accounts[0]!.secret;
    vault.close();
    expect(secret.equals(Buffer.alloc(secret.length))).toBe(true);
    expect(vault.accounts).toEqual([]);
  });

  it("leaves no temporary files behind", async () => {
    const vault = await Vault.create(vaultPath, PASSWORD, FAST);
    vault.save();
    vault.save();
    vault.close();
    expect(readdirSync(path.dirname(vaultPath))).toEqual(["vault.enc"]);
  });

  posixOnly(
    "creates the file with mode 0600 and the directory with mode 0700",
    async () => {
      const vault = await Vault.create(vaultPath, PASSWORD, FAST);
      vault.save();
      vault.close();
      expect(statSync(vaultPath).mode & 0o777).toBe(0o600);
      expect(statSync(path.dirname(vaultPath)).mode & 0o777).toBe(0o700);
    },
  );

  it("stores the strong default scrypt parameters in the header", async () => {
    expect(SCRYPT).toEqual({ logN: 17, r: 8, p: 1 });
    const vault = await Vault.create(vaultPath, PASSWORD);
    vault.close();
    expect([...readFileSync(vaultPath).subarray(6, 12)]).toEqual([
      1, 1, 17, 8, 1, 0,
    ]);
    (await Vault.open(vaultPath, PASSWORD)).close();
  });
});

describe("wrong password", () => {
  it("rejects a wrong password without revealing anything", async () => {
    (await Vault.create(vaultPath, PASSWORD, FAST)).close();
    await expect(
      Vault.open(vaultPath, Buffer.from("wrong password")),
    ).rejects.toThrow(WrongPasswordError);
    await expect(Vault.open(vaultPath, Buffer.alloc(0))).rejects.toThrow(
      WrongPasswordError,
    );
  });

  it("accepts only the new password after a password change", async () => {
    const vault = await Vault.create(vaultPath, PASSWORD, FAST);
    vault.accounts.push(...sampleAccounts());
    vault.save();
    const saltBefore = readFileSync(vaultPath).subarray(12, 44);

    const next = Buffer.from("a brand new passphrase");
    await vault.changePassword(next, FAST);
    vault.close();

    expect(readFileSync(vaultPath).subarray(12, 44).equals(saltBefore)).toBe(
      false,
    );
    await expect(Vault.open(vaultPath, PASSWORD)).rejects.toThrow(
      WrongPasswordError,
    );
    const reopened = await Vault.open(vaultPath, next);
    expect(reopened.accounts).toEqual(sampleAccounts());
    reopened.close();
  });
});

describe("corrupted vault detection", () => {
  async function writeVault(): Promise<Buffer> {
    const vault = await Vault.create(vaultPath, PASSWORD, FAST);
    vault.accounts.push(...sampleAccounts());
    vault.save();
    vault.close();
    return readFileSync(vaultPath);
  }

  async function openModified(file: Buffer): Promise<unknown> {
    mkdirSync(path.dirname(vaultPath), { recursive: true });
    writeFileSync(vaultPath, file);
    return Vault.open(vaultPath, PASSWORD).then(
      (vault) => vault.close(),
      (error: unknown) => error,
    );
  }

  it("detects a flipped bit anywhere in the file", async () => {
    const original = await writeVault();
    // Skip the magic and version bytes, which have their own dedicated errors.
    for (const offset of [
      7,
      8,
      12,
      44,
      56,
      72,
      original.length - 33,
      original.length - 1,
    ]) {
      const damaged = Buffer.from(original);
      damaged[offset]! ^= 0x01;
      expect(await openModified(damaged), `offset ${offset}`).toBeInstanceOf(
        CorruptedError,
      );
    }
  });

  it("detects truncation and trailing garbage", async () => {
    const original = await writeVault();
    for (const length of [0, 3, 6, 7, 60, 103, original.length - 1]) {
      expect(
        await openModified(original.subarray(0, length)),
        `length ${length}`,
      ).toBeInstanceOf(CorruptedError);
    }
    expect(
      await openModified(Buffer.concat([original, Buffer.from("x")])),
    ).toBeInstanceOf(CorruptedError);
  });

  it("rejects files that are not vaults", async () => {
    expect(await openModified(Buffer.from('{"accounts": []}'))).toBeInstanceOf(
      CorruptedError,
    );
    expect(await openModified(Buffer.alloc(4096))).toBeInstanceOf(
      CorruptedError,
    );
  });

  it("reports an unsupported format version", async () => {
    const original = await writeVault();
    const future = Buffer.from(original);
    future[6] = 2;
    expect(String(await openModified(future))).toMatch(
      /Unsupported vault format version 2/,
    );
  });

  it("rejects out-of-range key derivation parameters before deriving", async () => {
    const original = await writeVault();
    const hostile = Buffer.from(original);
    hostile[8] = 40;
    expect(await openModified(fixChecksum(hostile))).toBeInstanceOf(
      CorruptedError,
    );
  });

  it("authenticates the header and ciphertext even when the checksum is repaired", async () => {
    const original = await writeVault();
    // Offsets: scrypt p, salt, IV, auth tag, ciphertext.
    for (const offset of [10, 12, 44, 56, 72]) {
      const tampered = Buffer.from(original);
      tampered[offset]! ^= 0x02;
      expect(
        await openModified(fixChecksum(tampered)),
        `offset ${offset}`,
      ).toBeInstanceOf(WrongPasswordError);
    }
  });

  it("leaves the damaged file untouched", async () => {
    const original = await writeVault();
    const damaged = Buffer.from(original);
    damaged[80]! ^= 0xff;
    await openModified(damaged);
    expect(readFileSync(vaultPath).equals(damaged)).toBe(true);
  });
});

describe("backups", () => {
  it("reads a backup with the vault key when it was made with the same password", async () => {
    const vault = await Vault.create(vaultPath, PASSWORD, FAST);
    vault.accounts.push(...sampleAccounts());
    const backupPath = path.join(dir, "backup.kairos");
    vault.backup(backupPath);

    const restored = await vault.readBackup(readFileSync(backupPath));
    expect(restored).toEqual(sampleAccounts());
    vault.close();
  });

  it("needs the old password for a backup made before a password change", async () => {
    const vault = await Vault.create(vaultPath, PASSWORD, FAST);
    vault.accounts.push(...sampleAccounts());
    const backupPath = path.join(dir, "backup.kairos");
    vault.backup(backupPath);
    const backup = readFileSync(backupPath);

    const next = Buffer.from("a brand new passphrase");
    await vault.changePassword(next, FAST);

    await expect(vault.readBackup(backup)).rejects.toThrow(WrongPasswordError);
    await expect(vault.readBackup(backup, next)).rejects.toThrow(
      WrongPasswordError,
    );
    expect(await vault.readBackup(backup, PASSWORD)).toEqual(sampleAccounts());
    vault.close();
  });

  it("opens a sealed file with either the password or the derived key", async () => {
    const key = await newKey(PASSWORD, FAST);
    const file = seal(key, sampleAccounts());
    expect((await open(file, PASSWORD)).accounts).toEqual(sampleAccounts());
    expect((await open(file, key)).accounts).toEqual(sampleAccounts());
  });
});

describe("vault location", () => {
  it("uses ~/.config on Linux and honours XDG_CONFIG_HOME", () => {
    expect(paths.defaultPath({}, "linux", "/home/ann")).toBe(
      "/home/ann/.config/kairos/vault.enc",
    );
    expect(
      paths.defaultPath({ XDG_CONFIG_HOME: "/xdg" }, "linux", "/home/ann"),
    ).toBe("/xdg/kairos/vault.enc");
    expect(
      paths.defaultPath({ XDG_CONFIG_HOME: "relative" }, "linux", "/home/ann"),
    ).toBe("/home/ann/.config/kairos/vault.enc");
  });

  it("uses Application Support on macOS", () => {
    expect(paths.defaultPath({}, "darwin", "/Users/ann")).toBe(
      "/Users/ann/Library/Application Support/kairos/vault.enc",
    );
  });

  it("uses %APPDATA% on Windows", () => {
    expect(
      paths.defaultPath(
        { APPDATA: "C:\\Users\\ann\\AppData\\Roaming" },
        "win32",
        "",
      ),
    ).toBe("C:\\Users\\ann\\AppData\\Roaming\\kairos\\vault.enc");
    expect(paths.defaultPath({}, "win32", "C:\\Users\\ann")).toBe(
      "C:\\Users\\ann\\AppData\\Roaming\\kairos\\vault.enc",
    );
  });

  it("lets KAIROS_VAULT override the location", () => {
    const custom = path.join(tmpdir(), "elsewhere", "my.vault");
    expect(paths.vaultPath({ KAIROS_VAULT: custom })).toBe(custom);
    expect(paths.vaultPath({ KAIROS_VAULT: "" })).toBe(
      paths.defaultPath({ KAIROS_VAULT: "" }),
    );
  });
});
