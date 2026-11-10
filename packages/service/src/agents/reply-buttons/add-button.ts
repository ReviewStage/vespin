/**
 * add-button.ts -- `add_button`: a button a coding agent puts in its reply, beside the line it is about, which starts a new agent on a brief it wrote, or sends its words to a running agent, once a member presses it.
 *
 * The agent never writes what a button does into its reply: it calls this
 * tool with the button's label and what a press does, which is checked now,
 * while the agent can still mend it, and kept with the button
 * (`@repo/database/models/reply-buttons`), and the tool answers the link the
 * agent writes beside its line, which the app draws as the button
 * (`@repo/features/reply-button-wire`). So a label cannot say one thing and
 * do another, and the brief stays out of the reply's words. A start lands on
 * the agent's own task; a send goes to another agent of its workspace. Every
 * check runs again when the button is pressed, as the member who presses it.
 * The tool stands behind the Reply buttons workspace experiment, which the
 * catalog's gate holds (`TOOL_GATE.REPLY_BUTTONS`).
 */

import { makeReplyButton } from "@repo/database/models/reply-buttons";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import { modelChoiceSchema } from "@repo/features/models-wire";
import {
  REPLY_BUTTON_ACTION,
  REPLY_BUTTON_BOUNDS,
  type ReplyButtonAction,
  replyButtonLinkOf,
} from "@repo/features/reply-button-wire";
import type { WireRecord } from "@repo/wire";
import { describeWire } from "@repo/wire/effect";
import { DateTime, Effect, Option, Result, Schema } from "effect";
import { ACTION_RESULT_STATUS, type UnparsedWireValue, wireUuidSchema } from "../../core.js";
import { ModelChoiceRefused } from "../../providers/model-catalog.js";
import {
  type AgentCall,
  type AgentToolServices,
  agentToolRejected,
  callerAgent,
  callerUserId,
  callerWorkspace,
  choiceRefusal,
  orStoreRefusal,
  START_BRANCH,
  START_PROMPT,
  START_TITLE,
} from "../agent-tools.js";
import { MAX_MESSAGE_WORDS_CHARS } from "../coder-host/agent-message.js";
import { acceptedAgentChoice } from "../coder-host/start.js";
import { workspaceAgent } from "../workspace-agents.js";
import { workspaceStepOf } from "../written-mentions.js";

/** Why a button was not made, in the words the model reads. */
export const ADD_BUTTON_REFUSAL = {
  UNREADABLE:
    "Not added: give a label and exactly one of start or send, and a model with its effort or neither.",
  NOT_AGENT: "Not added: only a coding agent puts a button in its reply.",
  NO_AGENT: "Not added: no agent of your workspace has that id.",
  SELF: "Not added: a button never sends to you; start a new agent instead, or say it yourself.",
  MODELS_UNREAD: "Not added: the models offered could not be read; try again.",
} as const;

const ADD_BUTTON_INPUT = Schema.Struct({
  label: describeWire(
    Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(REPLY_BUTTON_BOUNDS.MAX_LABEL_CHARS)),
    "The button's words, a short action in sentence case, such as Wire up the invite email: " +
      `at most ${REPLY_BUTTON_BOUNDS.MAX_LABEL_CHARS} characters, saying what pressing it sets off.`,
  ),
  start: Schema.optionalKey(
    describeWire(
      Schema.Struct({
        prompt: describeWire(
          START_PROMPT,
          "The brief the new agent is handed as its first message: everything it needs to start " +
            "on its work, since it knows nothing else of yours.",
        ),
        title: Schema.optionalKey(
          describeWire(START_TITLE, "The new agent's title; leave it out to have it named."),
        ),
        branch: Schema.optionalKey(
          describeWire(
            START_BRANCH,
            "The branch of the task's repository to clone its checkout at, which must be on " +
              "GitHub when the button is pressed; leave it out for the default branch.",
          ),
        ),
        model: Schema.optionalKey(
          describeWire(
            modelChoiceSchema.fields.model,
            `The model to run on, by its catalog id, as ${AGENT_TOOL.LIST_MODELS} lists it; ` +
              "leave it out with the effort for the default of the member who presses it.",
          ),
        ),
        effort: Schema.optionalKey(
          describeWire(
            modelChoiceSchema.fields.effort,
            "The reasoning effort, as the model lists it; given with the model or not at all.",
          ),
        ),
      }),
      "Start a new agent on the task you work on, as the member who presses the button, where " +
        "their agents on the task run.",
    ),
  ),
  send: Schema.optionalKey(
    describeWire(
      Schema.Struct({
        agentId: describeWire(
          wireUuidSchema,
          `Another agent of your workspace, by the id ${AGENT_TOOL.LIST_AGENTS} answered.`,
        ),
        text: describeWire(
          Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(MAX_MESSAGE_WORDS_CHARS)),
          "The words sent to it, as the member who presses the button.",
        ),
      }),
      "Send words to an agent that is already running, as the member who presses the button.",
    ),
  ),
});

const readAsked = Schema.decodeUnknownResult(ADD_BUTTON_INPUT);

type Asked = typeof ADD_BUTTON_INPUT.Type;

/** `add_button` as a coding agent is offered it: its name, its words, and its input. */
export const ADD_BUTTON_TOOL = {
  name: AGENT_TOOL.ADD_BUTTON,
  description:
    "Put a button in your reply that sets off work the developer may want next, beside the " +
    "line it is about: a new agent started on a brief you write, or words sent to an agent " +
    "already running, either of them only once a member presses it, and then as that member. " +
    "Use it where your reply names a next step that runs apart from your own work, such as a " +
    "follow-up found along the way, rather than asking the developer to start it by hand; " +
    "never for what you will do yourself. Give its label and exactly one of start or send. It " +
    "is checked now, so a refusal says what to mend. Answers `accepted` with the button's " +
    "link, which you write in your reply as `[<label>](<link>)` at the end of the line it is " +
    "about, where the developer sees it as the button, or `rejected` and why no button was " +
    "made. A button runs once, whoever presses it.",
  inputSchema: ADD_BUTTON_INPUT,
} as const;

/** What a press does, as the button keeps it, from what the agent asked; the start's choice already checked. */
function actionOf(asked: Asked): ReplyButtonAction | undefined {
  const { start, send } = asked;
  if (start !== undefined && send === undefined) {
    return { kind: REPLY_BUTTON_ACTION.START, ...start };
  }
  if (send !== undefined && start === undefined) {
    return { kind: REPLY_BUTTON_ACTION.SEND, agentId: send.agentId, text: send.text };
  }
  return undefined;
}

/** Why a start's model is refused, said with the models offered; none where the member's choice stands. */
const startChoiceRefusal = (userId: string, action: ReplyButtonAction) =>
  Effect.gen(function* () {
    if (action.kind !== REPLY_BUTTON_ACTION.START || action.model === undefined) return undefined;
    const choice = { model: action.model, effort: action.effort ?? "" };
    const accepted = yield* acceptedAgentChoice(userId, choice).pipe(Effect.result);
    if (Result.isSuccess(accepted)) return undefined;
    const refusal = accepted.failure;
    return refusal instanceof ModelChoiceRefused
      ? choiceRefusal(choice, refusal.offered, "Not added")
      : ADD_BUTTON_REFUSAL.MODELS_UNREAD;
  });

/** One call of `add_button`: the button made and the link to write it by, or why none was. */
export function runAddButton(
  call: AgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, AgentToolServices> {
  const asked = readAsked(input);
  const action = Result.isSuccess(asked) ? actionOf(asked.success) : undefined;
  // A choice is one thing: a model without its effort, or the reverse, names nothing to run on.
  if (
    !Result.isSuccess(asked) ||
    action === undefined ||
    (action.kind === REPLY_BUTTON_ACTION.START &&
      (action.model === undefined) !== (action.effort === undefined))
  ) {
    return Effect.succeed(agentToolRejected(ADD_BUTTON_REFUSAL.UNREADABLE));
  }
  const agent = callerAgent(call.caller);
  if (agent === undefined) return Effect.succeed(agentToolRejected(ADD_BUTTON_REFUSAL.NOT_AGENT));
  if (action.kind === REPLY_BUTTON_ACTION.SEND && action.agentId === agent.id) {
    return Effect.succeed(agentToolRejected(ADD_BUTTON_REFUSAL.SELF));
  }
  const userId = callerUserId(call.caller);
  return orStoreRefusal(
    Effect.gen(function* () {
      const workspace = yield* callerWorkspace(call.caller);
      if (Option.isNone(workspace)) return agentToolRejected(ADD_BUTTON_REFUSAL.NO_AGENT);
      if (action.kind === REPLY_BUTTON_ACTION.SEND) {
        const found = yield* workspaceAgent(userId, workspace.value, action.agentId, agent.id);
        if (Option.isNone(found)) return agentToolRejected(ADD_BUTTON_REFUSAL.NO_AGENT);
      }
      const refused = yield* startChoiceRefusal(userId, action);
      if (refused !== undefined) return agentToolRejected(refused);
      const now = yield* DateTime.nowAsDate;
      const label = asked.success.label;
      const buttonId = yield* makeReplyButton(agent.id, label, action, now);
      const step = yield* workspaceStepOf(userId, workspace.value);
      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        button: { id: buttonId, label },
        link: replyButtonLinkOf({ workspace: step, agentId: agent.id, buttonId }),
      };
    }),
  );
}
