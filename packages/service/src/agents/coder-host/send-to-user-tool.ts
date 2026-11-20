/**
 * send-to-user-tool.ts -- `send_to_user`, a Manager's one way to reach people: a message in the chat its page draws.
 *
 * A Manager's page draws no transcript: it is a chat between the people who
 * can open the Manager and the Manager itself, in which their lines stand as
 * they sent them and the Manager's words are the input of its `send_to_user`
 * calls alone. The call stores nothing of its own: its input stays in the
 * transcript as every call's does, where the panel reads it as the
 * Manager's message. So this door only holds the input to its bound and
 * refuses what is not one, or a caller that is no Manager.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import { stampAgentSaid } from "@repo/database/models/agent-chat-reads";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import { AGENT_KIND } from "@repo/features/agent-wire";
import type { WireRecord } from "@repo/wire";
import { describeWire } from "@repo/wire/effect";
import { Clock, Effect, Predicate, Result, Schema } from "effect";
import { ACTION_RESULT_STATUS, isRecord, type UnparsedWireValue } from "../../core.js";
import { logStoreFailure } from "../../http/store-failure.js";
import { type AgentCall, agentToolRejected, callerAgent } from "../agent-tools.js";

/** The most characters one message may spell. */
const SEND_TO_USER_CHARS = 8_000;

/** Why `send_to_user` was refused, in words the model can act on. */
const SEND_TO_USER_REFUSAL = {
  UNREADABLE: "Not sent: pass text, the message's words in Markdown; nothing else is read.",
  TOO_LONG: (length: number) =>
    `Not sent: text is ${length} characters, over the ${SEND_TO_USER_CHARS} one message may spell; say it shorter, or in two messages.`,
  NOT_MANAGER: "Not sent: only a Manager sends to its chat.",
} as const;

const SEND_TO_USER_INPUT = Schema.Struct({
  text: describeWire(
    Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(SEND_TO_USER_CHARS)),
    "One message, in Markdown, as people will read it in your chat: a line or two making one point, with mention links for what they can open.",
  ),
});

const readInput = Schema.decodeUnknownResult(SEND_TO_USER_INPUT);

/** `send_to_user` as a Manager is offered it: its name, its words, and its input. */
export const SEND_TO_USER_TOOL = {
  name: AGENT_TOOL.SEND_TO_USER,
  description:
    "Send a message to your chat, the only way your words reach people: your page shows people's " +
    "messages and these alone, never your other text or tool calls. Everyone who can open you sees " +
    "the same chat, so write to all of them, and each of them sees your row marked unread until they " +
    "open it. Call it to answer someone, to report what is done, or " +
    "to say what you are waiting on; a turn that sends nothing shows nothing. Write as a coworker " +
    "would on Slack: several short messages rather than one long one, one point to each, concise " +
    "and straight to the point, with no greeting, filler, or recap, and no headers or long lists " +
    "unless what you say needs them. For a decision with options or a to-do, post a thread instead.",
  inputSchema: SEND_TO_USER_INPUT,
} as const;

/** The call's input read, its refusal naming the one thing wrong. */
function readSend(input: UnparsedWireValue): Result.Result<void, string> {
  if (Result.isSuccess(readInput(input))) return Result.succeed(undefined);
  const text = isRecord(input) ? input.text : undefined;

  if (Predicate.isString(text) && text.trim().length > SEND_TO_USER_CHARS) {
    return Result.fail(SEND_TO_USER_REFUSAL.TOO_LONG(text.trim().length));
  }

  return Result.fail(SEND_TO_USER_REFUSAL.UNREADABLE);
}

/** One call of `send_to_user`: taken where its input holds to its bound and a Manager calls it, refused with why otherwise. */
export function runSendToUser(
  call: AgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, DatabaseServices> {
  const read = readSend(input);

  if (Result.isFailure(read)) return Effect.succeed(agentToolRejected(read.failure));

  const manager = callerAgent(call.caller);

  if (manager?.kind !== AGENT_KIND.MANAGER) {
    return Effect.succeed(agentToolRejected(SEND_TO_USER_REFUSAL.NOT_MANAGER));
  }

  const answer: WireRecord = { status: ACTION_RESULT_STATUS.ACCEPTED };

  // Note that a stamp that fails is logged and the message still taken, since it stands in the transcript whatever the row says.
  return Clock.currentTimeMillis.pipe(
    Effect.flatMap((now) => stampAgentSaid(manager.id, new Date(now))),
    Effect.tapError(logStoreFailure),
    Effect.ignore,
    Effect.as(answer),
  );
}
