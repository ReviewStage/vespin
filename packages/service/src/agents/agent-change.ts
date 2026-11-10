/**
 * agent-change.ts -- an agent changed or archived, as the one operation the app's menu, `update_agent`, and the command line all run.
 *
 * The app's `agents.change` names one change a call and `update_agent` may
 * name several, so a change is a partial (`AgentChanges`) written in one
 * transaction, either every change standing or none. A model and effort
 * moved are handed to a native runner that runs at once and counted for each
 * of the two that moved; a permission mode is read by the agent's next
 * launch, so it reaches the agent from its next turn. An archive stops a turn still running first, as a
 * Stop does, then stamps the agent, lets its sandbox and its device go once
 * the archive stands, and is counted where it archived an agent standing
 * unarchived; bringing one back clears whichever archive stands.
 *
 * Every other archive writes through here too, each deciding which agents
 * it puts away and why: a task moved to Done or Canceled archives its idle agents in
 * the task's own transaction (`doneTaskArchive`), and they are let go of
 * once it commits (`archivedWithTaskLetGo`); a turn ending on a task a
 * member or an agent moved to Done or Canceled archives its agent with it
 * (`archivedWithDoneTask`); and "Archive finished runs", which a Slack agent
 * is put away by too, archives an agent that finished well and stands as it
 * was read (`archivedUnmovedAgent`), recorded as the app's with why, since
 * no member asked for it. The last two let an agent go on its device alone,
 * leaving its sandbox be.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import {
  type Agent,
  type AgentArchiveCommitted,
  type AgentCommitted,
  archiveAgentCommitted,
  archiveUnmovedAgent,
  pinAgentCommitted,
  renameAgentCommitted,
  updateAgentChoiceCommitted,
  updateAgentPermissionModeCommitted,
  updateAgentServersCommitted,
} from "@repo/database/models/agent-store";
import {
  archiveAgentOfDoneTask,
  type TaskArchivedAgent,
  type TaskDoneArchive,
} from "@repo/database/models/task-store";
import type { StoreWriter } from "@repo/database/models/writer";
import type { StoredArchive } from "@repo/database/schemas/agent";
import type { AgentPermissionMode } from "@repo/features/agent-approval-wire";
import { AGENT_ARCHIVER } from "@repo/features/agent-wire";
import type { ModelChoice } from "@repo/features/models-wire";
import { Data, Effect, Option } from "effect";
import { SqlClient } from "effect/sql";
import { recordServerEvent, SERVER_AGENT_SETTING, SERVER_EVENT } from "../events/server-events.js";
import { hostedStoreOrUnavailable } from "../http/http-effect.js";
import { runnerChoiceApplied } from "./coder-host/runtime-sessions.js";
import { idleStandingAgents, stoppedForGood } from "./coder-host/stop.js";
import { discardedOrLogged } from "./device-discard.js";
import { deletedInBackground, type SandboxDeleteReach } from "./session-sandboxes.js";

/** Why the app archived an agent on its own, as its banner says beneath who archived it. */
export const AUTOMATIC_ARCHIVE_REASON = {
  RUN_FINISHED: "Automation run finished",
  SLACK_FINISHED: "Slack agent finished",
} as const;

export type AutomaticArchiveReason =
  (typeof AUTOMATIC_ARCHIVE_REASON)[keyof typeof AUTOMATIC_ARCHIVE_REASON];

/** The changes asked of an agent, each already read, and a choice already the catalog's; any left out stands. */
export interface AgentChanges {
  /** Its title, cleared where empty, so its tab falls back to the model's name. */
  readonly title?: string | undefined;
  readonly choice?: ModelChoice | undefined;
  /** Whether the asking member keeps it pinned, and where among their pins. */
  readonly pinned?: boolean | undefined;
  readonly position?: string | undefined;
  readonly disabledServers?: readonly string[] | undefined;
  /** How its tool calls are answered from its next turn, already held to what its harness takes. */
  readonly permissionMode?: AgentPermissionMode | undefined;
}

/** A change that found no row to write: the agent left the account's reach as it was changed, which takes every change back. */
class AgentChangeLost extends Data.TaggedError("AgentChangeLost") {}

/** The settings a choice moved, each counted once. */
function settingsMoved(agent: Agent, choice: ModelChoice) {
  return [
    ...(choice.model === agent.model ? [] : [SERVER_AGENT_SETTING.MODEL]),
    ...(choice.effort === agent.effort ? [] : [SERVER_AGENT_SETTING.EFFORT]),
  ];
}

/** Every change asked written in one transaction: the agent as the last write left it, the agent as it stood where none was asked. */
const writtenChanges = (userId: string, agent: Agent, changes: AgentChanges) =>
  Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const kept = (changed: Option.Option<AgentCommitted>) =>
          Option.isSome(changed)
            ? Effect.succeed(changed.value)
            : Effect.fail(new AgentChangeLost());
        const { title, choice, pinned, position, disabledServers, permissionMode } = changes;
        let last: AgentCommitted = { agent };
        if (title !== undefined) {
          last = yield* kept(
            yield* renameAgentCommitted(userId, agent.id, title.length === 0 ? null : title),
          );
        }
        if (choice !== undefined) {
          last = yield* kept(yield* updateAgentChoiceCommitted(userId, agent.id, choice));
        }
        if (pinned !== undefined) {
          last = yield* kept(yield* pinAgentCommitted(userId, agent.id, pinned, position));
        }
        if (disabledServers !== undefined) {
          last = yield* kept(yield* updateAgentServersCommitted(userId, agent.id, disabledServers));
        }
        if (permissionMode !== undefined) {
          last = yield* kept(
            yield* updateAgentPermissionModeCommitted(userId, agent.id, permissionMode),
          );
        }
        return last;
      }),
    ),
  );

/**
 * The agent changed for what follows, every change asked or none, answered
 * as it then stands with the transaction it was written in; nothing where
 * the agent left the account's reach. A choice moved is handed to a native
 * runner that runs now.
 */
export const changedAgent = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  agent: Agent,
  changes: AgentChanges,
) {
  const written = yield* writtenChanges(userId, agent, changes).pipe(
    Effect.map(Option.some),
    Effect.catchTag("AgentChangeLost", () => Effect.succeed(Option.none<AgentCommitted>())),
  );
  const { choice } = changes;
  if (choice === undefined || Option.isNone(written)) return written;
  yield* runnerChoiceApplied(written.value.agent);
  // Counted for each of the two the change moved, under the member; a window alone counts none.
  for (const changed of settingsMoved(agent, choice)) {
    yield* recordServerEvent(
      SERVER_EVENT.AGENT_SETTINGS_CHANGE,
      { userId, workspaceId: agent.organizationId },
      { changed },
    );
  }
  return written;
});

/**
 * The agent archived by who the stamp names, or brought back. An archived
 * agent works on unseen, so a turn still running is stopped before the
 * stamp, refused where none can be stopped yet (`stoppedForGood`); once the
 * archive stands its sandbox is deleted with the drive it owns, so an
 * unarchive opens one afresh from its repository's base drive and its pushed
 * branch, and a local agent is let go of on its device.
 * Nothing where the agent left the account's reach.
 */
export const archivedAgent = /* @__PURE__ */ Effect.fnUntraced(function* (
  reach: SandboxDeleteReach,
  writer: Effect.Effect<StoreWriter>,
  userId: string,
  agent: Agent,
  archived: boolean,
  archivedBy: StoredArchive,
) {
  if (archived) yield* stoppedForGood(writer, userId, agent);
  const written: Option.Option<AgentArchiveCommitted> = yield* hostedStoreOrUnavailable(
    archiveAgentCommitted(userId, agent.id, archived, archivedBy),
  );
  if (!archived || Option.isNone(written)) return written;
  yield* deletedInBackground(reach, [agent]);
  // Counted only where this write archived an agent standing unarchived, under the member it archived for.
  if (written.value.archivedNow) {
    yield* recordServerEvent(
      SERVER_EVENT.AGENT_ARCHIVE,
      { userId, workspaceId: agent.organizationId },
      { agent_kind: agent.kind },
    );
  }
  return written;
});

/** How a task's move to Done or Canceled archives its agents with it, as `archivedBy`: those a Stop reads idle, in the task's own transaction (`updateTaskCommitted`). */
export const doneTaskArchive = (archivedBy: StoredArchive) =>
  ({ archivedBy, idle: idleStandingAgents }) satisfies TaskDoneArchive<DatabaseServices>;

/** The agents a task's Done or Canceled archived with it let go of once it commits, as an archive by hand lets one go: their sandboxes deleted and a local one discarded on its device. */
export const archivedWithTaskLetGo = (
  reach: SandboxDeleteReach,
  archived: readonly TaskArchivedAgent[],
) => (archived.length > 0 ? deletedInBackground(reach, archived) : Effect.void);

/**
 * The agent archived with its task where a member or an agent moved the
 * task to Done or Canceled while it worked and it now reads idle, as whoever
 * moved it (`archiveAgentOfDoneTask`), then let go of on its device; what a
 * turn's end asks of an agent its task's Done or Canceled left at work.
 */
export const archivedWithDoneTask = (userId: string, taskId: string, agentId: string) =>
  Effect.flatMap(archiveAgentOfDoneTask(userId, taskId, agentId, idleStandingAgents), (archived) =>
    Effect.forEach(archived, discardedOrLogged, { discard: true }),
  );

/**
 * The agent archived by the app for its starter, for `reason`, where it
 * stands unarchived and its lines have run no further than `seenSeq`, with
 * nothing open (`archiveUnmovedAgent`), then let go of on its device:
 * whether it was archived, and whether nothing failed letting it go, true
 * where nothing was asked. Note that the app's archiver is reused rather
 * than a new one, because a build from before it rejects an archiver it
 * does not know.
 */
export const archivedUnmovedAgent = /* @__PURE__ */ Effect.fnUntraced(function* (
  agent: Pick<Agent, "id" | "userId">,
  seenSeq: number,
  reason: AutomaticArchiveReason,
) {
  const archivedBy = { by: AGENT_ARCHIVER.APP, userId: agent.userId, reason } as const;
  const archived = yield* archiveUnmovedAgent(agent.userId, agent.id, seenSeq, archivedBy);
  const discarded = archived ? yield* discardedOrLogged(agent) : true;
  return { archived, discarded };
});
