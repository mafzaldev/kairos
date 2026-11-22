import { label, type Account } from "../../account.js";
import { KairosError } from "../../errors.js";
import * as migration from "../../uri/migration.js";
import * as otpauth from "../../uri/otpauth.js";
import { findExisting, merge } from "../../vault/accounts.js";
import * as camera from "../camera.js";
import type { Context } from "../context.js";
import { readQr } from "../qr.js";
import { withVault } from "../session.js";
import { report } from "./backup.js";

// `add`, `add-uri` and `import-qr` differ only in where the starting values
// come from. All three end here: review in the form, then save.
async function review(ctx: Context, initial: Partial<Account>, secretLocked = false) {
  try {
    await withVault(ctx, async (vault) => {
      const exists = (account: Account) => (findExisting(vault.accounts, account) ? `An account named "${label(account)}" already exists.` : undefined);

      const account = await ctx.prompts.accountForm({
        initial,
        secretLocked,
        clock: ctx.clock,
        check: exists,
      });
      const problem = exists(account);
      if (problem) throw new KairosError(problem);

      vault.accounts.push(account);
      vault.save();
      ctx.out(`Added ${label(account)}.`);
    });
  } finally {
    initial.secret?.fill(0);
  }
}

export async function add(ctx: Context, name?: string): Promise<void> {
  await review(ctx, name ? { name: name.trim() } : {});
}

// A Google Authenticator export holds many accounts at once, so instead of the
// form it lists them and asks once.
async function migrate(ctx: Context, text: string): Promise<void> {
  const { accounts, skipped, part, parts } = migration.parse(text);
  try {
    if (skipped.length > 0) {
      ctx.err(`Skipping ${skipped.length} that kairos cannot use (counter-based or MD5): ${skipped.join(", ")}`);
    }
    if (accounts.length === 0) {
      throw new KairosError("The export holds no accounts that kairos can import.");
    }

    ctx.err(`Google Authenticator export${parts > 1 ? `, part ${part} of ${parts}` : ""}:`);
    for (const account of accounts) ctx.err(`  ${label(account)}`);
    const plural = accounts.length === 1 ? "this account" : `these ${accounts.length} accounts`;
    if (!(await ctx.prompts.confirm(`Import ${plural}?`))) {
      ctx.err("Nothing was imported.");
      return;
    }

    await withVault(ctx, (vault) => {
      const result = merge(vault.accounts, accounts);
      if (result.added > 0) vault.save();
      report(ctx, result, "remove them first to take the exported version");
    });
  } finally {
    for (const account of accounts) account.secret.fill(0);
  }
}

export async function addUri(ctx: Context, uri: string): Promise<void> {
  if (migration.isExport(uri)) {
    await migrate(ctx, uri);
  } else {
    await review(ctx, otpauth.parse(uri), true);
  }
}

async function fromQr(ctx: Context, text: string): Promise<void> {
  if (!/^otpauth(-migration)?:/i.test(text.trim())) {
    // The content is not shown: an unrelated QR code could hold anything.
    throw new KairosError("The QR code was read, but it is not an authenticator setup code (no otpauth:// URI in it).");
  }
  await addUri(ctx, text);
}

export async function importQr(ctx: Context, image: string): Promise<void> {
  await fromQr(ctx, await readQr(image));
}

export async function scan(ctx: Context, options: { device?: string }): Promise<void> {
  ctx.err("Hold the QR code up to the camera. Press Ctrl+C to cancel.");
  const text = await camera.scan(options.device);
  ctx.err("Got it.");
  await fromQr(ctx, text);
}
