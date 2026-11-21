import type { Account } from "../account.js";
import { Base32Error, KairosError } from "../errors.js";
import * as base32 from "../otp/base32.js";
import { DEFAULTS, MAX_PERIOD } from "../otp/types.js";

/* Each validator returns an error message, or nothing if the value is fine. */

const MAX_TEXT = 100;
const MIN_PASSWORD = 8;

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

function validateText(what: string, value: string): string | undefined {
  if (value.length > MAX_TEXT) return `${what} must be at most ${MAX_TEXT} characters.`;
  if (CONTROL.test(value)) return `${what} must not contain control characters.`;
  return undefined;
}

export function validateName(value = ""): string | undefined {
  const name = value.trim();
  return name ? validateText("Name", name) : "Name is required.";
}

export function validateIssuer(value = ""): string | undefined {
  return validateText("Issuer", value.trim());
}

export function validateSecret(value = ""): string | undefined {
  if (!value.trim()) return "Secret is required.";
  try {
    base32.decode(value).fill(0);
    return undefined;
  } catch (error) {
    if (error instanceof Base32Error) return error.message;
    throw error;
  }
}

export function validatePeriod(value = ""): string | undefined {
  const period = /^\d+$/.test(value.trim()) ? Number(value) : 0;
  if (period < 1) return "Period must be a positive whole number of seconds.";
  if (period > MAX_PERIOD) return `Period must be at most ${MAX_PERIOD} seconds.`;
  return undefined;
}

export function validatePassword(value = ""): string | undefined {
  return [...value].length < MIN_PASSWORD ? `Use at least ${MIN_PASSWORD} characters. A long passphrase is best.` : undefined;
}

/** Fills in the defaults and checks the result. */
export function toAccount(draft: Partial<Account>): Account {
  const period = draft.period ?? DEFAULTS.period;
  const problem = validateName(draft.name) ?? validateIssuer(draft.issuer) ?? validatePeriod(String(period));
  if (problem) throw new KairosError(problem);
  if (!draft.name || !draft.secret?.length) throw new KairosError("Secret is required.");

  return {
    name: draft.name.trim(),
    issuer: (draft.issuer ?? "").trim(),
    secret: draft.secret,
    algorithm: draft.algorithm ?? DEFAULTS.algorithm,
    digits: draft.digits ?? DEFAULTS.digits,
    period,
  };
}
