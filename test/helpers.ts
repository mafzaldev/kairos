import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Account } from "../src/account.js";
import type { Context } from "../src/cli/context.js";
import { run } from "../src/cli/main.js";
import { CancelledError, KairosError } from "../src/errors.js";
import * as base32 from "../src/otp/base32.js";
import { toBytes, type Prompts } from "../src/prompts/prompts.js";
import { toAccount } from "../src/prompts/validate.js";
import type { ScryptParams } from "../src/vault/format.js";

/** Cheap scrypt parameters: the suite derives many keys. */
export const FAST_SCRYPT: ScryptParams = { logN: 10, r: 8, p: 1 };

export const PASSWORD = "correct horse battery staple";

/** RFC 6238 SHA1 seed "12345678901234567890" in base32: a public test value. */
export const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
/** RFC 6238 SHA512 seed (64 bytes) in base32. */
export const RFC_SECRET_SHA512 =
  "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA";

/** What the simulated user types into the account form; the secret as base32. */
export type FormEntry = Partial<Omit<Account, "secret">> & { secret?: string };

/** How the simulated user responds. Tests change these before running a command. */
export interface Answers {
  /** Typed at successive password prompts; the last entry repeats. */
  passwords: string[];
  newPassword: string;
  confirm: boolean;
  /** Typed over the form's pre-filled values, or 'cancel' to abandon the form. */
  form: FormEntry | "cancel";
}

export interface Harness {
  dir: string;
  vaultPath: string;
  /** Lines written to stdout / stderr so far. */
  out: string[];
  err: string[];
  ctx: Context;
  answers: Answers;
  /** Every prompt shown, in order. */
  asked: string[];
  /** What each account form was opened with (secrets omitted). */
  forms: Array<{ name?: string; issuer?: string; secretLocked: boolean }>;
  kairos: (...argv: string[]) => Promise<number>;
  /** Runs `kairos add <name>` and fills in the form. */
  add: (name: string, entry?: FormEntry) => Promise<number>;
  reset: () => void;
  cleanup: () => void;
}

/**
 * A sandboxed CLI: its own temporary vault, captured output, a clock frozen at
 * T = 59 s (the first RFC 6238 test time), and a simulated user at the prompts.
 */
export function createHarness(): Harness {
  const dir = mkdtempSync(path.join(tmpdir(), "kairos-cli-"));
  const vaultPath = path.join(dir, "config", "vault.enc");
  const out: string[] = [];
  const err: string[] = [];
  const asked: string[] = [];
  const forms: Harness["forms"] = [];
  const answers: Answers = {
    passwords: [PASSWORD],
    newPassword: PASSWORD,
    confirm: true,
    form: {},
  };

  /* eslint-disable @typescript-eslint/require-await -- the real prompts are asynchronous */
  const prompts: Prompts = {
    async password(label) {
      asked.push(label);
      const typed =
        answers.passwords.length > 1
          ? answers.passwords.shift()
          : answers.passwords[0];
      return toBytes(typed ?? "");
    },
    async newPassword() {
      asked.push("New master password");
      return toBytes(answers.newPassword);
    },
    async confirm(question) {
      asked.push(question);
      return answers.confirm;
    },
    async accountForm({ initial, secretLocked = false, check }) {
      asked.push("account form");
      forms.push({ name: initial.name, issuer: initial.issuer, secretLocked });
      if (answers.form === "cancel") throw new CancelledError();

      const { secret, ...typed } = answers.form;
      const draft = { ...initial, ...typed };
      if (secret && !secretLocked) draft.secret = base32.decode(secret);
      const account = toAccount(draft);
      // The real form sends the user back to edit; here a rejected entry simply fails.
      const problem = check?.(account);
      if (problem) throw new KairosError(problem);
      return account;
    },
  };
  /* eslint-enable @typescript-eslint/require-await */

  const ctx: Context = {
    env: { KAIROS_VAULT: vaultPath },
    clock: () => 59_000,
    out: (line) => void out.push(line),
    err: (line) => void err.push(line),
    prompts,
    interactive: true,
    tty: false,
    scrypt: FAST_SCRYPT,
  };

  const kairos = (...argv: string[]): Promise<number> => run(argv, ctx);
  return {
    dir,
    vaultPath,
    out,
    err,
    ctx,
    answers,
    asked,
    forms,
    kairos,
    add: (name, entry = {}) => {
      answers.form = { secret: RFC_SECRET, ...entry };
      return kairos("add", name);
    },
    reset: () => {
      out.length = 0;
      err.length = 0;
      asked.length = 0;
      forms.length = 0;
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
