/**
 * github-holds-words.ts -- what GitHub's row in Settings › Workspace says the workspace's GitHub holds, the panel's and the phone's alike: the accounts it reaches, and once read, how many repositories.
 */

import { andList, countWords, TERM } from "./words.js";

/**
 * The accounts that own `fullNames`, each by its full name's owner, once
 * however GitHub spells it, in the order first met.
 */
export function repositoryOwners(fullNames: readonly string[]): readonly string[] {
  const owners = new Map<string, string>();

  for (const fullName of fullNames) {
    const owner = fullName.slice(0, fullName.indexOf("/"));

    if (!owners.has(owner.toLowerCase())) owners.set(owner.toLowerCase(), owner);
  }

  return [...owners.values()];
}

/**
 * What GitHub's row says it holds: the accounts it reaches by login, and
 * where every list it adds up is read (`count`), how many repositories,
 * "acme and dean, 3 repositories"; none where it reaches no account.
 */
export function githubHoldsWords(
  logins: readonly string[],
  count: number | undefined,
): string | undefined {
  if (logins.length === 0) return undefined;

  const names = andList(logins);

  return count === undefined ? names : `${names}, ${countWords(count, TERM.REPOSITORY)}`;
}
