/**
 * use-pull-request-chapters.ts -- a pull request's chapters as the app's screens hold them, by its workspace, its repository, and its number: their read held live while a screen shows them, Try again, and the member's own Generate.
 *
 * They are read as the panel's Pull request tab reads them
 * (`@repo/panel`'s `chapters-read.ts`): the host's follow of them
 * (`ACT_KIND.CHAPTERS_REPOSITORY_FOLLOW`), kept open while the screen is in
 * focus, lays them on the document under the workspace, the repository,
 * and the number, so any member's claim, finish, or failure draws within a
 * moment. A Generate (`ACT_KIND.CHAPTERS_REPOSITORY_GENERATE`) stands as
 * being made until it answers, and its answer is drawn as soon as it lands
 * and stands until the held read moves, so the chapters made never give way
 * to what was there before.
 */

import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
import { LIVE_READ } from "@repo/features/live-wire";
import type { PullRequestChaptersAnswerView } from "@repo/features/pull-request-chapters-view";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { useQuery } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs, useHostFollow } from "../host/host-provider.js";
import type { PullRequestKey } from "./use-pull-request.js";

/** A read that failed before it ever answered, drawn as any other failed read. */
const UNANSWERED: PullRequestChaptersAnswerView = { failure: AGENT_CALL_FAILURE.UNANSWERED };

/** A pull request's chapters as a screen holds them: the read, its Try again, and the member's own Generate. */
export interface PullRequestChapters {
  /** What the read answers now, or the member's Generate's answer until the read moves; none while it has never answered. */
  readonly answer: PullRequestChaptersAnswerView | undefined;
  /** Reads them again at once, letting the member's last Generate's answer go. */
  readonly retry: () => Promise<void>;
  /** Generates them for the pull request's head now; the screen stands them as being made until it answers. */
  readonly generate: () => void;
  /** When the member's own Generate was pressed, while it is out. */
  readonly generating: number | undefined;
}

/** Says on the console an ask the host refused, which the screen draws without. */
function refused(what: string): (cause: unknown) => void {
  return (error) => console.error(`${what} did not land.`, error);
}

/**
 * The pull request's chapters, held followed while the screen is in focus
 * and let go as it leaves, as the panel's tab holds them while it shows.
 */
export function usePullRequestChapters(key: PullRequestKey): PullRequestChapters {
  const acts = useHostActs();
  const follow = useHostFollow();
  const { workspaceId, repository, number } = key;
  useFocusEffect(
    useCallback(
      () =>
        follow(
          () => acts[ACT_KIND.CHAPTERS_REPOSITORY_FOLLOW]({ workspaceId, repository, number }),
          () => undefined,
        ),
      [acts, follow, workspaceId, repository, number],
    ),
  );

  const read = useQuery({
    ...appStateQuery,
    select: useCallback(
      (state: AppStateSnapshot) =>
        state[LIVE_READ.REPOSITORY_PULL_REQUEST_CHAPTERS][workspaceId]?.[repository]?.[
          String(number)
        ],
      [workspaceId, repository, number],
    ),
  }).data;

  // Note that a read that failed with nothing kept from before draws as failed; one asked again stands as it last answered until it answers.
  const readAnswer: PullRequestChaptersAnswerView | undefined =
    read?.rows ?? (read?.failed === true ? UNANSWERED : undefined);

  const [generated, setGenerated] = useState<
    { readonly of: unknown; readonly answer: PullRequestChaptersAnswerView } | undefined
  >(undefined);

  const [generating, setGenerating] = useState<number | undefined>(undefined);
  // The read as last drawn, which a Generate's answer is held against once it lands.
  const latest = useRef(readAnswer);
  useEffect(() => {
    latest.current = readAnswer;
  }, [readAnswer]);
  // Note that whether a Generate is out is a ref too, because two presses in one frame both read the state as none.
  const out = useRef(false);

  const generate = useCallback(() => {
    if (out.current) return;
    out.current = true;
    setGenerating(Date.now());
    acts[ACT_KIND.CHAPTERS_REPOSITORY_GENERATE]({ workspaceId, repository, number })
      .catch((cause: unknown): PullRequestChaptersAnswerView => {
        refused("A Generate of the chapters")(cause);

        return UNANSWERED;
      })
      .then((answer) => {
        out.current = false;
        setGenerating(undefined);
        setGenerated({ of: latest.current, answer });
      });
  }, [acts, workspaceId, repository, number]);

  // Note that Try again lets a Generate's answer go, because a read that answers as before keeps its identity and would leave a failed Generate drawn over it.
  const retry = useCallback(() => {
    setGenerated(undefined);

    return acts[ACT_KIND.CHAPTERS_REPOSITORY_RETRY]({ workspaceId, repository, number }).catch(
      refused("A read of the chapters"),
    );
  }, [acts, workspaceId, repository, number]);

  const answer =
    generated !== undefined && generated.of === readAnswer ? generated.answer : readAnswer;

  return { answer, retry, generate, generating };
}
