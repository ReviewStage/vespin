/**
 * changes-people.ts -- who a pull request names, as its Pull request tab last read them, for every card that hangs beside it.
 *
 * The people are read from the pull request's changes in the Query cache,
 * which its Pull request tab fills (`useChangesReads`), by its repository
 * and number. A card reads its own pull request's entry, or a surface the
 * entries of the pull requests it already knows, through observers that are
 * disabled because they only read what the tab fetched; a pull request whose
 * changes no tab has read names nobody.
 */

import { type NumberedAddress, pullRequestAddressOf } from "@repo/features/link-grammar";
import type { RepositoryChangesAnswerView } from "@repo/features/pull-request-view";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { heldChangesQueryOptions } from "./agent-reads.js";
import type { HeldPeople } from "./use-agents.js";

/** A pull request's changes as read, which a failure never is. */
type ChangesRead = Exclude<RepositoryChangesAnswerView, { readonly failure: unknown }>;

/** Who the changes' pull request names, with the pull request they were read for; none where they name none. */
function heldPeopleOf(answer: ChangesRead): HeldPeople | undefined {
  if (answer.pullRequest === null) return undefined;
  const { url, files: _files, truncated: _truncated, ...people } = answer.pullRequest;

  return { url, people };
}

/** The pull request a page on GitHub is, none for any other page or none given. */
export function changesAddressOf(url: string | undefined): NumberedAddress | undefined {
  return url === undefined ? undefined : pullRequestAddressOf(url);
}

/** Who one pull request names, as its Pull request tab last read them; none before it read them, and for no pull request. */
export function useChangesPeople(pullRequest: NumberedAddress | undefined): HeldPeople | undefined {
  return useQuery({
    ...heldChangesQueryOptions(pullRequest ?? { repository: "", number: 0 }),
    enabled: false,
    select: heldPeopleOf,
  }).data;
}

/** Who each of the pull requests given names, by the key each is given under, of those whose Pull request tab read them. */
export function useChangesPeopleOf<K>(
  pullRequests: readonly (readonly [K, NumberedAddress])[],
): ReadonlyMap<K, HeldPeople> {
  const combine = useCallback(
    (results: readonly { readonly data?: HeldPeople | undefined }[]) => {
      const people = new Map<K, HeldPeople>();
      results.forEach((result, at) => {
        const entry = pullRequests[at];

        if (entry !== undefined && result.data !== undefined) people.set(entry[0], result.data);
      });

      return people;
    },
    [pullRequests],
  );

  return useQueries({
    queries: pullRequests.map(([, pullRequest]) => ({
      ...heldChangesQueryOptions(pullRequest),
      enabled: false,
      select: heldPeopleOf,
    })),
    combine,
  });
}
