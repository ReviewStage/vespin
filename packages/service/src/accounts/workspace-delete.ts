/**
 * workspace-delete.ts -- a workspace deleted by its owner, as the hosted procedure makes it.
 *
 * The one operation `workspaces.delete` (`workspaces-procedures.ts`) runs.
 * The owner alone deletes a workspace, though never the account's own first
 * workspace, which goes only with the account, and, where it is asked
 * `ifAlone`, never one anyone else is a member of or that holds an agent,
 * as setup's Just me asks of the team's workspace it made without asking.
 *
 * Every turn under way among the workspace's agents not archived, any
 * member's, one the owner cannot see among them, is stopped first under the
 * account that started it (`everyTurnStoppedByStarter`). The workspace's
 * own deletion steps then run as the organization plugin's delete hooks
 * run them (`workspace-deletion.ts`): what outlives its rows is read while
 * they stand, the store deletes the workspace as the plugin's adapter
 * deletes one (`organization-store.ts`), its pending invitations and every
 * other row of it with it, and what was read is settled after, a failure
 * there logged rather than answered, since the workspace is already gone,
 * as `deletion-hooks.ts` settles it. Note that the store deletes it rather
 * than the plugin, because the plugin's `deleteOrganization` takes only a
 * session; an account's own deletion still deletes its workspaces through
 * the plugin, under the session being deleted, whose hooks run the same
 * steps.
 */

import { type Agent, listAgentsOfDeletedWorkspace } from "@repo/database/models/agent-store";
import { deleteWorkspaceRows } from "@repo/database/models/organization-store";
import { storeWriter } from "@repo/database/models/writer";
import { Effect } from "effect";
import { everyTurnStoppedByStarter } from "../agents/coder-host/stop.js";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import { SERVER_WORKSPACE_MEMBER_ACTION } from "../events/server-events.js";
import { HOSTED_REFUSAL, hostedStoreOrUnavailable } from "../http/http-effect.js";
import { ownedWorkspace } from "./workspace-access.js";
import { afterWorkspaceDeletion, beforeWorkspaceDeletion } from "./workspace-deletion.js";
import { memberChanged } from "./workspace-member-operations.js";
import { listMembers } from "./workspace-members.js";

/** How many of a workspace's agents a delete reads at once, page by page, before it stops any. */
const DELETE_AGENTS_PAGE = 100;

/** Whoever a delete's Stops are written as: the workspace's agents, as a task's archive stops its own. */
const STOPPER = storeWriter({ tools: CODER_TOOL_SET });

/** Every agent of the workspace not archived, any member's, whether or not the owner sees it, read a page at a time. */
const workspaceAgentsToStop = Effect.fn("web/workspaceAgentsToStop")(function* (
  workspaceId: string,
) {
  const agents: Agent[] = [];
  for (;;) {
    const page = yield* hostedStoreOrUnavailable(
      listAgentsOfDeletedWorkspace(workspaceId, {
        offset: agents.length,
        limit: DELETE_AGENTS_PAGE,
      }),
    );
    agents.push(...page);
    if (page.length < DELETE_AGENTS_PAGE) return agents;
  }
});

/**
 * The owner's delete of a workspace, answered with its id. Note that the
 * workspace's kind is our rule rather than the plugin's, because an
 * account's deletion deletes its own first workspace through the plugin.
 */
export const workspaceDelete = Effect.fn("web/workspaceDelete")(function* (
  userId: string,
  workspaceId: string,
  ifAlone: boolean,
) {
  const workspace = yield* ownedWorkspace(userId, workspaceId);
  if (workspace.personal === true) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  const agents = yield* workspaceAgentsToStop(workspace.id);
  // Note that the members are read here rather than trusted from the asking window, whose list may be stale.
  if (ifAlone) {
    const members = yield* hostedStoreOrUnavailable(listMembers(workspace.id));
    if (agents.length > 0 || members.some((member) => member.userId !== userId)) {
      return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
    }
  }
  yield* everyTurnStoppedByStarter(STOPPER, agents);
  const pending = yield* hostedStoreOrUnavailable(beforeWorkspaceDeletion(workspace.id));
  yield* hostedStoreOrUnavailable(deleteWorkspaceRows(workspace.id));
  yield* afterWorkspaceDeletion(pending).pipe(
    Effect.catchCause((cause) =>
      Effect.logError("A deletion's settling failed after its row was deleted", cause),
    ),
  );
  yield* memberChanged(userId, workspace.id, SERVER_WORKSPACE_MEMBER_ACTION.DELETE);
  return { workspaceId: workspace.id };
});
