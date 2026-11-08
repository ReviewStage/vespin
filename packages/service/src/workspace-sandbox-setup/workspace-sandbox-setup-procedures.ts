/**
 * workspace-sandbox-setup-procedures.ts -- a workspace's cloud sandbox setup: read it as a member, and save its install script or a repository's setup script as an owner or admin.
 *
 * Every procedure resolves the caller (`accountMiddleware`, on the resource
 * so it runs before an input is read) and the workspace as the caller is a
 * member of it, a workspace it is not in answered as not found; a save by a
 * member who is no owner or admin is not permitted. A save whose script is
 * empty, or only whitespace, removes the script. Every answer is the setup
 * as it then stands.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import {
  listRepositorySetups,
  readInstallScript,
  removeInstallScript,
  removeRepositorySetup,
  setInstallScript,
  setRepositorySetup,
} from "@repo/database/models/workspace-sandbox-script-store";
import type { WorkspaceSandboxSetupAnswer } from "@repo/features/workspace-sandbox-setup-wire";
import { DateTime, Effect, Option } from "effect";
import { answeredWorkspace, managedWorkspace } from "../accounts/workspace-access.js";
import {
  type HostedRefusal,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";

export interface WorkspaceSandboxSetupProcedureSeams {
  resolveUserId: UserIdResolver;
}

/** Whether a script saved as given removes the one that stood: one with nothing but whitespace in it. */
function removes(script: string): boolean {
  return script.trim().length === 0;
}

/** The workspace's sandbox setup as it stands, for the wire. */
const setupAnswer = Effect.fn("web/workspaceSandboxSetupAnswer")(function* (
  workspaceId: string,
): Effect.fn.Return<WorkspaceSandboxSetupAnswer, HostedRefusal, DatabaseServices> {
  const [install, setups] = yield* hostedStoreOrUnavailable(
    Effect.all([readInstallScript(workspaceId), listRepositorySetups(workspaceId)]),
  );
  return {
    install: Option.match(install, {
      onNone: () => null,
      onSome: (row) => ({ script: row.script, updatedAt: row.updatedAt.getTime() }),
    }),
    setups: setups.map((row) => ({
      repository: row.repository,
      script: row.script,
      updatedAt: row.updatedAt.getTime(),
    })),
  };
});

/** The workspace sandbox setup resource: every procedure to a signed-in caller. */
export function workspaceSandboxSetupProcedures(seams: WorkspaceSandboxSetupProcedureSeams) {
  const signedIn = hosted.workspaceSandboxSetup.use(accountMiddleware(seams.resolveUserId));
  return {
    read: signedIn.read.effect(function* ({ input, context: { userId } }) {
      const workspace = yield* answeredWorkspace(userId, input.workspaceId);
      return yield* setupAnswer(workspace.id);
    }),

    putInstall: signedIn.putInstall.effect(function* ({ input, context: { userId } }) {
      const workspace = yield* managedWorkspace(userId, input.workspaceId);
      const now = yield* DateTime.nowAsDate;
      yield* hostedStoreOrUnavailable(
        removes(input.script)
          ? Effect.asVoid(removeInstallScript(workspace.id))
          : setInstallScript(workspace.id, input.script, now),
      );
      return yield* setupAnswer(workspace.id);
    }),

    putRepository: signedIn.putRepository.effect(function* ({ input, context: { userId } }) {
      const workspace = yield* managedWorkspace(userId, input.workspaceId);
      const now = yield* DateTime.nowAsDate;
      yield* hostedStoreOrUnavailable(
        removes(input.script)
          ? Effect.asVoid(removeRepositorySetup(workspace.id, input.repository))
          : setRepositorySetup(workspace.id, input.repository, input.script, now),
      );
      return yield* setupAnswer(workspace.id);
    }),
  };
}
