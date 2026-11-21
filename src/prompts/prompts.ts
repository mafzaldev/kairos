import type { Account } from "../account.js";
import { accountForm, type FormOptions } from "./form.js";
import { confirm, fail, hidden } from "./terminal.js";
import { validatePassword } from "./validate.js";

/**
 * How commands talk to the person at the keyboard. They go through this
 * interface instead of the terminal so tests can answer in the user's place.
 */
export interface Prompts {
  /** The caller wipes the returned buffer. */
  password: (label: string) => Promise<Buffer>;
  /** Asked twice, until both entries match. */
  newPassword: () => Promise<Buffer>;
  confirm: (question: string) => Promise<boolean>;
  accountForm: (options: FormOptions) => Promise<Account>;
}

/** NFKC, so the same visible password gives the same bytes on every keyboard. */
export function toBytes(password: string): Buffer {
  return Buffer.from(password.normalize("NFKC"));
}

export const terminal: Prompts = {
  async password(label) {
    const required = (value?: string) => (value ? undefined : "Enter the password.");
    return toBytes(await hidden(label, { validate: required }));
  },

  async newPassword() {
    for (;;) {
      const first = await hidden("New master password", {
        validate: validatePassword,
      });
      const second = await hidden("Repeat it to confirm");
      if (first === second) return toBytes(first);
      fail("The two entries do not match. Try again.");
    }
  },

  confirm,
  accountForm,
};
