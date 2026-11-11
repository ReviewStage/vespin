/**
 * workspace-deletion.ts -- what a workspace's deletion does of its own around Better Auth's `deleteOrganization`, which its hooks run (`deletion-hooks.ts`).
 *
 * Better Auth deletes the workspace's row, every row of the workspace
 * cascading with it, its agents and automations among them. What outlives
 * those rows is settled here, read before the delete and settled after it:
 * an agent's conversation names the account that ran it rather than the
 * workspace, so the conversations of every agent of the workspace are
 * deleted, as a deleted task's are (`conversation-delete.ts`); each agent's
 * sandboxes are deleted with the drives they own, as an archive deletes
 * them (`session-sandboxes.ts`'s `deletedWithWorkspace`), past the answer,
 * and so is the base drive of each repository its agents started in
 * (`base-drive.ts`), which no agent owns; each local agent's device is told
 * to stop its runner and remove its folder, as an archive tells it
 * (`device-discard.ts`'s `discardedWithWorkspace`), by a line that outlives
 * the agent's row; and each scheduled automation's schedule is deleted at
 * Vercel, as deleting the automation does (`automation-writes.ts`'s
 * `removeAutomationAs`), since nothing else would stop it firing. Nothing
 * is deleted before the workspace, because a delete refused after that
 * would leave a standing workspace's agents with their transcripts gone,
 * and a failure after it is logged, since the workspace is already gone.
 */

import { workspaceScheduledAutomations } from "@repo/database/models/automation-store";
import { deleteConversations } from "@repo/database/models/conversation-delete";
import { workspaceAgentConversations } from "@repo/database/models/workspace-store";
import { Effect } from "effect";
import { baseDriveName } from "../agents/base-drive.js";
import { discardedWithWorkspace } from "../agents/device-discard.js";
import { deletedWithWorkspace, deploymentSandboxDeletes } from "../agents/session-sandboxes.js";
import { workspaceDriveName } from "../agents/workspace-drive.js";
import { schedulesForgotten } from "../automations/automation-cadence.js";

/** What the deletion read before Better Auth deleted the workspace, which it settles after. */
export interface WorkspaceDeletionPending {
  readonly conversationIds: readonly string[];
  /** The sessions the workspace's agents ran in, whose sandboxes are deleted. */
  readonly sessionIds: readonly string[];
  /** The base drives of the repositories the workspace's agents started in, by name, each deleted where it stands. */
  readonly baseDrives: readonly string[];
  /** The local agents, each by the device it was pinned to, which is told to discard it. */
  readonly devices: readonly {
    readonly userId: string;
    readonly agentId: string;
    readonly deviceId: string;
  }[];
  /** The scheduled automations, named as their schedules are kept at Vercel. */
  readonly schedules: readonly { readonly id: string; readonly organizationId: string }[];
}

/** What the deletion reads before Better Auth deletes the workspace; a store that cannot be read refuses the delete. */
export const beforeWorkspaceDeletion = /* @__PURE__ */ Effect.fn("web/beforeWorkspaceDeletion")(
  function* (organizationId: string) {
    const agents = yield* workspaceAgentConversations(organizationId);
    const schedules = yield* workspaceScheduledAutomations(organizationId);
    return {
      conversationIds: agents.map((agent) => agent.conversationId),
      sessionIds: agents.flatMap((agent) => (agent.sessionId === null ? [] : [agent.sessionId])),
      // Note that the names are kept once each, as many agents share a repository and a name reads its case aside.
      baseDrives: [
        ...new Set(
          agents.flatMap((agent) =>
            agent.repository === null
              ? []
              : [baseDriveName({ workspaceId: organizationId, fullName: agent.repository })],
          ),
        ),
        workspaceDriveName(organizationId),
      ],
      devices: agents.flatMap(({ userId, agentId, deviceId }) =>
        deviceId === null ? [] : [{ userId, agentId, deviceId }],
      ),
      schedules,
    } satisfies WorkspaceDeletionPending;
  },
);

/** What the deletion settles once Better Auth has deleted the workspace, a failure logged since the workspace is already gone. */
export const afterWorkspaceDeletion = /* @__PURE__ */ Effect.fn("web/afterWorkspaceDeletion")(
  function* (pending: WorkspaceDeletionPending) {
    yield* deleteConversations(pending.conversationIds).pipe(
      Effect.catch((failure) =>
        Effect.logError(
          "The workspace's deletion left its agents' conversations standing",
          failure,
        ),
      ),
    );
    yield* deletedWithWorkspace(deploymentSandboxDeletes, pending.sessionIds, pending.baseDrives);
    yield* discardedWithWorkspace(pending.devices);
    yield* schedulesForgotten(pending.schedules);
  },
);
