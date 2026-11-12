/**
 * suggestion-model.ts -- a suggestion in another agent's reply as every client opens and sends it: the draft it fills in, what the send carries, and what its answer comes to, in the panel's words.
 *
 * A press of a suggestion (`reply-button-wire.ts`) never runs it: it fills a
 * draft in, a new agent's with the brief and the suggestion's model, or a
 * running agent's own box with the words, and the draft keeps the suggestion
 * beside its words (`DraftSuggestion`). What the member sends from it goes
 * through the suggestion, once: the words and files as they left them, and
 * for a new agent the model its chip holds, beside the title and branch the
 * suggestion named. Its answer is the agent it reached where the member's
 * own send landed; a send another member landed first is refused with who
 * sent it, so the member's words stay in the box rather than being taken for
 * sent. How a refused start is worded is the client's (`SuggestionRefusal`),
 * since the panel's names its Settings and its devices.
 */

import { Schema as EffectSchema } from "effect";
import type { AgentPermissionMode } from "./agent-approval-wire.js";
import { messageFailureWords, type RefusedCall } from "./agent-refusal-words.js";
import { isAgentCallFailure, type ReplyButtonPressAnswerView } from "./agent-view.js";
import type { AgentAttachment, AgentRunsOnRequest } from "./agent-wire.js";
import { FAILURE_REASON, type Failure } from "./failure-remedy.js";
import type { ModelChoice } from "./models-wire.js";
import {
  REPLY_BUTTON_ACTION,
  type ReplyButtonAction,
  type ReplyButtonSent,
  type ReplyButtonView,
} from "./reply-button-wire.js";
import type { Unreached } from "./unreached.js";

/** What a send that did not run says where no refusal of a start's or a message's names why. */
const SEND_REFUSED = "The suggestion wasn't sent. Try again.";

/** What a send says where another member's send of the suggestion stands first, by their name where their account stands. */
function sentByOther(by: string | null, landed: boolean): string {
  const who = by ?? "a teammate";

  return landed
    ? `Already sent by ${who}. Your words are still here.`
    : `${who} is sending this suggestion now. Your words are still here.`;
}

/**
 * The suggestion in another agent's reply a draft was opened from: the agent
 * whose reply holds it, the button, its label, and, for a new agent, the
 * title and branch it named, which the draft sends as they were since no
 * chip edits them. Its send goes through the suggestion, once, rather than
 * starting or sending afresh.
 */
export const draftSuggestionSchema = EffectSchema.Struct({
  agentId: EffectSchema.String,
  buttonId: EffectSchema.String,
  label: EffectSchema.String,
  title: EffectSchema.optionalKey(EffectSchema.String),
  branch: EffectSchema.optionalKey(EffectSchema.String),
});

export type DraftSuggestion = typeof draftSuggestionSchema.Type;

/** A send refused, as the draft's box says it under itself, the answer that refused it kept for a report. */
type SuggestionFailure = Failure & { readonly cause?: unknown };

/** What a suggestion's send came to: the agent the member's words reached, or why they reached none. */
export type SuggestionSendResult =
  | { readonly reached: string }
  | { readonly failure: SuggestionFailure };

/** How a client words a refused send of a suggestion, by the refusal the service answered. */
export type SuggestionRefusal = (refused: RefusedCall) => Failure;

/** A refused send to a running agent, said as a message's refusal is, on every client. */
export const MESSAGE_SUGGESTION_REFUSAL: SuggestionRefusal = (refused) => ({
  reason: FAILURE_REASON.OTHER,
  text: messageFailureWords(refused.failure),
});

/** The draft a suggestion opens keeps, from the button as the service answers it and the label it is drawn with. */
export function draftSuggestionOf(view: ReplyButtonView, label: string): DraftSuggestion {
  const { action } = view;
  const start = action.kind === REPLY_BUTTON_ACTION.START ? action : undefined;

  return {
    agentId: view.agentId,
    buttonId: view.id,
    label,
    ...(start?.title === undefined ? undefined : { title: start.title }),
    ...(start?.branch === undefined ? undefined : { branch: start.branch }),
  };
}

/** The model and effort a new agent's suggestion lays on its draft's chip; none where it named neither, or sends to a running agent. */
export function suggestedChoice(action: ReplyButtonAction): ModelChoice | undefined {
  if (action.kind !== REPLY_BUTTON_ACTION.START) return undefined;

  return action.model === undefined || action.effort === undefined
    ? undefined
    : { model: action.model, effort: action.effort };
}

/** What a draft's words become as a suggestion is laid in: those already written, a blank line, and the suggestion's. */
export function suggestedWords(written: string, suggested: string): string {
  return [written.trim(), suggested].filter((each) => each !== "").join("\n\n");
}

/** What a send from a suggestion's draft carries: its words and files as left, and for a new agent the model and effort its chip holds, beside the title and branch the suggestion named. */
export function sentOf(
  suggestion: DraftSuggestion,
  words: string,
  attachments: readonly AgentAttachment[],
  choice?: ModelChoice,
  disabledServers: readonly string[] = [],
  runsOn?: AgentRunsOnRequest,
  permissionMode?: AgentPermissionMode,
): ReplyButtonSent {
  return {
    words,
    ...(attachments.length === 0 ? undefined : { attachments }),
    ...(suggestion.title === undefined ? undefined : { title: suggestion.title }),
    ...(suggestion.branch === undefined ? undefined : { branch: suggestion.branch }),
    ...(choice === undefined ? undefined : { model: choice.model, effort: choice.effort }),
    ...(disabledServers.length === 0 ? undefined : { disabledServers }),
    ...(runsOn === undefined ? undefined : { runsOn }),
    ...(permissionMode === undefined ? undefined : { permissionMode }),
  };
}

/**
 * What a send's answer comes to: the agent reached where the member's own
 * send landed; who sent it where another's stands first; a refusal the
 * service named, in the client's words for it (`refusal`); and otherwise a
 * send that did not run.
 */
export function suggestionSendResult(
  answer: ReplyButtonPressAnswerView | Unreached<string>,
  refusal: SuggestionRefusal,
): SuggestionSendResult {
  if ("failure" in answer) {
    const { failure } = answer;

    if (!isAgentCallFailure(failure)) {
      return { failure: { reason: FAILURE_REASON.OTHER, text: SEND_REFUSED, cause: answer } };
    }

    return { failure: { ...refusal({ ...answer, failure }), cause: answer } };
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
