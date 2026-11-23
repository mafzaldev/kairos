import type { Account } from "../account.js";
import { CancelledError } from "../errors.js";
import * as base32 from "../otp/base32.js";
import { remaining, totp } from "../otp/totp.js";
import { ALGORITHMS, DEFAULTS } from "../otp/types.js";
import { spaced } from "../style.js";
import { MASK, dim, fail, hidden, select, show, text } from "./terminal.js";
import { toAccount, validateIssuer, validateName, validatePeriod, validateSecret } from "./validate.js";

export interface FormOptions {
  /** Values to pre-fill. The form owns `initial.secret` and wipes it if it fails. */
  initial: Partial<Account>;
  /** The secret came from a URI or QR code: show it masked instead of asking. */
  secretLocked?: boolean;
  clock?: () => number;
  /** Returns a message if the account cannot be saved, e.g. the name is taken. */
  check?: (account: Account) => string | undefined;
}

// Padded to the longest label so the values line up.
const field = (name: string) => name.padEnd("Algorithm".length);

async function askFields(draft: Partial<Account>, secretLocked: boolean): Promise<Partial<Account>> {
  const name = await text(field("Name"), {
    initial: draft.name,
    validate: validateName,
  });
  const issuer = await text(field("Issuer"), {
    initial: draft.issuer,
    hint: "optional",
    validate: validateIssuer,
  });

  let secret = draft.secret;
  if (secretLocked) {
    show(field("Secret"), MASK, true);
  } else {
    const previous = secret;
    const typed = await hidden(field("Secret"), {
      hint: previous ? "leave blank to keep" : "base32 key from the website",
      validate: (value) => (previous && !value?.trim() ? undefined : validateSecret(value)),
    });
    if (typed.trim()) {
      previous?.fill(0);
      secret = base32.decode(typed);
    }
  }

  const algorithm = await select(field("Algorithm"), ALGORITHMS, draft.algorithm);
  const digits = await select(field("Digits"), [6, 8] as const, draft.digits);
  const period = await text(field("Period"), {
    initial: String(draft.period ?? DEFAULTS.period),
    hint: "seconds",
    validate: validatePeriod,
  });

  return { name, issuer, secret, algorithm, digits, period: Number(period) };
}

/**
 * The form behind `add`, `add-uri`, `import-qr` and `edit`: one line per field, then a
 * preview of the current code to compare with the website before saving.
 */
export async function accountForm(options: FormOptions): Promise<Account> {
  const { secretLocked = false, clock = Date.now, check } = options;
  let draft = { ...options.initial };

  try {
    for (;;) {
      draft = await askFields(draft, secretLocked);
      const account = toAccount(draft);

      const problem = check?.(account);
      if (problem) {
        fail(problem);
        continue;
      }

      const now = clock();
      const wait = dim(`(changes in ${remaining(account.period, now)}s)`);
      show(field("Code"), `${spaced(totp(account, now))}  ${wait}`);

      const action = await select("Save this account?", ["Save", "Edit", "Cancel"] as const);
      if (action === "Save") return account;
      if (action === "Cancel") throw new CancelledError();
    }
  } catch (error) {
    draft.secret?.fill(0);
    throw error;
  }
}
