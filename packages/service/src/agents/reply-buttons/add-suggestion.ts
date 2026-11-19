/**
 * add-suggestion.ts -- `add_suggestion`: a suggestion a coding agent puts in its reply or a thread's message, beside the line it is about, of a new agent started on a brief it wrote, or of its words sent to a running agent, which a member opens filled in, may edit, and sends.
 *
 * The agent never writes what a suggestion does into its reply: it calls
 * this tool with the suggestion's label and what it suggests, which is
 * checked now, while the agent can still mend it, and kept with the
 * suggestion (`@repo/database/models/reply-buttons`), and the tool answers
 * the link the agent writes beside its line, which the app draws as the
 * suggestion (`@repo/features/reply-button-wire`). So a label cannot say one
 * thing and do another, and the brief stays out of the reply's words. A
 * start lands on the agent's own task; a send goes to another agent of its
 * workspace. Every check runs again when the member sends it, as that
 * member. The tool stands behind the Suggestions workspace experiment, which
 * the catalog's gate holds (`TOOL_GATE.REPLY_BUTTONS`).
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
import { describeWire, readEither } from "@repo/wire/effect";
import { DateTime, Effect, Option, Result, Schema } from "effect";
import { ACTION_RESULT_STATUS, type UnparsedWireValue, wireUuidSchema } from "../../core.js";
import { ModelChoiceRefused } from "../../providers/model-catalog.js";
import {
  type AgentCall,
  type AgentToolServices,
  agentToolRejected,
  branchNeededRefusal,
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

/** What a suggestion's action takes, in words, so a call refused for its shape is fixed in one retry. */
const ACTION_WORDS =
  'Give a label and an action: {kind: "start", prompt, model and effort as ' +
  `${AGENT_TOOL.LIST_MODELS} lists them, branch where your task works in a repository, and ` +
  'optionally title} or {kind: "send", agentId, text}, ' +
  "and no other field.";

/** Why a button was not made, in the words the model reads. */
export const ADD_SUGGESTION_REFUSAL = {
  NOT_AGENT: "Not added: only a coding agent puts a suggestion in its reply.",
  NO_AGENT: "Not added: no agent of your workspace has that id.",
  SELF: "Not added: a suggestion never sends to you; suggest a new agent instead, or say it yourself.",
  MODELS_UNREAD: "Not added: the models offered could not be read; try again.",
} as const;

/** One action a suggestion sets off, by its kind, with only the fields that kind takes; it reads as the button keeps it. */
const SUGGESTION_ACTION_INPUT = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal(REPLY_BUTTON_ACTION.START),
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
        "The branch of the task's repository to clone its checkout at, such as the " +
          "repository's default branch, which must be on GitHub when the button is pressed. " +
          "Required where the task works in a repository; leave it out for a task with none.",
      ),
    ),
    model: describeWire(
      modelChoiceSchema.fields.model,
      `The model to run on, by its catalog id, as ${AGENT_TOOL.LIST_MODELS} lists it.`,
    ),
    effort: describeWire(
      modelChoiceSchema.fields.effort,
      "The reasoning effort, as the model lists it.",
    ),
  }),
  Schema.Struct({
    kind: Schema.Literal(REPLY_BUTTON_ACTION.SEND),
    agentId: describeWire(
      wireUuidSchema,
      `Another agent of your workspace, by the id ${AGENT_TOOL.LIST_AGENTS} answered.`,
    ),
    text: describeWire(
      Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(MAX_MESSAGE_WORDS_CHARS)),
      "The words sent to it, as the member who sends them.",
    ),
  }),
]);

/**
 * A suggestion names its label and its action. Note that the action is
 * nested under `action`, because a tool's input must be an object at its
 * top, and that `label` stays flat, because released panels read it there
 * to name a stored call's row.
 */
const ADD_SUGGESTION_INPUT = Schema.Struct({
  label: describeWire(
    Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(REPLY_BUTTON_BOUNDS.MAX_LABEL_CHARS)),
    "The suggestion's words, a short action in sentence case, such as Wire up the invite email: " +
      `at most ${REPLY_BUTTON_BOUNDS.MAX_LABEL_CHARS} characters, saying what it sets off.`,
  ),
  action: describeWire(
    SUGGESTION_ACTION_INPUT,
    "What it sets off, by its kind, with only the fields that kind takes: start, a new agent on " +
      "the task you work on, started as the member who sends it, where their agents on the task " +
      "run; or send, words for an agent that is already running, sent as the member who sends " +
      "them.",
  ),
});

const readAsked = readEither(ADD_SUGGESTION_INPUT);

/** Why an input did not read, naming the field it failed at and what an action takes. */
function unreadable(path: readonly (string | number)[]): string {
  const at = path.join(".");

  return `Not added: the input did not read${at === "" ? "" : ` at ${at}`}. ${ACTION_WORDS}`;
}

/** `add_suggestion` as a coding agent is offered it: its name, its words, and its input. */
export const ADD_SUGGESTION_TOOL = {
  name: AGENT_TOOL.ADD_SUGGESTION,
  description:
    "Put a suggestion in your reply or a thread of work the developer may want next, beside " +
    "the line it is about: a new agent started on a brief you write, or words sent to an agent " +
    "already running. A member who presses it opens it filled in, in a new agent's box or that " +
    "agent's, may edit it, and sends it as themselves; nothing runs until they do. Use it " +
    "where your reply or a thread names a next step that runs apart from your own work, such " +
    "as a follow-up found along the way, rather than asking the developer to start it by hand; " +
    "never for what you will do yourself. Give its label and its action, a start or a send. " +
    "Write the link it answers in your reply, or in a thread's message, as `[<label>](<link>)` at " +
    "the end of the line it is about, where the developer sees it as the suggestion. A suggestion " +
    "is sent once, whoever sends it, and what it reaches reads that you suggested it.",
  inputSchema: ADD_SUGGESTION_INPUT,
} as const;

/** Why a start's model is refused, said with the models offered; none where it is offered, or the suggestion is no start. */
const startChoiceRefusal = (userId: string, action: ReplyButtonAction) =>
  Effect.gen(function* () {
    if (
      action.kind !== REPLY_BUTTON_ACTION.START ||
      action.model === undefined ||
      action.effort === undefined
    ) {
      return undefined;
    }

    const choice = { model: action.model, effort: action.effort };
    const accepted = yield* acceptedAgentChoice(userId, choice).pipe(Effect.result);

    if (Result.isSuccess(accepted)) return undefined;
    const refusal = accepted.failure;

    return refusal instanceof ModelChoiceRefused
      ? choiceRefusal(choice, refusal.offered, "Not added")
      : ADD_SUGGESTION_REFUSAL.MODELS_UNREAD;
  });

/** One call of `add_suggestion`: the button made and the link to write it by, or why none was. */
export function runAddSuggestion(
  call: AgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, AgentToolServices> {
  const asked = readAsked(input);

  if (Result.isFailure(asked)) {
    return Effect.succeed(agentToolRejected(unreadable(asked.failure.path)));
  }

  const { label, action } = asked.success;

  const agent = callerAgent(call.caller);

  if (agent === undefined)
    return Effect.succeed(agentToolRejected(ADD_SUGGESTION_REFUSAL.NOT_AGENT));

  if (action.kind === REPLY_BUTTON_ACTION.SEND && action.agentId === agent.id) {
    return Effect.succeed(agentToolRejected(ADD_SUGGESTION_REFUSAL.SELF));
  }

  const userId = callerUserId(call.caller);

  return orStoreRefusal(
    Effect.gen(function* () {
      const workspace = yield* callerWorkspace(call.caller);

      if (Option.isNone(workspace)) return agentToolRejected(ADD_SUGGESTION_REFUSAL.NO_AGENT);

      if (action.kind === REPLY_BUTTON_ACTION.SEND) {
        const found = yield* workspaceAgent(userId, workspace.value, action.agentId, agent.id);

        if (Option.isNone(found)) return agentToolRejected(ADD_SUGGESTION_REFUSAL.NO_AGENT);
      }

      const branchless =
        action.kind === REPLY_BUTTON_ACTION.START && agent.taskId !== null
          ? yield* branchNeededRefusal(call.caller, agent.taskId, action.branch, "Not added")
          : undefined;

      if (branchless !== undefined) return agentToolRejected(branchless);
      const refused = yield* startChoiceRefusal(userId, action);

      if (refused !== undefined) return agentToolRejected(refused);
      const now = yield* DateTime.nowAsDate;
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
