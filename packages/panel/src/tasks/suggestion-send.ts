import { messageFailureWords } from "@repo/features/agent-refusal-words";
import {
  AGENT_CALL_FAILURE,
  isAgentCallFailure,
  type ReplyButtonPressAnswerView,
  type ReplyButtonPressParams,
} from "@repo/features/agent-view";
import type { AgentAttachment } from "@repo/features/agent-wire";
import { FAILURE_REASON, type Failure } from "@repo/features/failure-remedy";
import type { ModelChoice } from "@repo/features/models-wire";
import type { ReplyButtonSent } from "@repo/features/reply-button-wire";
import { ACT_KIND } from "@repo/host/acts";
import { queryOptions, useQueryClient } from "@tanstack/react-query";
import { askAct, type Unreached, unreachedAs } from "../act.js";
import type { DraftSuggestion } from "../composer-drafts.js";
import { QUERY_ROOT } from "../query-keys.js";
import { startFailureNote } from "./agent-model.js";

/**
 * suggestion-send.ts -- a suggestion in another agent's reply sent from the draft it filled in: what the send carries, and what its answer comes to.
 *
 * A press of a suggestion only fills a draft in (`reply-button-link.tsx`): a
 * new agent's, or a running agent's own box. What the member sends from it
 * goes through the suggestion, once (`@repo/features/reply-button-wire`):
 * the words and files as they left them, and for a new agent the model its
 * chip holds, beside the title and branch the suggestion named. Its answer
 * is the agent it reached where the member's own send landed; a send
 * another member landed first is refused with who sent it, so the member's
 * words stay in the box rather than being taken for sent.
 */

/** A send refused, as the draft's box says it under itself, the answer that refused it kept for a report. */
export type SuggestionFailure = Failure & { readonly cause?: unknown };

/** What a suggestion's send came to: the agent the member's words reached, or why they reached none. */
export type SuggestionSendResult =
  | { readonly reached: string }
  | { readonly failure: SuggestionFailure };

/** What a send that did not run says where no refusal of a start's or a message's names why. */
const SEND_REFUSED = "The suggestion wasn't sent. Try again.";

/** What a send says where another member's send of the suggestion stands first, by their name where their account stands. */
function sentByOther(by: string | null, landed: boolean): string {
  const who = by ?? "a teammate";
  return landed
    ? `Already sent by ${who}. Your words are still here.`
    : `${who} is sending this suggestion now. Your words are still here.`;
}

/** What a send from a suggestion's draft carries: its words and files as left, and for a new agent the model and effort its chip holds, beside the title and branch the suggestion named. */
export function sentOf(
  suggestion: DraftSuggestion,
  words: string,
  attachments: readonly AgentAttachment[],
  choice?: ModelChoice,
): ReplyButtonSent {
  return {
    words,
    ...(attachments.length === 0 ? undefined : { attachments }),
    ...(suggestion.title === undefined ? undefined : { title: suggestion.title }),
    ...(suggestion.branch === undefined ? undefined : { branch: suggestion.branch }),
    ...(choice === undefined ? undefined : { model: choice.model, effort: choice.effort }),
  };
}

/**
 * What a send's answer comes to: the agent reached where the member's own
 * send landed; who sent it where another's stands first; and a refusal said
 * as a Start's where it starts a new agent, as a message's where it sends to
 * one running, and otherwise as a send that did not run.
 */
export function suggestionSendResult(
  answer: ReplyButtonPressAnswerView | Unreached<string>,
  starts: boolean,
  taskId: string | null,
): SuggestionSendResult {
  if ("failure" in answer) {
    const { failure } = answer;
    if (!isAgentCallFailure(failure)) {
      return { failure: { reason: FAILURE_REASON.OTHER, text: SEND_REFUSED, cause: answer } };
    }
    const note = starts
      ? startFailureNote({ ...answer, failure }, taskId)
      : { reason: FAILURE_REASON.OTHER, text: messageFailureWords(failure) };
    return { failure: { ...note, cause: answer } };
  }
  const { pressed } = answer;
  if (pressed?.byReader === true && pressed.agent !== null) {
    return { reached: pressed.agent.id };
  }
  const text =
    pressed === null || pressed.byReader
      ? SEND_REFUSED
      : sentByOther(pressed.by, pressed.agent !== null);
  return { failure: { reason: FAILURE_REASON.OTHER, text } };
}

/** A suggestion's button as the service answers it, by the agent whose reply holds it and its id, which the reply draws it from. */
export const replyButtonQuery = (agentId: string, buttonId: string) =>
  queryOptions({
    queryKey: [QUERY_ROOT.REPLY_BUTTON, agentId, buttonId],
    queryFn: () => askAct(ACT_KIND.AGENTS_REPLY_BUTTON, { agentId, buttonId }),
    retry: false,
  });

/** A send that found no host to answer it, refused as unanswered. */
const unanswered = unreachedAs(AGENT_CALL_FAILURE.UNANSWERED);

/**
 * Sends a suggestion's draft through it, once, and keeps the button as its
 * send left it, so the reply draws it as the agent it reached at once. The
 * door answers what the send came to (`suggestionSendResult`), said as a
 * Start's refusal where it starts a new agent and as a message's otherwise.
 */
export function useSuggestionSender(): (
  params: ReplyButtonPressParams,
  starts: boolean,
  taskId: string | null,
) => Promise<SuggestionSendResult> {
  const queries = useQueryClient();
  return async (params, starts, taskId) => {
    const answer = await askAct(ACT_KIND.AGENTS_REPLY_BUTTON_PRESS, params).catch(unanswered);
    if (!("failure" in answer)) {
      queries.setQueryData(replyButtonQuery(params.agentId, params.buttonId).queryKey, answer);
    }
    return suggestionSendResult(answer, starts, taskId);
  };
}
