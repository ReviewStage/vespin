/**
 * workspace-environment-procedures.ts -- a workspace's shared environment variables: list their names to a member, and put or delete one as an owner or admin.
 *
 * Every procedure resolves the caller (`accountMiddleware`, on the
 * resource so it runs before an input is read) and runs the one operation
 * behind every door to the variables (`workspace-environment.ts`), which
 * answers a workspace the caller is not in as not found and a write by a
 * member who is no owner or admin as not permitted. A put seals the value
 * under the deployment's ring (`keyRingMiddleware`, so a deployment holding
 * none answers it unavailable) the moment it is read, and nothing logs it.
 * Every answer is the workspace's variable names as they then stand, never
 * a value.
 */

import { Redacted } from "effect";
import type { UserIdResolver } from "../http/http-effect.js";
import { accountMiddleware, hosted, keyRingMiddleware } from "../orpc/base.js";
import {
  deleteWorkspaceVariable,
  listWorkspaceEnvironment,
  putWorkspaceVariable,
} from "./workspace-environment.js";

export interface WorkspaceEnvironmentProcedureSeams {
  resolveUserId: UserIdResolver;
}

/** The workspace environment resource: every procedure to a signed-in caller, the put on a deployment that holds a ring. */
export function workspaceEnvironmentProcedures(seams: WorkspaceEnvironmentProcedureSeams) {
  const signedIn = hosted.workspaceEnvironment.use(accountMiddleware(seams.resolveUserId));
  const keyed = signedIn.use(keyRingMiddleware);

  return {
    list: signedIn.list.effect(function* ({ input, context: { userId } }) {
      return yield* listWorkspaceEnvironment(userId, input.workspaceId);
    }),

    put: keyed.put.effect(function* ({ input: { value, ...variable }, context: { userId, ring } }) {
      return yield* putWorkspaceVariable(ring, userId, variable, Redacted.make(value));
    }),

    delete: signedIn.delete.effect(function* ({ input, context: { userId } }) {
      return yield* deleteWorkspaceVariable(userId, input);
    }),
  };
}
