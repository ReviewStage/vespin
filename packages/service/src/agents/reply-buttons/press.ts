/**
 * press.ts -- a button in an agent's reply as a member reads it, and its one press: the start or the send it keeps, run as the member who pressed it.
 *
 * A button is read and pressed only by a member who reaches its agent's
 * task, and only while its workspace has Reply buttons on: off, it is not
 * found, so the window draws its link as the plain link it is and no press
 * runs. A press claims the button for the member (`claimReplyButtonPress`);
 * a button another member's press holds, or one whose press landed, is
 * answered as it stands, so it runs once whoever presses it. The claim's
 * own presser runs it again under the same key, the button's id, which the
 * start keys the agent by and the send keys its line by, so a retry after a
 * press cut off starts or sends once, and an attempt refused releases only
 * its own claim, never a retry's. Every check runs again here as the
 * presser: a start lands on the button agent's task, on their model or the
 * one the button names; a send reaches an agent they reach. A press refused
 * is released, so the button may be pressed again.
 */

import type { Agent } from "@repo/database/models/agent-store";
import { readVisibleAgent } from "@repo/database/models/agent-store";
import {
  claimReplyButtonPress,
  type ReplyButton,
  readReplyButton,
  releaseReplyButtonPress,
  settleReplyButtonPress,
} from "@repo/database/models/reply-buttons";
import { readAccountNames } from "@repo/database/models/workspace-store";
import type { StoreWriter } from "@repo/database/models/writer";
import { MENTION_KIND } from "@repo/features/mention-link";
import { agentName } from "@repo/features/model-label";
import {
  REPLY_BUTTON_ACTION,
  type ReplyButtonSent,
  type ReplyButtonView,
  suggestionLine,
} from "@repo/features/reply-button-wire";
import { EXPERIMENT } from "@repo/settings";
import { MESSAGE_CHANNEL, type SuggestedBy } from "@repo/wire";
import { DateTime, Effect, Option } from "effect";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  pathUuid,
} from "../../http/http-effect.js";
import { reachedAgentById } from "../agent-reach.js";
import type { SummaryModelOf } from "../coder-host/replay-summary.js";
import { routedSessions } from "../coder-host/runtime-sessions.js";
import { type StartServices, startRequestedAgent } from "../coder-host/start.js";
import { steerMemberWords } from "../coder-host/steer.js";
import type { TypedTurn } from "../sessions/agent-sessions.js";
import { experimentOnIn } from "../workspace-experiment-on.js";
import { workspaceStepOf, writtenMention } from "../written-mentions.js";

/** The agent named by id and title, where the member still reaches it; none where they do not. */
const namedAgent = (userId: string, agentId: string | null) =>
  Effect.gen(function* () {
    if (agentId === null) return null;
    const agent = yield* hostedStoreOrUnavailable(readVisibleAgent(userId, agentId));
    return Option.match(agent, {
      onNone: () => null,
      onSome: (found: Agent) => ({ id: found.id, taskId: found.taskId, title: agentName(found) }),
    });
  });

/** The button as the window draws it, read as the member: where a start runs, whom a send goes to, and its press. */
const viewOf = (userId: string, button: ReplyButton, made: Agent) =>
  Effect.gen(function* () {
    const { action } = button;
    const sendTo =
      action.kind === REPLY_BUTTON_ACTION.SEND ? yield* namedAgent(userId, action.agentId) : null;
    const by =
      button.pressedBy === null
        ? new Map<string, string>()
        : yield* hostedStoreOrUnavailable(readAccountNames([button.pressedBy]));
    const pressed =
      button.pressedAt === null
        ? null
        : {
            at: button.pressedAt.getTime(),
            by: button.pressedBy === null ? null : (by.get(button.pressedBy) ?? null),
            byReader: button.pressedBy === userId,
            agent: yield* namedAgent(userId, button.reachedAgentId),
          };
    const view: ReplyButtonView = {
      id: button.id,
      agentId: button.agentId,
      label: button.label,
      action,
      repository: made.repository,
      sendTo,
      pressed,
    };
    return view;
  });

/** The button the path names on the agent it names, with that agent, where the member reaches both and the workspace has Reply buttons on; not found otherwise. */
const reachedButton = (userId: string, agentId: string, buttonId: string) =>
  Effect.gen(function* () {
    const { agent } = yield* reachedAgentById(userId, agentId);
    const id = yield* pathUuid(buttonId);
    const read = yield* hostedStoreOrUnavailable(readReplyButton(userId, id));
    if (Option.isNone(read) || read.value.agentId !== agent.id) {
      return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    }
    if (!(yield* experimentOnIn(read.value.organizationId, EXPERIMENT.REPLY_BUTTONS))) {
      return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    }
    return { button: read.value, agent };
  });

/** One button in an agent's reply as the member reads it. */
export const readReplyButtonView = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  agentId: string,
  buttonId: string,
) {
  const { button, agent } = yield* reachedButton(userId, agentId, buttonId);
  return yield* viewOf(userId, button, agent);
});

/** Whether what the member sent fits what the suggestion sets off: a send names no title, branch, or model, and a model goes with its effort. */
function sentFits(button: ReplyButton, sent: ReplyButtonSent): boolean {
  const { title, branch, model, effort } = sent;
  if (button.action.kind === REPLY_BUTTON_ACTION.SEND) {
    return [title, branch, model, effort].every((each) => each === undefined);
  }
  return (model === undefined) === (effort === undefined);
}

/**
 * The suggestion run as the member, with what they sent from its draft: the
 * agent it reached, or why it was refused. The words, files, title, branch,
 * and model are the draft's as the member left them, never the button's,
 * which only filled the draft in. The words open with a link to the agent
 * whose reply held the suggestion, and the line keeps which suggestion it
 * was, so the agent they reach and its transcript both say who suggested
 * them.
 */
const runPressed = (
  writer: Effect.Effect<StoreWriter>,
  userId: string,
  button: ReplyButton,
  made: Agent,
  sent: ReplyButtonSent,
  summaryModel: SummaryModelOf,
): Effect.Effect<string, HostedRefusal, StartServices> =>
  Effect.gen(function* () {
    const { action } = button;
    const step = yield* hostedStoreOrUnavailable(workspaceStepOf(userId, made.organizationId));
    const name = agentName(made);
    const mention = writtenMention({ kind: MENTION_KIND.AGENT, agentId: made.id }, name, step);
    const words = suggestionLine(mention, sent.words);
    const suggestedBy: SuggestedBy = { agent_id: made.id, name, button_id: button.id };
    const files = sent.attachments === undefined ? undefined : { attachments: sent.attachments };
    if (action.kind === REPLY_BUTTON_ACTION.SEND) {
      const { agent } = yield* reachedAgentById(userId, action.agentId);
      yield* steerMemberWords(writer, userId, agent, {
        text: words,
        clientKey: button.id,
        ...files,
        metadata: { channel: MESSAGE_CHANNEL.SUGGESTION, suggested_by: suggestedBy },
      });
      return agent.id;
    }
    const started = yield* startRequestedAgent(
      routedSessions<TypedTurn>(userId),
      userId,
      { taskId: button.taskId },
      {
        idempotencyKey: button.id,
        prompt: words,
        ...files,
        ...(sent.title === undefined ? undefined : { title: sent.title }),
        ...(sent.branch === undefined ? undefined : { branch: sent.branch }),
        ...(sent.model === undefined || sent.effort === undefined
          ? undefined
          : { model: sent.model, effort: sent.effort }),
      },
      summaryModel,
      undefined,
      undefined,
      suggestedBy,
    );
    return started.agent.id;
  });

/**
 * One suggestion in an agent's reply sent from its draft, as the member: run
 * once, and answered as the button then stands. A button another member's
 * send holds is answered as it stands, without running; one the member's own
 * send holds runs again under the same key. A send refused is released and
 * its refusal answered, and one that does not fit the suggestion is refused
 * before it claims anything.
 */
export const pressReplyButton = /* @__PURE__ */ Effect.fnUntraced(function* (
  writer: Effect.Effect<StoreWriter>,
  userId: string,
  agentId: string,
  buttonId: string,
  sent: ReplyButtonSent,
  summaryModel: SummaryModelOf,
) {
  const { button, agent } = yield* reachedButton(userId, agentId, buttonId);
  if (!sentFits(button, sent)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const now = yield* DateTime.nowAsDate;
  const claimed = yield* hostedStoreOrUnavailable(claimReplyButtonPress(button.id, userId, now));
  if (claimed !== undefined) {
    const reached = yield* runPressed(writer, userId, button, agent, sent, summaryModel).pipe(
      Effect.tapError(() =>
        hostedStoreOrUnavailable(releaseReplyButtonPress(button.id, claimed)).pipe(Effect.ignore),
      ),
    );
    yield* hostedStoreOrUnavailable(settleReplyButtonPress(button.id, userId, reached, now));
  }
  // Note that the button is read again either way, since a press unclaimed is another's that landed or runs since the first read.
  const settled = yield* hostedStoreOrUnavailable(readReplyButton(userId, button.id));
  return yield* viewOf(
    userId,
    Option.getOrElse(settled, () => button),
    agent,
  );
});
