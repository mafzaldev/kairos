import { KairosError } from "../../errors.js";
import { totp } from "../../otp/totp.js";
import { colors, wantsColor } from "../../style.js";
import { findAccount } from "../../vault/accounts.js";
import type { Context } from "../context.js";
import { withVault } from "../session.js";
import { CLEAR_LINE, HIDE_CURSOR, SHOW_CURSOR, frame, live, rows } from "./watch.js";

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
  await withVault(ctx, async (vault) => {
    const account = findAccount(vault.accounts, query, true);
    if (options.copy) {
      await copy(totp(account, ctx.clock()));
      ctx.err("Copied to the clipboard.");
    }

    // The same line `kairos watch` shows for this account.
    const c = colors(ctx.tty && wantsColor(process.stdout));
    const line = () => frame(rows([account], ctx.clock()), { columns: Infinity, rows: Infinity }, c).join("");

    if (!ctx.tty) {
      ctx.out(line());
      return;
    }
    // In a terminal the line stays and counts down, moving on to each new code, until a key is pressed.
    const hint = c.dim("  q to quit");
    await live(() => process.stdout.write(`\r${line()}${hint}${CLEAR_LINE}`), HIDE_CURSOR, `${SHOW_CURSOR}\n`);
  });
}
