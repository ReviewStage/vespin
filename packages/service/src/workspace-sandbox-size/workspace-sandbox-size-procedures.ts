/**
 * workspace-sandbox-size-procedures.ts -- a workspace's cloud sandbox size: read it as a member, and choose it as an owner or admin.
 *
 * Every procedure resolves the caller (`accountMiddleware`, on the resource
 * so it runs before an input is read), then runs the operation every door
 * shares (`workspace-sandbox-size.ts`): a workspace the caller is not in is
 * not found, and a choice by a member who is no owner or admin is not
 * permitted. Every answer is the size as
 * it then stands.
 */

import type { UserIdResolver } from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import { chooseSandboxSize, readSandboxSize } from "./workspace-sandbox-size.js";

export interface WorkspaceSandboxSizeProcedureSeams {
  resolveUserId: UserIdResolver;
}

/** The workspace sandbox size resource: every procedure to a signed-in caller. */
export function workspaceSandboxSizeProcedures(seams: WorkspaceSandboxSizeProcedureSeams) {
  const signedIn = hosted.workspaceSandboxSize.use(accountMiddleware(seams.resolveUserId));

  return {
    read: signedIn.read.effect(function* ({ input, context: { userId } }) {
      return yield* readSandboxSize(userId, input.workspaceId);
    }),

    put: signedIn.put.effect(function* ({ input, context: { userId } }) {
      return yield* chooseSandboxSize(userId, input.workspaceId, input.vcpus);
    }),
  };
}
