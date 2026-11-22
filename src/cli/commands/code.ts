import { label } from "../../account.js";
import { KairosError } from "../../errors.js";
import { remaining, totp } from "../../otp/totp.js";
import { findAccount } from "../../vault/accounts.js";
import type { Context } from "../context.js";
import { withVault } from "../session.js";

async function copy(text: string): Promise<void> {
  try {
    // Loaded on demand: only --copy needs it.
    const { default: clipboard } = await import("clipboardy");
    await clipboard.write(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message.split("\n", 1)[0] : "";
    throw new KairosError(
      `Could not copy to the clipboard${reason ? `: ${reason}` : "."}\n` + "On Linux this needs a graphical session with wl-clipboard (Wayland) or xsel (X11).",
    );
  }
}

export async function code(ctx: Context, query: string, options: { copy?: boolean }) {
  const result = await withVault(ctx, (vault) => {
    const account = findAccount(vault.accounts, query, true);
    const now = ctx.clock();
    return {
      name: label(account),
      code: totp(account, now),
      seconds: remaining(account.period, now),
    };
  });

  // The code comes first so it is easy to pick out with cut or awk.
  ctx.out(`${result.code}  (${result.name}, ${result.seconds}s remaining)`);

  if (options.copy) {
    await copy(result.code);
    ctx.err("Copied to the clipboard.");
  }
}
