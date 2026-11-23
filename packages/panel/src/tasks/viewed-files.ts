import {
  AGENT_CALL_FAILURE,
  type AgentPullRequestViewedAnswerView,
  type AgentPullRequestWriteAnswerView,
  PULL_REQUEST_PART,
} from "@repo/features/agent-view";
import { PULL_REQUEST_ACTION } from "@repo/features/pull-request-write-wire";
import { ViewedMarkStore, viewedIn } from "@repo/features/viewed-marks";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  repositoryPullRequestPartRetryMutation,
  repositoryPullRequestViewedQuery,
} from "../live-reads.js";
import type { ViewedMarks } from "./changes-list.js";
import type { PullRequestSource } from "./pull-request-source.js";
import { noteOf, type WriteNote } from "./pull-request-writes.js";

/**
 * viewed-files.ts -- which of a pull request's files the member marked viewed, as GitHub keeps the mark for them alone, read and set from Files changed.
 *
 * The marks are GitHub's own, the ones its Viewed box sets, so they are read
 * and written by the service on the member's own GitHub sign-in and never on
 * our GitHub App (`pull-request-write-wire.ts`): the read, held by the host
 * while Files changed reads a pull request (`repositoryPullRequestViewedQuery`)
 * and asked again each time the changes are read anew, so the two describe
 * the same push, and as its head moves, and a mark or an unmark as one of the
 * pull request's changes (`PULL_REQUESTS_ACTION`). A file marked
 * viewed and changed since (GitHub's dismissed) reads as not viewed, as
 * GitHub unticks it.
 *
 * How a press is drawn at once and settled with GitHub, a file's presses
 * folded and sent one at a time, is the marks' own, which every client
 * shares (`@repo/features/viewed-marks`); where GitHub would not take the
 * last press, the line under the bar says why, as any other change's does
 * (`pull-request-writes.tsx`).
 */

/** The member's viewed marks: the marks, once read, what the last read or press left to say, and the door that lets it go. */
export interface ViewedFiles {
  /** The marks and the door that sets one; none until they are read, or since a read did not answer. */
  readonly marks: ViewedMarks | undefined;
  readonly note: WriteNote | undefined;
  readonly dismiss: () => void;
}

/** A read of the marks the service did not answer. */
const UNANSWERED: AgentPullRequestViewedAnswerView = { failure: AGENT_CALL_FAILURE.UNANSWERED };

/** A mark nothing answered. */
const MARK_UNANSWERED: AgentPullRequestWriteAnswerView = { failure: AGENT_CALL_FAILURE.UNANSWERED };

/**
 * The member's marks on the pull request's files, held by the host
 * while `reading` names a pull request and asked again each time it counts
 * another answer of the changes read, and marked or unmarked a file at a
 * time, several files at once.
 */
export function useViewedFiles(
  source: Pick<PullRequestSource, "pullRequest" | "write">,
  /** How many answers the changes read has landed with, a pull request named in the latest; none while none is. */
  reading: number | undefined,
): ViewedFiles {
  const { pullRequest, write } = source;

  const held = useQuery(
    repositoryPullRequestViewedQuery(reading === undefined ? undefined : pullRequest),
  );

  const { mutate: retryViewed } = useMutation(repositoryPullRequestPartRetryMutation());
  // Note that a mark is sent through the door as it is when sent, held in a ref, since the marks are made once for the view's life.
  const writeNow = useRef(write);
  useEffect(() => {
    writeNow.current = write;
  }, [write]);

  const [marks] = useState(
    () =>
      new ViewedMarkStore<AgentPullRequestViewedAnswerView, AgentPullRequestWriteAnswerView>(
        (path, viewed) =>
          writeNow.current({
            action: viewed
              ? PULL_REQUEST_ACTION.MARK_FILE_VIEWED
              : PULL_REQUEST_ACTION.UNMARK_FILE_VIEWED,
            path,
          }),
        MARK_UNANSWERED,
      ),
  );

  const shown = useSyncExternalStore(marks.subscribe, marks.snapshot);

  // The changes read landing anew asks the marks again, so the two describe the same push.
  const readFor = useRef(reading);
  useEffect(() => {
    const was = readFor.current;
    readFor.current = reading;

    if (was !== undefined && reading !== undefined && was !== reading) {
      retryViewed({ part: PULL_REQUEST_PART.VIEWED, ...pullRequest });
    }
  }, [reading, retryViewed, pullRequest]);

  const answer: AgentPullRequestViewedAnswerView | undefined =
    held.data ?? (held.isError ? UNANSWERED : undefined);

  useEffect(() => {
    if (answer !== undefined) marks.take(answer);
  }, [answer, marks]);

  const viewed = useCallback((path: string) => viewedIn(shown, path), [shown]);

  const shownMarks = useMemo(
    () => (shown.states === undefined ? undefined : { viewed, toggle: marks.toggle }),
    [shown.states, viewed, marks],
  );

  return {
    marks: shownMarks,
    note: shown.said === undefined ? undefined : noteOf(shown.said),
    dismiss: marks.dismiss,
  };
}
