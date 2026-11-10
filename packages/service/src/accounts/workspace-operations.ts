/**
 * workspace-operations.ts -- a workspace's members read and its slug set, as the hosted procedures and the member MCP tools both make them.
 *
 * Each is the one operation its doors run: `workspaces.members` and
 * `workspaces.setSlug` (`workspaces-procedures.ts`) for the desktop, the
 * web app, and the command-line tool, and `list_workspace_members` and
 * `set_workspace_slug` (`../member-mcp/tools.ts`) for an outside agent
 * acting for a member. A door says who asks and words the answer; who may
 * read or write, and what is refused, stand here alone, so every door
 * refuses the same things for the same reasons.
 *
 * The members are answered to anyone in the workspace, with who its work
 * still names but left. The slug is changed by the owner alone, an
 * account's first workspace's among them, refusing one spelled other than a
 * slug may be, one reserved, and one another workspace holds or held, each
 * by its own word; the slug it stood under stays its own
 * (`workspace-slug-store.ts`).
 */

import { setWorkspaceSlug } from "@repo/database/models/workspace-slug-store";
import {
  WORKSPACE_SLUG_PROBLEM,
  type WorkspaceSlugProblem,
  workspaceSlugProblemOf,
} from "@repo/features/workspace-wire";
import { Effect } from "effect";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../http/http-effect.js";
import { answeredWorkspace, ownedWorkspace } from "./workspace-access.js";
import { listFormerMembers, listMembers } from "./workspace-members.js";

/** The refusal each reason a slug is refused for is answered with. */
const SLUG_REFUSAL = {
  [WORKSPACE_SLUG_PROBLEM.MALFORMED]: HOSTED_REFUSAL.WORKSPACE_SLUG_MALFORMED,
  [WORKSPACE_SLUG_PROBLEM.RESERVED]: HOSTED_REFUSAL.WORKSPACE_SLUG_RESERVED,
  [WORKSPACE_SLUG_PROBLEM.TAKEN]: HOSTED_REFUSAL.WORKSPACE_SLUG_TAKEN,
} as const satisfies Record<WorkspaceSlugProblem, HostedRefusal>;

/** A workspace's members to a member of it, and who its work still names but left; one the account is not in is not found. */
export const workspaceMembersRead = Effect.fn("web/workspaceMembersRead")(function* (
  userId: string,
  workspaceId: string,
) {
  const workspace = yield* answeredWorkspace(userId, workspaceId);
  const members = yield* hostedStoreOrUnavailable(listMembers(workspace.id));
  const former = yield* hostedStoreOrUnavailable(listFormerMembers(workspace.id));
  // Note that nobody who left says nothing, so an answer is as it was before anyone could leave.
  return former.length === 0 ? { members } : { members, former };
});

/**
 * The owner's new slug for a workspace, answered with the workspace under
 * it. Note that the slug is written by the store rather than the plugin,
 * because the slug it leaves is kept as the workspace's in the same
 * transaction, and the owner alone may change it, which our rule holds.
 */
export const workspaceSlugSet = Effect.fn("web/workspaceSlugSet")(function* (
  userId: string,
  workspaceId: string,
  slug: string,
) {
  const workspace = yield* ownedWorkspace(userId, workspaceId);
  const problem = workspaceSlugProblemOf(slug);
  if (problem !== undefined) return yield* Effect.fail(SLUG_REFUSAL[problem]);
  const set = yield* hostedStoreOrUnavailable(
    setWorkspaceSlug(workspace.id, slug).pipe(
      Effect.as(true),
      Effect.catchTag("WorkspaceSlugTaken", () => Effect.succeed(false)),
    ),
  );
  if (!set) return yield* Effect.fail(SLUG_REFUSAL[WORKSPACE_SLUG_PROBLEM.TAKEN]);
  return { workspace: yield* answeredWorkspace(userId, workspace.id) };
});
