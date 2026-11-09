/**
 * claude-session-entries.ts -- an agent's CLI transcript as Anthropic's reference Postgres `SessionStore` keeps it: appended, loaded, listed, and deleted under the agent's conversation.
 *
 * The five methods and their SQL are the example's
 * (`claude-agent-sdk-typescript`'s `examples/session-stores/postgres`), each
 * narrowed to one conversation of the account given, so no account reads or
 * writes another's transcript (`../schemas/claude-session-entry.ts`). A key
 * is the SDK's `SessionKey`: a project, a session, and a subpath, absent for
 * the main transcript. Beside them, a Start copies its source's rows to the
 * conversation it starts, so a continued or forked agent forks the source's
 * transcript as its own.
 *
 * A session is held from its first entry where the store holds the entry
 * that opens it (`opensTranscript`), which an append marks as it inserts it.
 * The Agent SDK resumes from the store whenever it holds any entry of the
 * session, and from the store's entries alone, so a session the store holds
 * only a tail of, as one the CLI began before the store kept transcripts, is
 * never resumed (`../../../service/src/agents/coder-host/runner-sessions.ts`).
 * Nor is a session the SDK dropped a batch of (`markSessionBroken`), whose
 * entries hold a gap however they begin.
 */

import { and, asc, desc, eq, isNotNull, isNull, max, sql } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { claudeBrokenSessions, claudeSessionEntries } from "../schemas/claude-session-entry.js";
import { conversations } from "../schemas/storage.js";

type EntryEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

/**
 * The most entries one page of a transcript holds, and the most bytes its
 * entries hold together, counted as Postgres writes each entry out, which is
 * never less than the JSON a page is answered as. Note that the bytes are
 * held well under the platform's 4.5 MB bound on a function's response; a
 * page holds its first entry however large, which an append's own bound on
 * its request already keeps under it.
 */
const PAGE_ENTRIES = 1_000;
const PAGE_BYTES = 2 * 1024 * 1024;

/** One transcript line, opaque but for its `type`, as the SDK's `SessionStoreEntry` is. */
const EntrySchema = Schema.Record(Schema.String, Schema.Unknown);
export type SessionEntry = typeof EntrySchema.Type;

/** Where a transcript is kept: the SDK's `SessionKey`, `subpath` absent for the main transcript. */
export interface SessionEntryKey {
  readonly projectKey: string;
  readonly sessionId: string;
  readonly subpath?: string | undefined;
}

/** One page of a transcript: its entries in order, and the cursor the next page is read after, none past its last. */
export interface SessionEntryPage {
  readonly entries: readonly SessionEntry[];
  readonly next: number | null;
}

/** A session of a project and when its main transcript was last appended to, in epoch milliseconds. */
export interface SessionListing {
  readonly sessionId: string;
  readonly mtime: number;
}

const OwnerFields = { userId: Schema.String, conversationId: Schema.String };
const KeyFields = {
  ...OwnerFields,
  projectKey: Schema.String,
  sessionId: Schema.String,
  subpath: Schema.NullOr(Schema.String),
};

/** The account's own conversation, which every read and write of its rows is narrowed to. */
const ownConversation = (userId: string, conversationId: string) =>
  and(eq(conversations.id, conversationId), eq(conversations.userId, userId));

/** The rows of one session's transcript, or of all its transcripts where `subpath` is absent. */
const sessionRows = (conversationId: string, projectKey: string, sessionId: string) =>
  and(
    eq(claudeSessionEntries.conversationId, conversationId),
    eq(claudeSessionEntries.projectKey, projectKey),
    eq(claudeSessionEntries.sessionId, sessionId),
  );

const findConversation = SqlSchema.findOneOption({
  Request: Schema.Struct(OwnerFields),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, conversationId }) =>
    Database.use((db) =>
      db
        .select({ id: conversations.id })
        .from(conversations)
        .where(ownConversation(userId, conversationId))
        .limit(1),
    ),
});

const insertEntries = SqlSchema.void({
  Request: Schema.Struct({ ...KeyFields, entries: Schema.Array(EntrySchema) }),
  execute: ({ conversationId, projectKey, sessionId, subpath, entries }) =>
    Database.use((db) =>
      db.insert(claudeSessionEntries).values(
        entries.map((entry) => ({
          conversationId,
          projectKey,
          sessionId,
          subpath,
          entry,
          opens: opensTranscript(subpath, entry),
        })),
      ),
    ),
});

const findEntries = SqlSchema.findAll({
  Request: Schema.Struct(KeyFields),
  Result: Schema.Struct({ entry: EntrySchema }),
  execute: ({ userId, conversationId, projectKey, sessionId, subpath }) =>
    Database.use((db) =>
      db
        .select({ entry: claudeSessionEntries.entry })
        .from(claudeSessionEntries)
        .innerJoin(conversations, eq(conversations.id, claudeSessionEntries.conversationId))
        .where(
          and(
            ownConversation(userId, conversationId),
            sessionRows(conversationId, projectKey, sessionId),
            // Note that IS NOT DISTINCT FROM matches null to null, so no subpath reads the main transcript.
            sql`${claudeSessionEntries.subpath} is not distinct from ${subpath}`,
          ),
        )
        .orderBy(asc(claudeSessionEntries.id)),
    ),
});

/**
 * One page of a transcript, walked an entry at a time along the key's index
 * from the cursor, each entry measured as Postgres writes it out, until the
 * page's count or bytes are spent. The walk goes on past each entry the page
 * keeps, so it takes one entry past the page,
 * answered as its id alone, so the page's end is told from the transcript's;
 * no entry past that one is read or measured. The page's first entry is kept
 * however large, and the walk only goes on where the account owns the
 * conversation, which its first step checks.
 */
const findPage = SqlSchema.findAll({
  Request: Schema.Struct({ ...KeyFields, after: Schema.NullOr(Schema.Number) }),
  Result: Schema.Struct({
    id: Schema.NumberFromString,
    entry: Schema.NullOr(Schema.fromJsonString(EntrySchema)),
  }),
  execute: ({ userId, conversationId, projectKey, sessionId, subpath, after }) =>
    Effect.flatMap(
      SqlClient.SqlClient,
      (client) => client`
        with recursive walk(id, n, running) as (
          (select stored.id, 1, octet_length(stored.entry::text)::bigint
            from claude_session_entries stored
            join conversations on conversations.id = stored.conversation_id
            where conversations.id = ${conversationId} and conversations.user_id = ${userId}
              and stored.conversation_id = ${conversationId}
              and stored.project_key = ${projectKey} and stored.session_id = ${sessionId}
              and stored.subpath is not distinct from ${subpath}
              and stored.id > ${after ?? 0}
            order by stored.id limit 1)
          union all
          (select step.id, walk.n + 1, walk.running + octet_length(step.entry::text)
            from walk cross join lateral (
              select stored.id, stored.entry from claude_session_entries stored
                where stored.conversation_id = ${conversationId}
                  and stored.project_key = ${projectKey} and stored.session_id = ${sessionId}
                  and stored.subpath is not distinct from ${subpath}
                  and stored.id > walk.id
                order by stored.id limit 1
            ) step
            where walk.n <= ${PAGE_ENTRIES} and (walk.n = 1 or walk.running <= ${PAGE_BYTES}))
        )
        select walk.id::text as id,
          case when walk.n <= ${PAGE_ENTRIES} and (walk.n = 1 or walk.running <= ${PAGE_BYTES})
            then stored.entry::text end as entry
          from walk join claude_session_entries stored on stored.id = walk.id
          order by walk.id`,
    ),
});

const findSessions = SqlSchema.findAll({
  Request: Schema.Struct({ ...OwnerFields, projectKey: Schema.String }),
  Result: Schema.Struct({ sessionId: Schema.String, mtime: Schema.Date }),
  execute: ({ userId, conversationId, projectKey }) =>
    Database.use((db) => {
      const mtime = max(claudeSessionEntries.createdAt);
      return db
        .select({ sessionId: claudeSessionEntries.sessionId, mtime })
        .from(claudeSessionEntries)
        .innerJoin(conversations, eq(conversations.id, claudeSessionEntries.conversationId))
        .where(
          and(
            ownConversation(userId, conversationId),
            eq(claudeSessionEntries.conversationId, conversationId),
            eq(claudeSessionEntries.projectKey, projectKey),
            isNull(claudeSessionEntries.subpath),
          ),
        )
        .groupBy(claudeSessionEntries.sessionId)
        .orderBy(desc(mtime));
    }),
});

const deleteEntries = SqlSchema.void({
  Request: Schema.Struct(KeyFields),
  execute: ({ userId, conversationId, projectKey, sessionId, subpath }) =>
    Database.use((db) =>
      db.delete(claudeSessionEntries).where(
        and(
          sessionRows(conversationId, projectKey, sessionId),
          // Note that a main transcript's delete takes its subpaths with it.
          subpath === null ? undefined : eq(claudeSessionEntries.subpath, subpath),
          sql`exists (select 1 from ${conversations} where ${ownConversation(userId, conversationId)})`,
        ),
      ),
    ),
});

const findSubkeys = SqlSchema.findAll({
  Request: Schema.Struct({ ...OwnerFields, projectKey: Schema.String, sessionId: Schema.String }),
  Result: Schema.Struct({ subpath: Schema.String }),
  execute: ({ userId, conversationId, projectKey, sessionId }) =>
    Database.use((db) =>
      db
        .selectDistinct({ subpath: sql<string>`${claudeSessionEntries.subpath}` })
        .from(claudeSessionEntries)
        .innerJoin(conversations, eq(conversations.id, claudeSessionEntries.conversationId))
        .where(
          and(
            ownConversation(userId, conversationId),
            sessionRows(conversationId, projectKey, sessionId),
            isNotNull(claudeSessionEntries.subpath),
          ),
        ),
    ),
});

const copyEntries = SqlSchema.void({
  Request: Schema.Struct({
    sourceUserId: Schema.String,
    sourceConversationId: Schema.String,
    conversationId: Schema.String,
  }),
  execute: ({ sourceUserId, sourceConversationId, conversationId }) =>
    Database.use((db) =>
      db.insert(claudeSessionEntries).select((qb) =>
        qb
          .select({
            conversationId: sql<string>`${conversationId}::uuid`.as("conversation_id"),
            projectKey: claudeSessionEntries.projectKey,
            sessionId: claudeSessionEntries.sessionId,
            subpath: claudeSessionEntries.subpath,
            entry: claudeSessionEntries.entry,
            opens: claudeSessionEntries.opens,
            createdAt: claudeSessionEntries.createdAt,
          })
          .from(claudeSessionEntries)
          .innerJoin(conversations, eq(conversations.id, claudeSessionEntries.conversationId))
          .where(ownConversation(sourceUserId, sourceConversationId))
          .orderBy(asc(claudeSessionEntries.id)),
      ),
    ),
});

const copyBreaks = SqlSchema.void({
  Request: Schema.Struct({
    sourceUserId: Schema.String,
    sourceConversationId: Schema.String,
    conversationId: Schema.String,
  }),
  execute: ({ sourceUserId, sourceConversationId, conversationId }) =>
    Database.use((db) =>
      db
        .insert(claudeBrokenSessions)
        .select((qb) =>
          qb
            .select({
              conversationId: sql<string>`${conversationId}::uuid`.as("conversation_id"),
              sessionId: claudeBrokenSessions.sessionId,
              createdAt: claudeBrokenSessions.createdAt,
            })
            .from(claudeBrokenSessions)
            .innerJoin(conversations, eq(conversations.id, claudeBrokenSessions.conversationId))
            .where(ownConversation(sourceUserId, sourceConversationId)),
        )
        .onConflictDoNothing(),
    ),
});

const insertBreak = SqlSchema.void({
  Request: Schema.Struct({ conversationId: Schema.String, sessionId: Schema.String }),
  execute: ({ conversationId, sessionId }) =>
    Database.use((db) =>
      db.insert(claudeBrokenSessions).values({ conversationId, sessionId }).onConflictDoNothing(),
    ),
});

const findOpening = SqlSchema.findOneOption({
  Request: Schema.Struct({ ...OwnerFields, sessionId: Schema.String }),
  Result: Schema.Struct({ id: Schema.Number }),
  execute: ({ userId, conversationId, sessionId }) =>
    Database.use((db) =>
      db
        .select({ id: claudeSessionEntries.id })
        .from(claudeSessionEntries)
        .innerJoin(conversations, eq(conversations.id, claudeSessionEntries.conversationId))
        .where(
          and(
            ownConversation(userId, conversationId),
            eq(claudeSessionEntries.conversationId, conversationId),
            eq(claudeSessionEntries.sessionId, sessionId),
            eq(claudeSessionEntries.opens, true),
            // Note that a session the SDK dropped a batch of holds a gap, however it begins.
            sql`not exists (select 1 from ${claudeBrokenSessions} where ${and(
              eq(claudeBrokenSessions.conversationId, conversationId),
              eq(claudeBrokenSessions.sessionId, sessionId),
            )})`,
          ),
        )
        .limit(1),
    ),
});

/**
 * Whether the entry opens its transcript: a Claude Code session's root,
 * the main transcript's user entry with no parent, which every later entry
 * of its chain descends from; or a Codex rollout's first line, its
 * `session_meta`. The migration that added the mark backfilled it by the
 * same predicate. Note that a CLI that stopped writing either marks nothing,
 * so its sessions start afresh rather than resume a transcript we cannot
 * tell is whole.
 */
function opensTranscript(subpath: string | null, entry: SessionEntry): boolean {
  if (entry.type === "session_meta") return true;
  return subpath === null && entry.type === "user" && entry.parentUuid === null;
}

/** A key's fields as the requests take them: no subpath as null. */
function keyFields(userId: string, conversationId: string, key: SessionEntryKey) {
  return {
    userId,
    conversationId,
    projectKey: key.projectKey,
    sessionId: key.sessionId,
    subpath: key.subpath ?? null,
  };
}

/** The entries given appended to the key's transcript in the account's conversation, in their order; nothing where the conversation is not the account's. */
export function appendSessionEntries(
  userId: string,
  conversationId: string,
  key: SessionEntryKey,
  entries: readonly SessionEntry[],
): EntryEffect<void> {
  if (entries.length === 0) return Effect.void;
  return Effect.gen(function* () {
    const own = yield* findConversation({ userId, conversationId });
    if (Option.isNone(own)) return;
    yield* insertEntries({ ...keyFields(userId, conversationId, key), entries });
  });
}

/** The key's transcript in the account's conversation, in the order it was appended; none where it holds no entry. */
export function loadSessionEntries(
  userId: string,
  conversationId: string,
  key: SessionEntryKey,
): EntryEffect<Option.Option<readonly SessionEntry[]>> {
  return findEntries(keyFields(userId, conversationId, key)).pipe(
    Effect.map((rows) =>
      rows.length > 0 ? Option.some(rows.map((row) => row.entry)) : Option.none(),
    ),
  );
}

/**
 * One page of the key's transcript in the account's conversation, from the
 * entry after the cursor given, or from its first where none is: the entries
 * in the order they were appended, held to a page's count and bytes, and the
 * cursor the next page is read after, none where the page holds the last.
 * A page holds at least one entry wherever one stands past the cursor.
 */
export function loadSessionEntryPage(
  userId: string,
  conversationId: string,
  key: SessionEntryKey,
  after: number | null,
): EntryEffect<SessionEntryPage> {
  return findPage({ ...keyFields(userId, conversationId, key), after }).pipe(
    Effect.map((rows) => {
      // Note that only the walk's last row can be past the page, so its entries are the rows that carry one.
      const kept: Array<{ readonly id: number; readonly entry: SessionEntry }> = [];
      for (const { id, entry } of rows) if (entry !== null) kept.push({ id, entry });
      const last = kept.at(-1);
      return {
        entries: kept.map((row) => row.entry),
        next: kept.length < rows.length && last !== undefined ? last.id : null,
      };
    }),
  );
}

/** The project's sessions in the account's conversation, each with when its main transcript was last appended to, the latest first. */
export function listSessionEntrySessions(
  userId: string,
  conversationId: string,
  projectKey: string,
): EntryEffect<readonly SessionListing[]> {
  return findSessions({ userId, conversationId, projectKey }).pipe(
    Effect.map((rows) =>
      rows.map((row) => ({ sessionId: row.sessionId, mtime: row.mtime.getTime() })),
    ),
  );
}

/** The key's transcript deleted from the account's conversation; a main transcript's with every subpath under its session. */
export function deleteSessionEntries(
  userId: string,
  conversationId: string,
  key: SessionEntryKey,
): EntryEffect<void> {
  return deleteEntries(keyFields(userId, conversationId, key));
}

/** The subpaths the session holds a transcript under in the account's conversation. */
export function listSessionEntrySubkeys(
  userId: string,
  conversationId: string,
  key: Pick<SessionEntryKey, "projectKey" | "sessionId">,
): EntryEffect<readonly string[]> {
  return findSubkeys({ userId, conversationId, ...key }).pipe(
    Effect.map((rows) => rows.map((row) => row.subpath)),
  );
}

/**
 * The session given marked broken in the account's conversation: the Agent
 * SDK dropped a batch of its transcript, so the store holds it with a gap
 * and it is never held again; nothing where the conversation is not the
 * account's.
 */
export function markSessionBroken(
  userId: string,
  conversationId: string,
  sessionId: string,
): EntryEffect<void> {
  return Effect.gen(function* () {
    const own = yield* findConversation({ userId, conversationId });
    if (Option.isNone(own)) return;
    yield* insertBreak({ conversationId, sessionId });
  });
}

/** Whether the account's conversation holds the session given whole: from its first entry, the entry that opens it among its own, and with no batch dropped since (`markSessionBroken`). */
export function holdsSession(
  userId: string,
  conversationId: string,
  sessionId: string,
): EntryEffect<boolean> {
  return findOpening({ userId, conversationId, sessionId }).pipe(Effect.map(Option.isSome));
}

/** Every row of the source conversation, read as its own account, copied to the conversation given in their order, its broken sessions marked broken there too. */
export function copySessionEntries(
  source: { readonly userId: string; readonly conversationId: string },
  conversationId: string,
): EntryEffect<void> {
  const request = {
    sourceUserId: source.userId,
    sourceConversationId: source.conversationId,
    conversationId,
  };
  return Effect.andThen(copyEntries(request), copyBreaks(request));
}
