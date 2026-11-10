/**
 * cli-pull-request-ref.ts -- the pull request a `vespin pr` command's argument names: by its page on GitHub, or as `owner/name#number`.
 *
 * A link is what a person copies from a browser or an answer, and
 * `owner/name#number` is how GitHub itself writes one in text, so the
 * command takes both. A link is read as the app reads a GitHub page
 * (`pullRequestAddressOf`), any page under the pull request among it.
 */

import {
  GITHUB_REPOSITORY_PATTERN,
  type NumberedAddress,
  pullRequestAddressOf,
} from "./link-grammar.js";

/** `owner/name#number`, as GitHub writes a pull request in text. */
const NUMBERED_REPOSITORY = /^([^#\s]+)#(\d+)$/u;

/** The pull request an argument names, or none where it is neither a pull request's page nor `owner/name#number`. */
export function cliPullRequestRefOf(argument: string): NumberedAddress | undefined {
  const trimmed = argument.trim();
  const linked = pullRequestAddressOf(trimmed);
  if (linked !== undefined) return linked;
  const [, repository, digits] = NUMBERED_REPOSITORY.exec(trimmed) ?? [];
  const number = Number(digits);
  if (repository === undefined || !GITHUB_REPOSITORY_PATTERN.test(repository)) return undefined;
  return Number.isSafeInteger(number) && number >= 1 ? { repository, number } : undefined;
}
