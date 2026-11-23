/**
 * use-pull-request-viewed.ts -- which of a pull request's files the member marked viewed, as its Files screen and each file's screen draw and set the marks, read and written as the panel's Files changed reads and writes them.
 *
 * The marks are GitHub's own, read by the host while a screen showing them
 * is in focus (`PULL_REQUEST_PART.VIEWED`, laid on the document under the
 * workspace, the repository, and the number), and each press goes to GitHub
 * as one of the pull request's changes (`MARK_FILE_VIEWED`,
 * `UNMARK_FILE_VIEWED`). How a press is drawn at once and settled, a file's
 * presses folded and sent one at a time and a refusal put back, is the
 * marks' own, as the panel's (`@repo/features/viewed-marks`). One store
 * stands per pull request for the app's life, under the account signed in,
 * so a mark pressed on a file's screen stands ticked on the list behind it.
 */

import { signedInAccountId } from "@repo/credentials/snapshot";
import { AGENT_CALL_FAILURE, PULL_REQUEST_PART } from "@repo/features/agent-view";
import { LIVE_READ } from "@repo/features/live-wire";
import { pullRequestWriteWords } from "@repo/features/pull-request-model";
import type {
  RepositoryPullRequestViewedAnswerView,
  RepositoryPullRequestWriteAnswerView,
} from "@repo/features/pull-request-view";
import { PULL_REQUEST_ACTION } from "@repo/features/pull-request-write-wire";
import { type ViewedMarkSnapshot, ViewedMarkStore, viewedIn } from "@repo/features/viewed-marks";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { useQuery } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs, useHostFollow } from "../host/host-provider.js";
import { type PullRequestKey, partIn } from "./use-pull-request.js";

type Store = ViewedMarkStore<
  RepositoryPullRequestViewedAnswerView,
  RepositoryPullRequestWriteAnswerView
>;

/** A mark nothing answered. */
const UNANSWERED: RepositoryPullRequestWriteAnswerView = { failure: AGENT_CALL_FAILURE.UNANSWERED };

/** The stores, by the account signed in, the repository whatever its case, and the number. */
const STORES = new Map<string, Map<string, Map<number, Store>>>();

/** The store of the pull request `key` names under `accountId`, made the first time it is asked for. */
function storeOf(
  accountId: string,
  key: PullRequestKey,
  send: (path: string, viewed: boolean) => Promise<RepositoryPullRequestWriteAnswerView>,
): Store {
  const repository = key.repository.toLowerCase();
  const byRepository = STORES.get(accountId) ?? new Map<string, Map<number, Store>>();
  const byNumber = byRepository.get(repository) ?? new Map<number, Store>();
  const held = byNumber.get(key.number);

  if (held !== undefined) return held;
  const made: Store = new ViewedMarkStore(send, UNANSWERED);
  byNumber.set(key.number, made);
  byRepository.set(repository, byNumber);
  STORES.set(accountId, byRepository);

  return made;
}

/** The member's marks as a screen draws and sets them. */
export interface PullRequestViewed {
  /** Whether the file at `path` stands viewed; false for every file until the marks are read. */
  readonly viewed: (path: string) => boolean;
  /** Turns the file's mark over; none until the marks are read, so a press never asks for a mark GitHub's are unknown beside. */
  readonly toggle: ((path: string) => void) | undefined;
  /** Why the last press did not stand, or the marks could not be read, in the pull request's changes' words; none while nothing failed. */
  readonly note: string | undefined;
}

/** A snapshot with no marks, for the screen drawn before an account is read. */
const NO_MARKS: ViewedMarkSnapshot<
  RepositoryPullRequestViewedAnswerView | RepositoryPullRequestWriteAnswerView
> = {
  states: undefined,
  pressed: new Map(),
  said: undefined,
};

/** Nothing to tell, for the screen drawn before an account is read. */
const quiet = () => () => undefined;

/** The member's marks on the files of the pull request `key` names, read while the calling screen is in focus. */
export function usePullRequestViewed(key: PullRequestKey): PullRequestViewed {
  const acts = useHostActs();
  const follow = useHostFollow();
  const { workspaceId, repository, number } = key;

  useFocusEffect(
    useCallback(
      () =>
        follow(
          () =>
            acts[ACT_KIND.PULL_REQUESTS_PART_FOLLOW]({
              part: PULL_REQUEST_PART.VIEWED,
              workspaceId,
              repository,
              number,
            }),
          () => undefined,
        ),
      [acts, follow, workspaceId, repository, number],
    ),
  );

  const { data: accountId } = useQuery({
    ...appStateQuery,
    select: (state) => signedInAccountId(state.account),
  });

  const read = useQuery({
    ...appStateQuery,
    select: useCallback(
      (state: AppStateSnapshot) =>
        partIn(state[LIVE_READ.REPOSITORY_PULL_REQUEST_VIEWED], {
          workspaceId,
          repository,
          number,
        }),
      [workspaceId, repository, number],
    ),
  }).data;

  const store =
    accountId === undefined
      ? undefined
      : storeOf(accountId, key, (path, viewed) =>
          acts[ACT_KIND.PULL_REQUESTS_ACTION]({
            workspaceId,
            repository,
            number,
            request: {
              action: viewed
                ? PULL_REQUEST_ACTION.MARK_FILE_VIEWED
                : PULL_REQUEST_ACTION.UNMARK_FILE_VIEWED,
              path,
            },
          }),
        );

  const shown = useSyncExternalStore(
    store?.subscribe ?? quiet,
    store?.snapshot ?? (() => NO_MARKS),
  );

  const rows = read?.rows;

  // Note that a read the host failed takes the marks away, as one that answered with a refusal does.
  useEffect(() => {
    if (store === undefined) return;

    if (rows !== undefined) store.take(rows);
    else if (read?.failed === true) store.take({ failure: AGENT_CALL_FAILURE.UNANSWERED });
  }, [store, rows, read?.failed]);

  return {
    viewed: (path) => viewedIn(shown, path),
    toggle:
      store === undefined || shown.states === undefined
        ? undefined
        : (path) => void store.toggle(path),
    note: shown.said === undefined ? undefined : pullRequestWriteWords(shown.said)?.words,
  };
}
