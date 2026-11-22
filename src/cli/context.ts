import { terminal, type Prompts } from "../prompts/prompts.js";
import { interactive } from "../prompts/terminal.js";
import { SCRYPT, type ScryptParams } from "../vault/format.js";
import { session, type Session } from "./agent.js";

/** What a command needs from the outside world. Tests supply their own. */
export interface Context {
  env: NodeJS.ProcessEnv;
  clock: () => number;
  /** stdout: the result of a command. */
  out: (line: string) => void;
  /** stderr: status, warnings and errors. */
  err: (line: string) => void;
  prompts: Prompts;
  /** Keeps the vault unlocked between commands for a while. */
  session: Session;
  interactive: boolean;
  /** Whether stdout is a terminal, as opposed to a pipe or file. */
  tty: boolean;
  scrypt: ScryptParams;
}

export function createContext(): Context {
  return {
    env: process.env,
    clock: Date.now,
    out: (line) => void process.stdout.write(`${line}\n`),
    err: (line) => void process.stderr.write(`${line}\n`),
    prompts: terminal,
    session,
    interactive: interactive(),
    tty: Boolean(process.stdout.isTTY),
    scrypt: SCRYPT,
  };
}
