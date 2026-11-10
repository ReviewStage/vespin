import {
  MESSAGE_ROLE,
  type MessageRole,
  type SchemaPath,
  type SchemaRead,
  type SchemaRefusal,
  TURN_OPEN,
  TURN_ORIGIN,
  TURN_STATUS,
  unparsedWire,
  type WireBoundaryInput,
  WireValueSchema,
} from "@repo/wire";
import {
  readStoredUIMessages,
  type StoredUIMessage,
  UNREGISTERED_TOOL_PART,
} from "@repo/wire/ui-messages";
import type { ToolSet } from "ai";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  lt,
  max,
  notExists,
  or,
  type SQL,
  type SQLWrapper,
  sql,
} from "drizzle-orm";
import { type AnyPgColumn, alias } from "drizzle-orm/pg-core";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, queryBuilder, type StoreFailure } from "../core/query.js";
import {
  conversations,
  messages,
  type StoredTurnUsage,
  standingLine,
  turns,
} from "../schemas/storage.js";
import {
  EpochMillisColumnSchema,
  InstantColumnSchema,
  optionalField,
  TurnUsageColumnSchema,
} from "./columns.js";
import { claimExpiredBefore } from "./dispatch-claim.js";

/**
 * The conversation reads the brain and the voice make: a turn's journal by
 * its client id, a row by its id, the rows a standing context recalls, and
 * the turn rows an id names. A deleted conversation is read by nothing
 * here, because its rows go with it (`conversation-delete.ts`).
 *
 * Messages are read back through `readStoredUIMessages`, never the SDK's
 * validator alone, because the SDK turns a terminal tool part naming a tool
 * the registry does not hold into a dynamic-tool part rather than refusing
 * it. A tool part naming a tool the catalog has since retired is dropped
 * from its row and the row is answered without it, because one retired call
 * must not leave a conversation unreadable on every device for as long as
 * the row stands; a page holding a row this build cannot read otherwise is
 * refused whole, naming the row's sequence, rather than answered with the
 * row silently reshaped.
 *
 * Every read below is an `Effect<A, SqlError | SchemaError, SqlClient>` over
 * the ambient client, its statement a Drizzle builder over the tables
 * `schemas/storage.ts` declares and its row a `Schema` decodes rather than
 * trusts. Two things follow from the builder. A projection names its own
 * fields, so a result schema is spelled in the same words the rest of the
 * module is; and the vocabulary a text column holds — a turn's origin and
 * status, an event's kind, a message's role — is read as the literals the
 * writer alone spells into it, so a row holding a word this build does not
 * know is refused rather than trusted. What the builder cannot spell is a
 * named `sql` fragment inside the one rendered statement: the instant a turn
 * last changed and its text form.
 */

/** The vocabularies the text columns hold, as the writer spells them; a row outside one is refused. */
const TurnOriginSchema = Schema.Literals(Object.values(TURN_ORIGIN));
const TurnStatusSchema = Schema.Literals(Object.values(TURN_STATUS));
const MessageRoleSchema = Schema.Literals(Object.values(MESSAGE_ROLE));

/** The most rows one read answers. */
const MAXIMUM_READ_PAGE = 200;

export interface StoredMessageRecord {
  readonly id: string;
  readonly conversationId: string;
  readonly seq: number;
  readonly turnId?: string;
  readonly clientId: string;
  readonly createdAt: Date;
  /** Where the row stands in the Conversation: a spoken row at the instant its words began, any other where it was written. */
  readonly placedAt: Date;
  /** Absent while the message is still in flight and mutable. */
  readonly finishedAt?: Date;
  /** The conversation's journal revision at the row's last write in place; absent for a row never written in place. */
  readonly revision?: number;
  readonly message: StoredUIMessage;
}

/**
 * A refused page names the sequence of the first row this build could not
 * read and the path inside that row. The registry pre-check names the row
 * itself; the SDK's structural refusal names none, so the rows are then read
 * one at a time, in order, to find it, a cost paid only on the failure path.
 */
export type MessageListRead =
  | { readonly ok: true; readonly value: readonly StoredMessageRecord[] }
  | {
      readonly ok: false;
      readonly refusal: SchemaRefusal;
      readonly conversationId: string;
      readonly seq: number;
      readonly path: SchemaPath;
    };

type MessageRow = {
  readonly id: string;
  readonly conversationId: string;
  readonly seq: number;
  readonly turnId: string | null;
  readonly clientId: string;
  readonly createdAt: Date;
  readonly placedAt: Date;
  readonly finishedAt: Date | null;
  readonly revision: number | null;
  /** The row's message as it was written, held to the vocabulary by the read and by nothing before it. */
  readonly stored: WireBoundaryInput;
};

type RefusedPage = Exclude<MessageListRead, { ok: true }>;

function refusedRow(
  rows: readonly MessageRow[],
  read: Exclude<SchemaRead<unknown>, { ok: true }>,
  tools: ToolSet,
): Effect.Effect<RefusedPage> {
  const [index, ...path] = read.path;
  const named = rows.find((_, position) => position === index);
  if (named !== undefined) {
    return Effect.succeed({
      ok: false,
      refusal: read.refusal,
      conversationId: named.conversationId,
      seq: named.seq,
      path,
    });
  }
  // The reader named no row, so each is read alone until the unreadable one names itself.
  return Effect.gen(function* () {
    for (const row of rows) {
      const single = yield* readStoredUIMessages(
        unparsedWire([row.stored]),
        tools,
        UNREGISTERED_TOOL_PART.DROP,
      );
      if (!single.ok) {
        const [, ...inner] = single.path;
        return {
          ok: false,
          refusal: single.refusal,
          conversationId: row.conversationId,
          seq: row.seq,
          path: inner,
        };
      }
    }
    return yield* Effect.die(new Error("a page was refused whole and every row of it read alone"));
  });
}

function pageLimit(cursor: { readonly limit?: number }): number {
  return Math.min(Math.max(cursor.limit ?? MAXIMUM_READ_PAGE, 1), MAXIMUM_READ_PAGE);
}

/**
 * The join every read here makes to its conversation row, one per table
 * reached: the conversation the row belongs to. It is spelled once per table
 * rather than once over a column handed in, because the column the join
 * holds to is what makes each one the join it is. A message's join also
 * leaves out a line its hand-over withdrew, which the agent never heard
 * unless a turn takes it, and which no read shows until one does.
 */
const MESSAGE_CONVERSATION_STANDS = and(
  eq(conversations.id, messages.conversationId),
  standingLine(messages),
);

const TURN_CONVERSATION_STANDS = eq(conversations.id, turns.conversationId);

/** The columns a message read selects, held to the vocabulary by nothing until `readSelected` below. */
const MESSAGE_FIELDS = {
  id: messages.id,
  conversationId: messages.conversationId,
  seq: messages.seq,
  turnId: messages.turnId,
  clientId: messages.clientId,
  role: messages.role,
  parts: messages.parts,
  metadata: messages.metadata,
  createdAt: messages.createdAt,
  placedAt: messages.placedAt,
  finishedAt: messages.finishedAt,
  revision: messages.revision,
};

/** The row every message read selects, in the fields the projection above names. */
const SELECTED_MESSAGE_FIELDS = {
  id: Schema.String,
  conversationId: Schema.String,
  seq: EpochMillisColumnSchema,
  turnId: Schema.NullOr(Schema.String),
  clientId: Schema.String,
  role: MessageRoleSchema,
  parts: WireValueSchema,
  metadata: Schema.NullOr(WireValueSchema),
  createdAt: InstantColumnSchema,
  placedAt: InstantColumnSchema,
  finishedAt: Schema.NullOr(InstantColumnSchema),
  revision: Schema.NullOr(EpochMillisColumnSchema),
} as const;

const SelectedMessageRowSchema = Schema.Struct(SELECTED_MESSAGE_FIELDS);

type SelectedMessage = typeof SelectedMessageRowSchema.Type;

/** Selected rows read back through the vocabulary, in the order given, or the page refused at its first unreadable row. */
function readSelected(
  selected: readonly SelectedMessage[],
  tools: ToolSet,
): Effect.Effect<MessageListRead> {
  const rows: MessageRow[] = selected.map(({ role, parts, metadata, ...row }) => ({
    ...row,
    stored: { id: row.id, role, parts, ...optionalField("metadata", metadata) },
  }));
  const read = readStoredUIMessages(
    unparsedWire(rows.map((row) => row.stored)),
    tools,
    UNREGISTERED_TOOL_PART.DROP,
  );
  return Effect.flatMap(read, (read): Effect.Effect<MessageListRead> => {
    if (!read.ok) return refusedRow(rows, read, tools);
    return Effect.succeed({
      ok: true,
      value: read.value.map((message, index) => {
        const row = rows[index];
        if (row === undefined) throw new Error("a read answered more messages than rows");
        return {
          id: row.id,
          conversationId: row.conversationId,
          seq: row.seq,
          ...optionalField("turnId", row.turnId),
          clientId: row.clientId,
          createdAt: row.createdAt,
          placedAt: row.placedAt,
          ...optionalField("finishedAt", row.finishedAt),
          ...optionalField("revision", row.revision),
          message,
        };
      }),
    });
  });
}

const findRecentMessages = SqlSchema.findAll({
  Request: Schema.Struct({
    conversationId: Schema.String,
    userId: Schema.String,
    limit: Schema.Number,
  }),
  Result: SelectedMessageRowSchema,
  execute: (options) =>
    Database.use((db) =>
      db
        .select(MESSAGE_FIELDS)
        .from(messages)
        .innerJoin(conversations, MESSAGE_CONVERSATION_STANDS)
        .where(
          and(
            eq(messages.conversationId, options.conversationId),
            eq(messages.userId, options.userId),
            isNotNull(messages.finishedAt),
            inArray(messages.role, [MESSAGE_ROLE.USER, MESSAGE_ROLE.ASSISTANT]),
          ),
        )
        .orderBy(desc(messages.seq))
        .limit(options.limit),
    ),
});

/**
 * The newest finished messages of the two speaking roles, answered oldest
 * first: what a turn's standing context and a rotated session's seed read
 * back. A row still in flight says nothing finished yet, and a system row
 * says nothing a speaker said, so neither is answered.
 */
export function listRecentMessages(
  userId: string,
  conversationId: string,
  tools: ToolSet,
  limit: number,
): Effect.Effect<MessageListRead, StoreFailure, DatabaseServices> {
  return Effect.flatMap(
    findRecentMessages({ conversationId, userId, limit: pageLimit({ limit }) }),
    (selected) => readSelected([...selected].reverse(), tools),
  );
}

const findTurnOpeners = SqlSchema.findAll({
  Request: Schema.Struct({
    conversationId: Schema.String,
    userId: Schema.String,
    turnIds: Schema.Array(Schema.String),
  }),
  Result: SelectedMessageRowSchema,
  execute: (options) =>
    Database.use((db) =>
      db
        .selectDistinctOn([messages.turnId], MESSAGE_FIELDS)
        .from(messages)
        .innerJoin(conversations, MESSAGE_CONVERSATION_STANDS)
        .where(
          and(
            eq(messages.conversationId, options.conversationId),
            eq(messages.userId, options.userId),
            inArray(messages.turnId, [...options.turnIds]),
            isNotNull(messages.finishedAt),
            eq(messages.role, MESSAGE_ROLE.USER),
          ),
        )
        .orderBy(messages.turnId, asc(messages.seq)),
    ),
});

/**
 * The line that opened each turn asked, oldest first: the first finished
 * user row that names the turn, since a line a turn took in mid-run names
 * none. A turn no line opened, or one of another conversation, answers
 * nothing.
 */
export function listTurnOpeners(
  userId: string,
  conversationId: string,
  tools: ToolSet,
  turnIds: readonly string[],
): Effect.Effect<MessageListRead, StoreFailure, DatabaseServices> {
  if (turnIds.length === 0) return Effect.succeed({ ok: true, value: [] });
  return Effect.flatMap(findTurnOpeners({ conversationId, userId, turnIds }), (selected) =>
    readSelected(
      selected.toSorted((first, second) => first.seq - second.seq),
      tools,
    ),
  );
}

const findMessagesBefore = SqlSchema.findAll({
  Request: Schema.Struct({
    conversationId: Schema.String,
    userId: Schema.String,
    before: Schema.Number,
    limit: Schema.Number,
  }),
  Result: SelectedMessageRowSchema,
  execute: (options) =>
    Database.use((db) =>
      db
        .select(MESSAGE_FIELDS)
        .from(messages)
        .innerJoin(conversations, MESSAGE_CONVERSATION_STANDS)
        .where(
          and(
            eq(messages.conversationId, options.conversationId),
            eq(messages.userId, options.userId),
            lt(messages.seq, options.before),
          ),
        )
        .orderBy(desc(messages.seq))
        .limit(options.limit),
    ),
});

/**
 * The newest messages below a sequence, every role and finished or not, as
 * each now stands, answered oldest first: a page of a transcript read back
 * from its end, `before` the lowest sequence the reader holds so far. A page
 * holds at most `limit` rows, and fewer only once nothing more stands below.
 * A conversation that no longer stands, or another account's, answers none.
 */
export function listMessagesBefore(
  userId: string,
  conversationId: string,
  tools: ToolSet,
  before: number,
  limit?: number,
): Effect.Effect<MessageListRead, StoreFailure, DatabaseServices> {
  return Effect.flatMap(
    findMessagesBefore({
      conversationId,
      userId,
      before,
      limit: pageLimit({ ...(limit === undefined ? undefined : { limit }) }),
    }),
    (selected) => readSelected([...selected].reverse(), tools),
  );
}

const findMessagesFrom = SqlSchema.findAll({
  Request: Schema.Struct({
    conversationId: Schema.String,
    userId: Schema.String,
    from: Schema.Number,
    limit: Schema.Number,
  }),
  Result: SelectedMessageRowSchema,
  execute: (options) =>
    Database.use((db) =>
      db
        .select(MESSAGE_FIELDS)
        .from(messages)
        .innerJoin(conversations, MESSAGE_CONVERSATION_STANDS)
        .where(
          and(
            eq(messages.conversationId, options.conversationId),
            eq(messages.userId, options.userId),
            gte(messages.seq, options.from),
          ),
        )
        .orderBy(asc(messages.seq))
        .limit(options.limit),
    ),
});

/**
 * The oldest messages at or above a sequence, every role and finished or
 * not, as each now stands, oldest first: a page of a transcript read on
 * from a place in it, `from` the sequence to start at. A page holds at most
 * `limit` rows, and fewer only once nothing more stands above. A
 * conversation that no longer stands, or another account's, answers none.
 */
export function listMessagesFrom(
  userId: string,
  conversationId: string,
  tools: ToolSet,
  from: number,
  limit?: number,
): Effect.Effect<MessageListRead, StoreFailure, DatabaseServices> {
  return Effect.flatMap(
    findMessagesFrom({
      conversationId,
      userId,
      from,
      limit: pageLimit({ ...(limit === undefined ? undefined : { limit }) }),
    }),
    (selected) => readSelected(selected, tools),
  );
}

const findMessageSeq = SqlSchema.findOneOption({
  Request: Schema.Struct({
    conversationId: Schema.String,
    userId: Schema.String,
    messageId: Schema.String,
    role: MessageRoleSchema,
  }),
  Result: Schema.Struct({ seq: Schema.Number }),
  execute: (options) =>
    Database.use((db) =>
      db
        .select({ seq: messages.seq })
        .from(messages)
        .innerJoin(conversations, MESSAGE_CONVERSATION_STANDS)
        .where(
          and(
            eq(messages.conversationId, options.conversationId),
            eq(messages.userId, options.userId),
            eq(messages.id, options.messageId),
            eq(messages.role, options.role),
          ),
        ),
    ),
});

/**
 * Where a message of the conversation in the role named stands, by its id,
 * without reading its parts: what a read back from the end starts below.
 * Nothing for a message that is not there in that role, and nothing in a
 * conversation that no longer stands or another account's.
 */
export function messageSeqOf(
  userId: string,
  conversationId: string,
  messageId: string,
  role: MessageRole,
): Effect.Effect<Option.Option<number>, StoreFailure, DatabaseServices> {
  return Effect.map(
    findMessageSeq({ conversationId, userId, messageId, role }),
    Option.map((row) => row.seq),
  );
}

/** Where a transcript reader stands: the highest message sequence it has, and the journal revision it read at. */
export interface MessageCursor {
  readonly seq: number;
  readonly revision: number;
}

/** A page of messages past a cursor, and the cursor to read on from. */
export interface MessagePagePast {
  readonly read: MessageListRead;
  readonly cursor: MessageCursor;
}

const findMessagesPast = SqlSchema.findAll({
  Request: Schema.Struct({
    conversationId: Schema.String,
    userId: Schema.String,
    seq: Schema.Number,
    revision: Schema.Number,
    limit: Schema.Number,
  }),
  Result: SelectedMessageRowSchema,
  execute: (options) =>
    Database.use((db) =>
      db
        .select(MESSAGE_FIELDS)
        .from(messages)
        .innerJoin(conversations, MESSAGE_CONVERSATION_STANDS)
        .where(
          and(
            eq(messages.conversationId, options.conversationId),
            eq(messages.userId, options.userId),
            or(gt(messages.seq, options.seq), gt(messages.revision, options.revision)),
          ),
        )
        .orderBy(asc(messages.seq))
        .limit(options.limit),
    ),
});

const findJournalRevision = SqlSchema.findOneOption({
  Request: Schema.Struct({ conversationId: Schema.String, userId: Schema.String }),
  Result: Schema.Struct({ journalRevision: EpochMillisColumnSchema }),
  execute: (options) =>
    Database.use((db) =>
      db
        .select({ journalRevision: conversations.journalRevision })
        .from(conversations)
        .where(
          and(
            eq(conversations.id, options.conversationId),
            eq(conversations.userId, options.userId),
          ),
        ),
    ),
});

/**
 * The messages a reader has not seen as they now stand: every row past the
 * cursor's sequence, and every row amended in place past its revision, in
 * sequence order, read back through the vocabulary. The cursor answered
 * is the highest sequence on the page or the one asked, and the
 * conversation's journal revision as it stands now, read before the page
 * so an amendment that lands between the two is heard again rather than
 * missed. A conversation that no longer stands answers no rows and the
 * cursor asked. A page holds at most `limit` rows, no more than any read
 * here answers, and fewer only once nothing more stands past the cursor.
 */
export function listMessagesPast(
  userId: string,
  conversationId: string,
  tools: ToolSet,
  cursor: MessageCursor,
  limit?: number,
): Effect.Effect<MessagePagePast, StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const standing = yield* findJournalRevision({ conversationId, userId });
    if (Option.isNone(standing)) return { read: { ok: true, value: [] }, cursor };
    const selected = yield* findMessagesPast({
      conversationId,
      userId,
      seq: cursor.seq,
      revision: cursor.revision,
      limit: pageLimit({ ...(limit === undefined ? undefined : { limit }) }),
    });
    const read = yield* readSelected(selected, tools);
    const seq = selected.reduce((highest, row) => Math.max(highest, row.seq), cursor.seq);
    return { read, cursor: { seq, revision: standing.value.journalRevision } };
  });
}

const findHighestSeq = SqlSchema.findAll({
  Request: Schema.Struct({ conversationId: Schema.String, userId: Schema.String }),
  Result: Schema.Struct({ seq: Schema.Number }),
  execute: (options) =>
    Database.use((db) =>
      db
        .select({ seq: sql<number>`coalesce(max(${messages.seq}), 0)`.mapWith(Number) })
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, options.conversationId),
            eq(messages.userId, options.userId),
          ),
        ),
    ),
});

/**
 * Where a reader who has every message as it now stands is: the highest
 * sequence the conversation holds and its journal revision, the revision
 * read first so an amendment that lands between the two is heard again
 * rather than missed. A reader that read a conversation's newest rows some
 * other way follows on from here (`listMessagesPast`). A conversation that
 * no longer stands, or another account's, is the start.
 */
export function messageCursorNow(
  userId: string,
  conversationId: string,
): Effect.Effect<MessageCursor, StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const standing = yield* findJournalRevision({ conversationId, userId });
    if (Option.isNone(standing)) return { seq: 0, revision: 0 };
    const [highest] = yield* findHighestSeq({ conversationId, userId });
    return { seq: highest?.seq ?? 0, revision: standing.value.journalRevision };
  });
}

/** Where a transcript stands as one reading: the cursor of a reader who has every message as it now stands, and the journal revision it was last rewound at, none for one never rewound. */
export interface MessageStanding {
  readonly cursor: MessageCursor;
  readonly rewound: Option.Option<number>;
}

const findMessageStanding = SqlSchema.findOneOption({
  Request: Schema.Struct({ conversationId: Schema.String, userId: Schema.String }),
  Result: Schema.Struct({
    seq: EpochMillisColumnSchema,
    revision: EpochMillisColumnSchema,
    rewound: Schema.NullOr(EpochMillisColumnSchema),
  }),
  execute: (options) =>
    Database.use((db) =>
      db
        .select({
          seq: sql<number>`(
            select coalesce(max(${messages.seq}), 0) from ${messages}
            where ${and(eq(messages.conversationId, conversations.id), eq(messages.userId, options.userId))}
          )`,
          revision: conversations.journalRevision,
          rewound: conversations.rewoundRevision,
        })
        .from(conversations)
        .where(
          and(
            eq(conversations.id, options.conversationId),
            eq(conversations.userId, options.userId),
          ),
        ),
    ),
});

/**
 * Where a transcript stands now (`messageCursorNow`), and where it was last
 * rewound, read in one statement, so a reader that reads its rows after
 * this misses no message written or amended past the cursor, and a rewind
 * that lands meanwhile moves the rewound revision past the cursor answered,
 * which its next reading then finds behind. A conversation that no longer
 * stands, or another account's, is the start, never rewound.
 */
export function messageStandingNow(
  userId: string,
  conversationId: string,
): Effect.Effect<MessageStanding, StoreFailure, DatabaseServices> {
  return Effect.map(
    findMessageStanding({ conversationId, userId }),
    Option.match({
      onNone: () => ({ cursor: { seq: 0, revision: 0 }, rewound: Option.none() }),
      onSome: (row) => ({
        cursor: { seq: row.seq, revision: row.revision },
        rewound: Option.fromNullishOr(row.rewound),
      }),
    }),
  );
}

const findRunningChildTurns = SqlSchema.findAll({
  Request: Schema.Struct({ parentConversationId: Schema.String, userId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: (options) =>
    Database.use((db) =>
      db
        .select({ id: turns.id })
        .from(turns)
        .innerJoin(conversations, eq(turns.conversationId, conversations.id))
        .where(
          and(
            eq(conversations.parentConversationId, options.parentConversationId),
            eq(conversations.userId, options.userId),
            inArray(turns.status, [...TURN_OPEN]),
          ),
        )
        .orderBy(asc(turns.id)),
    ),
});

/** The queued or running turns of every child conversation of the one named, a subagent's session each, by id; none of another account's. */
export function runningChildTurns(
  userId: string,
  parentConversationId: string,
): Effect.Effect<readonly string[], StoreFailure, DatabaseServices> {
  return Effect.map(findRunningChildTurns({ parentConversationId, userId }), (rows) =>
    rows.map((row) => row.id),
  );
}

/** The last `tail` of a message's parts, in order, cut out of the jsonb where it is stored, so a reader after the newest parts alone never carries the whole array out. */
function partsTail(tail: number) {
  return sql`(select coalesce(jsonb_agg(tail.part order by tail.place), '[]'::jsonb) from jsonb_array_elements(${messages.parts}) with ordinality as tail(part, place) where tail.place > jsonb_array_length(${messages.parts}) - ${tail})`.mapWith(
    messages.parts,
  );
}

const findNewestJournalOf = SqlSchema.findAll({
  Request: Schema.Struct({
    conversationIds: Schema.Array(Schema.String),
    tailParts: Schema.optional(Schema.Int),
  }),
  Result: SelectedMessageRowSchema,
  execute: ({ conversationIds, tailParts }) =>
    Database.use((db) =>
      db
        .selectDistinctOn(
          [messages.conversationId],
          tailParts === undefined
            ? MESSAGE_FIELDS
            : { ...MESSAGE_FIELDS, parts: partsTail(tailParts) },
        )
        .from(messages)
        .innerJoin(conversations, MESSAGE_CONVERSATION_STANDS)
        .where(
          and(
            inArray(messages.conversationId, [...conversationIds]),
            eq(messages.role, MESSAGE_ROLE.ASSISTANT),
          ),
        )
        .orderBy(messages.conversationId, desc(messages.seq)),
    ),
});

/**
 * The newest turn journal of each conversation named, whoever owns it, keyed
 * by conversation: `listJournals`' newest for many at once, or only the last
 * `tailParts` of each one's parts where that is all its reader looks at. A
 * conversation with none, or whose journal does not read, is absent. Only for
 * ids a gate already read, as `latestTurnsOfReached`.
 */
export function newestJournalsOfReached(
  conversationIds: readonly string[],
  tools: ToolSet,
  tailParts?: number,
): Effect.Effect<ReadonlyMap<string, StoredMessageRecord>, StoreFailure, DatabaseServices> {
  if (conversationIds.length === 0) return Effect.succeed(new Map());
  return Effect.flatMap(
    findNewestJournalOf({ conversationIds, ...optionalField("tailParts", tailParts) }),
    (selected) =>
      // Note that each row is read on its own, so one unreadable journal leaves out its conversation alone.
      Effect.map(
        Effect.forEach(selected, (row) => readSelected([row], tools)),
        (reads) =>
          new Map(
            reads
              .flatMap((read) => (read.ok ? read.value : []))
              .map((record) => [record.conversationId, record]),
          ),
      ),
  );
}

const findMessageByClientIdRow = SqlSchema.findAll({
  Request: Schema.Struct({
    conversationId: Schema.String,
    userId: Schema.String,
    clientId: Schema.String,
  }),
  Result: SelectedMessageRowSchema,
  execute: (options) =>
    Database.use((db) =>
      db
        .select(MESSAGE_FIELDS)
        .from(messages)
        .innerJoin(conversations, MESSAGE_CONVERSATION_STANDS)
        .where(
          and(
            eq(messages.conversationId, options.conversationId),
            eq(messages.userId, options.userId),
            eq(messages.clientId, options.clientId),
          ),
        ),
    ),
});

/**
 * The one message a writer's own client id names in a conversation, read back
 * under the registry like a page: a turn's journal is the row whose client id
 * is the turn's id. Answers an empty page where none stands.
 */
export function readMessageByClientId(
  userId: string,
  conversationId: string,
  tools: ToolSet,
  clientId: string,
): Effect.Effect<MessageListRead, StoreFailure, DatabaseServices> {
  return Effect.flatMap(
    findMessageByClientIdRow({ conversationId, userId, clientId }),
    (selected) => readSelected(selected, tools),
  );
}

const findMessageByIdRow = SqlSchema.findAll({
  Request: Schema.Struct({
    conversationId: Schema.String,
    userId: Schema.String,
    messageId: Schema.String,
  }),
  Result: SelectedMessageRowSchema,
  execute: (options) =>
    Database.use((db) =>
      db
        .select(MESSAGE_FIELDS)
        .from(messages)
        .innerJoin(conversations, MESSAGE_CONVERSATION_STANDS)
        .where(
          and(
            eq(messages.conversationId, options.conversationId),
            eq(messages.userId, options.userId),
            eq(messages.id, options.messageId),
          ),
        ),
    ),
});

/**
 * The one message its id names in the account's conversation, read back
 * under the registry like a page, so its parts stand at the indexes a page
 * of it answered: what a reader fetches a part its page carried cut from.
 * Answers an empty page where none stands, in a conversation that no
 * longer stands, and in another account's.
 */
export function readMessageById(
  userId: string,
  conversationId: string,
  tools: ToolSet,
  messageId: string,
): Effect.Effect<MessageListRead, StoreFailure, DatabaseServices> {
  return Effect.flatMap(findMessageByIdRow({ conversationId, userId, messageId }), (selected) =>
    readSelected(selected, tools),
  );
}

/** The newest turn of a conversation, as a coding agent's status is read from it. */
export interface LatestTurn {
  readonly conversationId: string;
  readonly id: string;
  readonly status: string;
  /** The runtime's own id for the turn, which a Stop names to the harness; null where the row names none. */
  readonly runtimeTurnId: string | null;
  /** The word for how a failed turn failed, and the detail behind it; null on a turn that did not. */
  readonly failure: string | null;
  readonly failureDetail: string | null;
  readonly cancelRequestedAt: Date | null;
  /** When the turn was queued, and when its runtime started it; null until it has. */
  readonly queuedAt: Date;
  readonly startedAt: Date | null;
  /** When the turn answered or ended; null while it runs. */
  readonly settledAt: Date | null;
  /** The deadline of the state it stands in while it is queued or runs (`turn-state.ts`); null for a turn from before the deadline. Optional, so a turn built by hand in a test need not name it. */
  readonly leaseUntil?: Date | null;
  /** When the usage limit an open turn is held for resets (`turns.waits_until`); null where it waits on none. Optional as `leaseUntil` is. */
  readonly waitsUntil?: Date | null;
  /** What the turn ran under and what it cost, as the row holds them; null where the row names no model, and until the turn settles. */
  readonly model: string | null;
  readonly usage: StoredTurnUsage | null;
  /** Whether a step of the turn ran at standard speed because Anthropic refused it Fast. */
  readonly fastRefused: boolean;
}

const LatestTurnRowSchema = Schema.Struct({
  conversationId: Schema.String,
  id: Schema.String,
  status: Schema.String,
  runtimeTurnId: Schema.NullOr(Schema.String),
  failure: Schema.NullOr(Schema.String),
  failureDetail: Schema.NullOr(Schema.String),
  cancelRequestedAt: Schema.NullOr(InstantColumnSchema),
  queuedAt: InstantColumnSchema,
  startedAt: Schema.NullOr(InstantColumnSchema),
  settledAt: Schema.NullOr(InstantColumnSchema),
  /** The deadline of the state it stands in while it is open (`turn-state.ts`); null for a turn from before the deadline. */
  leaseUntil: Schema.NullOr(InstantColumnSchema),
  waitsUntil: Schema.NullOr(InstantColumnSchema),
  model: Schema.NullOr(Schema.String),
  usage: Schema.NullOr(TurnUsageColumnSchema),
  fastRefused: Schema.Boolean,
});

/** A read of conversations by id, under the account that owns them, or by id alone (null) where the caller passed a gate of its own. */
const ConversationsReadSchema = Schema.Struct({
  userId: Schema.NullOr(Schema.String),
  conversationIds: Schema.Array(Schema.String),
});

/** The newest turn of each conversation named, by the order the turns were queued; a conversation with none answers no row. */
const findLatestTurns = SqlSchema.findAll({
  Request: ConversationsReadSchema,
  Result: LatestTurnRowSchema,
  execute: ({ userId, conversationIds }) =>
    Database.use((db) =>
      db
        .selectDistinctOn([turns.conversationId], {
          conversationId: turns.conversationId,
          id: turns.id,
          status: turns.status,
          runtimeTurnId: turns.runtimeTurnId,
          failure: turns.failure,
          failureDetail: turns.failureDetail,
          cancelRequestedAt: turns.cancelRequestedAt,
          queuedAt: turns.queuedAt,
          startedAt: turns.startedAt,
          settledAt: turns.settledAt,
          leaseUntil: turns.leaseUntil,
          waitsUntil: turns.waitsUntil,
          model: turns.model,
          usage: turns.usage,
          fastRefused: turns.fastRefused,
        })
        .from(turns)
        .where(
          and(
            userId === null ? undefined : eq(turns.userId, userId),
            inArray(turns.conversationId, [...conversationIds]),
          ),
        )
        .orderBy(turns.conversationId, desc(turns.queuedAt), desc(turns.id)),
    ),
});

/** What one settled turn ran under and cost, as a conversation's total is summed from it. */
export type TurnUsageRow = Pick<LatestTurn, "model" | "fastRefused"> & {
  readonly usage: StoredTurnUsage;
};

const TurnUsageRowSchema = Schema.Struct({
  model: Schema.NullOr(Schema.String),
  usage: TurnUsageColumnSchema,
  fastRefused: Schema.Boolean,
});

/**
 * Every turn with a recorded usage of the conversation named and of each
 * conversation delegated from it, which is where a coding agent's workers
 * run, so the agent's total is its own turns' and its workers'.
 */
const findTurnUsages = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, conversationId: Schema.String }),
  Result: TurnUsageRowSchema,
  execute: ({ userId, conversationId }) =>
    Database.use((db) =>
      db
        .select({ model: turns.model, usage: turns.usage, fastRefused: turns.fastRefused })
        .from(turns)
        .where(
          and(
            eq(turns.userId, userId),
            isNotNull(turns.usage),
            or(
              eq(turns.conversationId, conversationId),
              inArray(
                turns.conversationId,
                db
                  .select({ id: conversations.id })
                  .from(conversations)
                  .where(eq(conversations.parentConversationId, conversationId)),
              ),
            ),
          ),
        ),
    ),
});

/** The usage of every settled turn of the account's conversation and of the conversations delegated from it. */
export function turnUsagesOf(
  userId: string,
  conversationId: string,
): Effect.Effect<readonly TurnUsageRow[], StoreFailure, DatabaseServices> {
  return findTurnUsages({ userId, conversationId });
}

function latestTurnsRead(
  userId: string | null,
  conversationIds: readonly string[],
): Effect.Effect<ReadonlyMap<string, LatestTurn>, StoreFailure, DatabaseServices> {
  if (conversationIds.length === 0) return Effect.succeed(new Map());
  return Effect.map(
    findLatestTurns({ userId, conversationIds }),
    (rows) => new Map(rows.map((row) => [row.conversationId, row])),
  );
}

/** The newest turn of each of the account's conversations named, keyed by conversation; a conversation with no turn yet is absent. */
export function latestTurnsOf(
  userId: string,
  conversationIds: readonly string[],
): Effect.Effect<ReadonlyMap<string, LatestTurn>, StoreFailure, DatabaseServices> {
  return latestTurnsRead(userId, conversationIds);
}

/**
 * The newest turn of each conversation named, whoever owns it, keyed by
 * conversation. Only for ids a gate already read, such as the conversations
 * of the coding agents a member's workspace reaches, which other members started.
 */
export function latestTurnsOfReached(
  conversationIds: readonly string[],
): Effect.Effect<ReadonlyMap<string, LatestTurn>, StoreFailure, DatabaseServices> {
  return latestTurnsRead(null, conversationIds);
}

const findTurnStoppedUnder = SqlSchema.findAll({
  Request: Schema.Struct({ conversationId: Schema.String, key: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ conversationId, key }) =>
    Database.use((db) =>
      db
        .select({ id: turns.id })
        .from(turns)
        .where(and(eq(turns.conversationId, conversationId), eq(turns.cancelRequestKey, key)))
        .limit(1),
    ),
});

/**
 * Whether a Stop made under the key stands on a turn of the conversation
 * named, whoever owns it: what a tool call run again reads to find the turn
 * it stopped. Only for an id a gate already read, as `latestTurnsOfReached`.
 */
export function turnStoppedUnderReached(
  conversationId: string,
  key: string,
): Effect.Effect<boolean, StoreFailure, DatabaseServices> {
  return Effect.map(findTurnStoppedUnder({ conversationId, key }), (rows) => rows.length > 0);
}

/**
 * When the newest turn to end in the conversation `conversationId` names
 * ended, or null where none has: what a live statement selects beside the
 * newest turn, whose own end is null while it runs, as
 * `lastSettledTurnsOfReached` reads it.
 */
export function lastSettledTurnAt(conversationId: SQLWrapper): SQL<Date | null> {
  // Note that the instant is selected bare, because Drizzle's `max` casts it to text and a cast through text is no immutable function, which a live statement must hold to.
  return sql<Date | null>`(${queryBuilder
    .select({ settledAt: sql<Date | null>`max(${turns.settledAt})` })
    .from(turns)
    .where(eq(turns.conversationId, conversationId))})`;
}

const LastSettledTurnRowSchema = Schema.Struct({
  conversationId: Schema.String,
  settledAt: InstantColumnSchema,
});

/** When the newest turn to end in each conversation named ended; a conversation none of whose turns has ended answers no row. */
const findLastSettledTurns = SqlSchema.findAll({
  Request: Schema.Struct({ conversationIds: Schema.Array(Schema.String) }),
  Result: LastSettledTurnRowSchema,
  execute: ({ conversationIds }) =>
    Database.use((db) =>
      db
        .select({ conversationId: turns.conversationId, settledAt: max(turns.settledAt) })
        .from(turns)
        .where(and(inArray(turns.conversationId, [...conversationIds]), isNotNull(turns.settledAt)))
        .groupBy(turns.conversationId),
    ),
});

/**
 * When the newest turn to end in each conversation named ended, whoever owns
 * it, keyed by conversation; a conversation none of whose turns has ended is
 * absent. Only for ids a gate already read, as `latestTurnsOfReached`.
 */
export function lastSettledTurnsOfReached(
  conversationIds: readonly string[],
): Effect.Effect<ReadonlyMap<string, Date>, StoreFailure, DatabaseServices> {
  if (conversationIds.length === 0) return Effect.succeed(new Map());
  return Effect.map(
    findLastSettledTurns({ conversationIds }),
    (rows) => new Map(rows.map((row) => [row.conversationId, row.settledAt])),
  );
}

/**
 * What the retired runtime put between two messages it handed a turn as one:
 * steers that arrived while a step was under way were coalesced into the next
 * step's input, their words joined by a blank line, and the turn received the
 * joined words as a single message.
 */
export const COALESCED_LINE_SEPARATOR = "\n\n";

/** A developer's line and the turn-owned row later in its conversation that may carry its words: one table under the two names the read takes it by. */
const receipt = alias(messages, "receipt");

/** The words of a row's one text part, as both the line and the receipt hold them, fenced by the coalescing separator so a whole coalesced segment is matched and never a fragment of one. */
const fencedWords = (parts: AnyPgColumn) =>
  sql`${COALESCED_LINE_SEPARATOR} || (${parts} -> 0 ->> 'text') || ${COALESCED_LINE_SEPARATOR}`;

/**
 * Whether a turnless user row of `messages` still awaits its turn: no later
 * user row of a turn in its conversation carries its words, whole or as one
 * of the segments the retired runtime coalesced. Such a row is that runtime's
 * own receipt of the line, written by its relay where the line was not taken into the turn, so
 * the line awaits nothing: it must not read the agent as running forever,
 * and no later turn may take it in the place of the line it did receive.
 */
export function noReceiptOfLine() {
  return notExists(
    queryBuilder
      .select({ id: receipt.id })
      .from(receipt)
      .where(
        and(
          eq(receipt.conversationId, messages.conversationId),
          eq(receipt.role, MESSAGE_ROLE.USER),
          isNotNull(receipt.turnId),
          gt(receipt.seq, messages.seq),
          sql`strpos(${fencedWords(receipt.parts)}, ${fencedWords(messages.parts)}) > 0`,
        ),
      ),
  );
}

const findSentLine = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    conversationId: Schema.String,
    clientId: Schema.String,
    claimExpiredBefore: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: (key) =>
    Database.use((db) =>
      db
        .select({ id: messages.id })
        .from(messages)
        .innerJoin(conversations, eq(conversations.id, messages.conversationId))
        .where(
          and(
            eq(messages.conversationId, key.conversationId),
            eq(messages.userId, key.userId),
            eq(messages.clientId, key.clientId),
            // A line its hand-over withdrew was not sent, and a send repeated under its key sends it afresh.
            standingLine(messages),
            // A line its dispatch claim still hands over is not sent yet: the hand-over may withdraw it.
            sql`not (${conversations.dispatchLine} is not distinct from ${messages.id} and ${conversations.dispatchClaimedAt} > ${key.claimExpiredBefore})`,
          ),
        )
        .limit(1),
    ),
});

/**
 * Whether a row of the account's conversation stands under the client id:
 * the line a send repeated after a lost answer already wrote, read before
 * anything is sent again. A line whose hand-over is still under way is not
 * one yet (`dispatch-claim.ts`), so a send repeated meanwhile goes on to the
 * writer, which waits the hand-over out and reads the key again; one whose
 * claim expired with its holder is, since what it handed over is never
 * handed over again.
 */
export function sentLineStands(
  userId: string,
  conversationId: string,
  clientId: string,
): Effect.Effect<boolean, StoreFailure, DatabaseServices> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(
      findSentLine({
        userId,
        conversationId,
        clientId,
        claimExpiredBefore: claimExpiredBefore(now),
      }),
      Option.isSome,
    ),
  );
}

/** A turn row is mutable, so its order is the latest instant any of its stamps was set. */
const TURN_CHANGED_AT = sql`
  greatest(
    ${turns.queuedAt},
    coalesce(${turns.startedAt}, ${turns.queuedAt}),
    coalesce(${turns.settledAt}, ${turns.queuedAt}),
    coalesce(${turns.cancelRequestedAt}, ${turns.queuedAt})
  )
`;

/** The columns a turn read selects, in the fields `TurnRowSchema` names. */
const TURN_FIELDS = {
  id: turns.id,
  userId: turns.userId,
  conversationId: turns.conversationId,
  origin: turns.origin,
  status: turns.status,
  runtimeTurnId: turns.runtimeTurnId,
  model: turns.model,
  reasoningEffort: turns.reasoningEffort,
  promptHash: turns.promptHash,
  toolSetHash: turns.toolSetHash,
  responseIds: turns.responseIds,
  usage: turns.usage,
  queuedAt: turns.queuedAt,
  startedAt: turns.startedAt,
  settledAt: turns.settledAt,
  failure: turns.failure,
  cancelRequestedAt: turns.cancelRequestedAt,
  fastRefused: turns.fastRefused,
};

const TurnRowSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  conversationId: Schema.String,
  origin: TurnOriginSchema,
  status: TurnStatusSchema,
  /** The runtime's own id for the turn: a native turn's own id, or the retired runtime's `turn_<n>` within its session; the opener's inbox row and a row from before the column names none. */
  runtimeTurnId: Schema.NullOr(Schema.String),
  model: Schema.NullOr(Schema.String),
  reasoningEffort: Schema.NullOr(Schema.String),
  promptHash: Schema.NullOr(Schema.String),
  toolSetHash: Schema.NullOr(Schema.String),
  responseIds: Schema.NullOr(Schema.Array(Schema.String)),
  usage: Schema.NullOr(WireValueSchema),
  queuedAt: InstantColumnSchema,
  startedAt: Schema.NullOr(InstantColumnSchema),
  settledAt: Schema.NullOr(InstantColumnSchema),
  failure: Schema.NullOr(Schema.String),
  cancelRequestedAt: Schema.NullOr(InstantColumnSchema),
  /** Whether a step of the turn ran at standard speed because Anthropic refused it Fast. */
  fastRefused: Schema.Boolean,
});

export type StoredTurnRecord = typeof TurnRowSchema.Type;

const TurnRowsSchema = Schema.Array(TurnRowSchema);

/** The turn rows the ids name, whichever standing conversations they ran over, in the order they last changed. */
export function turnsNamed(
  userId: string,
  turnIds: readonly string[],
): Effect.Effect<readonly StoredTurnRecord[], StoreFailure, DatabaseServices> {
  if (turnIds.length === 0) return Effect.succeed([]);
  return Effect.flatMap(
    Database.use((db) =>
      db
        .select(TURN_FIELDS)
        .from(turns)
        .innerJoin(conversations, TURN_CONVERSATION_STANDS)
        .where(and(eq(turns.userId, userId), inArray(turns.id, [...turnIds])))
        .orderBy(asc(TURN_CHANGED_AT), asc(turns.id)),
    ),
    (rows) => Schema.decodeUnknownEffect(TurnRowsSchema)(rows),
  );
}

const findTurnQueuedAt = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    conversationId: Schema.String,
    turnId: Schema.String,
  }),
  Result: Schema.Struct({ queuedAt: InstantColumnSchema }),
  execute: ({ userId, conversationId, turnId }) =>
    Database.use((db) =>
      db
        .select({ queuedAt: turns.queuedAt })
        .from(turns)
        .where(
          and(
            eq(turns.userId, userId),
            eq(turns.conversationId, conversationId),
            eq(turns.id, turnId),
          ),
        ),
    ),
});

const findTurnsBefore = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    conversationId: Schema.String,
    limit: Schema.Number,
    before: Schema.optionalKey(Schema.Struct({ queuedAt: Schema.Date, id: Schema.String })),
  }),
  Result: TurnRowSchema,
  execute: ({ userId, conversationId, limit, before }) =>
    Database.use((db) =>
      db
        .select(TURN_FIELDS)
        .from(turns)
        .innerJoin(conversations, TURN_CONVERSATION_STANDS)
        .where(
          and(
            eq(turns.userId, userId),
            eq(turns.conversationId, conversationId),
            before === undefined
              ? undefined
              : or(
                  lt(turns.queuedAt, before.queuedAt),
                  and(eq(turns.queuedAt, before.queuedAt), lt(turns.id, before.id)),
                ),
          ),
        )
        .orderBy(desc(turns.queuedAt), desc(turns.id))
        .limit(limit),
    ),
});

/** A page of a conversation's turns, oldest first, and whether older ones stand. */
export interface TurnPage {
  readonly turns: readonly StoredTurnRecord[];
  readonly earlier: boolean;
}

/**
 * The newest turns of the account's standing conversation queued before the
 * turn `before` names, or the newest of all with none, answered oldest
 * first by when each was queued. A turn the conversation does not hold
 * names no place, and answers an empty page.
 */
export function turnsBefore(
  userId: string,
  conversationId: string,
  limit: number,
  before: string | undefined,
): Effect.Effect<TurnPage, StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    let place: { queuedAt: Date; id: string } | undefined;
    if (before !== undefined) {
      const named = yield* findTurnQueuedAt({ userId, conversationId, turnId: before });
      if (Option.isNone(named)) return { turns: [], earlier: false };
      place = { queuedAt: named.value.queuedAt, id: before };
    }
    const size = pageLimit({ limit });
    // One more than the page is asked for, so the read can tell whether older turns stand.
    const newestFirst = yield* findTurnsBefore({
      userId,
      conversationId,
      limit: size + 1,
      ...(place === undefined ? undefined : { before: place }),
    });
    return { turns: newestFirst.slice(0, size).reverse(), earlier: newestFirst.length > size };
  });
}
