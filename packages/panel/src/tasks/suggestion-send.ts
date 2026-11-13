import { AGENT_CALL_FAILURE, type ReplyButtonPressParams } from "@repo/features/agent-view";
import {
  MESSAGE_SUGGESTION_REFUSAL,
  type SuggestionRefusal,
  type SuggestionSendResult,
  suggestionSendResult,
} from "@repo/features/suggestion-model";
import { ACT_KIND } from "@repo/host/acts";
import { queryOptions, useQueryClient } from "@tanstack/react-query";
import { askAct, unreachedAs } from "../act.js";
import { QUERY_ROOT } from "../query-keys.js";
import { startFailureNote } from "./agent-model.js";

/**
 * suggestion-send.ts -- a suggestion in another agent's reply sent from the draft it filled in, through the panel's act port, its refusals in the panel's words.
 *
 * A press of a suggestion only fills a draft in (`reply-button-link.tsx`): a
 * new agent's, or a running agent's own box. What the send carries and what
 * its answer comes to are every client's (`@repo/features/suggestion-model`);
 * what stays here is the read of the button, the send through the act port,
 * and a refused start said as the panel's Start says it.
 */

/**
 * How a send is refused, in the panel's words: as a Start's where it starts a
 * new agent, naming Settings and the task's device as the Start does, and as
 * a message's where it sends to one running.
 */
function refusalOf(starts: boolean, taskId: string | null): SuggestionRefusal {
  return starts ? (refused) => startFailureNote(refused, taskId) : MESSAGE_SUGGESTION_REFUSAL;
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

    return suggestionSendResult(answer, refusalOf(starts, taskId));
  };
}
