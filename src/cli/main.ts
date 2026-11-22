import { CommanderError } from "commander";
import { CancelledError, KairosError } from "../errors.js";
import { colors, wantsColor } from "../style.js";
import type { Context } from "./context.js";
import { program } from "./program.js";

/** Runs the CLI and returns the exit code. Never throws. */
export async function run(argv: string[], ctx: Context): Promise<number> {
  try {
    await program(ctx).parseAsync(argv, { from: "user" });
    return 0;
  } catch (error) {
    return report(ctx, error);
  }
}

function report(ctx: Context, error: unknown): number {
  // Commander has already printed its own message (usage error, --help, --version).
  if (error instanceof CommanderError) return error.exitCode;

  if (error instanceof CancelledError) {
    ctx.err(error.message);
    return error.exitCode;
  }

  const prefix = colors(wantsColor(process.stderr)).red("error:");
  // Our own errors and file-system errors carry a message worth showing as-is.
  if (error instanceof KairosError || (error instanceof Error && "code" in error)) {
    ctx.err(`${prefix} ${error.message}`);
    return error instanceof KairosError ? error.exitCode : 1;
  }

  ctx.err(`${prefix} unexpected failure: ${error instanceof Error ? error.message : String(error)}`);
  ctx.err(ctx.env.KAIROS_DEBUG && error instanceof Error && error.stack ? error.stack : "This is a bug in kairos. Set KAIROS_DEBUG=1 to see a stack trace.");
  return 1;
}
