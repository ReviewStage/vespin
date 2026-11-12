/**
 * workspace-sandbox-script-run-store.ts -- how a workspace's cloud setup scripts last ran: record a run, replacing the script's last, and list the last run of each.
 *
 * Every function is an effect over the ambient `SqlClient`, keyed by the
 * workspace, so no workspace reads or replaces another's runs, and a run
 * names its agent only where that agent is the workspace's own and is read
 * only by a member who sees that agent (`agentVisibleTo`). A
 * repository is kept lowercased, since GitHub's names ignore case. A run holds facts alone, never what its script printed
 * (`../schemas/workspace-sandbox-script-run.ts`).
 */

import { CLOUD_SETUP_SCRIPT } from "@repo/features/workspace-sandbox-setup-wire";
import { and, eq, lte } from "drizzle-orm";
import { type Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { agentTable } from "../schemas/agent.js";
import { workspaceSandboxScriptRun as run } from "../schemas/workspace-sandbox-script-run.js";
import { InstantColumnSchema } from "./columns.js";
import { agentVisibleTo } from "./workspace-store.js";

const ScriptSchema = Schema.Literals(Object.values(CLOUD_SETUP_SCRIPT));

/** One script's run as it is recorded: which script, of which repository where it is one's, in which agent's sandbox, how it exited, and when it started. */
const RunWriteSchema = Schema.Struct({
  organizationId: Schema.String,
  script: ScriptSchema,
  repository: Schema.NullOr(Schema.String),
  agentId: Schema.String,
  exitCode: Schema.Int,
  ranAt: Schema.Date,
});

export type WorkspaceScriptRunWrite = typeof RunWriteSchema.Type;

const RunAgentSchema = Schema.Struct({
  id: Schema.String,
  taskId: Schema.String,
  title: Schema.NullOr(Schema.String),
  model: Schema.String,
  automationOrigin: Schema.NullOr(Schema.Struct({ name: Schema.String })),
});

const RunSchema = Schema.Struct({
  script: ScriptSchema,
  repository: Schema.NullOr(Schema.String),
  exitCode: Schema.Int,
  ranAt: InstantColumnSchema,
  /** The agent whose sandbox it ran in, with what names it. */
  agent: RunAgentSchema,
});

/** A script's last run, as it was recorded, with the agent it ran for. */
export type WorkspaceScriptRun = typeof RunSchema.Type;

const upsertRun = SqlSchema.void({
  Request: RunWriteSchema,
  execute: (write) =>
    Database.use((db) =>
      db
        .insert(run)
        .values({ ...write, repository: write.repository?.toLowerCase() ?? null })
        .onConflictDoUpdate({
          target: [run.organizationId, run.script, run.repository],
          set: { agentId: write.agentId, exitCode: write.exitCode, ranAt: write.ranAt },
          // Note that a run that started before the one standing replaces nothing, since a setup can run for minutes and finish after a later one.
          setWhere: lte(run.ranAt, write.ranAt),
        }),
    ),
});

const findRuns = SqlSchema.findAll({
  Request: Schema.Struct({ organizationId: Schema.String, readerId: Schema.String }),
  Result: RunSchema,
  execute: ({ organizationId, readerId }) =>
    Database.use((db) =>
      db
        .select({
          script: run.script,
          repository: run.repository,
          exitCode: run.exitCode,
          ranAt: run.ranAt,
          agent: {
            id: agentTable.id,
            taskId: agentTable.taskId,
            title: agentTable.title,
            model: agentTable.model,
            automationOrigin: agentTable.automationOrigin,
          },
        })
        .from(run)
        // Note that the agent is joined within the workspace too, so a row can never name another workspace's agent.
        .innerJoin(
          agentTable,
          and(
            eq(agentTable.id, run.agentId),
            eq(agentTable.organizationId, run.organizationId),
            agentVisibleTo(readerId),
          ),
        )
        .where(eq(run.organizationId, organizationId)),
    ),
});

/** The script's run recorded as its last, unless the one standing started later. */
export function recordScriptRun(
  write: WorkspaceScriptRunWrite,
): Effect.Effect<void, StoreFailure, DatabaseServices> {
  return upsertRun(write);
}

/** The last run of each of the workspace's scripts that has run, in no order, of those whose agent the reader sees. */
export function listScriptRuns(
  organizationId: string,
  readerId: string,
): Effect.Effect<readonly WorkspaceScriptRun[], StoreFailure, DatabaseServices> {
  return findRuns({ organizationId, readerId });
}
