import { randomBytes } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Account } from "../account.js";
import { KairosError } from "../errors.js";
import { newKey, open, seal, type Key } from "./crypto.js";
import { SCRYPT, type ScryptParams } from "./format.js";

/**
 * Writes to a temporary file in the same directory, fsyncs it, then renames it
 * over the target, so a crash leaves either the old file or the new one.
 */
function writeAtomic(target: string, data: Buffer): void {
  const temp = `${target}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    const fd = openSync(temp, "wx", 0o600);
    try {
      writeFileSync(fd, data);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, target);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

/** An unlocked vault. Call close() when done to wipe the key and the secrets. */
export class Vault {
  private constructor(
    readonly path: string,
    public key: Key,
    public accounts: Account[],
  ) {}

  static exists(file: string): boolean {
    return existsSync(file);
  }

  static async create(file: string, password: Buffer, params = SCRYPT): Promise<Vault> {
    if (existsSync(file)) {
      throw new KairosError(`A vault already exists at ${file}.`);
    }
    const vault = new Vault(file, await newKey(password, params), []);
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    vault.save();
    return vault;
  }

  /** Opens with the master password, or with a key a session has kept. */
  static async open(file: string, secret: Buffer | Key): Promise<Vault> {
    const { key, accounts } = await open(readFileSync(file), secret);
    return new Vault(file, key, accounts);
  }

  save(): void {
    writeAtomic(this.path, seal(this.key, this.accounts));
  }

  /** Re-encrypts under a new password, with a new salt. */
  async changePassword(password: Buffer, params: ScryptParams = SCRYPT): Promise<void> {
    const previous = this.key;
    this.key = await newKey(password, params);
    try {
      this.save();
    } catch (error) {
      this.key.bytes.fill(0);
      this.key = previous;
      throw error;
    }
    previous.bytes.fill(0);
  }

  /** Writes an encrypted backup, protected by the vault's current password. */
  backup(file: string): void {
    writeAtomic(file, seal(this.key, this.accounts));
  }

  /** Decrypts a backup with `password`, or with the vault's own key if none is given. */
  async readBackup(file: Buffer, password?: Buffer): Promise<Account[]> {
    const { key, accounts } = await open(file, password ?? this.key);
    key.bytes.fill(0);
    return accounts;
  }

  close(): void {
    this.key.bytes.fill(0);
    for (const account of this.accounts) account.secret.fill(0);
    this.accounts = [];
  }
}
