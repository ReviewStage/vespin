import { isWireUuid } from "@repo/features";
import { AGENT_KIND } from "@repo/features/agent-wire";
import { MEMORY_BOUNDS } from "@repo/features/memory-wire";
import { and, count, desc, eq, inArray, isNotNull, isNull, or, type SQL, sql } from "drizzle-orm";
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
 *
 * Every read and write takes a scope (`MemoryScope`): the workspace's own
 * memories, which every agent recalls; one Manager's own, kept for it
 * alone; or both, which is what that Manager recalls. A memory outside the
 * scope reads as one that names nothing, so a workspace read never answers
 * a Manager's memory and one Manager never reads another's. A keep lands in
 * the one scope it names and dedupes and corrects only within it, and one
 * into a Manager's scope that names no Manager of the workspace writes
 * nothing. The bound still counts every memory of the workspace, whoever
 * may recall it. Every caller from before Managers kept their own reads and
 * writes the workspace's alone, the scope each takes unless handed one.
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

/** Which of a workspace's memories a read or a write reaches. */
export const MEMORY_SCOPE = {
  /** The workspace's own memories, which every agent recalls, and none kept for a Manager alone. */
  WORKSPACE: "workspace",
  /** One Manager's own memories alone. */
  MANAGER: "manager",
  /** The workspace's own memories and one Manager's own: what that Manager recalls. */
  WORKSPACE_AND_MANAGER: "workspace_and_manager",
} as const;

/** Which of a workspace's memories a read or a write reaches, with the Manager where it names one. */
export type MemoryScope =
  | { readonly kind: typeof MEMORY_SCOPE.WORKSPACE }
  | {
      readonly kind: typeof MEMORY_SCOPE.MANAGER | typeof MEMORY_SCOPE.WORKSPACE_AND_MANAGER;
      readonly managerId: string;
    };

/** Where a keep lands: the workspace's own memories, or one Manager's own. */
export type MemoryKeepScope = Exclude<
  MemoryScope,
  { readonly kind: typeof MEMORY_SCOPE.WORKSPACE_AND_MANAGER }
>;

/** The workspace's own memories alone: the scope of every caller that names none. */
export const WORKSPACE_MEMORIES = {
  kind: MEMORY_SCOPE.WORKSPACE,
} as const satisfies MemoryKeepScope;

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

/** One memory as the store holds it: its words, the member whose words they are, null once that account is gone, the agent and line they came from, null for a member's own keep, and the Manager it is kept for alone, null for the workspace's own. */
export interface StoredMemory {
  readonly id: string;
  readonly userId: string | null;
  readonly agentId: string | null;
  readonly messageId: string | null;
  readonly managerId: string | null;
  readonly text: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export type MemoryOutcome =
  | { readonly kind: MemoryWritten; readonly memory: StoredMemory }
  | { readonly kind: typeof MEMORY_OUTCOME.NOT_FOUND | typeof MEMORY_OUTCOME.FULL };

/** Where a memory's words came from as one reader may see it: the agent, the line that opened its turn, and the task the agent works on, or the Manager, which works on none, by its name. */
export type MemorySourceRead = MemorySource &
  (
    | { readonly taskId: string; readonly taskName: string }
    | { readonly taskId: null; readonly managerName: string }
  );

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
  managerId: Schema.NullOr(Schema.String),
  text: Schema.String,
  createdAt: InstantColumnSchema,
  updatedAt: InstantColumnSchema,
});

const ROW_COLUMNS = {
  id: memory.id,
  userId: memory.userId,
  agentId: memory.agentId,
  messageId: memory.messageId,
  managerId: memory.managerId,
  text: memory.text,
  createdAt: memory.createdAt,
  updatedAt: memory.updatedAt,
};

/** A scope as a request carries it: the Manager it names, if any, and whether the workspace's own memories are in it. */
const ScopeSchema = Schema.Struct({
  managerId: Schema.NullOr(Schema.String),
  workspace: Schema.Boolean,
});

const MemoryKeySchema = Schema.Struct({
  organizationId: Schema.String,
  id: Schema.String,
  scope: ScopeSchema,
});

/** Who wrote a memory's words: the member, and the agent and line they came from, each null where none did. */
const MemoryWriterFields = {
  userId: Schema.NullOr(Schema.String),
  agentId: Schema.NullOr(Schema.String),
  messageId: Schema.NullOr(Schema.String),
};

/** The memories a scope reaches: the workspace's own where it holds them, and the Manager's own where it names one. */
function inScope(scope: typeof ScopeSchema.Type): SQL | undefined {
  const own = scope.managerId === null ? undefined : eq(memory.managerId, scope.managerId);

  return scope.workspace ? or(isNull(memory.managerId), own) : own;
}

/** Every memory of the workspace in the scope, most recently kept or corrected first: what a keep dedupes against under its lock, and what a read answers. */
const findMemories = SqlSchema.findAll({
  Request: Schema.Struct({ organizationId: Schema.String, scope: ScopeSchema }),
  Result: MemoryRowSchema,
  execute: (key) =>
    Database.use((db) =>
      db
        .select(ROW_COLUMNS)
        .from(memory)
        .where(and(eq(memory.organizationId, key.organizationId), inScope(key.scope)))
        .orderBy(desc(memory.updatedAt), desc(memory.createdAt)),
    ),
});

/** How many memories the workspace holds, whoever may recall them: what its bound counts. */
const countMemories = SqlSchema.findAll({
  Request: Schema.String,
  Result: Schema.Struct({ count: Schema.Number }),
  execute: (organizationId) =>
    Database.use((db) =>
      db.select({ count: count() }).from(memory).where(eq(memory.organizationId, organizationId)),
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
        .where(
          and(
            eq(memory.organizationId, key.organizationId),
            eq(memory.id, key.id),
            inScope(key.scope),
          ),
        ),
    ),
});

/** The Manager named, where it is one of the workspace's; nothing for any other agent or an id that names none. */
const findManager = SqlSchema.findOneOption({
  Request: Schema.Struct({ organizationId: Schema.String, managerId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: (key) =>
    Database.use((db) =>
      db
        .select({ id: agentTable.id })
        .from(agentTable)
        .where(
          and(
            eq(agentTable.id, key.managerId),
            eq(agentTable.organizationId, key.organizationId),
            eq(agentTable.kind, AGENT_KIND.MANAGER),
          ),
        ),
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
    managerId: Schema.NullOr(Schema.String),
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
          managerId: write.managerId,
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
        .where(
          and(
            eq(memory.organizationId, write.organizationId),
            eq(memory.id, write.id),
            inScope(write.scope),
          ),
        )
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
        .where(
          and(
            eq(memory.organizationId, key.organizationId),
            eq(memory.id, key.id),
            inScope(key.scope),
          ),
        )
        .returning(TXID_RETURNING),
    ),
});

/** A memory's source as its statement reads it: the agent, its line, its task where it stands on one, and its name. */
const MemorySourceRowSchema = Schema.Struct({
  id: Schema.String,
  agentId: Schema.String,
  messageId: Schema.NullOr(Schema.String),
  taskId: Schema.NullOr(Schema.String),
  taskName: Schema.NullOr(Schema.String),
  agentName: Schema.String,
});

/** Where each of the memories named came from, as the reader may see it: only an agent the reader may open, with its task, or a Manager, which works on none, with its name. */
const findMemorySources = SqlSchema.findAll({
  Request: Schema.Struct({
    readerId: Schema.String,
    organizationId: Schema.String,
    ids: Schema.Array(Schema.String),
  }),
  Result: MemorySourceRowSchema,
  execute: (key) =>
    Database.use((db) =>
      db
        .select({
          id: memory.id,
          agentId: agentTable.id,
          messageId: memory.messageId,
          taskId: task.id,
          taskName: task.name,
          // Note that a Manager is named at its start, so its model stands in only for a row that somehow holds no title.
          agentName: sql<string>`coalesce(${agentTable.title}, ${agentTable.model})`,
        })
        .from(memory)
        .innerJoin(agentTable, eq(agentTable.id, memory.agentId))
        .leftJoin(task, eq(task.id, agentTable.taskId))
        .where(
          and(
            eq(memory.organizationId, key.organizationId),
            inArray(memory.id, [...key.ids]),
            agentVisibleTo(key.readerId),
            or(isNotNull(task.id), eq(agentTable.kind, AGENT_KIND.MANAGER)),
          ),
        ),
    ),
});

/** A source row as the reader is told it: the agent's task, or the Manager standing on none. */
function sourceReadOf(row: typeof MemorySourceRowSchema.Type): MemorySourceRead {
  const { agentId, messageId } = row;

  return row.taskId === null || row.taskName === null
    ? { agentId, messageId, taskId: null, managerName: row.agentName }
    : { agentId, messageId, taskId: row.taskId, taskName: row.taskName };
}

/** A row as the store answers it. */
function storedOf(row: typeof MemoryRowSchema.Type): StoredMemory {
  return {
    id: row.id,
    userId: row.userId,
    agentId: row.agentId,
    messageId: row.messageId,
    managerId: row.managerId,
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

/** A scope as a request carries it. */
function scopeKey(scope: MemoryScope): typeof ScopeSchema.Type {
  switch (scope.kind) {
    case MEMORY_SCOPE.WORKSPACE:
      return { managerId: null, workspace: true };
    case MEMORY_SCOPE.MANAGER:
      return { managerId: scope.managerId, workspace: false };
    case MEMORY_SCOPE.WORKSPACE_AND_MANAGER:
      return { managerId: scope.managerId, workspace: true };
  }
}

/** The workspace's memories in the scope, most recently kept or corrected first; the workspace's own alone unless handed another. */
export function listMemories(
  organizationId: string,
  scope: MemoryScope = WORKSPACE_MEMORIES,
): MemoryStoreEffect<readonly StoredMemory[]> {
  return Effect.map(findMemories({ organizationId, scope: scopeKey(scope) }), (rows) =>
    rows.map(storedOf),
  );
}

/**
 * Keeps one memory in the workspace as the member's words, or corrects the
 * one `replaces` names, and answers what that came to. The words are taken
 * as handed: the caller holds them to the bound and to what may be kept at
 * all. A new memory past the bound, or a correction of a memory the
 * workspace does not hold, writes nothing. `source` is the coding agent
 * keeping them and the line that opened its turn; a member's own keep hands
 * none. `scope` is where the memory lands, the workspace's own unless
 * handed a Manager's: the same words and the memory `replaces` names are
 * looked for there alone, and a Manager's scope naming no Manager of the
 * workspace writes nothing.
 */
export function rememberMemory(
  organizationId: string,
  userId: string,
  text: string,
  replaces: string | undefined,
  source?: MemorySource,
  scope: MemoryKeepScope = WORKSPACE_MEMORIES,
): MemoryStoreEffect<MemoryOutcome> {
  const writer = {
    userId,
    agentId: source?.agentId ?? null,
    messageId: source?.messageId ?? null,
  };

  const key = scopeKey(scope);

  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const workspace = yield* lockWorkspace(organizationId);

        if (Option.isNone(workspace)) return { kind: MEMORY_OUTCOME.NOT_FOUND } as const;

        if (key.managerId !== null) {
          const manager = yield* findManager({ organizationId, managerId: key.managerId });

          if (Option.isNone(manager)) return { kind: MEMORY_OUTCOME.NOT_FOUND } as const;
        }

        const every = (yield* findMemories({ organizationId, scope: key })).map(storedOf);
        const now = yield* DateTime.nowAsDate;
        const same = every.find((kept) => sameWords(kept.text) === sameWords(text));

        if (replaces !== undefined) {
          const target = every.find((kept) => kept.id === replaces.toLowerCase());

          if (target === undefined) return { kind: MEMORY_OUTCOME.NOT_FOUND } as const;

          // Note that a correction to words another memory already holds folds the two, because keeping both would hold one fact twice.
          if (same !== undefined && same.id !== target.id) {
            yield* deleteMemory({ organizationId, id: target.id, scope: key });
          }

          const id = same?.id ?? target.id;

          const kept = yield* updateMemory({
            organizationId,
            id,
            scope: key,
            ...writer,
            text,
            now,
          });

          return outcomeOf(MEMORY_OUTCOME.CORRECTED, kept);
        }

        if (same !== undefined) {
          // Note that the same words kept again stay the words of whoever kept them first, from where they first came.
          const kept = yield* updateMemory({
            organizationId,
            id: same.id,
            scope: key,
            userId: same.userId,
            agentId: same.agentId,
            messageId: same.messageId,
            text,
            now,
          });

          return outcomeOf(MEMORY_OUTCOME.ALREADY_KEPT, kept);
        }

        const [held] = yield* countMemories(organizationId);

        if ((held?.count ?? 0) >= MEMORY_BOUNDS.MAX_MEMORIES) {
          return { kind: MEMORY_OUTCOME.FULL } as const;
        }

        const kept = yield* insertMemory({
          organizationId,
          ...writer,
          managerId: key.managerId,
          text,
          now,
        });

        return outcomeOf(MEMORY_OUTCOME.KEPT, kept);
      }),
    ),
  );
}

/**
 * Where each of the workspace's memories named came from, by its id, as the
 * reader may see it: the agent that kept or last corrected it, the line
 * that opened its turn, and the agent's task, or, for a Manager, which works
 * on none, its name. A memory a member kept, one
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
    (rows) => new Map(rows.map((row) => [row.id, sourceReadOf(row)])),
  );
}

/**
 * Forgets one of the workspace's memories for good, where the forgetter may:
 * its words are theirs, or they manage the workspace, the only ones who may
 * forget a memory whose member's account is gone. An id that names none of
 * the workspace's memories in the scope, the workspace's own unless handed
 * another, forgets nothing and answers forgotten with no transaction, as
 * another workspace's does, so a forget retried after it landed answers the
 * same. One that deleted the row answers the transaction it was deleted in
 * beside it.
 */
export function forgetMemory(
  organizationId: string,
  id: string,
  by: MemoryForgetter,
  scope: MemoryScope = WORKSPACE_MEMORIES,
): MemoryStoreEffect<MemoryForgot> {
  const key = scopeKey(scope);

  return Effect.gen(function* () {
    // Note that an id that is no UUID is never bound, because Postgres refuses any other text against a `uuid` column.
    if (!isWireUuid(id)) return { outcome: MEMORY_FORGET.FORGOTTEN };
    const found = yield* findMemory({ organizationId, id, scope: key });

    if (Option.isNone(found)) return { outcome: MEMORY_FORGET.FORGOTTEN };

    if (found.value.userId !== by.userId && !by.manages) {
      return { outcome: MEMORY_FORGET.NOT_PERMITTED };
    }

    const [deleted] = yield* deleteMemory({ organizationId, id, scope: key });

    return deleted === undefined
      ? { outcome: MEMORY_FORGET.FORGOTTEN }
      : { outcome: MEMORY_FORGET.FORGOTTEN, txid: deleted.txid };
  });
}
