/**
 * workspace-environment-procedures.ts -- a workspace's shared environment variables: list them to a member, and put, save, edit, or delete them as an owner or admin.
 *
 * Every procedure resolves the caller (`accountMiddleware`, on the
 * resource so it runs before an input is read) and runs the one operation
 * behind every door to the variables (`workspace-environment.ts`), which
 * answers a workspace the caller is not in as not found and a write by a
 * member who is no owner or admin as not permitted. A put, a save, or an
 * edit seals each value under the deployment's ring (`keyRingMiddleware`,
 * so a deployment holding none answers it unavailable) the moment it is
 * read, and nothing logs it. Every answer is the workspace's variables as
 * they then stand, a config's value opened where the deployment holds a
 * ring, and never a secret's.
 */

import { Effect, Option, Redacted } from "effect";
import type { UserIdResolver } from "../http/http-effect.js";
import { accountMiddleware, hosted, hostedKeyRing, keyRingMiddleware } from "../orpc/base.js";
import {
  deleteWorkspaceVariable,
  editWorkspaceVariable,
  listWorkspaceEnvironment,
  putWorkspaceVariable,
  saveWorkspaceVariables,
} from "./workspace-environment.js";

/** The deployment's ring where it holds one, for an answer's configs; a read or a delete goes on without it. */
const ringIfHeld = Effect.map(Effect.option(hostedKeyRing), Option.getOrUndefined);

export interface WorkspaceEnvironmentProcedureSeams {
  resolveUserId: UserIdResolver;
}

/** The workspace environment resource: every procedure to a signed-in caller, the put on a deployment that holds a ring. */
export function workspaceEnvironmentProcedures(seams: WorkspaceEnvironmentProcedureSeams) {
  const signedIn = hosted.workspaceEnvironment.use(accountMiddleware(seams.resolveUserId));
  const keyed = signedIn.use(keyRingMiddleware);

  return {
    list: signedIn.list.effect(function* ({ input, context: { userId } }) {
      return yield* listWorkspaceEnvironment(yield* ringIfHeld, userId, input.workspaceId);
    }),

    put: keyed.put.effect(function* ({
      input: { value, secret, ...variable },
      context: { userId, ring },
    }) {
      return yield* putWorkspaceVariable(ring, userId, variable, Redacted.make(value), secret);
    }),

    save: keyed.save.effect(function* ({ input, context: { userId, ring } }) {
      return yield* saveWorkspaceVariables(ring, userId, input);
    }),

    edit: keyed.edit.effect(function* ({ input, context: { userId, ring } }) {
      return yield* editWorkspaceVariable(ring, userId, input);
    }),

    delete: signedIn.delete.effect(function* ({ input, context: { userId } }) {
      return yield* deleteWorkspaceVariable(yield* ringIfHeld, userId, input);
    }),
  };
}
