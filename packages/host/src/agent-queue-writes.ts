import { bootHolds } from "@repo/features/agent-boot";
import type { AgentQueue, QueuedMessage } from "@repo/features/agent-queue-wire";
import {
  AGENT_CALL_FAILURE,
  type AgentAgentAnswer,
  type AgentMessageAnswerView,
  type AgentMessageParams,
  type AgentMessageRefusal,
  type AgentQueueAnswerView,
  type AgentQueueParams,
  type AgentRewindParams,
  type AgentUnsendParams,
  agentAgentAnswerSchema,
  type SendingMessage,
} from "@repo/features/agent-view";
import {
  AGENT_STATUS,
  type AgentAttachment,
  type AgentMessageRequest,
  type AgentQueueChange,
  type AgentSummary,
  type AgentTranscriptMessage,
  QUEUE_CHANGE,
} from "@repo/features/agent-wire";
import type { EntityPool, Refused, RowKind, WriteDeclaration, Written } from "@repo/sync";
import { MESSAGE_ROLE } from "@repo/wire";
import { sentLineId } from "@repo/wire/host-ids";
import {
  Effect,
  Equal,
  MutableHashMap,
  Option,
  PubSub,
  Result,
  Schema,
  type Scope,
  Stream,
} from "effect";
import type { AppTranscript } from "./app-state.js";
import { type CarriedWaits, carriedWaits, type HeldAnswers } from "./live-collection.js";
import type { HeldTranscript } from "./transcript-follow.js";

/**
 * agent-queue-writes.ts -- each agent's messages on their way as the sync engine's pool holds them: its queue, fed from its own transcript's pages, and the messages sent and not yet written, every change to either drawn the moment it is asked.
 *
 * One row of the pool (`@repo/sync`) per agent, by its id, holds where each
 * of the member's messages on their way stands: queued behind the turn, in
 * the queue its transcript's pages carry (`word.queue`), each page's taken at
 * its revision, so a page read before a newer one never puts an older queue
 * back; or sending, from the moment the member sent it until the service's
 * row for it lands in the transcript, under the id that row is written
 * under (`sentLineId`). The transcript the windows draw carries both as the
 * pool draws them (`word.queue` and `sending`), so every window, the
 * desktop's, the web's, and the iPhone's, draws one record, and a message
 * that moves, a steer out of the queue or a send the service held in the
 * queue while the agent's machine boots, moves in one draw: it is never in
 * both places, nor in neither.
 *
 * Three writes go through the row, so the service takes them one at a time
 * in the order they were asked, which is the order the service's lock takes
 * them in: a change of the queue (`agents.queue`), a message sent
 * (`agents.message`), and a rewind (`agents.rewind`). A change of the queue
 * stands until the pool's queue is at least as new as the one the service
 * answered (`Written.carried`), since the service answers the queue it left,
 * revision and all, but no transaction. A message sent stands until its row
 * lands in the transcript, or, where the service answered that it holds it
 * in the queue while the agent's first launch boots, as the queue it
 * answered. A refused write is taken back, and a message the service
 * refused stands where it went, marked with why, kept apart from the pool for
 * as long as the host runs, so a transcript let go and held again draws it
 * still, until it is sent again under its key, which draws it on its way in
 * the same draw, or let go (`agents.unsend`). The refusal is kept before the
 * write is taken back, so the line never leaves the transcript between.
 * A message the member sends while the agent's first launch boots its
 * machine is drawn in the queue from the moment it is sent, never in the
 * transcript, because that is where the service puts it (`bootHolds`, the
 * one rule both read, of the boot the agent's own pages carry); its answer
 * then names the queue it stands in, in its drawn place.
 * Note that the refusals are kept by the account that sent them, and drawn
 * only while that account is signed in, because a host one member signs out
 * of may next be signed in to by another, who may reach the same agent but
 * never another member's words that did not go. The signed-in account's are
 * also kept on disk, sealed, beside the writes waiting for the service
 * (`entity-store.ts`), so a relaunch draws them where they went: all of each
 * but its files' bytes, which stay with the window that attached them, and
 * the facts of its failure, which no window draws. A message read back so
 * whose row the transcript holds went after all, so it is let go; one refused
 * since the host started is not, because its row may still be on its way out.
 * A sign-out lets every refusal go with the file.
 */

/** Where an agent's messages on their way stand: its queue and the messages sending. */
interface Outbox {
  readonly queue: AgentQueue;
  readonly sending: readonly SendingMessage[];
}

/** An agent's messages on their way as the pool holds them, by the agent's id. */
interface OutboxRow extends Outbox {
  readonly agentId: string;
}

/** How a change leaves an agent's messages on their way, from what is drawn now. */
type OutboxStep = (outbox: Outbox) => Outbox;

/** A change of an agent's messages on their way: the agent's, and what it leaves, so it is drawn even before any page of the agent's landed. */
interface OutboxChange {
  readonly agentId: string;
  readonly step: OutboxStep;
}

/**
 * The queue a send is drawn over before any page of the agent's carried one:
 * empty, and older than any the service answers, so the first page's queue
 * stands over it.
 */
const NO_QUEUE: AgentQueue = { messages: [], revision: -1 };

/** An agent's messages on their way, by the agent's id, every change of them what it leaves. */
const AGENT_OUTBOX: RowKind<OutboxRow, OutboxChange> = {
  key: (row) => row.agentId,
  drawn: ({ agentId, step }, row) => {
    // Note that a message sent before any page of the queue landed is drawn over none, so it shows at once.
    const was: Outbox = row ?? { queue: NO_QUEUE, sending: [] };
    const outbox = step(was);

    // Note that a change the row already carries leaves it alone, so a reader holds the very row.
    if (Equal.equals(outbox.queue, was.queue) && outbox.sending === was.sending) return undefined;

    return { agentId, ...outbox };
  },
};

/** A change of an agent's queue as the host writes it: the window's params, and the member it is queued by. */
export type QueueWrite = AgentQueueParams & { readonly queuedBy: string };

/**
 * A change of an agent's queue as the host sends it: the write, when it was
 * asked by the host's clock, and for a steer, its message as it then goes,
 * read from the queue as it stood as it was asked.
 */
export type QueuedWrite = QueueWrite & {
  readonly sentAt: number;
  readonly steered?: SendingMessage;
};

/** A message sent as the host writes it: the window's params, when it went by the host's clock, and the account signed in as it was sent. */
export type MessageWrite = AgentMessageParams & {
  readonly sentAt: number;
  readonly sentBy: string | undefined;
};

/** The files a message carries, by the ids the window keeps their bytes under, where it named them; none where it carries none. */
function filesOf(
  attachments: readonly AgentAttachment[] | undefined,
  pictures: readonly string[] | undefined,
): Pick<QueuedMessage, "files"> {
  if (attachments === undefined || attachments.length === 0) return {};

  return {
    files: attachments.map((file, index) => {
      const id = pictures?.[index];

      return {
        name: file.name,
        mediaType: file.mediaType,
        ...(id === undefined ? undefined : { id }),
      };
    }),
  };
}

/**
 * Whether `id` names the queued message: its own id, or the send key of one
 * sent while the agent's machine booted, which is drawn under that key until
 * the service answers the id it stored it under.
 */
function names(message: QueuedMessage, id: string): boolean {
  return message.id === id || message.sendKey === id;
}

/** The queue with the message `id` names as `changed` leaves it; as it is where it lists none. */
function withMessage(
  queue: AgentQueue,
  id: string,
  changed: (message: QueuedMessage) => QueuedMessage,
): AgentQueue {
  return {
    ...queue,
    messages: queue.messages.map((message) => (names(message, id) ? changed(message) : message)),
  };
}

/** A change of the queue addressed to the ids the service stores its messages under, as `storedId` names each. */
function addressed(change: AgentQueueChange, storedId: (id: string) => string): AgentQueueChange {
  switch (change.change) {
    case QUEUE_CHANGE.EDIT:
    case QUEUE_CHANGE.HOLD:
    case QUEUE_CHANGE.DELETE:
    case QUEUE_CHANGE.STEER:
      return { ...change, messageId: storedId(change.messageId) };
    case QUEUE_CHANGE.REORDER:
      return { ...change, order: change.order.map(storedId) };
    default:
      return change;
  }
}

/** The messages sending with `message` the newest, where none under its id stands already. */
function sendingWith(
  sending: readonly SendingMessage[],
  message: SendingMessage,
): readonly SendingMessage[] {
  return sending.some((each) => each.id === message.id) ? sending : [...sending, message];
}

/** The outbox with its queue as `change` leaves it. */
function queueChanged(change: (queue: AgentQueue) => AgentQueue): OutboxStep {
  return (outbox) => ({ ...outbox, queue: change(outbox.queue) });
}

/**
 * A queued message steered out of the queue, as it then goes: under the key
 * its row is written under, which is its own id but for one the service held
 * while the agent booted, with an edit's words and files where it steers one.
 */
function steered(
  message: QueuedMessage,
  change: Extract<AgentQueueChange, { change: typeof QUEUE_CHANGE.STEER }>,
  pictures: readonly string[] | undefined,
  sentAt: number,
  sentBy: string,
): SendingMessage {
  const clientKey = message.sendKey ?? message.id;

  const files =
    change.text === undefined ? message.files : filesOf(change.attachments, pictures).files;

  return {
    id: sentLineId(clientKey),
    clientKey,
    text: change.text ?? message.text,
    files,
    sentAt,
    steers: true,
    ...(sentBy === "" ? undefined : { sentBy }),
  };
}

/** The outbox as a change of its queue leaves it, drawn before the service answers; a steer moves its message out of the queue and into the messages sending in the one change. */
function drawnChange({ change, pictures, queuedBy }: QueueWrite, sentAt: number): OutboxStep {
  switch (change.change) {
    case QUEUE_CHANGE.ADD:
      return queueChanged((queue) =>
        queue.messages.some((message) => message.id === change.id)
          ? queue
          : {
              ...queue,
              messages: [
                ...queue.messages,
                {
                  id: change.id,
                  text: change.text,
                  queuedBy,
                  ...filesOf(change.attachments, pictures),
                },
              ],
            },
      );
    case QUEUE_CHANGE.EDIT:
      return queueChanged((queue) =>
        withMessage(queue, change.messageId, ({ editing: _editing, files: _files, ...kept }) => ({
          ...kept,
          text: change.text,
          ...filesOf(change.attachments, pictures),
        })),
      );
    case QUEUE_CHANGE.HOLD:
      return queueChanged((queue) =>
        withMessage(queue, change.messageId, ({ editing: _editing, ...kept }) =>
          change.held ? { ...kept, editing: true } : kept,
        ),
      );
    case QUEUE_CHANGE.DELETE:
      return queueChanged((queue) => ({
        ...queue,
        messages: queue.messages.filter((message) => !names(message, change.messageId)),
      }));
    case QUEUE_CHANGE.REORDER: {
      const at = new Map(change.order.map((id, index) => [id, index]));

      const placed = (message: QueuedMessage) =>
        at.get(message.id) ??
        (message.sendKey === undefined ? undefined : at.get(message.sendKey)) ??
        change.order.length;

      return queueChanged((queue) => ({
        ...queue,
        messages: queue.messages.toSorted((one, other) => placed(one) - placed(other)),
      }));
    }

    case QUEUE_CHANGE.RESUME:
      return queueChanged(({ paused: _paused, ...queue }) => queue);
    case QUEUE_CHANGE.STEER:
      return (outbox) => {
        const message = outbox.queue.messages.find((each) => names(each, change.messageId));

        if (message === undefined) return outbox;

        return {
          queue: {
            ...outbox.queue,
            messages: outbox.queue.messages.filter((each) => each !== message),
          },
          sending: sendingWith(
            outbox.sending,
            steered(message, change, pictures, sentAt, queuedBy),
          ),
        };
      };
  }
}

/** The queue the service answered, over any queue older than it; a newer one is the service's later word, and stands. */
function answeredOver(answered: AgentQueue): (queue: AgentQueue) => AgentQueue {
  return (queue) => (queue.revision >= answered.revision ? queue : answered);
}

/** A message sent, as it is drawn while it is on its way. */
function sendingOf({
  clientKey,
  text,
  attachments,
  pictures,
  steers,
  rewinds,
  sentAt,
  taskId,
  sentBy,
}: MessageWrite): SendingMessage {
  return {
    id: sentLineId(clientKey),
    clientKey,
    text,
    ...filesOf(attachments, pictures),
    sentAt,
    steers: steers === true,
    ...(rewinds === undefined ? undefined : { rewinds: rewinds.messageId }),
    ...(rewinds?.restoreFiles === true ? { restoresFiles: true } : undefined),
    ...(taskId === undefined ? undefined : { taskId }),
    ...(sentBy === undefined ? undefined : { sentBy }),
  };
}

/** The queue with a message sent while the agent's machine boots at its end, as the service queues it, under its send key. */
function queuedWith(queue: AgentQueue, write: MessageWrite): AgentQueue {
  if (queue.messages.some((message) => message.sendKey === write.clientKey)) return queue;

  return {
    ...queue,
    messages: [
      ...queue.messages,
      {
        id: write.clientKey,
        text: write.text,
        queuedBy: write.sentBy ?? "",
        sendKey: write.clientKey,
        ...filesOf(write.attachments, write.pictures),
      },
    ],
  };
}

/** The ids the member's rows of a transcript were written under, which a message sending lands as. */
function landedLines(messages: readonly AgentTranscriptMessage[]): ReadonlySet<string> {
  return new Set(
    messages.flatMap((message) =>
      message.role === MESSAGE_ROLE.USER && message.clientId !== undefined
        ? [message.clientId]
        : [],
    ),
  );
}

/**
 * The transcript as the windows draw it, with the agent's messages on their
 * way laid over its page: the queue in its word's place, where its last page
 * carried a queue, and the messages sending whose rows have not landed yet.
 */
function laid(
  rows: AppTranscript,
  outbox: Outbox | undefined,
  refused: readonly SendingMessage[],
  reader: string | undefined,
): AppTranscript {
  // Note that the rows may be as the record last drew them, so what they carried of it is laid anew, never kept.
  const { sending: _drawn, ...page } = rows;
  const landed = landedLines(page.messages);
  // Note that a message on its way is drawn for the account that sent it alone, as a sign-out may leave one standing.
  const going = (outbox?.sending ?? []).filter((message) => message.sentBy === reader);
  // Note that a refused message sent again is drawn on its way alone, under the same id.

  const sending = [
    ...going,
    ...refused.filter((message) => !going.some((each) => each.id === message.id)),
  ].filter((message) => !landed.has(message.id));

  return {
    ...page,
    ...(page.word?.queue === undefined || outbox === undefined
      ? undefined
      : { word: { ...page.word, queue: outbox.queue } }),
    ...(sending.length === 0 ? undefined : { sending }),
  };
}

/** What a followed agent's writes wait on, its queue reaching the pool and its lines landing in its transcript, and how its transcript is drawn again. */
interface Standing {
  readonly queue: CarriedWaits<OutboxRow>;
  readonly lines: CarriedWaits<AgentTranscriptMessage>;
  readonly redraw: Effect.Effect<void>;
}

/** How the host reaches the service for the writes of the row. */
export interface OutboxSends {
  readonly queue: (
    agentId: string,
    change: AgentQueueChange,
  ) => Effect.Effect<AgentQueueAnswerView>;
  readonly message: (
    agentId: string,
    request: AgentMessageRequest,
  ) => Effect.Effect<AgentMessageAnswerView>;
  readonly rewind: (
    agentId: string,
    messageId: string,
    restoreFiles: boolean,
  ) => Effect.Effect<AgentAgentAnswer>;
}

/** The agents' messages on their way in the pool, and the writes that change them. */
export interface AgentQueues {
  /**
   * An agent's own transcript as its follow lays it, for the caller's
   * scope: each page's queue taken into the pool, and the transcript laid
   * for the windows with the messages on their way as the pool draws them,
   * which every write standing draws again; read back as the service last
   * said it, so nothing drawn is taken as the service's.
   */
  readonly held: (
    agentId: string,
    answers: HeldAnswers<AppTranscript>,
  ) => Effect.Effect<HeldTranscript, never, Scope.Scope>;
  /** A change of an agent's queue as it is sent, asked `sentAt`, its steered message read from the queue as it stands now. */
  readonly queuedWrite: (write: QueueWrite, sentAt: number) => QueuedWrite;
  /** A change of an agent's queue. */
  readonly queue: (
    sends: OutboxSends,
  ) => WriteDeclaration<OutboxRow, OutboxChange, QueuedWrite, AgentQueueAnswerView>;
  /** A message sent to an agent, taking it back to just before a line first where it goes in that line's place. */
  readonly message: (
    sends: OutboxSends,
  ) => WriteDeclaration<OutboxRow, OutboxChange, MessageWrite, AgentAgentAnswer>;
  /** A message the service refused let go, its line drawn no more. */
  readonly unsend: (params: AgentUnsendParams) => Effect.Effect<void>;
  /** The messages the service refused that the account signed in now sent, as the sealed store keeps them (`entity-store.ts`). */
  readonly refusedKept: () => readonly unknown[];
  /** Each moving of the messages refused, which has the store keep them again. */
  readonly refusedMoves: Stream.Stream<void>;
  /** The messages refused that `account` sent, as the store kept them, laid back as a launch opens it, beside any refused since. */
  readonly refusedRestored: (account: string, kept: readonly unknown[]) => Effect.Effect<void>;
  /** Every message refused let go, as a sign-out lets the store's file go. */
  readonly refusedForgotten: Effect.Effect<void>;
  /** A write of the agent's that draws nothing but goes after every write asked of it before, as a suggestion sent to it from a reply does. */
  readonly inTurn: <Input extends { readonly agentId: string }, Answer extends object>(
    send: (input: Input) => Effect.Effect<Answer>,
  ) => WriteDeclaration<OutboxRow, OutboxChange, Input, Answer>;
  /** An agent taken back to just before a line, after every write asked of it before. */
  readonly rewind: (
    sends: OutboxSends,
  ) => WriteDeclaration<OutboxRow, OutboxChange, AgentRewindParams, AgentAgentAnswer>;
}

/** A refused message as the sealed store keeps it: all of it but its files' bytes and its sender, who is the store's account, and the facts of its failure. */
const keptRefusedSchema = Schema.Struct({
  agentId: Schema.String,
  id: Schema.String,
  clientKey: Schema.String,
  text: Schema.String,
  files: Schema.optionalKey(
    Schema.Array(Schema.Struct({ name: Schema.String, mediaType: Schema.String })),
  ),
  sentAt: Schema.Number,
  steers: Schema.Boolean,
  rewinds: Schema.optionalKey(Schema.String),
  restoresFiles: Schema.optionalKey(Schema.Boolean),
  taskId: Schema.optionalKey(Schema.String),
  refused: agentAgentAnswerSchema,
});

type KeptRefused = typeof keptRefusedSchema.Type;

const decodeKeptRefused = Schema.decodeUnknownResult(keptRefusedSchema);
const encodeKeptRefused = Schema.encodeSync(keptRefusedSchema);

/** A refused message of the agent's as the store keeps it. */
function keptOf(
  agentId: string,
  message: SendingMessage,
  refused: AgentMessageRefusal,
): KeptRefused {
  const { cause: _cause, ...why } = refused;

  return {
    agentId,
    id: message.id,
    clientKey: message.clientKey,
    text: message.text,
    ...(message.files === undefined
      ? undefined
      : { files: message.files.map(({ name, mediaType }) => ({ name, mediaType })) }),
    sentAt: message.sentAt,
    steers: message.steers,
    ...(message.rewinds === undefined ? undefined : { rewinds: message.rewinds }),
    ...(message.restoresFiles === undefined ? undefined : { restoresFiles: message.restoresFiles }),
    ...(message.taskId === undefined ? undefined : { taskId: message.taskId }),
    refused: why,
  };
}

/** The refused message the store kept, sent by `sentBy`, by its agent; none where what it kept is no refusal. */
function refusedOfKept(kept: KeptRefused, sentBy: string): [string, SendingMessage] | undefined {
  const { agentId, refused, ...message } = kept;

  return "failure" in refused ? [agentId, { ...message, sentBy, refused }] : undefined;
}

/** Leaves the outbox as it is: a write that draws nothing but goes in turn. */
const unchanged: OutboxStep = (outbox) => outbox;

/** The agents' messages on their way in `pool`, each held while its own transcript is followed, for as long as the scope stands. */
export function agentQueues(
  pool: EntityPool,
  accountId: () => string | undefined,
  agentListed: (agentId: string) => AgentSummary | undefined = () => undefined,
): Effect.Effect<AgentQueues, never, Scope.Scope> {
  return Effect.flatMap(PubSub.unbounded<void>(), (moves) =>
    Effect.sync(() => {
      /** Each followed agent's waits on what its pages carry, while its follow stands. */
      const standing = MutableHashMap.empty<string, Standing>();
      /** Whether each followed agent's first launch holds its lines while its machine boots, as its newest page said. */
      const booting = MutableHashMap.empty<string, boolean>();
      /** The id the service stored each message sent while a machine booted under, by its send key, as its answers and pages said. */
      const stored = MutableHashMap.empty<string, string>();

      /** Notes the ids a queue the service said stores its boot-held messages under. */
      const storedIn = (queue: AgentQueue) => {
        for (const { id, sendKey } of queue.messages) {
          if (sendKey !== undefined && sendKey !== id) MutableHashMap.set(stored, sendKey, id);
        }
      };

      /** The id the service stores the message `id` names under; `id` itself where it said no other. */
      const storedId = (id: string) => Option.getOrElse(MutableHashMap.get(stored, id), () => id);

      /**
       * Whether the agent's first launch holds the lines sent to it now, so the
       * service queues them: as its newest page said, or, before any page
       * said, as the task list shows an agent just made, starting with no turn
       * yet, whose first launch boots.
       */
      const holdsLines = (agentId: string) =>
        Option.getOrElse(MutableHashMap.get(booting, agentId), () => {
          const listed = agentListed(agentId);

          return listed?.status === AGENT_STATUS.STARTING && listed.turnId === null;
        });
      /** The messages the service refused, by the account that sent them and then the agent's id, in the order sent, kept for as long as the host runs. */

      const refused = MutableHashMap.empty<
        string,
        MutableHashMap.MutableHashMap<string, readonly SendingMessage[]>
      >();

      /** The ids of the refused messages read back from the store, whose row landing means they went after all. */
      const restored = new Set<string>();

      /** The refusals of `account`'s, by the agent's id; none for no account. */
      const refusedBy = (account: string | undefined) =>
        account === undefined
          ? undefined
          : Option.getOrUndefined(MutableHashMap.get(refused, account));

      /** The agent's refused messages the account signed in now sent; none while nobody is signed in. */
      const refusedOf = (agentId: string): readonly SendingMessage[] =>
        Option.getOrElse(
          Option.flatMap(Option.fromUndefinedOr(refusedBy(accountId())), (byAgent) =>
            MutableHashMap.get(byAgent, agentId),
          ),
          () => [],
        );

      /**
       * The agent's refused messages of `account`'s as `change` leaves them, its
       * transcript drawn again where a follow stands for it. Note that the
       * account is the one that sent the message, read as it was sent, so a
       * refusal landing after a sign-out is kept for its sender alone.
       */
      const refusedChanged = (
        account: string | undefined,
        agentId: string,
        change: (was: readonly SendingMessage[]) => readonly SendingMessage[],
      ) =>
        Effect.suspend(() => {
          if (account === undefined) return Effect.void;

          const byAgent =
            refusedBy(account) ?? MutableHashMap.empty<string, readonly SendingMessage[]>();

          MutableHashMap.set(refused, account, byAgent);
          const now = change(Option.getOrElse(MutableHashMap.get(byAgent, agentId), () => []));

          if (now.length === 0) MutableHashMap.remove(byAgent, agentId);
          else MutableHashMap.set(byAgent, agentId, now);

          return Effect.andThen(
            PubSub.publish(moves, undefined),
            Option.match(MutableHashMap.get(standing, agentId), {
              onNone: () => Effect.void,
              onSome: (waits) => waits.redraw,
            }),
          );
        });

      /** The agent's refused messages without the one drawn under `id`. */
      const without = (id: string) => (was: readonly SendingMessage[]) =>
        was.filter((message) => message.id !== id);

      /** Lets go of the refused messages read back from the store whose row the agent's transcript holds, since they went after all. */
      const wentAfterAll = (agentId: string, messages: readonly AgentTranscriptMessage[]) =>
        Effect.suspend(() => {
          const landed = landedLines(messages);

          const went = refusedOf(agentId).filter(
            (message) => restored.has(message.id) && landed.has(message.id),
          );

          if (went.length === 0) return Effect.void;

          for (const message of went) restored.delete(message.id);
          const ids = new Set(went.map((message) => message.id));

          return refusedChanged(accountId(), agentId, (was) =>
            was.filter((message) => !ids.has(message.id)),
          );
        });

      const stand = (agentId: string, waits: Standing) =>
        Effect.acquireRelease(
          Effect.sync(() => MutableHashMap.set(standing, agentId, waits)),
          () =>
            Effect.sync(() => {
              if (Option.getOrUndefined(MutableHashMap.get(standing, agentId)) === waits) {
                MutableHashMap.remove(standing, agentId);
              }
            }),
        );

      const held = (agentId: string, answers: HeldAnswers<AppTranscript>) =>
        Effect.gen(function* () {
          const redraw = Effect.sync(() => {
            const rows = answers.rows();

            if (rows !== undefined) {
              answers.answered(laid(rows, outboxes.row(agentId), refusedOf(agentId), accountId()));
            }
          });

          // Note that no write of the row answers a transaction, so the read hands no wait and each write waits on its rows (`carried`).
          const outboxes = yield* pool.stand(AGENT_OUTBOX, {
            redraw: () => redraw,
            confirmation: () => undefined,
          });

          const waits: Standing = {
            queue: yield* carriedWaits(() => outboxes.synced()),
            lines: yield* carriedWaits(() => answers.rows()?.messages ?? []),
            redraw,
          };

          yield* stand(agentId, waits);

          /** A page's queue taken as the agent's, at its revision, and every change it carries let stand down. */
          const taken = (queue: AgentQueue) =>
            Effect.andThen(
              Effect.sync(() => storedIn(queue)),
              Effect.andThen(
                outboxes.answer([{ agentId, queue, sending: [] }], { at: BigInt(queue.revision) }),
                waits.queue.answered,
              ),
            );

          // Note that a transcript held again takes the queue and the boot it was left with, so a change still standing is drawn over it before the next page lands.
          const keptWord = answers.rows()?.word;

          if (keptWord !== undefined) {
            MutableHashMap.set(booting, agentId, bootHolds(keptWord.boot?.phase));
          }

          const kept = keptWord?.queue;

          if (kept !== undefined) yield* Effect.andThen(taken(kept), redraw);
          // Note that a transcript let go is left as the service last said it, so a write taken back once no window follows it is drawn there no more.
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              const rows = answers.rows();

              if (rows === undefined || outboxes.pending().length === 0) return;
              answers.answered(laid(rows, outboxes.synced()[0], refusedOf(agentId), accountId()));
            }),
          );

          return {
            rows: () => {
              const rows = answers.rows();

              return rows === undefined
                ? undefined
                : laid(rows, outboxes.synced()[0], [], accountId());
            },
            answered: (rows) =>
              Effect.gen(function* () {
                const queue = rows.word?.queue;
                MutableHashMap.set(booting, agentId, bootHolds(rows.word?.boot?.phase));

                if (queue !== undefined) yield* taken(queue);
                yield* wentAfterAll(agentId, rows.messages);
                answers.answered(
                  laid(rows, outboxes.row(agentId), refusedOf(agentId), accountId()),
                );
                yield* waits.lines.answered;
              }),
          } satisfies HeldTranscript;
        });

      /** Waits until the agent's pages carry what `until` asks, at once where no follow stands for it. */
      const carriedFor = <Row>(
        agentId: string,
        waitsOf: (waits: Standing) => CarriedWaits<Row>,
        until: (rows: readonly Row[]) => boolean,
      ) =>
        Effect.suspend(() => {
          const waits = Option.getOrUndefined(MutableHashMap.get(standing, agentId));

          return waits === undefined ? Effect.void : waitsOf(waits).carried(until);
        });

      /** Waits until the agent's queue is at least as new as `queue`. */
      const queueCarried = (agentId: string, queue: AgentQueue) =>
        carriedFor(
          agentId,
          (waits) => waits.queue,
          (rows) => rows.some((row) => row.queue.revision >= queue.revision),
        );

      /** Waits until the row of the line written under `id` lands in the agent's transcript. */
      const lineCarried = (agentId: string, id: string) =>
        carriedFor(
          agentId,
          (waits) => waits.lines,
          (messages) => landedLines(messages).has(id),
        );

      /** The queue the service answered, standing over the outbox's in place of the change. */
      const queueAnswered = (answered: AgentQueue): OutboxStep =>
        queueChanged(answeredOver(answered));

      const queue = (
        sends: OutboxSends,
      ): WriteDeclaration<OutboxRow, OutboxChange, QueuedWrite, AgentQueueAnswerView> => ({
        kind: AGENT_OUTBOX,
        keys: ({ agentId }) => [agentId],
        change: (input) => ({ agentId: input.agentId, step: drawnChange(input, input.sentAt) }),
        send: (input) =>
          Effect.map(
            // A change waiting behind another while its member signed out never goes under the next account's sign-in.
            input.queuedBy === "" || input.queuedBy !== accountId()
              ? Effect.succeed<AgentQueueAnswerView>({ failure: AGENT_CALL_FAILURE.UNANSWERED })
              : // Note that the change is addressed as it goes, after any send ahead of it was answered the id it stored.
                sends.queue(input.agentId, addressed(input.change, storedId)),
            (
              answer,
            ): Written<OutboxChange, AgentQueueAnswerView> | Refused<AgentQueueAnswerView> => {
              if (!("queue" in answer)) return { refused: answer };
              const { agentId, change } = input;
              const over = queueAnswered(answer.queue);
              const taken = { agentId, step: over };
              const queueLands = queueCarried(agentId, answer.queue);

              if (change.change !== QUEUE_CHANGE.STEER) {
                return { answer, txid: undefined, standsAs: taken, taken, carried: queueLands };
              }

              // A steer stands as the queue it left with its message sending, until both have landed.
              const line = input.steered;

              return {
                answer,
                txid: undefined,
                standsAs: {
                  agentId,
                  step: (outbox) => {
                    const now = over(outbox);

                    return line === undefined
                      ? now
                      : { ...now, sending: sendingWith(now.sending, line) };
                  },
                },
                taken,
                carried: Effect.andThen(
                  queueLands,
                  line === undefined ? Effect.void : lineCarried(agentId, line.id),
                ),
              };
            },
          ),
      });

      const message = (
        sends: OutboxSends,
      ): WriteDeclaration<OutboxRow, OutboxChange, MessageWrite, AgentAgentAnswer> => ({
        kind: AGENT_OUTBOX,
        keys: ({ agentId }) => [agentId],
        change: (input) => ({
          agentId: input.agentId,
          // A message sent while the agent's machine boots goes into its queue, where the service puts it.
          step: holdsLines(input.agentId)
            ? queueChanged((queue) => queuedWith(queue, input))
            : (outbox) => ({ ...outbox, sending: sendingWith(outbox.sending, sendingOf(input)) }),
        }),
        send: (input) =>
          Effect.gen(function* () {
            const {
              agentId,
              pictures: _pictures,
              steers: _steers,
              taskId: _taskId,
              rewinds,
              sentAt: _sentAt,
              sentBy: sender,
              ...request
            } = input;

            const line = sendingOf(input);

            // A message waiting behind another while its sender signed out never goes under the next account's sign-in,
            // and stands refused for its sender, who finds it where it went on signing in again.
            if (sender === undefined || sender !== accountId()) {
              yield* refusedChanged(sender, agentId, (was) => [
                ...without(line.id)(was),
                { ...line, refused: { failure: AGENT_CALL_FAILURE.UNANSWERED } },
              ]);

              return {
                refused: { failure: AGENT_CALL_FAILURE.UNANSWERED },
              } satisfies Refused<AgentAgentAnswer>;
            }

            // A line in place of another takes the agent back to just before that one first; one that did not go sends nothing.
            if (rewinds !== undefined) {
              const rewound = yield* sends.rewind(
                agentId,
                rewinds.messageId,
                rewinds.restoreFiles === true,
              );

              if ("failure" in rewound) {
                yield* refusedChanged(sender, agentId, (was) => [
                  ...without(line.id)(was),
                  { ...line, refused: rewound },
                ]);

                return { refused: rewound } satisfies Refused<AgentAgentAnswer>;
              }
            }

            // The account signed in may have changed while the rewind went, so the sender is asked again.
            if (sender !== accountId()) {
              yield* refusedChanged(sender, agentId, (was) => [
                ...without(line.id)(was),
                { ...line, refused: { failure: AGENT_CALL_FAILURE.UNANSWERED } },
              ]);

              return {
                refused: { failure: AGENT_CALL_FAILURE.UNANSWERED },
              } satisfies Refused<AgentAgentAnswer>;
            }

            const answer = yield* sends.message(agentId, request);

            if ("failure" in answer) {
              const said: AgentMessageRefusal =
                rewinds === undefined ? answer : { ...answer, rewound: true };

              yield* refusedChanged(sender, agentId, (was) => [
                ...without(line.id)(was),
                { ...line, refused: said },
              ]);

              return { refused: said } satisfies Refused<AgentAgentAnswer>;
            }

            yield* refusedChanged(sender, agentId, without(line.id));

            // A message the agent's first launch holds stands as the queue it waits in, which the service answered, in the line's place.
            if (answer.queued !== undefined) {
              storedIn(answer.queued);
              const taken = { agentId, step: queueAnswered(answer.queued) };

              return {
                answer: { agent: answer.agent, queued: true },
                txid: undefined,
                standsAs: taken,
                taken,
                carried: queueCarried(agentId, answer.queued),
              } satisfies Written<OutboxChange, AgentAgentAnswer>;
            }

            // A message drawn in the queue that the service sent after all, its machine up meanwhile, stands on its way.
            return {
              answer: { agent: answer.agent },
              txid: undefined,
              standsAs: {
                agentId,
                step: (outbox) => ({ ...outbox, sending: sendingWith(outbox.sending, line) }),
              },
              taken: { agentId, step: unchanged },
              carried: lineCarried(agentId, line.id),
            } satisfies Written<OutboxChange, AgentAgentAnswer>;
          }),
      });

      const rewind = (
        sends: OutboxSends,
      ): WriteDeclaration<OutboxRow, OutboxChange, AgentRewindParams, AgentAgentAnswer> => ({
        kind: AGENT_OUTBOX,
        keys: ({ agentId }) => [agentId],
        change: ({ agentId }) => ({ agentId, step: unchanged }),
        send: ({ agentId, messageId, restoreFiles }) =>
          Effect.map(
            sends.rewind(agentId, messageId, restoreFiles === true),
            (answer): Written<OutboxChange, AgentAgentAnswer> | Refused<AgentAgentAnswer> =>
              "failure" in answer
                ? { refused: answer }
                : { answer, txid: undefined, settled: true },
          ),
      });

      const inTurn = <Input extends { readonly agentId: string }, Answer extends object>(
        send: (input: Input) => Effect.Effect<Answer>,
      ): WriteDeclaration<OutboxRow, OutboxChange, Input, Answer> => ({
        kind: AGENT_OUTBOX,
        keys: ({ agentId }) => [agentId],
        change: ({ agentId }) => ({ agentId, step: unchanged }),
        send: (input) =>
          Effect.map(send(input), (answer): Written<OutboxChange, Answer> | Refused<Answer> =>
            "failure" in answer ? { refused: answer } : { answer, txid: undefined, settled: true },
          ),
      });

      const queuedWrite = (write: QueueWrite, sentAt: number): QueuedWrite => {
        const { change } = write;

        if (change.change !== QUEUE_CHANGE.STEER) return { ...write, sentAt };

        const message = pool
          .row(AGENT_OUTBOX, write.agentId)
          ?.queue.messages.find((each) => names(each, change.messageId));

        return message === undefined
          ? { ...write, sentAt }
          : {
              ...write,
              sentAt,
              steered: steered(message, change, write.pictures, sentAt, write.queuedBy),
            };
      };

      const unsend = ({ agentId, lineId }: AgentUnsendParams) =>
        refusedChanged(accountId(), agentId, without(lineId));

      const refusedKept = () =>
        [
          ...(refusedBy(accountId()) ?? MutableHashMap.empty<string, readonly SendingMessage[]>()),
        ].flatMap(([agentId, messages]) =>
          messages.flatMap((message) =>
            message.refused === undefined
              ? []
              : [encodeKeptRefused(keptOf(agentId, message, message.refused))],
          ),
        );

      const refusedRestored = (account: string, kept: readonly unknown[]) =>
        Effect.forEach(
          kept.flatMap((entry) => {
            // Note that an entry a build of another shape kept, which no longer reads, is let go.
            const decoded = decodeKeptRefused(entry);

            const read = Result.isFailure(decoded)
              ? undefined
              : refusedOfKept(decoded.success, account);

            return read === undefined ? [] : [read];
          }),
          ([agentId, message]) =>
            Effect.suspend(() => {
              restored.add(message.id);

              // Note that one refused since the host started stands as it is, since it is the newer word.
              return refusedChanged(account, agentId, (was) =>
                was.some((each) => each.id === message.id) ? was : [...was, message],
              );
            }),
          { discard: true },
        );

      const refusedForgotten = Effect.suspend(() => {
        restored.clear();

        const agents = [...refused].flatMap(([, byAgent]) =>
          [...byAgent].map(([agentId]) => agentId),
        );

        MutableHashMap.clear(refused);

        return Effect.andThen(
          PubSub.publish(moves, undefined),
          Effect.forEach(
            agents,
            (agentId) =>
              Option.match(MutableHashMap.get(standing, agentId), {
                onNone: () => Effect.void,
                onSome: (waits) => waits.redraw,
              }),
            { discard: true },
          ),
        );
      });

      return {
        held,
        queuedWrite,
        queue,
        message,
        inTurn,
        rewind,
        unsend,
        refusedKept,
        refusedMoves: Stream.fromPubSub(moves),
        refusedRestored,
        refusedForgotten,
      };
    }),
  );
}
