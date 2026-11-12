import { isWireUuid } from "@repo/features";
import { MEMORY_BOUNDS } from "@repo/features/memory-wire";
import { and, desc, eq, inArray } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { TXID_RETURNING, TxidRowSchema } from "../core/txid.js";
import { agentTable } from "../schemas/agent.js";
import { organization } from "../schemas/auth.js";
import { memory } from "../schemas/memory.js";
import { task } from "../schemas/task.js";
import { InstantColumnSchema } from "./columns.js";
import { agentVisibleTo } from "./workspace-store.js";

/**
 * memory-store.ts -- a workspace's memories, shared by its members, kept and corrected by its coding agents and read and forgotten from Settings.
 *
 * Every function is an effect over the ambient `SqlClient`, keyed by the
 * workspace, so no workspace reads, corrects, or forgets another's memory:
 * an id of another workspace's reads exactly as an id that names nothing.
 * Whether the caller is a member is the caller's to settle before it calls.
 * A keep or a correction runs under a lock on the workspace's own row, so
 * two at once — a retried call, or two members' calls — are serialized: the
 * same words kept twice stand once, the bound is counted once, and of two
 * corrections of one memory the later wins whole. A correction rewrites the
 * memory in place under its id and makes its words the corrector's, so the
 * workspace never holds the old words beside the new; where the new words
 * are already another memory's, the two become that one. Forgetting deletes
 * the row, and only for the member whose words it holds or one who manages
 * the workspace. A memory outlives the account whose words it holds, as a
 * workspace's git history outlives its committers: its member is then null.
 * Where the words came from moves with them: a keep or a correction by a
 * coding agent names the agent and the line that opened its turn
 * (`MemorySource`), and one by a member names none, while the same words
 * kept again stay where they first came from, as they stay the first
 * keeper's.
 * The workspace's bound counts every memory, so a recall's read of one
 * workspace's rows stays bounded, and so does the live read Settings holds
 * (`packages/service/src/live/reads/workspace-memories.ts`), which answers every one of them.
 */

/** What a memory store operation answers: an effect over the ambient client. */
export type MemoryStoreEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

/** What a keep or a correction came to. */
export const MEMORY_OUTCOME = {
  /** A new memory was kept. */
  KEPT: "kept",
  /** The same words already stood as a memory; it was touched, and nothing new was kept. */
  ALREADY_KEPT: "already_kept",
  /** The memory named was rewritten in place, or folded into one already holding the new words. */
  CORRECTED: "corrected",
  /** The memory named for correction is not the workspace's, or was forgotten; nothing was written. */
  NOT_FOUND: "not_found",
  /** The workspace holds as many memories as it may; nothing was written. */
  FULL: "full",
} as const;

/** What a forget came to. */
export const MEMORY_FORGET = {
  /** The memory is gone: forgotten now, or already gone before. */
  FORGOTTEN: "forgotten",
  /** The memory stands and the caller may not forget it; nothing was deleted. */
  NOT_PERMITTED: "not_permitted",
} as const;

type MemoryForget = (typeof MEMORY_FORGET)[keyof typeof MEMORY_FORGET];

/** What a forget came to, and the transaction its delete committed in where it deleted a row; none where nothing was deleted. */
export interface MemoryForgot {
  readonly outcome: MemoryForget;
  readonly txid?: string;
}

type MemoryWritten =
  | typeof MEMORY_OUTCOME.KEPT
  | typeof MEMORY_OUTCOME.ALREADY_KEPT
  | typeof MEMORY_OUTCOME.CORRECTED;

/** Where a memory's words came from: the coding agent that kept them, and the line that opened its turn then, none for a turn no line opened. */
export interface MemorySource {
  readonly agentId: string;
  readonly messageId: string | null;
}

/** One memory as the store holds it: its words, the member whose words they are, null once that account is gone, and the agent and line they came from, null for a member's own keep. */
export interface StoredMemory {
  readonly id: string;
  readonly userId: string | null;
  readonly agentId: string | null;
  readonly messageId: string | null;
  readonly text: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export type MemoryOutcome =
  | { readonly kind: MemoryWritten; readonly memory: StoredMemory }
  | { readonly kind: typeof MEMORY_OUTCOME.NOT_FOUND | typeof MEMORY_OUTCOME.FULL };

/** Where a memory's words came from as one reader may see it: the agent, the line that opened its turn, and the task the agent works on. */
export interface MemorySourceRead extends MemorySource {
  readonly taskId: string;
  readonly taskName: string;
}

/** Who asks to forget: the member, and whether they own or administer the workspace. */
export interface MemoryForgetter {
  readonly userId: string;
  readonly manages: boolean;
}

const MemoryRowSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.NullOr(Schema.String),
  agentId: Schema.NullOr(Schema.String),
  messageId: Schema.NullOr(Schema.String),
  text: Schema.String,
  createdAt: InstantColumnSchema,
  updatedAt: InstantColumnSchema,
});

const ROW_COLUMNS = {
  id: memory.id,
  userId: memory.userId,
  agentId: memory.agentId,
  messageId: memory.messageId,
  text: memory.text,
  createdAt: memory.createdAt,
  updatedAt: memory.updatedAt,
};

const MemoryKeySchema = Schema.Struct({ organizationId: Schema.String, id: Schema.String });

/** Who wrote a memory's words: the member, and the agent and line they came from, each null where none did. */
const MemoryWriterFields = {
  userId: Schema.NullOr(Schema.String),
  agentId: Schema.NullOr(Schema.String),
  messageId: Schema.NullOr(Schema.String),
};

/** Every memory of the workspace, most recently kept or corrected first: what a keep counts and dedupes against under its lock, and what a read answers. */
const findMemories = SqlSchema.findAll({
  Request: Schema.String,
  Result: MemoryRowSchema,
  execute: (organizationId) =>
    Database.use((db) =>
      db
        .select(ROW_COLUMNS)
        .from(memory)
        .where(eq(memory.organizationId, organizationId))
        .orderBy(desc(memory.updatedAt), desc(memory.createdAt)),
    ),
});

const findMemory = SqlSchema.findOneOption({
  Request: MemoryKeySchema,
  Result: MemoryRowSchema,
  execute: (key) =>
    Database.use((db) =>
      db
        .select(ROW_COLUMNS)
        .from(memory)
        .where(and(eq(memory.organizationId, key.organizationId), eq(memory.id, key.id))),
    ),
});

/** The workspace's row, held for the transaction, which is what serializes one workspace's keeps; nothing for a workspace gone. */
const lockWorkspace = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({ id: Schema.String }),
  execute: (organizationId) =>
    Database.use((db) =>
      db
        .select({ id: organization.id })
        .from(organization)
        .where(eq(organization.id, organizationId))
        .for("update"),
    ),
});

const insertMemory = SqlSchema.findOneOption({
  Request: Schema.Struct({
    organizationId: Schema.String,
    ...MemoryWriterFields,
    text: Schema.String,
    now: Schema.Date,
  }),
  Result: MemoryRowSchema,
  execute: (write) =>
    Database.use((db) =>
      db
        .insert(memory)
        .values({
          organizationId: write.organizationId,
          userId: write.userId,
          agentId: write.agentId,
          messageId: write.messageId,
          text: write.text,
          createdAt: write.now,
          updatedAt: write.now,
        })
        .returning(ROW_COLUMNS),
    ),
});

/** A memory's words written again, as the member they now belong to and from where they now came. */
const updateMemory = SqlSchema.findOneOption({
  Request: Schema.Struct({
    ...MemoryKeySchema.fields,
    ...MemoryWriterFields,
    text: Schema.String,
    now: Schema.Date,
  }),
  Result: MemoryRowSchema,
  execute: (write) =>
    Database.use((db) =>
      db
        .update(memory)
        .set({
          text: write.text,
          userId: write.userId,
          agentId: write.agentId,
          messageId: write.messageId,
          updatedAt: write.now,
        })
        .where(and(eq(memory.organizationId, write.organizationId), eq(memory.id, write.id)))
        .returning(ROW_COLUMNS),
    ),
});

/** A memory deleted, answering the transaction it was deleted in; none where no row was. */
const deleteMemory = SqlSchema.findAll({
  Request: MemoryKeySchema,
  Result: TxidRowSchema,
  execute: (key) =>
    Database.use((db) =>
      db
        .delete(memory)
        .where(and(eq(memory.organizationId, key.organizationId), eq(memory.id, key.id)))
        .returning(TXID_RETURNING),
    ),
});

/** Where each of the memories named came from, as the reader may see it: only an agent the reader may open, with its task. */
const findMemorySources = SqlSchema.findAll({
  Request: Schema.Struct({
    readerId: Schema.String,
    organizationId: Schema.String,
    ids: Schema.Array(Schema.String),
  }),
  Result: Schema.Struct({
    id: Schema.String,
    agentId: Schema.String,
    messageId: Schema.NullOr(Schema.String),
    taskId: Schema.String,
    taskName: Schema.String,
  }),
  execute: (key) =>
    Database.use((db) =>
      db
        .select({
          id: memory.id,
          agentId: agentTable.id,
          messageId: memory.messageId,
          taskId: task.id,
          taskName: task.name,
        })
        .from(memory)
        .innerJoin(agentTable, eq(agentTable.id, memory.agentId))
        .innerJoin(task, eq(task.id, agentTable.taskId))
        .where(
          and(
            eq(memory.organizationId, key.organizationId),
            inArray(memory.id, [...key.ids]),
            agentVisibleTo(key.readerId),
          ),
        ),
    ),
});

/** A row as the store answers it. */
function storedOf(row: typeof MemoryRowSchema.Type): StoredMemory {
  return {
    id: row.id,
    userId: row.userId,
    agentId: row.agentId,
    messageId: row.messageId,
    text: row.text,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

/** What a write came to, by the row it answered; a row the lock should have held but that is gone reads as not found. */
function outcomeOf(
  kind: MemoryWritten,
  row: Option.Option<typeof MemoryRowSchema.Type>,
): MemoryOutcome {
  return Option.match(row, {
    onNone: () => ({ kind: MEMORY_OUTCOME.NOT_FOUND }),
    onSome: (kept) => ({ kind, memory: storedOf(kept) }),
  });
}

/** Words as two memories are compared: case, spacing, and a closing stop do not tell them apart. */
function sameWords(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[.!]+$/u, "");
}

/** The workspace's memories, most recently kept or corrected first. */
export function listMemories(organizationId: string): MemoryStoreEffect<readonly StoredMemory[]> {
  return Effect.map(findMemories(organizationId), (rows) => rows.map(storedOf));
}

/**
 * Keeps one memory in the workspace as the member's words, or corrects the
 * one `replaces` names, and answers what that came to. The words are taken
 * as handed: the caller holds them to the bound and to what may be kept at
 * all. A new memory past the bound, or a correction of a memory the
 * workspace does not hold, writes nothing. `source` is the coding agent
 * keeping them and the line that opened its turn; a member's own keep hands
 * none.
 */
export function rememberMemory(
  organizationId: string,
  userId: string,
  text: string,
  replaces: string | undefined,
  source?: MemorySource,
): MemoryStoreEffect<MemoryOutcome> {
  const writer = {
    userId,
    agentId: source?.agentId ?? null,
    messageId: source?.messageId ?? null,
  };

  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const workspace = yield* lockWorkspace(organizationId);

        if (Option.isNone(workspace)) return { kind: MEMORY_OUTCOME.NOT_FOUND } as const;
        const every = (yield* findMemories(organizationId)).map(storedOf);
        const now = yield* DateTime.nowAsDate;
        const same = every.find((kept) => sameWords(kept.text) === sameWords(text));

        if (replaces !== undefined) {
          const target = every.find((kept) => kept.id === replaces.toLowerCase());

          if (target === undefined) return { kind: MEMORY_OUTCOME.NOT_FOUND } as const;

          // Note that a correction to words another memory already holds folds the two, because keeping both would hold one fact twice.
          if (same !== undefined && same.id !== target.id) {
            yield* deleteMemory({ organizationId, id: target.id });
          }

          const id = same?.id ?? target.id;
          const kept = yield* updateMemory({ organizationId, id, ...writer, text, now });

          return outcomeOf(MEMORY_OUTCOME.CORRECTED, kept);
        }

        if (same !== undefined) {
          // Note that the same words kept again stay the words of whoever kept them first, from where they first came.
          const kept = yield* updateMemory({
            organizationId,
            id: same.id,
            userId: same.userId,
            agentId: same.agentId,
            messageId: same.messageId,
            text,
            now,
          });

          return outcomeOf(MEMORY_OUTCOME.ALREADY_KEPT, kept);
        }

        if (every.length >= MEMORY_BOUNDS.MAX_MEMORIES) {
          return { kind: MEMORY_OUTCOME.FULL } as const;
        }

        const kept = yield* insertMemory({ organizationId, ...writer, text, now });

        return outcomeOf(MEMORY_OUTCOME.KEPT, kept);
      }),
    ),
  );
}

/**
 * Where each of the workspace's memories named came from, by its id, as the
 * reader may see it: the agent that kept or last corrected it, the line
 * that opened its turn, and the agent's task. A memory a member kept, one
 * whose agent is gone, and one whose agent or task the reader may not open
 * (`agentVisibleTo`) has none, so no reader learns of a task it cannot see.
 */
export function readMemorySources(
  readerId: string,
  organizationId: string,
  ids: readonly string[],
): MemoryStoreEffect<ReadonlyMap<string, MemorySourceRead>> {
  if (ids.length === 0) return Effect.succeed(new Map());

  return Effect.map(
    findMemorySources({ readerId, organizationId, ids }),
    (rows) => new Map(rows.map(({ id, ...source }) => [id, source])),
  );
}

/**
 * Forgets one of the workspace's memories for good, where the forgetter may:
 * its words are theirs, or they manage the workspace, the only ones who may
 * forget a memory whose member's account is gone. An id that names none of
 * the workspace's memories, another workspace's included, forgets nothing
 * and answers forgotten with no transaction, so a forget retried after it
 * landed answers the same. One that deleted the row answers the transaction
 * it was deleted in beside it.
 */
export function forgetMemory(
  organizationId: string,
  id: string,
  by: MemoryForgetter,
): MemoryStoreEffect<MemoryForgot> {
  return Effect.gen(function* () {
    // Note that an id that is no UUID is never bound, because Postgres refuses any other text against a `uuid` column.
    if (!isWireUuid(id)) return { outcome: MEMORY_FORGET.FORGOTTEN };
    const found = yield* findMemory({ organizationId, id });

    if (Option.isNone(found)) return { outcome: MEMORY_FORGET.FORGOTTEN };

    if (found.value.userId !== by.userId && !by.manages) {
      return { outcome: MEMORY_FORGET.NOT_PERMITTED };
    }

    const [deleted] = yield* deleteMemory({ organizationId, id });

    return deleted === undefined
      ? { outcome: MEMORY_FORGET.FORGOTTEN }
      : { outcome: MEMORY_FORGET.FORGOTTEN, txid: deleted.txid };
  });
}
