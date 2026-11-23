import { label, type Account } from "../../account.js";
import { KairosError } from "../../errors.js";
import { findAccount, findExisting, sortAccounts } from "../../vault/accounts.js";
import type { Context } from "../context.js";
import { withVault } from "../session.js";

export async function list(ctx: Context): Promise<void> {
  // Only names and issuers leave the vault.
  const accounts = await withVault(ctx, (vault) => sortAccounts(vault.accounts).map(({ name, issuer }) => ({ name, issuer })));

  if (accounts.length === 0) {
    ctx.err("No accounts yet. Add one with `kairos add`.");
  } else if (ctx.tty) {
    const width = Math.max(4, ...accounts.map((account) => account.name.length));
    ctx.out(`${"NAME".padEnd(width)}  ISSUER`);
    for (const { name, issuer } of accounts) ctx.out(`${name.padEnd(width)}  ${issuer || "-"}`);
  } else {
    // Piped into another tool: tab-separated, no header.
    for (const { name, issuer } of accounts) ctx.out(`${name}\t${issuer}`);
  }
}

export async function remove(ctx: Context, query: string): Promise<void> {
  await withVault(ctx, async (vault) => {
    const account = findAccount(vault.accounts, query);
    const name = label(account);

    const sure = await ctx.prompts.confirm(`Remove "${name}"? Its codes will be gone for good.`);
    if (!sure) {
      ctx.err("Nothing was removed.");
      return;
    }

    vault.accounts = vault.accounts.filter((other) => other !== account);
    vault.save();
    account.secret.fill(0);
    ctx.out(`Removed ${name}.`);
  });
}

export async function edit(ctx: Context, query: string): Promise<void> {
  await withVault(ctx, async (vault) => {
    const account = findAccount(vault.accounts, query);
    const exists = (edited: Account) => (findExisting(vault.accounts, edited, account) ? `An account named "${label(edited)}" already exists.` : undefined);

    // The form wipes the secret it was given if it fails, so it gets a copy.
    const edited = await ctx.prompts.accountForm({
      initial: { ...account, secret: Buffer.from(account.secret) },
      clock: ctx.clock,
      check: exists,
    });
    const problem = exists(edited);
    if (problem) throw new KairosError(problem);

    vault.accounts[vault.accounts.indexOf(account)] = edited;
    vault.save();
    account.secret.fill(0);
    ctx.out(`Updated ${label(edited)}.`);
  });
}
