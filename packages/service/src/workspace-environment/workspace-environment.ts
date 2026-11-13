/**
 * workspace-environment.ts -- a workspace's shared environment variables as the account reaches them: list them to a member, and set, save, edit, or delete them as an owner or admin.
 *
 * The one operation behind every door to them: the hosted procedures
 * (`workspace-environment-procedures.ts`), which Settings › Cloud environment and
 * the CLI call, and the member MCP tools (`../member-mcp/tools.ts`). Each
 * resolves the workspace as the account is a member of it, a workspace it
 * is not in refused as not found, and a write by a member who is no owner
 * or admin as not permitted. A write seals each value under the ring its
 * caller handed it the moment it is read, and nothing logs it. Every
 * answer is the workspace's variables as they then stand, each with when
 * and by whom it was added and last changed, and a config's value opened
 * with the ring where one is handed; never a secret's.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import {
  type KeyRing,
  openWorkspaceVariable,
  type SealedWorkspaceVariable,
  sealWorkspaceVariable,
} from "@repo/database/models/provider-key-seal";
import {
  editWorkspaceVariable as editStoredVariable,
  type ListedWorkspaceVariable,
  listWorkspaceVariables,
  removeWorkspaceVariable,
  setWorkspaceVariables,
  WORKSPACE_VARIABLE_EDIT,
} from "@repo/database/models/workspace-environment-store";
import type {
  WorkspaceEnvironmentAnswer,
  WorkspaceVariable,
  WorkspaceVariableEditRequest,
  WorkspaceVariablesSaveRequest,
} from "@repo/features/workspace-environment-wire";
import { DateTime, Effect, Redacted, Result, type Types } from "effect";
import { answeredWorkspace, managedWorkspace } from "../accounts/workspace-access.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../http/http-effect.js";

/** A variable a set or a delete names: its workspace and its name. */
export interface WorkspaceVariableRef {
  readonly workspaceId: string;
  readonly name: string;
}

/** One listed variable for the wire, a config's value opened where the ring is handed and opens it. */
function wireVariable(
  ring: KeyRing | undefined,
  organizationId: string,
  row: ListedWorkspaceVariable,
): WorkspaceVariable {
  const opened =
    ring === undefined || row.config === undefined
      ? undefined
      : Result.getOrUndefined(
          openWorkspaceVariable(ring, { organizationId, name: row.name }, row.config),
        );

  const wire: Types.Mutable<WorkspaceVariable> = {
    name: row.name,
    secret: row.secret,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };

  if (opened !== undefined) wire.value = Redacted.value(opened);

  if (row.createdBy !== undefined) wire.createdBy = row.createdBy;

  if (row.updatedBy !== undefined) wire.updatedBy = row.updatedBy;

  return wire;
}

/** The workspace's variables as they stand, for the wire. */
const environmentAnswer = Effect.fn("web/workspaceEnvironmentAnswer")(function* (
  ring: KeyRing | undefined,
  workspaceId: string,
): Effect.fn.Return<WorkspaceEnvironmentAnswer, HostedRefusal, DatabaseServices> {
  const listed = yield* hostedStoreOrUnavailable(listWorkspaceVariables(workspaceId));

  return { variables: listed.map((row) => wireVariable(ring, workspaceId, row)) };
});

/** A workspace's variables, to any member of it; a config's value opened where the deployment holds a ring. */
export const listWorkspaceEnvironment = Effect.fn("web/listWorkspaceEnvironment")(function* (
  ring: KeyRing | undefined,
  userId: string,
  workspaceId: string,
): Effect.fn.Return<WorkspaceEnvironmentAnswer, HostedRefusal, DatabaseServices> {
  const workspace = yield* answeredWorkspace(userId, workspaceId);

  return yield* environmentAnswer(ring, workspace.id);
});

/**
 * One variable set by an owner or admin, replacing the value of one of
 * that name; the value sealed under the ring, and answered only for a
 * config. A new one is a secret unless `secret` is false, and one that
 * stands becomes a secret where `secret` is true.
 */
export const putWorkspaceVariable = Effect.fn("web/putWorkspaceVariable")(function* (
  ring: KeyRing,
  userId: string,
  variable: WorkspaceVariableRef,
  value: Redacted.Redacted<string>,
  secret?: boolean,
): Effect.fn.Return<WorkspaceEnvironmentAnswer, HostedRefusal, DatabaseServices> {
  const workspace = yield* managedWorkspace(userId, variable.workspaceId);

  const sealed = sealWorkspaceVariable(
    ring,
    { organizationId: workspace.id, name: variable.name },
    value,
  );

  const now = yield* DateTime.nowAsDate;
  yield* hostedStoreOrUnavailable(
    setWorkspaceVariables(workspace.id, [{ name: variable.name, sealed }], secret, userId, now),
  );

  return yield* environmentAnswer(ring, workspace.id);
});

/** Several variables set at once by an owner or admin, all or none, as a put of each would set it. */
export const saveWorkspaceVariables = Effect.fn("web/saveWorkspaceVariables")(function* (
  ring: KeyRing,
  userId: string,
  request: WorkspaceVariablesSaveRequest,
): Effect.fn.Return<WorkspaceEnvironmentAnswer, HostedRefusal, DatabaseServices> {
  const workspace = yield* managedWorkspace(userId, request.workspaceId);

  const variables = request.variables.map(({ name, value }) => ({
    name,
    sealed: sealWorkspaceVariable(
      ring,
      { organizationId: workspace.id, name },
      Redacted.make(value),
    ),
  }));

  const now = yield* DateTime.nowAsDate;
  yield* hostedStoreOrUnavailable(
    setWorkspaceVariables(workspace.id, variables, request.secret, userId, now),
  );

  return yield* environmentAnswer(ring, workspace.id);
});

/**
 * One variable edited by an owner or admin: renamed, given a new value, or
 * turned secret. A value is sealed under the name it ends with, so a
 * rename that keeps the value opens it under the old name and seals it
 * again under the new, inside the store's lock on the row; a value the
 * ring cannot open is refused as unavailable rather than lost. A variable
 * that stands not is not found, and a rename onto one that stands is
 * refused as taken.
 */
export const editWorkspaceVariable = Effect.fn("web/editWorkspaceVariable")(function* (
  ring: KeyRing,
  userId: string,
  request: WorkspaceVariableEditRequest,
): Effect.fn.Return<WorkspaceEnvironmentAnswer, HostedRefusal, DatabaseServices> {
  const workspace = yield* managedWorkspace(userId, request.workspaceId);
  const organizationId = workspace.id;

  const name = request.rename ?? request.name;
  const owner = { organizationId, name };

  const sealed =
    request.value === undefined
      ? undefined
      : sealWorkspaceVariable(ring, owner, Redacted.make(request.value));

  // Note that a rename keeping its value opens it as the row holds it under the edit's lock, so a save between a read and the rename is never undone.
  const resealed =
    sealed === undefined && name !== request.name
      ? (stored: SealedWorkspaceVariable) => {
          const value = openWorkspaceVariable(ring, { organizationId, name: request.name }, stored);

          return Result.isSuccess(value)
            ? sealWorkspaceVariable(ring, owner, value.success)
            : undefined;
        }
      : undefined;

  const now = yield* DateTime.nowAsDate;

  const outcome = yield* hostedStoreOrUnavailable(
    editStoredVariable(
      organizationId,
      request.name,
      { name, sealed, resealed, secret: request.secret },
      userId,
      now,
    ),
  );

  if (outcome === WORKSPACE_VARIABLE_EDIT.MISSING) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  }

  if (outcome === WORKSPACE_VARIABLE_EDIT.NAME_TAKEN) {
    return yield* Effect.fail(HOSTED_REFUSAL.VARIABLE_NAME_TAKEN);
  }

  if (outcome === WORKSPACE_VARIABLE_EDIT.UNREADABLE) {
    return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  }

  return yield* environmentAnswer(ring, organizationId);
});

/** One variable deleted by an owner or admin; one already gone leaves the variables as they stand. */
export const deleteWorkspaceVariable = Effect.fn("web/deleteWorkspaceVariable")(function* (
  ring: KeyRing | undefined,
  userId: string,
  variable: WorkspaceVariableRef,
): Effect.fn.Return<WorkspaceEnvironmentAnswer, HostedRefusal, DatabaseServices> {
  const workspace = yield* managedWorkspace(userId, variable.workspaceId);
  yield* hostedStoreOrUnavailable(removeWorkspaceVariable(workspace.id, variable.name));

  return yield* environmentAnswer(ring, workspace.id);
});
