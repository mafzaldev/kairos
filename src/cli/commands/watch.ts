import { label, type Account } from "../../account.js";
import { remaining, totp } from "../../otp/totp.js";
import { colors, spaced, wantsColor, type Colors } from "../../style.js";
import { sortAccounts } from "../../vault/accounts.js";
import type { Context } from "../context.js";
import { withVault } from "../session.js";

export interface Row {
  name: string;
  code: string;
  seconds: number;
  period: number;
}

export function rows(accounts: readonly Account[], now: number): Row[] {
  return accounts.map((account) => ({
    name: label(account),
    code: totp(account, now),
    seconds: remaining(account.period, now),
    period: account.period,
  }));
}

const BAR = 10;
const URGENT = 5;

const clip = (text: string, width: number) => (text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`);

/**
 * Lays the rows out for a terminal of the given size: no line is wider than
 * `columns` and there are at most `rows` lines, so nothing wraps or scrolls.
 */
export function frame(list: readonly Row[], size: { columns: number; rows: number }, c: Colors): string[] {
  const codeWidth = Math.max(0, ...list.map((row) => row.code.length + 1));
  // name + 2 + code + 2 + bar + 1 + "NNNs"
  const nameWidth = Math.max(4, Math.min(Math.max(0, ...list.map((row) => row.name.length)), size.columns - codeWidth - BAR - 9));

  const line = (row: Row): string => {
    const filled = Math.round((row.seconds / row.period) * BAR);
    const countdown = `${"█".repeat(filled)}${"░".repeat(BAR - filled)} ${String(row.seconds).padStart(3)}s`;
    return [
      clip(row.name, nameWidth).padEnd(nameWidth),
      c.bold(spaced(row.code).padEnd(codeWidth)),
      row.seconds <= URGENT ? c.yellow(countdown) : c.dim(countdown),
    ].join("  ");
  };

  const lines = list.map(line);
  if (lines.length <= size.rows) return lines;
  const shown = Math.max(0, size.rows - 1);
  return [...lines.slice(0, shown), c.dim(clip(`… ${lines.length - shown} more`, size.columns))];
}

const ALT_SCREEN = "\u001b[?1049h";
const MAIN_SCREEN = "\u001b[?1049l";
const HIDE_CURSOR = "\u001b[?25l";
const SHOW_CURSOR = "\u001b[?25h";
const HOME = "\u001b[H";
const CLEAR_LINE = "\u001b[K";
const CLEAR_BELOW = "\u001b[J";

const HELP = "kairos watch · press q or Ctrl+C to exit";
const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
const QUIT_KEYS = ["q", "Q", "\u0003", "\u0004"]; // q, Ctrl+C, Ctrl+D

// Redraws every second on the alternate screen. Leaving it restores what was
// on screen before and keeps the codes out of the scrollback.
function live(accounts: readonly Account[], clock: () => number): Promise<void> {
  const { stdin, stdout } = process;
  const c = colors(wantsColor(stdout));

  return new Promise((resolve) => {
    let timer: NodeJS.Timeout;

    const draw = () => {
      const columns = stdout.columns || 80;
      const body = frame(rows(accounts, clock()), { columns, rows: (stdout.rows || 24) - 2 }, c);
      const lines = [c.dim(clip(HELP, columns)), "", ...body];
      stdout.write(HOME + lines.map((line) => line + CLEAR_LINE).join("\n") + CLEAR_BELOW);
    };

    const tick = () => {
      draw();
      // Wake just after the next second boundary so the countdown stays in step.
      timer = setTimeout(tick, 1000 - (Date.now() % 1000) + 10);
    };

    const restore = () => stdout.write(SHOW_CURSOR + MAIN_SCREEN);

    const stop = () => {
      clearTimeout(timer);
      stdout.off("resize", draw);
      stdin.off("data", onKey);
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.pause();
      for (const signal of SIGNALS) process.off(signal, stop);
      process.off("exit", restore);
      restore();
      resolve();
    };

    const onKey = (key: Buffer) => {
      if (QUIT_KEYS.some((quit) => key.includes(quit))) stop();
    };

    for (const signal of SIGNALS) process.on(signal, stop);
    // Put the terminal back even if the process dies some other way.
    process.on("exit", restore);
    stdout.on("resize", draw);
    if (stdin.isTTY) {
      // Raw mode keeps typed keys from being echoed over the display.
      stdin.setRawMode(true);
      stdin.resume();
      stdin.on("data", onKey);
    }

    stdout.write(ALT_SCREEN + HIDE_CURSOR);
    tick();
  });
}

export async function watch(ctx: Context): Promise<void> {
  await withVault(ctx, async (vault) => {
    const accounts = sortAccounts(vault.accounts);
    if (accounts.length === 0) {
      ctx.err("No accounts yet. Add one with `kairos add`.");
    } else if (ctx.tty) {
      await live(accounts, ctx.clock);
    } else {
      // Nothing to refresh when piped: print one snapshot.
      const size = { columns: Infinity, rows: Infinity };
      for (const line of frame(rows(accounts, ctx.clock()), size, colors(false))) ctx.out(line);
    }
  });
}
