/**
 * use-pull-request-viewed.ts -- which of a pull request's files the member marked viewed, as its Files screen and each file's screen draw and set the marks, read and written as the panel's Files changed reads and writes them.
 *
 * The marks are GitHub's own, read by the host while a screen showing them
 * is in focus (`PULL_REQUEST_PART.VIEWED`, laid on the document under the
 * workspace, the repository, and the number), and each press goes to GitHub
 * as one of the pull request's changes (`MARK_FILE_VIEWED`,
 * `UNMARK_FILE_VIEWED`) through TanStack Query's own mutations: a file's
 * screen owns its one `useMutation` under the file's own `scope`, so its
 * marks go to GitHub one after another in the order pressed while another
 * file's go beside them, and a press stands drawn while it is out
 * (`useMutationState`, read on every screen alike, so a mark pressed on a
 * file's screen stands ticked on the list behind it). A mark GitHub took
 * stands until the marks are read again, which it asks for; one it refused
 * falls back to what the read holds, its words said under the list.
 */

import { signedInAccountId } from "@repo/credentials/snapshot";
import { PULL_REQUEST_PART } from "@repo/features/agent-view";
import { LIVE_READ } from "@repo/features/live-wire";
import { pullRequestWriteWords } from "@repo/features/pull-request-model";
import type { RepositoryPullRequestWriteAnswerView } from "@repo/features/pull-request-view";
import {
  FILE_VIEWED_STATE,
  PULL_REQUEST_ACTION,
  PULL_REQUEST_WRITE_OUTCOME,
} from "@repo/features/pull-request-write-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import {
  hashKey,
  type Mutation,
  type MutationState,
  useMutation,
  useMutationState,
  useQuery,
} from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs, useHostFollow } from "../host/host-provider.js";
import { type PullRequestKey, partIn } from "./use-pull-request.js";

/** Where the marks' mutations are kept among the app's. */
const MUTATION_ROOT = "pull-request-viewed";

/** One press: the file, and the mark it asks for. */
interface Press {
  readonly path: string;
  readonly viewed: boolean;
}

/** A mark GitHub did not take, carrying what it said. */
class MarkRefused extends Error {
  readonly words: string | undefined;
  readonly at = Date.now();

  constructor(answer: RepositoryPullRequestWriteAnswerView) {
    const words = pullRequestWriteWords(answer)?.words;
    super(words);
    this.words = words;
  }
}

/** When a press was answered: GitHub's taking it, or its refusal, which stands as long as a press taken would; never for one still out. */
function answeredAt(state: MutationState): number {
  if (state.error instanceof MarkRefused) return state.error.at;

  // SAFETY: every mutation under the marks' key is built by this hook, whose answer is the time GitHub took it.
  const data = state.data as { readonly at: number } | undefined;

  return data?.at ?? 0;
}

/** The member's marks as the Files screen draws them. */
export interface PullRequestViewed {
  /** Whether the file at `path` stands viewed: its press still out or taken since the last read, else GitHub's mark; false for every file until the marks are read. */
  readonly viewed: (path: string) => boolean;
  /** Why the last press did not stand, or the marks could not be read, in the pull request's changes' words; none while nothing failed. */
  readonly note: string | undefined;
}

/** One file's mark as its own screen draws and sets it. */
export interface FileViewed {
  /** Whether the file stands viewed, as `PullRequestViewed`'s `viewed` reads it. */
  readonly viewed: boolean;
  /** Turns the file's mark over; none until the marks are read, so a press never asks for a mark GitHub's are unknown beside. */
  readonly toggle: (() => void) | undefined;
}

/** The marks as read and pressed, and the key their presses are kept under. */
interface Marks extends PullRequestViewed {
  readonly readable: boolean;
  readonly mutationKey: readonly unknown[];
}

/** The member's marks on the files of the pull request `key` names, read while the calling screen is in focus, with every press on them still standing over the read. */
function useMarks(key: PullRequestKey): Marks {
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

  const rows = read?.rows;

  const files =
    rows !== undefined && !("failure" in rows) && "files" in rows ? rows.files : undefined;

  // When the marks were last read, so a mark GitHub took before it is the read's to say, and one taken after it still stands drawn.
  const [readAt, setReadAt] = useState(0);
  useEffect(() => {
    if (rows !== undefined) setReadAt(Date.now());
  }, [rows]);

  const mutationKey = [MUTATION_ROOT, accountId, repository.toLowerCase(), number];

  // Every press on this pull request standing over the read, from whichever file's screen it was made: out, or answered since it.
  const presses = useMutationState({
    filters: {
      mutationKey,
      predicate: (each: Mutation) =>
        each.state.status === "pending" || answeredAt(each.state) > readAt,
    },
    select: (each) => ({
      // SAFETY: every mutation under this key is `useFileViewed`'s, whose variables are a press.
      press: each.state.variables as Press,
      refused: each.state.error instanceof MarkRefused ? each.state.error : undefined,
    }),
  });

  const viewed = (path: string): boolean => {
    const newest = presses.findLast(
      (each) => each.press.path === path && each.refused === undefined,
    );

    if (newest !== undefined) return newest.press.viewed;

    return (
      files?.some((file) => file.path === path && file.state === FILE_VIEWED_STATE.VIEWED) ?? false
    );
  };

  const refusal = presses.findLast((each) => each.refused !== undefined)?.refused;

  return {
    viewed,
    note:
      refusal?.words ??
      (rows !== undefined && files === undefined ? pullRequestWriteWords(rows)?.words : undefined),
    readable: files !== undefined,
    mutationKey,
  };
}

/** The member's marks on the files of the pull request `key` names, read while the calling screen is in focus. */
export function usePullRequestViewed(key: PullRequestKey): PullRequestViewed {
  const { viewed, note } = useMarks(key);

  return { viewed, note };
}

/**
 * The member's mark on the file at `path` of the pull request `key` names,
 * as the file's screen draws and sets it. The screen owns the file's one
 * mutation, under the file's own `scope`, so its presses go to GitHub one
 * after another in the order pressed, while another file's go beside them.
 */
export function useFileViewed(key: PullRequestKey, path: string): FileViewed {
  const acts = useHostActs();
  const marks = useMarks(key);
  const { workspaceId, repository, number } = key;

  const mark = useMutation({
    mutationKey: marks.mutationKey,
    scope: { id: hashKey([...marks.mutationKey, path]) },
    mutationFn: async (press: Press) => {
      const answer = await acts[ACT_KIND.PULL_REQUESTS_ACTION]({
        workspaceId,
        repository,
        number,
        request: {
          action: press.viewed
            ? PULL_REQUEST_ACTION.MARK_FILE_VIEWED
            : PULL_REQUEST_ACTION.UNMARK_FILE_VIEWED,
          path: press.path,
        },
      });

      if ("failure" in answer || answer.outcome !== PULL_REQUEST_WRITE_OUTCOME.DONE) {
        throw new MarkRefused(answer);
      }

      return { at: Date.now() };
    },
    // Note that the marks are read again once GitHub took one, so the read soon says it.
    onSuccess: () =>
      void acts[ACT_KIND.PULL_REQUESTS_PART_RETRY]({
        part: PULL_REQUEST_PART.VIEWED,
        workspaceId,
        repository,
        number,
      }),
    retry: false,
  });

  const viewed = marks.viewed(path);

  return {
    viewed,
    toggle: marks.readable ? () => mark.mutate({ path, viewed: !viewed }) : undefined,
  };
}
