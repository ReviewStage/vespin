/**
 * workspace-sandbox-setup-procedures.ts -- a workspace's cloud sandbox setup: read it as a member, and save its install script or a repository's setup or archive script as an owner or admin.
 *
 * Every procedure resolves the caller (`accountMiddleware`, on the resource
 * so it runs before an input is read), then runs the operation every door
 * shares (`workspace-sandbox-setup.ts`): a workspace the caller is not in
 * is not found, a save by a member who is no owner or admin is not
 * permitted, and a save whose script is empty, or only whitespace, removes
 * the script. Every answer is the setup as it then stands.
 */

import { REPOSITORY_SCRIPT_KIND } from "@repo/features/workspace-sandbox-setup-wire";
import type { UserIdResolver } from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import {
  readSandboxSetup,
  saveInstallScript,
  saveRepositorySetup,
} from "./workspace-sandbox-setup.js";

export interface WorkspaceSandboxSetupProcedureSeams {
  resolveUserId: UserIdResolver;
}

/** The workspace sandbox setup resource: every procedure to a signed-in caller. */
export function workspaceSandboxSetupProcedures(seams: WorkspaceSandboxSetupProcedureSeams) {
  const signedIn = hosted.workspaceSandboxSetup.use(accountMiddleware(seams.resolveUserId));
  return {
    read: signedIn.read.effect(function* ({ input, context: { userId } }) {
      return yield* readSandboxSetup(userId, input.workspaceId);
    }),

    putInstall: signedIn.putInstall.effect(function* ({ input, context: { userId } }) {
      return yield* saveInstallScript(userId, input.workspaceId, input.script);
    }),

    putRepository: signedIn.putRepository.effect(function* ({ input, context: { userId } }) {
      return yield* saveRepositorySetup(
        userId,
        input.workspaceId,
        input.repository,
        input.script,
        input.kind ?? REPOSITORY_SCRIPT_KIND.SETUP,
      );
    }),
  };
}
