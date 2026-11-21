import { label, type Account } from "../account.js";
import { KairosError } from "../errors.js";

type Identity = Pick<Account, "name" | "issuer">;

const fold = (text: string) => text.normalize("NFKC").toLowerCase();

/** Accounts are identified by issuer + name, ignoring case. */
export function findExisting(accounts: readonly Account[], id: Identity, except?: Account): Account | undefined {
  return accounts.find((account) => account !== except && fold(account.name) === fold(id.name) && fold(account.issuer) === fold(id.issuer));
}

function isSubsequence(needle: string, haystack: string): boolean {
  let matched = 0;
  for (const char of haystack) {
    if (char === needle[matched]) matched++;
  }
  return matched === needle.length;
}

// Higher is a better match; 0 is no match.
function score(account: Account, query: string, fuzzy: boolean): number {
  const name = fold(account.name);
  const issuer = fold(account.issuer);
  const names = issuer ? [name, `${issuer}:${name}`, `${issuer} ${name}`] : [name];

  if (names.includes(query)) return 5;
  if (issuer === query) return 4;
  const fields = [...names, issuer];
  if (fields.some((field) => field.startsWith(query))) return 3;
  if (fields.some((field) => field.includes(query))) return 2;
  if (fuzzy && fields.some((field) => isSubsequence(query, field))) return 1;
  return 0;
}

/**
 * Resolves what the user typed to exactly one account. Exact beats prefix,
 * prefix beats substring, substring beats fuzzy ("ghb" for "GitHub"); a tie at
 * the best level is an error, not a guess.
 */
export function findAccount(accounts: readonly Account[], text: string, fuzzy = false): Account {
  const query = fold(text.trim());
  const scored = accounts.map((account) => ({
    account,
    score: query ? score(account, query, fuzzy) : 0,
  }));
  const best = Math.max(0, ...scored.map((entry) => entry.score));
  const matches = scored.filter((entry) => best > 0 && entry.score === best);

  if (matches.length === 0) {
    throw new KairosError(`No account matches "${text}". Run \`kairos list\` to see your accounts.`);
  }
  if (matches.length > 1) {
    const names = matches.map((entry) => `  - ${label(entry.account)}`).join("\n");
    throw new KairosError(`"${text}" matches more than one account:\n${names}\nBe more specific (for example "issuer:name").`);
  }
  return matches[0]!.account;
}

export function sortAccounts(accounts: readonly Account[]): Account[] {
  return [...accounts].sort((a, b) => fold(a.issuer).localeCompare(fold(b.issuer)) || fold(a.name).localeCompare(fold(b.name)));
}
