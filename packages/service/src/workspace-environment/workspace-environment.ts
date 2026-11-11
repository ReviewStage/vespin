/**
 * workspace-environment.ts -- a workspace's shared environment variables as the account reaches them: list their names to a member, and set or delete one as an owner or admin.
 *
 * The one operation behind every door to them: the hosted procedures
 * (`workspace-environment-procedures.ts`), which Settings › Cloud environment and
 * the CLI call, and the member MCP tools (`../member-mcp/tools.ts`). Each
 * resolves the workspace as the account is a member of it, a workspace it
 * is not in refused as not found, and a set or a delete by a member who is
 * no owner or admin as not permitted. A set seals the value under the ring
 * its caller handed it the moment it is read, and nothing logs it. Every
 * answer is the workspace's variable names as they then stand, each with
 * when it was last set, and never a value.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import { type KeyRing, sealWorkspaceVariable } from "@repo/database/models/provider-key-seal";
import {
  listWorkspaceVariables,
  removeWorkspaceVariable,
  setWorkspaceVariable,
} from "@repo/database/models/workspace-environment-store";
import type { WorkspaceEnvironmentAnswer } from "@repo/features/workspace-environment-wire";
import { DateTime, Effect, type Redacted } from "effect";
import { answeredWorkspace, managedWorkspace } from "../accounts/workspace-access.js";
import { type HostedRefusal, hostedStoreOrUnavailable } from "../http/http-effect.js";

/** A variable a set or a delete names: its workspace and its name. */
export interface WorkspaceVariableRef {
  readonly workspaceId: string;
  readonly name: string;
}

/** The workspace's variable names as they stand, for the wire. */
const environmentAnswer = Effect.fn("web/workspaceEnvironmentAnswer")(function* (
  workspaceId: string,
): Effect.fn.Return<WorkspaceEnvironmentAnswer, HostedRefusal, DatabaseServices> {
  const listed = yield* hostedStoreOrUnavailable(listWorkspaceVariables(workspaceId));
  return {
    variables: listed.map((row) => ({ name: row.name, updatedAt: row.updatedAt.getTime() })),
  };
});

/** The names of a workspace's variables, to any member of it. */
export const listWorkspaceEnvironment = Effect.fn("web/listWorkspaceEnvironment")(function* (
  userId: string,
  workspaceId: string,
): Effect.fn.Return<WorkspaceEnvironmentAnswer, HostedRefusal, DatabaseServices> {
  const workspace = yield* answeredWorkspace(userId, workspaceId);
  return yield* environmentAnswer(workspace.id);
});

/** One variable set, replacing the value of one of that name, by an owner or admin; the value sealed under the ring and never answered. */
export const putWorkspaceVariable = Effect.fn("web/putWorkspaceVariable")(function* (
  ring: KeyRing,
  userId: string,
  variable: WorkspaceVariableRef,
  value: Redacted.Redacted<string>,
): Effect.fn.Return<WorkspaceEnvironmentAnswer, HostedRefusal, DatabaseServices> {
  const workspace = yield* managedWorkspace(userId, variable.workspaceId);
  const owner = { organizationId: workspace.id, name: variable.name };
  const sealed = sealWorkspaceVariable(ring, owner, value);
  const now = yield* DateTime.nowAsDate;
  yield* hostedStoreOrUnavailable(setWorkspaceVariable(workspace.id, variable.name, sealed, now));
  return yield* environmentAnswer(workspace.id);
});

/** One variable deleted by an owner or admin; one already gone leaves the names as they stand. */
export const deleteWorkspaceVariable = Effect.fn("web/deleteWorkspaceVariable")(function* (
  userId: string,
  variable: WorkspaceVariableRef,
): Effect.fn.Return<WorkspaceEnvironmentAnswer, HostedRefusal, DatabaseServices> {
  const workspace = yield* managedWorkspace(userId, variable.workspaceId);
  yield* hostedStoreOrUnavailable(removeWorkspaceVariable(workspace.id, variable.name));
  return yield* environmentAnswer(workspace.id);
});
