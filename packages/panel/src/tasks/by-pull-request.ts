import type { NumberedAddress } from "@repo/features/link-grammar";

/**
 * by-pull-request.ts -- values the window keeps for each pull request it shows, by its repository and then its number: what each Pull request tab shows, and what each one's pin is named.
 *
 * A Pull request tab names its pull request by its repository and number
 * (`@repo/ui/tab-strip-model`'s `ChangesStripTab`), and GitHub reads a
 * repository's owner and name whatever their case, so a value is kept
 * under the repository as GitHub would read it, then under the number, as
 * nested maps rather than one key joined from the two.
 */

/** Values kept for each pull request, by its repository, spelled as GitHub reads it, and then by its number. */
export type ByPullRequest<V> = ReadonlyMap<string, ReadonlyMap<number, V>>;

/** Nothing kept for any pull request. */
export const NO_PULL_REQUESTS_KEPT: ByPullRequest<never> = new Map();

/** The value kept for the pull request given; none where none is. */
export function ofPullRequest<V>(
  kept: ByPullRequest<V>,
  pullRequest: NumberedAddress,
): V | undefined {
  return kept.get(pullRequest.repository.toLowerCase())?.get(pullRequest.number);
}

/** What is kept with the pull request given keeping `value`, or kept no more where it is none. */
export function withPullRequest<V>(
  kept: ByPullRequest<V>,
  pullRequest: NumberedAddress,
  value: V | undefined,
): ByPullRequest<V> {
  const repository = pullRequest.repository.toLowerCase();
  const ofRepository = new Map(kept.get(repository));

  if (value === undefined) ofRepository.delete(pullRequest.number);
  else ofRepository.set(pullRequest.number, value);
  const next = new Map(kept);

  if (ofRepository.size === 0) next.delete(repository);
  else next.set(repository, ofRepository);

  return next;
}
