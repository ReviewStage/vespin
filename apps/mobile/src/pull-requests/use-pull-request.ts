/**
 * use-pull-request.ts -- one agent's pull request as the app's screens read and change it: its three parts held live while a screen shows it, Try again, and the changes a member makes to it on GitHub.
 *
 * A pull request is read as the panel's Pull request tab reads it
 * (`@repo/panel`'s `live-reads.ts`): each part's follow
 * (`ACT_KIND.AGENTS_PULL_REQUEST_PART_FOLLOW`), the pull request itself, its
 * checks, and its conversation, kept open on the host while the screen is
 * in focus and opened again as it breaks (`@repo/host/follow-stream`), and
 * the host lays each part it reads on the document, under the agent and the
 * pull request's number, and asks it again as the pull request moves, so
 * the screen stays current with nothing of its own. A change is the panel's
 * act too (`ACT_KIND.AGENTS_PULL_REQUEST_ACTION`), made on GitHub as the
 * member; once GitHub answered, the parts are asked again and the change
 * stays out until they land, so the screen never draws the pull request as
 * it stood before its change.
 */

import {
  type AgentOverviewChecksAnswerView,
  type AgentOverviewConversationAnswerView,
  type AgentOverviewPullRequestAnswerView,
  PULL_REQUEST_PART,
  type PullRequestPart,
} from "@repo/features/agent-view";
import type { AgentOverviewPullRequest } from "@repo/features/agent-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import { PULL_REQUEST_WRITE_WORDS, pullRequestWriteWords } from "@repo/features/pull-request-model";
import type {
  PullRequestAction,
  PullRequestActionRequest,
} from "@repo/features/pull-request-write-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppHostRead, AppStateSnapshot } from "@repo/host/app-state";
import { BUZZ } from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs, useHostFollow } from "../host/host-provider.js";
import { useWrite } from "../use-write.js";

/** The parts a pull request screen holds: the pull request, its checks, and its conversation. */
const SHOWN_PARTS: readonly PullRequestPart[] = [
  PULL_REQUEST_PART.PULL_REQUEST,
  PULL_REQUEST_PART.CHECKS,
  PULL_REQUEST_PART.CONVERSATION,
];

/** One agent's pull request, by the agent and its number. */
export interface PullRequestKey {
  readonly agentId: string;
  readonly number: number;
}

/** The parts as the host holds them now, each its read as it stands; none before the host holds it. */
export interface PullRequestParts {
  readonly pullRequest: AppHostRead<AgentOverviewPullRequestAnswerView> | undefined;
  readonly checks: AppHostRead<AgentOverviewChecksAnswerView> | undefined;
  readonly conversation: AppHostRead<AgentOverviewConversationAnswerView> | undefined;
}

/** Says on the console an ask the host refused, which the screen draws without. */
function refused(what: string): (error: unknown) => void {
  return (error) => console.error(`${what} did not land.`, error);
}

/** One part's read on the document, under the agent and the number. */
function partIn<Part>(
  slice: Readonly<Record<string, Readonly<Record<string, AppHostRead<Part>>>>>,
  key: PullRequestKey,
): AppHostRead<Part> | undefined {
  return slice[key.agentId]?.[String(key.number)];
}

/**
 * The pull request's parts as the host holds them, each held followed while
 * the screen is in focus and let go as it leaves, as the panel's tab holds
 * them while it shows. Note that the document keeps a part's identity while
 * it does not move, so the screen is drawn again only as one does.
 */
export function usePullRequestParts(key: PullRequestKey): PullRequestParts {
  const acts = useHostActs();
  const follow = useHostFollow();
  const { agentId, number } = key;
  useFocusEffect(
    useCallback(() => {
      const stops = SHOWN_PARTS.map((part) =>
        follow(
          () => acts[ACT_KIND.AGENTS_PULL_REQUEST_PART_FOLLOW]({ part, agentId, number }),
          () => undefined,
        ),
      );

      return () => {
        for (const stop of stops) stop();
      };
    }, [acts, follow, agentId, number]),
  );

  const pullRequest = useQuery({
    ...appStateQuery,
    select: useCallback(
      (state: AppStateSnapshot) => partIn(state[LIVE_READ.PULL_REQUEST], { agentId, number }),
      [agentId, number],
    ),
  }).data;

  const checks = useQuery({
    ...appStateQuery,
    select: useCallback(
      (state: AppStateSnapshot) =>
        partIn(state[LIVE_READ.PULL_REQUEST_CHECKS], { agentId, number }),
      [agentId, number],
    ),
  }).data;

  const conversation = useQuery({
    ...appStateQuery,
    select: useCallback(
      (state: AppStateSnapshot) =>
        partIn(state[LIVE_READ.PULL_REQUEST_CONVERSATION], { agentId, number }),
      [agentId, number],
    ),
  }).data;

  return useMemo(
    () => ({ pullRequest, checks, conversation }),
    [pullRequest, checks, conversation],
  );
}

/** Asks every part of the pull request again at once, as Try again and a pull down ask; answers once each ask has landed. */
export function usePullRequestRetry(key: PullRequestKey): () => Promise<void> {
  const acts = useHostActs();
  const { agentId, number } = key;

  return useCallback(
    () =>
      Promise.all(
        SHOWN_PARTS.map((part) =>
          acts[ACT_KIND.AGENTS_PULL_REQUEST_PART_RETRY]({ part, agentId, number }).catch(
            refused("A pull request's read"),
          ),
        ),
      ).then(() => undefined),
    [acts, agentId, number],
  );
}

/** What a screen says of the last change where GitHub did not make it: our sentence, and GitHub's own words under it where it said some. */
interface WriteNote {
  readonly words: string;
  readonly said?: string | undefined;
}

/** The pull request's changes: the one out, if any, what the last one left to say, and the press that sends one. */
export interface PullRequestWrites {
  readonly pending: PullRequestAction | undefined;
  readonly note: WriteNote | undefined;
  /** Sends the change; answers whether GitHub made it, once the parts it asked again have landed. Nothing is sent while another change is out. */
  readonly write: (request: PullRequestActionRequest) => Promise<boolean>;
}

/**
 * The pull request's changes, one at a time, as the panel's tab makes
 * them: a press while one is out sends nothing; once GitHub answers,
 * whether it made the change or refused it, the parts are asked again and
 * the change stays out until they land; and where GitHub did not make it,
 * its note says why until the next change is sent.
 */
export function usePullRequestWrites(key: PullRequestKey): PullRequestWrites {
  const acts = useHostActs();
  const retry = usePullRequestRetry(key);
  const { agentId, number } = key;
  const [pending, setPending] = useState<PullRequestAction | undefined>(undefined);
  const [note, setNote] = useState<WriteNote | undefined>(undefined);
  // Note that the change out is held in a ref as well, because two presses in one frame both read the state from before either.
  const out = useRef(false);
  const write = useWrite();

  const change = useCallback(
    async (request: PullRequestActionRequest) => {
      if (out.current) return false;
      out.current = true;
      setPending(request.action);
      setNote(undefined);

      try {
        // Note that GitHub's own sentence of a refusal is kept beside the words, so the note says both; a change that got no answer says the words alone.
        let said: WriteNote | undefined;

        return await write(
          async () => {
            const answer = await acts[ACT_KIND.AGENTS_PULL_REQUEST_ACTION]({
              agentId,
              number,
              request,
            });

            // Note that a refusal may still have moved the pull request, so every answer from GitHub reads again.
            if (!("failure" in answer)) await retry();
            said = pullRequestWriteWords(answer);

            return answer;
          },
          {
            refused: () => said?.words,
            unanswered: PULL_REQUEST_WRITE_WORDS.UNREACHED,
            inPlace: (words) => setNote(said ?? { words }),
            went: BUZZ.SUCCESS,
          },
        );
      } finally {
        out.current = false;
        setPending(undefined);
      }
    },
    [acts, write, retry, agentId, number],
  );

  return { pending, note, write: change };
}

/** No pull request read, held as one map so a screen that holds none reads the same each time. */
const NO_PULL_REQUESTS: ReadonlyMap<number, AgentOverviewPullRequest> = new Map();

/** The numbers handed, as the same array while they are the same numbers, so a follow over them is not opened again as the list is drawn again. */
function useSameNumbers(numbers: readonly number[]): readonly number[] {
  const [held, setHeld] = useState(numbers);

  const same =
    held.length === numbers.length && held.every((number, index) => numbers[index] === number);

  // Note that new numbers are taken as they are drawn, as React keeps a value from the last render, rather than through a ref read while drawing.
  if (same) return held;
  setHeld(numbers);

  return numbers;
}

/**
 * Each of an agent's pull requests named, as its own read answers it, held
 * followed while the screen is in focus, as a page drawing their cards
 * offers what each may do; one not read yet, or whose read failed, is
 * absent.
 */
export function usePullRequestsRead(
  agentId: string,
  numbers: readonly number[],
): ReadonlyMap<number, AgentOverviewPullRequest> {
  const acts = useHostActs();
  const follow = useHostFollow();
  const held = useSameNumbers(numbers);
  useFocusEffect(
    useCallback(() => {
      const part = PULL_REQUEST_PART.PULL_REQUEST;

      const stops = held.map((number) =>
        follow(
          () => acts[ACT_KIND.AGENTS_PULL_REQUEST_PART_FOLLOW]({ part, agentId, number }),
          () => undefined,
        ),
      );

      return () => {
        for (const stop of stops) stop();
      };
    }, [acts, follow, agentId, held]),
  );

  const slice = useQuery({
    ...appStateQuery,
    select: useCallback(
      (state: AppStateSnapshot) => state[LIVE_READ.PULL_REQUEST][agentId],
      [agentId],
    ),
  }).data;

  return useMemo(() => {
    if (slice === undefined) return NO_PULL_REQUESTS;
    const read = new Map<number, AgentOverviewPullRequest>();

    for (const number of held) {
      const rows = slice[String(number)]?.rows;

      if (rows !== undefined && !("failure" in rows) && rows.pullRequest !== null) {
        read.set(number, rows.pullRequest);
      }
    }

    return read;
  }, [slice, held]);
}
