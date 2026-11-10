/**
 * workspace-create.ts -- a workspace created for an account, the one operation the hosted `workspaces.create` and the member MCP server's `create_workspace` both run.
 *
 * The account's own first workspace is ensured before the new one is made,
 * as the list ensures it, so an account whose first call is a create still
 * has it; the new workspace is then made through the organization plugin's
 * server-only create (`createWorkspace`), the account its owner, counted,
 * and answered as the account now sees it. Nothing here reads a session:
 * the plugin's create names its owner by id, so a caller on the OAuth token
 * reaches it as one on the Mac's does.
 */

import type { StoreFailure } from "@repo/database/core/query";
import type { WorkspaceSeams } from "@repo/database/models/workspace-seams";
import { createWorkspace, ensurePersonalWorkspace } from "@repo/database/models/workspace-store";
import { type Cause, Context, Effect } from "effect";
import { recordServerEvent, SERVER_EVENT } from "../events/server-events.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../http/http-effect.js";
import { answeredWorkspace } from "./workspace-access.js";

/** The plugin's workspace writes, provided to a door that holds no procedure's seams, such as the member MCP server's tools. */
export class WorkspacePlugin extends Context.Service<WorkspacePlugin, WorkspaceSeams>()(
  "WorkspacePlugin",
) {}

/**
 * A write through the plugin, a store failure answered as
 * `hostedStoreOrUnavailable` answers one and the plugin's refusal as the
 * same outage the Mac may retry, logged by its kind alone, since what the
 * plugin threw may quote what it was asked to write.
 */
export function pluginWriteOrUnavailable<A, R>(
  effect: Effect.Effect<A, StoreFailure | Cause.UnknownError, R>,
): Effect.Effect<A, HostedRefusal, R> {
  return Effect.catch(effect, (failure) =>
    failure._tag === "UnknownError"
      ? Effect.andThen(
          Effect.logWarning("Workspace not made: UnknownError"),
          Effect.fail(HOSTED_REFUSAL.UNAVAILABLE),
        )
      : hostedStoreOrUnavailable(Effect.fail(failure)),
  );
}

/** A workspace of the name given, made for the account as its owner, answered as it now sees it. */
export const createdWorkspace = Effect.fn("web/createdWorkspace")(function* (
  seams: WorkspaceSeams,
  userId: string,
  name: string,
) {
  yield* pluginWriteOrUnavailable(ensurePersonalWorkspace(userId, seams));
  const organizationId = yield* pluginWriteOrUnavailable(createWorkspace(userId, name, seams));
  yield* recordServerEvent(
    SERVER_EVENT.WORKSPACE_CREATE,
    { userId, workspaceId: organizationId },
    {},
  );
  return yield* answeredWorkspace(userId, organizationId);
});
