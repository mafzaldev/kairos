import { statSync } from "node:fs";
import { KairosError, WrongPasswordError } from "../errors.js";
import { vaultPath } from "../vault/paths.js";
import { Vault } from "../vault/vault.js";
import { MINUTES } from "./agent.js";
import type { Context } from "./context.js";

const ATTEMPTS = 3;

/**
 * Asks for a password until `open` accepts it, three times at most. The caller
 * wipes the password it gets back; rejected ones are wiped here.
 */
export async function authenticate<T>(ctx: Context, label: string, open: (password: Buffer) => Promise<T>): Promise<[T, Buffer]> {
  for (let attempt = 1; ; attempt++) {
    const password = await ctx.prompts.password(label);
    try {
      return [await open(password), password];
    } catch (error) {
      password.fill(0);
      if (!(error instanceof WrongPasswordError) || attempt === ATTEMPTS) throw error;
      ctx.err("Incorrect password. Try again.");
    }
  }
}

/**
 * Unlocks the vault, runs `action`, then wipes the key, the secrets and the
 * password from memory whether or not the action succeeded.
 *
 * A running session supplies the key without a prompt, in which case there is
 * no password to pass on. `fresh` insists on the password and leaves sessions
 * alone, for the commands that should not be available to whoever finds an
 * unlocked terminal.
 */
export async function withVault<T>(ctx: Context, action: (vault: Vault, password?: Buffer) => T | Promise<T>, options: { fresh?: boolean } = {}): Promise<T> {
  const file = vaultPath(ctx.env);
  if (!Vault.exists(file)) {
    throw new KairosError(`No vault found at ${file}. Run \`kairos init\` to create one.`);
  }
  if (process.platform !== "win32" && statSync(file).mode & 0o077) {
    ctx.err(`Warning: ${file} is readable by other users. Run: chmod 600 "${file}"`);
  }

  let vault: Vault | undefined;
  let password: Buffer | undefined;

  const held = options.fresh ? undefined : await ctx.session.key(file);
  if (held) {
    try {
      vault = await Vault.open(file, held);
    } catch (error) {
      // The password was changed since the session began: fall back to asking.
      if (!(error instanceof WrongPasswordError)) throw error;
    } finally {
      held.bytes.fill(0);
    }
  }

  if (!vault) {
    [vault, password] = await authenticate(ctx, "Master password", (candidate) => Vault.open(file, candidate));
    if (!options.fresh) {
      await ctx.session.end(file);
      if (ctx.session.start(file, vault.key)) {
        ctx.err(`Unlocked for ${MINUTES} minutes. Run \`kairos lock\` to end that sooner.`);
      }
    }
  }

  try {
    return await action(vault, password);
  } finally {
    password?.fill(0);
    vault.close();
  }
}
