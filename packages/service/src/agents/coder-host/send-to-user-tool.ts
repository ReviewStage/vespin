/**
 * send-to-user-tool.ts -- `chat_send`, a Manager's one way to reach people: a message in the chat its page draws.
 *
 * A Manager's page draws no transcript: it is a chat between the people who
 * can open the Manager and the Manager itself, in which their lines stand as
 * they sent them and the Manager's words are the input of its `chat_send`
 * calls alone, beside the sets its `show_media` calls showed. The call's
 * input stays in the transcript as every call's does, where today's panel
 * reads it as the Manager's message, and the message is also written as a
 * row of the Manager's chat before the call answers (`manager-chat-row.ts`),
 * under the call's key, and answered by the row's id. This door holds the
 * input to its bound and refuses what is not one, a caller that is no
 * Manager, or a send on a spoken turn, whose reply is its plain text the
 * voice says.
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
import { MANAGER_THREAD_ASKS } from "./inbox.js";
import { MANAGER_SAID, writeManagerSaid } from "./manager-chat-row.js";
import { readNativeTurnHanded } from "./turn-message.js";

/** The most characters one message may spell. */
const SEND_TO_USER_CHARS = 8_000;

/** The most characters the id of the thread a reply names may spell: a message's id, with room to spare. */
const SEND_TO_USER_ID_CHARS = 200;

/** Why `chat_send` was refused, in words the model can act on. */
const SEND_TO_USER_REFUSAL = {
  UNREADABLE: "Not sent: pass text, the message's words in Markdown; nothing else is read.",
  TOO_LONG: (length: number) =>
    `Not sent: text is ${length} characters, over the ${SEND_TO_USER_CHARS} one message may spell; say it shorter, or in two messages.`,
  NOT_MANAGER: "Not sent: only a Manager sends to its chat.",
  SPOKEN: "You're on a call: answer in plain text; the voice will say it.",
  UNKEPT: "Not sent: the message could not be kept just now. The call may be made again.",
  NO_THREAD: (id: string) =>
    `Not sent: No message in your chat has the id ${id}. Use chat_read_messages or chat_search to find message ids.`,
} as const;

const SEND_TO_USER_INPUT = Schema.Struct({
  text: describeWire(
    Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(SEND_TO_USER_CHARS)),
    "One message, in Markdown, as people will read it in your chat: a line or two making one point, with mention links for what they can open.",
  ),
  thread_ts: Schema.optionalKey(
    describeWire(
      Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(SEND_TO_USER_ID_CHARS)),
      "The parent message's id, to make this message a reply in its thread.",
    ),
  ),
  reply_broadcast: Schema.optionalKey(
    describeWire(Schema.Boolean, "Also post the reply to the chat."),
  ),
});

const readInput = Schema.decodeUnknownResult(SEND_TO_USER_INPUT);

/** How `chat_send` threads its replies, in Charles's words. */
const CHAT_THREAD_WORDS =
  "Reply in threads. When you answer or follow up on a message, set thread_ts to its thread's " +
  "parent message id. Leave thread_ts out only to bring up something new.";

/** What `chat_send` says of the chat, whether or not the Manager posts threads. */
const SEND_TO_USER_WORDS =
  "Send a message to your chat, the only way your words reach people: your page shows people's " +
  `messages, these, and the files you show with ${AGENT_TOOL.SHOW_MEDIA} alone, never your other text or tool calls. ` +
  "Everyone who can open you sees " +
  "the same chat, so write to all of them, and each of them sees your row marked unread until they " +
  "open it. Call it to answer someone, to report what is done, or " +
  "to say what you are waiting on; a turn that sends nothing shows nothing. Write as a coworker " +
  "would on Slack: several short messages rather than one long one, one point to each, concise " +
  "and straight to the point, with no greeting, filler, or recap, and no headers or long lists " +
  "unless what you say needs them. " +
  CHAT_THREAD_WORDS;

/** `chat_send` as a Manager is offered it: its name, its words, and its input. */
export const SEND_TO_USER_TOOL = {
  name: AGENT_TOOL.SEND_TO_USER,
  description: `${SEND_TO_USER_WORDS} For ${MANAGER_THREAD_ASKS}, post an Inbox thread instead.`,
  inputSchema: SEND_TO_USER_INPUT,
} as const;

/**
 * `chat_send` in the words of the Manager's standing: the thread it
 * hands a decision or a to-do named only where the member its threads would
 * land with keeps an Inbox, which offers it `inbox_post`, so a Manager with
 * none is told of no thread.
 */
export function sendToUserToolOf(on: { readonly inboxOn: boolean }) {
  if (on.inboxOn) return SEND_TO_USER_TOOL;

  return { ...SEND_TO_USER_TOOL, description: SEND_TO_USER_WORDS };
}

/** The call's input read, its refusal naming the one thing wrong. */
function readSend(input: UnparsedWireValue): Result.Result<typeof SEND_TO_USER_INPUT.Type, string> {
  const read = readInput(input);

  if (Result.isSuccess(read)) return Result.succeed(read.success);
  const text = isRecord(input) ? input.text : undefined;

  if (Predicate.isString(text) && text.trim().length > SEND_TO_USER_CHARS) {
    return Result.fail(SEND_TO_USER_REFUSAL.TOO_LONG(text.trim().length));
  }

  return Result.fail(SEND_TO_USER_REFUSAL.UNREADABLE);
}

/** The Manager's last word stamped as now, and the call taken; a stamp that fails is logged and the message still taken, since it stands in the transcript whatever the row says. */
const stampedSaid = (managerId: string, answer: WireRecord) =>
  Clock.currentTimeMillis.pipe(
    Effect.flatMap((now) => stampAgentSaid(managerId, new Date(now))),
    Effect.tapError(logStoreFailure),
    Effect.ignore,
    Effect.as(answer),
  );

/** One call of `chat_send`: taken where its input holds to its bound and a Manager calls it on a typed turn, its row written to the chat and its id answered; refused with why otherwise. */
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

  const target = { userId: manager.userId, conversationId: manager.conversationId };
  const { text, thread_ts: threadTs, reply_broadcast: broadcast } = read.success;

  const said = {
    clientKey: call.clientKey,
    text,
    attachments: [],
    ...(threadTs === undefined
      ? undefined
      : { inReplyTo: threadTs, broadcast: broadcast === true }),
  };

  return Effect.gen(function* () {
    const handed = yield* readNativeTurnHanded(target);

    // Note that a spoken turn's reply is its plain text, which the voice says, so it sends nothing (`turn-context.ts`).
    if (handed.spoken === true) return agentToolRejected(SEND_TO_USER_REFUSAL.SPOKEN);

    // Note that the row is written before the call answers, so the id answered names a message that stands.
    const written = yield* writeManagerSaid(manager, said);

    // Note that a reply's id names the thread it stands in, as Slack takes it, so only an id the chat does not hold is refused.
    if (written.kind === MANAGER_SAID.NO_THREAD) {
      return agentToolRejected(SEND_TO_USER_REFUSAL.NO_THREAD(threadTs ?? ""));
    }

    if (written.kind !== MANAGER_SAID.KEPT) return agentToolRejected(SEND_TO_USER_REFUSAL.UNKEPT);

    const answer: WireRecord = {
      status: ACTION_RESULT_STATUS.ACCEPTED,
      message_id: written.id,
      thread_ts: written.threadRoot,
    };

    return yield* stampedSaid(manager.id, answer);
  }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.orElseSucceed(() => agentToolRejected(SEND_TO_USER_REFUSAL.UNKEPT)),
  );
}
