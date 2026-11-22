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

export const HIDE_CURSOR = "\u001b[?25l";
export const SHOW_CURSOR = "\u001b[?25h";
export const CLEAR_LINE = "\u001b[K";
const CLEAR_BELOW = "\u001b[J";

const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
const QUIT_KEYS = ["q", "Q", "\r", "\u0003", "\u0004"]; // q, Enter, Ctrl+C, Ctrl+D

/**
 * Calls `draw` once a second until the user quits. `enter` is written to the
 * terminal first and `leave` afterwards, however the process ends.
 */
export function live(draw: () => void, enter: string, leave: string): Promise<void> {
  const { stdin, stdout } = process;

  return new Promise((resolve) => {
    let timer: NodeJS.Timeout;

    const tick = () => {
      draw();
      // Wake just after the next second boundary so the countdown stays in step.
      timer = setTimeout(tick, 1000 - (Date.now() % 1000) + 10);
    };

    const restore = () => stdout.write(leave);

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

    stdout.write(enter);
    tick();
  });
}

export async function watch(ctx: Context): Promise<void> {
  await withVault(ctx, async (vault) => {
    const accounts = sortAccounts(vault.accounts);
    if (accounts.length === 0) {
      ctx.err("No accounts yet. Add one with `kairos add`.");
    } else if (ctx.tty) {
      const { stdout } = process;
      const c = colors(wantsColor(stdout));
      // Drawn in place: each redraw moves back up over the lines of the last one.
      let drawn = 0;
      const draw = () => {
        const size = { columns: stdout.columns || 80, rows: (stdout.rows || 24) - 3 };
        const list = rows(accounts, ctx.clock());
        // Measured without colour codes, so the divider is as wide as the rows look.
        const width = Math.max(...frame(list, size, colors(false)).map((line) => line.length));
        const lines = [...frame(list, size, c), c.dim("─".repeat(width)), c.dim("q to quit")];
        const up = drawn > 1 ? `\u001b[${drawn - 1}A` : "";
        stdout.write(`${up}\r${lines.map((line) => line + CLEAR_LINE).join("\n")}${CLEAR_BELOW}`);
        drawn = lines.length;
      };
      await live(draw, HIDE_CURSOR, `${SHOW_CURSOR}\n`);
    } else {
      // Nothing to refresh when piped: print one snapshot.
      const size = { columns: Infinity, rows: Infinity };
      for (const line of frame(rows(accounts, ctx.clock()), size, colors(false))) ctx.out(line);
    }
  });
}
