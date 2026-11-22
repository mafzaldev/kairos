import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { label, type Account } from "../../account.js";
import { KairosError, WrongPasswordError } from "../../errors.js";
import * as otpauth from "../../uri/otpauth.js";
import { findExisting, sortAccounts } from "../../vault/accounts.js";
import { unpack } from "../../vault/format.js";
import { vaultPath } from "../../vault/paths.js";
import type { Vault } from "../../vault/vault.js";
import type { Context } from "../context.js";
import { authenticate, withVault } from "../session.js";

const PLAIN_WARNING =
  "Warning: this prints every secret in plaintext. Anyone who sees or captures the output " +
  "(screen, scrollback, a redirected file) can generate your codes forever.";

export async function exportBackup(ctx: Context, file: string | undefined, options: { plain?: boolean; force?: boolean }): Promise<void> {
  if (options.plain) {
    if (file) {
      throw new KairosError("--plain prints to the terminal and does not take a file.");
    }
    ctx.err(PLAIN_WARNING);
    if (!(await ctx.prompts.confirm("Print all secrets in plaintext?"))) {
      ctx.err("Nothing was exported.");
      return;
    }
    // The one place secrets are deliberately turned into printable text.
    await withVault(ctx, (vault) => {
      for (const account of sortAccounts(vault.accounts)) ctx.out(otpauth.format(account));
    });
    return;
  }

  if (!file) {
    throw new KairosError("Give a file for the encrypted backup: `kairos export <file>` (or use --plain).");
  }
  const target = path.resolve(file);
  if (target === vaultPath(ctx.env)) {
    throw new KairosError("That is the vault itself. Choose a different file for the backup.");
  }
  if (existsSync(target) && !options.force) {
    throw new KairosError(`${target} already exists. Use --force to overwrite it.`);
  }

  await withVault(ctx, (vault) => {
    vault.backup(target);
    ctx.out(`Exported ${count(vault.accounts.length, "account")} to ${target}`);
  });
  ctx.err("The backup is encrypted with your current master password. You need it to restore.");
}

// A backup is locked with the master password in use when it was made. Try the
// vault's own key, then the current password, and only then ask.
async function decrypt(ctx: Context, vault: Vault, password: Buffer, backup: Buffer) {
  for (const secret of [undefined, password]) {
    try {
      return await vault.readBackup(backup, secret);
    } catch (error) {
      if (!(error instanceof WrongPasswordError)) throw error;
    }
  }

  ctx.err("This backup was made with a different master password.");
  const [accounts, typed] = await authenticate(ctx, "Backup password", (candidate) => vault.readBackup(backup, candidate));
  typed.fill(0);
  return accounts;
}

const same = (a: Account, b: Account) => a.secret.equals(b.secret) && a.algorithm === b.algorithm && a.digits === b.digits && a.period === b.period;

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

export async function importBackup(ctx: Context, file: string, options: { overwrite?: boolean }): Promise<void> {
  if (!existsSync(file)) {
    throw new KairosError(`Backup file not found: ${file}`);
  }
  const backup = readFileSync(file);
  // Reject a damaged or foreign file before asking for any password.
  unpack(backup);

  await withVault(ctx, async (vault, password) => {
    let added = 0;
    let replaced = 0;
    let unchanged = 0;
    const conflicts: string[] = [];

    for (const incoming of await decrypt(ctx, vault, password, backup)) {
      const existing = findExisting(vault.accounts, incoming);
      if (!existing) {
        vault.accounts.push(incoming);
        added++;
      } else if (same(existing, incoming)) {
        incoming.secret.fill(0);
        unchanged++;
      } else if (options.overwrite) {
        vault.accounts[vault.accounts.indexOf(existing)] = incoming;
        existing.secret.fill(0);
        replaced++;
      } else {
        conflicts.push(label(incoming));
        incoming.secret.fill(0);
      }
    }

    if (added + replaced > 0) vault.save();

    const notes = [replaced && `${replaced} replaced`, unchanged && `${unchanged} already present`].filter(Boolean);
    ctx.out(`Imported ${count(added, "new account")}${notes.length ? ` (${notes.join(", ")})` : ""}.`);
    if (conflicts.length > 0) {
      ctx.err(
        `Skipped ${count(conflicts.length, "account")} whose secret or settings differ from the vault's ` +
          `(use --overwrite to replace them):\n${conflicts.map((name) => `  - ${name}`).join("\n")}`,
      );
    }
  });
}
