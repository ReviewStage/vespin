/**
 * use-agent-approvals.ts -- the calls an agent holds for the member's answer, as its page draws and answers them: each held call's row, the oldest waiting for the banner over the composer, and a message's denial of those waiting.
 *
 * The asks are held as the panel's tab holds them, by the shared model
 * (`@repo/features/agent-approval-model`): each the agent's row carries
 * waiting (`pendingApprovals`) is taken in as the page first sees it, an
 * answer goes to the service through the host (`ACT_KIND.AGENTS_ANSWER_APPROVAL`)
 * with its press busy while it is out, and the row then says how it came
 * out, "Allowed" or "Denied"; one that stops waiting with no answer of this
 * page's says it was denied by a message sent meanwhile, answered elsewhere,
 * or expired. The page offers Allow and Deny, the panel's first two answers.
 */

import {
  answerFailedOf,
  HELD_WORDS,
  type HeldAsk,
  heldAbout,
  heldWith,
  markedAsk,
  SETTLED_WORD,
  sameHeld,
  waitingOnYouWords,
} from "@repo/features/agent-approval-model";
import type { AgentPendingApproval } from "@repo/features/agent-approval-wire";
import { AGENT_CALL_FAILURE, type AgentApprovalAnswerView } from "@repo/features/agent-view";
import { AGENT_STATUS } from "@repo/features/agent-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { FollowedAgent } from "@repo/host/app-state-reads";
import { BUZZ, type HeldAnswer, type HeldCall } from "@repo/ui-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHostActs } from "../host/host-provider.js";
import { useWrite } from "../use-write.js";

/** One ask as the page holds it, its failure in words. */
type Held = HeldAsk<HeldAnswer, string>;

/** No asks, held as one value so an agent that holds none reads the same each time. */
const NO_ASKS: readonly AgentPendingApproval[] = [];

/** The banner over the composer while a call waits: how many wait, what the oldest asks, and its answer's press. */
export interface WaitingBanner {
  readonly waiting: string;
  readonly asks: string;
  readonly answering: HeldAnswer | undefined;
  readonly note: string | undefined;
  readonly onAnswer: (answer: HeldAnswer) => void;
}

/** The agent's held calls as its page draws them. */
export interface AgentApprovals {
  /** The ask the agent holds the call `callId` for, as its row draws it; none where it holds none. */
  readonly heldCall: (callId: string) => HeldCall | undefined;
  /** The banner over the composer; none while no call waits. */
  readonly banner: WaitingBanner | undefined;
  /** Says a message went while calls waited, which the service denies them with once it takes it; one not taken takes that back. */
  readonly messageSent: (taken: Promise<boolean>) => void;
}

/** An ask once its answer came back: settled as the answer says, or offered again with why it did not go. */
function answeredAsk(ask: Held, answered: AgentApprovalAnswerView): Held {
  if ("approval" in answered) {
    return { ...ask, answering: undefined, settled: SETTLED_WORD[answered.approval.status] };
  }

  if ("approvalStatus" in answered && answered.approvalStatus !== undefined) {
    return { ...ask, answering: undefined, settled: SETTLED_WORD[answered.approvalStatus] };
  }

  return { ...ask, answering: undefined, error: answerFailedOf(answered.failure).words };
}

/** A held ask as its row draws it, answered through `answer`. */
function heldCallOf(ask: Held, answer: (answer: HeldAnswer) => void): HeldCall {
  return {
    words: ask.settled ?? HELD_WORDS.WAITING,
    waiting: ask.settled === undefined,
    about: heldAbout(ask.approval),
    answering: ask.answering,
    note: ask.error,
    onAnswer: answer,
  };
}

/**
 * The calls the agent holds for an answer, from its row as the task list
 * follows it. Note that the asks are held per agent, from the first render
 * that sees each, so a page moved to another agent starts from none.
 */
export function useAgentApprovals(
  agent: FollowedAgent | undefined,
  agentId: string,
): AgentApprovals {
  const acts = useHostActs();
  const write = useWrite();
  const pending = agent?.pendingApprovals ?? NO_ASKS;
  const running = agent?.status === AGENT_STATUS.RUNNING;

  const [state, setState] = useState<{
    readonly agentId: string;
    readonly held: ReadonlyMap<string, Held>;
  }>(() => ({ agentId, held: new Map() }));

  const fresh = state.agentId === agentId ? state : { agentId, held: new Map<string, Held>() };
  const held = heldWith(fresh.held, pending, running);

  if (fresh !== state || !sameHeld(held, state.held)) setState({ agentId, held });
  // What the agent's row says now, which a message's mark reads as it goes.
  const latest = useRef({ pending, running });
  useEffect(() => {
    latest.current = { pending, running };
  }, [pending, running]);

  const settle = useCallback(
    (forAgent: string, id: string, change: (ask: Held) => Held) =>
      setState((was) => {
        const ask = was.held.get(id);

        if (was.agentId !== forAgent || ask === undefined) return was;

        return { ...was, held: new Map(was.held).set(id, change(ask)) };
      }),
    [],
  );

  const answer = useCallback(
    (approvalId: string, press: HeldAnswer) => {
      settle(agentId, approvalId, (ask) => ({ ...ask, answering: press, error: undefined }));
      // Note that an answer refused says why under the call it answered, rather than in the notice. One refused because another reader settled the call first still buzzes as a refusal, since this press did not land, but its row reads settled rather than failed.
      write(
        () =>
          acts[ACT_KIND.AGENTS_ANSWER_APPROVAL]({ agentId, approvalId, answer: press }).then(
            (answered) => {
              settle(agentId, approvalId, (ask) => answeredAsk(ask, answered));

              return answered;
            },
          ),
        {
          refused: (answered) =>
            "failure" in answered ? answerFailedOf(answered.failure).words : undefined,
          unanswered: answerFailedOf(AGENT_CALL_FAILURE.UNANSWERED).words,
          inPlace: (words) =>
            settle(agentId, approvalId, (ask) =>
              ask.settled === undefined ? { ...ask, answering: undefined, error: words } : ask,
            ),
          went: BUZZ.SUCCESS,
        },
      );
    },
    [acts, write, agentId, settle],
  );

  // Note that the asks are marked as the message goes, since the service may take them off before it answers, and a message not taken takes the mark back.
  const messageSent = useCallback(
    (taken: Promise<boolean>) => {
      const waitingIds = latest.current.pending.map((each) => each.id);

      if (waitingIds.length === 0) return;

      const mark = (messaged: boolean) =>
        setState((was) => {
          if (was.agentId !== agentId) return was;
          const next = new Map(was.held);

          for (const id of waitingIds) {
            const ask = next.get(id);

            if (ask !== undefined) next.set(id, markedAsk(ask, messaged, latest.current.running));
          }

          return { ...was, held: next };
        });

      mark(true);
      taken.then((went) => {
        if (!went) mark(false);
      });
    },
    [agentId],
  );

  return useMemo(() => {
    const asks = [...held.values()].toSorted((a, b) => a.approval.askedAt - b.approval.askedAt);
    const waiting = asks.filter((ask) => ask.settled === undefined);
    const oldest = waiting[0];

    // Note that a subagent's call is not among the transcript's rows, so the banner alone answers it.
    const byCall = new Map(
      asks.flatMap((ask) =>
        ask.approval.subagentId === undefined ? [[ask.approval.toolUseId, ask] as const] : [],
      ),
    );

    return {
      heldCall: (callId) => {
        const ask = byCall.get(callId);

        return ask === undefined
          ? undefined
          : heldCallOf(ask, (press) => answer(ask.approval.id, press));
      },
      banner:
        oldest === undefined
          ? undefined
          : {
              waiting: waitingOnYouWords(waiting.length),
              asks: oldest.approval.title,
              answering: oldest.answering,
              note: oldest.error,
              onAnswer: (press) => answer(oldest.approval.id, press),
            },
      messageSent,
    };
  }, [held, answer, messageSent]);
}
