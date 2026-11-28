/**
 * workspace-machines-procedures.ts -- the machines a workspace owns, as a released build's Settings › Machines asks for them: none listed, and none to rename or remove.
 *
 * No machine is connected to a workspace, yet a desktop from v0.41.0 to
 * v0.42.0 and an iPhone build at `HOSTED_API_VERSION` 7 to 10 still list a
 * workspace's machines and may ask to rename or remove one, so each
 * procedure stands to answer them. Every procedure is the account's own, on
 * its bearer or its browser's session (`accountMiddleware`), and a
 * workspace the account is not in is not found, as before. A list answers
 * no machine, and a rename or a remove answers not found, since no machine
 * the workspace could name stands. They go once the floor reaches 11, from
 * which no build asks (`@repo/features/client-identity`).
 */

import { Effect } from "effect";
import { answeredWorkspace } from "../accounts/workspace-access.js";
import { HOSTED_REFUSAL, type UserIdResolver } from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";

export interface WorkspaceMachinesProcedureSeams {
  /** The account behind a request: its bearer, or a browser's session cookie (`accountMiddleware`). */
  resolveUserId: UserIdResolver;
}

/** The workspace machines resource, on the account's bearer or session. */
export function workspaceMachinesProcedures(seams: WorkspaceMachinesProcedureSeams) {
  const signedIn = hosted.workspaceMachines.use(accountMiddleware(seams.resolveUserId));

  return {
    list: signedIn.list.effect(function* ({ context, input }) {
      yield* answeredWorkspace(context.userId, input.workspaceId);

      return { machines: [] };
    }),
    rename: signedIn.rename.effect(function* ({ context, input }) {
      yield* answeredWorkspace(context.userId, input.workspaceId);

      return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    }),
    remove: signedIn.remove.effect(function* ({ context, input }) {
      yield* answeredWorkspace(context.userId, input.workspaceId);

      return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    }),
  };
}
