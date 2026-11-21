import { PasswordPrompt, SelectPrompt, TextPrompt, isCancel, type Prompt, type State } from "@clack/core";
import { CancelledError, NoTerminalError } from "../errors.js";
import { colors, wantsColor } from "../style.js";

/*
 * One-line prompts. Each draws "? Label  value" while active and collapses to
 * "◆ Label  value" once answered, so a whole form stays a few lines tall.
 *
 * Everything goes to stderr, which keeps stdout clean for a command's result
 * (`kairos code github | xclip` never captures prompt text).
 */

const output = process.stderr;
const c = colors(wantsColor(output));

export const MASK = "••••••••";

// A plain symbol: a check mark is drawn as a wide emoji in some terminal fonts.
const ANSWERED = c.green("◆");

/** Returns an error message, or nothing if the value is fine. */
type Validate = (value: string | undefined) => string | undefined;

export function interactive(): boolean {
  return Boolean(process.stdin.isTTY && output.isTTY);
}

function line(state: State, label: string, value: string, error = ""): string {
  const mark = state === "submit" ? ANSWERED : state === "cancel" ? c.red("×") : c.cyan("?");
  const text = `${mark} ${label}  ${value}`;
  return state === "error" ? `${text}\n  ${c.red(error)}` : text;
}

async function ask<T>(prompt: Prompt<T>): Promise<T> {
  if (!interactive()) throw new NoTerminalError();
  const answer = await prompt.prompt();
  if (isCancel(answer)) throw new CancelledError();
  return answer as T;
}

const emptyInput = (hint: string) => `${c.inverse(" ")} ${c.dim(hint)}`;

export function text(label: string, options: { initial?: string; hint?: string; validate?: Validate } = {}): Promise<string> {
  const { initial, hint = "", validate } = options;
  return ask(
    new TextPrompt({
      output,
      validate,
      initialValue: initial,
      render() {
        if (this.state === "submit") return line(this.state, label, this.value ?? "");
        if (this.state === "cancel") return line(this.state, label, "");
        const value = this.userInput ? this.userInputWithCursor : emptyInput(hint);
        return line(this.state, label, value, this.error);
      },
    }),
  );
}

/** Masked input. The answered line shows a fixed-width mask, hiding the length too. */
export async function hidden(label: string, options: { hint?: string; validate?: Validate } = {}): Promise<string> {
  const { hint = "", validate } = options;
  // Nothing typed leaves the value unset rather than empty.
  const answer: string | undefined = await ask(
    new PasswordPrompt({
      output,
      validate,
      mask: "•",
      render() {
        if (this.state === "submit") return line(this.state, label, MASK);
        if (this.state === "cancel") return line(this.state, label, "");
        const value = this.userInput ? this.userInputWithCursor : emptyInput(hint);
        return line(this.state, label, value, this.error);
      },
    }),
  );
  return answer ?? "";
}

/** Choices side by side; arrow keys move, Enter picks. */
export function select<T extends string | number>(label: string, choices: readonly T[], initial?: T): Promise<T> {
  return ask(
    new SelectPrompt({
      output,
      options: choices.map((value) => ({ value })),
      initialValue: initial,
      render() {
        if (this.state === "submit") return line(this.state, label, String(this.value));
        if (this.state === "cancel") return line(this.state, label, "");
        const choice = (value: T, index: number) => (index === this.cursor ? `${c.cyan("●")} ${value}` : c.dim(`○ ${value}`));
        const row = this.options.map((option, index) => choice(option.value, index));
        return line(this.state, label, row.join("  "));
      },
    }),
  );
}

export async function confirm(question: string): Promise<boolean> {
  return (await select(question, ["Yes", "No"], "No")) === "Yes";
}

/** A static line in the same layout as the prompts. */
export function show(label: string, value: string, answered = false): void {
  output.write(`${answered ? ANSWERED : " "} ${label}  ${value}\n`);
}

export function fail(message: string): void {
  output.write(`  ${c.red(message)}\n`);
}

export const dim = c.dim;
