import { KairosError } from "../../errors.js";
import { vaultPath } from "../../vault/paths.js";
import { Vault } from "../../vault/vault.js";
import type { Context } from "../context.js";
import { withVault } from "../session.js";

export async function init(ctx: Context): Promise<void> {
  const file = vaultPath(ctx.env);
  if (Vault.exists(file)) {
    throw new KairosError(`A vault already exists at ${file}.`);
  }

  const password = await ctx.prompts.newPassword();
  try {
    (await Vault.create(file, password, ctx.scrypt)).close();
  } finally {
    password.fill(0);
  }
  ctx.out(`Created an empty vault at ${file}`);
  ctx.err("A forgotten master password cannot be recovered. Add accounts with `kairos add`.");
}

export async function passwd(ctx: Context): Promise<void> {
  await withVault(ctx, async (vault) => {
    const password = await ctx.prompts.newPassword();
    try {
      await vault.changePassword(password, ctx.scrypt);
    } finally {
      password.fill(0);
    }
  });
  ctx.out("Master password changed.");
  ctx.err("Backups made earlier are still encrypted with the old password.");
}
