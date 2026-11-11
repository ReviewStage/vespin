import { randomUUID } from "node:crypto";
import {
  PAGE_OWNER,
  PAGE_SHOWER,
  type PageLine,
  type PageOwner,
  type PageShower,
  type PageVersion,
  type PageWrite,
  pageShowerSchema,
  pageWriteSchema,
} from "@repo/features/page-wire";
import { and, desc, eq, type SQL, sql } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, queryBuilder } from "../core/query.js";
import { task } from "../schemas/task.js";
import { taskPageVersion } from "../schemas/task-page.js";
import { InstantColumnSchema } from "./columns.js";
import type { TaskStoreEffect } from "./task-store.js";
import { reachableTask, taskReachableBy } from "./workspace-store.js";

/**
 * task-pages.ts -- the pages shown on a task: write a page or its next version as who showed it, list a task's pages, and read one version, by its task or by the page's id alone.
 *
 * A page stands on a task, whose pages any agent on it and the brain write.
 * An agent owner (`PAGE_OWNER.AGENT`), which a released desktop still names
 * for the pages an agent on no task once showed on itself, holds none, since
 * every page stands on a task. A write is a page's next version, taken under
 * the task row's own lock, so two writes of one page never take one number
 * and a task deleted meanwhile reads as gone rather than written back into
 * being. Every statement names the account beside the task and gates on the
 * task's rule of who may read it (`taskReachableBy`), so a member reads and
 * writes the pages a teammate's agent wrote, and a task the account does not
 * reach reads and writes as no task, exactly as in `task-store.ts`. A
 * version a coding agent showed names it in `agent_id`. A write is read against the
 * wire's own bounds before it touches a row, so nothing is stored that the
 * desktop could not read back. Pages written in the same millisecond list in
 * no particular order between them.
 */

const OwnerKeySchema = Schema.Struct({
  userId: Schema.String,
  owner: Schema.Union([
    Schema.Struct({ kind: Schema.Literal(PAGE_OWNER.TASK), taskId: Schema.String }),
    Schema.Struct({ kind: Schema.Literal(PAGE_OWNER.AGENT), agentId: Schema.String }),
  ]),
});

const PageLineRowSchema = Schema.Struct({
  pageId: Schema.String,
  title: Schema.String,
  version: Schema.Number,
  at: InstantColumnSchema,
  shownBy: Schema.NullOr(pageShowerSchema),
});

const PAGE_LINE_COLUMNS = {
  pageId: taskPageVersion.pageId,
  title: taskPageVersion.title,
  version: taskPageVersion.version,
  at: taskPageVersion.at,
  shownBy: taskPageVersion.shownBy,
};

/** The versions that stand on the owner: a task's by its column; none of an agent's, since every page stands on a task. */
function ownedBy(owner: PageOwner): SQL {
  return owner.kind === PAGE_OWNER.TASK ? eq(taskPageVersion.taskId, owner.taskId) : sql`false`;
}

/** The task's id under its row's lock until the transaction ends; nothing where the account reaches no such task. */
const lockTask = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, taskId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, taskId }) =>
    Database.use((db) =>
      db.select({ id: task.id }).from(task).where(reachableTask(userId, taskId)).for("update"),
    ),
});

/** The newest version's number of one page of the owner; nothing where the owner has no such page. */
const findNewestVersion = SqlSchema.findOneOption({
  Request: Schema.Struct({ owner: OwnerKeySchema.fields.owner, pageId: Schema.String }),
  Result: Schema.Struct({ version: Schema.Number }),
  execute: ({ owner, pageId }) =>
    Database.use((db) =>
      db
        .select({ version: taskPageVersion.version })
        .from(taskPageVersion)
        .where(and(ownedBy(owner), eq(taskPageVersion.pageId, pageId)))
        .orderBy(desc(taskPageVersion.version))
        .limit(1),
    ),
});

const insertVersion = SqlSchema.findOne({
  Request: Schema.Struct({
    taskId: Schema.String,
    agentId: Schema.NullOr(Schema.String),
    pageId: Schema.String,
    version: Schema.Number,
    title: Schema.String,
    html: Schema.String,
    shownBy: pageShowerSchema,
    at: Schema.Date,
  }),
  Result: PageLineRowSchema,
  execute: (row) =>
    Database.use((db) => db.insert(taskPageVersion).values(row).returning(PAGE_LINE_COLUMNS)),
});

/** Each page of the owner by its newest version, the most recently written first. */
const findPageLines = SqlSchema.findAll({
  Request: OwnerKeySchema,
  Result: PageLineRowSchema,
  execute: ({ userId, owner }) => {
    // Note that the newest versions are picked first and ordered after, because `distinct on` must lead the ordering.
    const newest = queryBuilder
      .selectDistinctOn([taskPageVersion.pageId], PAGE_LINE_COLUMNS)
      .from(taskPageVersion)
      .innerJoin(task, eq(task.id, taskPageVersion.taskId))
      .where(and(ownedBy(owner), taskReachableBy(userId)))
      .orderBy(taskPageVersion.pageId, desc(taskPageVersion.version))
      .as("newest");
    return Database.use((db) => db.select().from(newest).orderBy(desc(newest.at), newest.pageId));
  },
});

const findVersion = SqlSchema.findOneOption({
  Request: Schema.Struct({
    ...OwnerKeySchema.fields,
    pageId: Schema.String,
    version: Schema.Number,
  }),
  Result: Schema.Struct({ ...PageLineRowSchema.fields, html: Schema.String }),
  execute: ({ userId, owner, pageId, version }) =>
    Database.use((db) =>
      db
        .select({ ...PAGE_LINE_COLUMNS, html: taskPageVersion.html })
        .from(taskPageVersion)
        .innerJoin(task, eq(task.id, taskPageVersion.taskId))
        .where(
          and(
            ownedBy(owner),
            taskReachableBy(userId),
            eq(taskPageVersion.pageId, pageId),
            eq(taskPageVersion.version, version),
          ),
        )
        .limit(1),
    ),
});

/** A version of a page found by the page's id alone, its newest where none is named, with the task it stands on, gated on the task's rule of who may read it. */
const findPageById = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    pageId: Schema.String,
    version: Schema.NullOr(Schema.Number),
  }),
  Result: Schema.Struct({
    ...PageLineRowSchema.fields,
    html: Schema.String,
    taskId: Schema.String,
  }),
  execute: ({ userId, pageId, version }) =>
    Database.use((db) =>
      db
        .select({
          ...PAGE_LINE_COLUMNS,
          html: taskPageVersion.html,
          taskId: taskPageVersion.taskId,
        })
        .from(taskPageVersion)
        .innerJoin(task, eq(task.id, taskPageVersion.taskId))
        .where(
          and(
            eq(taskPageVersion.pageId, pageId),
            taskReachableBy(userId),
            version === null ? undefined : eq(taskPageVersion.version, version),
          ),
        )
        .orderBy(desc(taskPageVersion.version))
        .limit(1),
    ),
});

function lineOf(row: typeof PageLineRowSchema.Type): PageLine {
  return {
    id: row.pageId,
    title: row.title,
    version: row.version,
    at: row.at.getTime(),
    ...(row.shownBy === null ? undefined : { shownBy: row.shownBy }),
  };
}

/** The agent a version is written as shown by; none for one the brain showed. */
function agentOf(shownBy: PageShower): string | null {
  return shownBy.kind === PAGE_SHOWER.AGENT ? shownBy.agentId : null;
}

/**
 * Writes the page's next version, or a new page's first where the write
 * names none, on the owner, as shown by `shownBy`; the page as it now
 * stands. Nothing where the owner is no task the account reaches, or the
 * task holds no such page, and a schema failure, with nothing written, for
 * a write past the wire's bounds.
 */
export function writePage(
  userId: string,
  owner: PageOwner,
  write: PageWrite,
  shownBy: PageShower,
): TaskStoreEffect<Option.Option<PageLine>> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const admitted = yield* Schema.decodeUnknownEffect(pageWriteSchema)(write);
        if (owner.kind !== PAGE_OWNER.TASK) return Option.none<PageLine>();
        const locked = yield* lockTask({ userId, taskId: owner.taskId });
        if (Option.isNone(locked)) return Option.none<PageLine>();
        const newest =
          admitted.pageId === undefined
            ? Option.some({ version: 0 })
            : yield* findNewestVersion({ owner, pageId: admitted.pageId });
        if (Option.isNone(newest)) return Option.none<PageLine>();
        const at = yield* DateTime.nowAsDate;
        // An insert that returned no row is the database breaking its own contract, not an outcome.
        const row = yield* insertVersion({
          taskId: owner.taskId,
          agentId: agentOf(shownBy),
          pageId: admitted.pageId ?? randomUUID(),
          version: newest.value.version + 1,
          title: admitted.title,
          html: admitted.html,
          shownBy,
          at,
        }).pipe(Effect.catchTag("NoSuchElementError", Effect.die));
        return Option.some(lineOf(row));
      }),
    ),
  );
}

/** The owner's pages, each by its newest version, the most recently written first; none where the account reaches no such owner. */
export function listPages(userId: string, owner: PageOwner): TaskStoreEffect<readonly PageLine[]> {
  return Effect.map(findPageLines({ userId, owner }), (rows) => rows.map(lineOf));
}

/** One version of one page of the owner, with its HTML; nothing where the account reaches no such owner, page, or version. */
export function readPageVersion(
  userId: string,
  owner: PageOwner,
  pageId: string,
  version: number,
): TaskStoreEffect<Option.Option<PageVersion>> {
  return Effect.map(
    findVersion({ userId, owner, pageId, version }),
    Option.map((row) => ({ ...lineOf(row), html: row.html })),
  );
}

/** A page read by its id alone: the task it stands on, the version asked for, and the newest version there is. */
export interface FoundPage {
  readonly taskId: string;
  readonly page: PageVersion;
  readonly newestVersion: number;
}

/**
 * One version of the page by the page's id alone, the newest where none is
 * named, with the task it stands on and its newest version; nothing where
 * the account reaches no task holding such a page or version.
 */
export function readPageById(
  userId: string,
  pageId: string,
  version: number | undefined,
): TaskStoreEffect<Option.Option<FoundPage>> {
  return Effect.gen(function* () {
    const found = yield* findPageById({ userId, pageId, version: version ?? null });
    if (Option.isNone(found)) return Option.none();
    const { taskId, html, ...line } = found.value;
    const newest = yield* findNewestVersion({ owner: { kind: PAGE_OWNER.TASK, taskId }, pageId });
    return Option.some({
      taskId,
      page: { ...lineOf(line), html },
      newestVersion: Option.match(newest, {
        onNone: () => line.version,
        onSome: (row) => row.version,
      }),
    });
  });
}
