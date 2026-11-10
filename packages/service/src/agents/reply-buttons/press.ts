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
 * press cut off starts or sends once. Every check runs again here as the
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
import { agentName } from "@repo/features/model-label";
import { REPLY_BUTTON_ACTION, type ReplyButtonView } from "@repo/features/reply-button-wire";
import { EXPERIMENT } from "@repo/settings";
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

/** The agent named by id and title, where the member still reaches it; none where they do not. */
const namedAgent = (userId: string, agentId: string | null) =>
  Effect.gen(function* () {
    if (agentId === null) return null;
    const agent = yield* hostedStoreOrUnavailable(readVisibleAgent(userId, agentId));
    return Option.match(agent, {
      onNone: () => null,
      onSome: (found: Agent) => ({ id: found.id, title: agentName(found) }),
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

/** The button's start or send run as the member: the agent it reached, or why it was refused. */
const runPressed = (
  writer: Effect.Effect<StoreWriter>,
  userId: string,
  button: ReplyButton,
  summaryModel: SummaryModelOf,
): Effect.Effect<string, HostedRefusal, StartServices> => {
  const { action } = button;
  if (action.kind === REPLY_BUTTON_ACTION.SEND) {
    return Effect.gen(function* () {
      const { agent } = yield* reachedAgentById(userId, action.agentId);
      yield* steerMemberWords(writer, userId, agent, { text: action.text, clientKey: button.id });
      return agent.id;
    });
  }
  return Effect.map(
    startRequestedAgent(
      routedSessions<TypedTurn>(userId),
      userId,
      { taskId: button.taskId },
      {
        idempotencyKey: button.id,
        prompt: action.prompt,
        ...(action.title === undefined ? undefined : { title: action.title }),
        ...(action.branch === undefined ? undefined : { branch: action.branch }),
        ...(action.model === undefined || action.effort === undefined
          ? undefined
          : { model: action.model, effort: action.effort }),
      },
      summaryModel,
    ),
    (started) => started.agent.id,
  );
};

/**
 * One press of a button in an agent's reply, as the member: run once, and
 * answered as the button then stands. A button another member's press holds
 * is answered as it stands, without running; one the member's own press
 * holds runs again under the same key. A press refused is released and its
 * refusal answered.
 */
export const pressReplyButton = /* @__PURE__ */ Effect.fnUntraced(function* (
  writer: Effect.Effect<StoreWriter>,
  userId: string,
  agentId: string,
  buttonId: string,
  summaryModel: SummaryModelOf,
) {
  const { button, agent } = yield* reachedButton(userId, agentId, buttonId);
  const now = yield* DateTime.nowAsDate;
  const claimed = yield* hostedStoreOrUnavailable(claimReplyButtonPress(button.id, userId, now));
  if (claimed) {
    const reached = yield* runPressed(writer, userId, button, summaryModel).pipe(
      Effect.tapError(() =>
        hostedStoreOrUnavailable(releaseReplyButtonPress(button.id, userId)).pipe(Effect.ignore),
      ),
    );
    yield* hostedStoreOrUnavailable(settleReplyButtonPress(button.id, userId, reached));
  }
  // Note that the button is read again either way, since a press unclaimed is another's that landed or runs since the first read.
  const settled = yield* hostedStoreOrUnavailable(readReplyButton(userId, button.id));
  return yield* viewOf(
    userId,
    Option.getOrElse(settled, () => button),
    agent,
  );
});
