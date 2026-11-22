import { label, type Account } from "../../account.js";
import { KairosError } from "../../errors.js";
import * as otpauth from "../../uri/otpauth.js";
import { findExisting } from "../../vault/accounts.js";
import type { Context } from "../context.js";
import { readQr } from "../qr.js";
import { withVault } from "../session.js";

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

export async function addUri(ctx: Context, uri: string): Promise<void> {
  await review(ctx, otpauth.parse(uri), true);
}

export async function importQr(ctx: Context, image: string): Promise<void> {
  const text = await readQr(image);
  if (!/^otpauth(-migration)?:/i.test(text.trim())) {
    // The content is not shown: an unrelated QR code could hold anything.
    throw new KairosError("The QR code was read, but it is not an authenticator setup code (no otpauth:// URI in it).");
  }
  await addUri(ctx, text);
}
