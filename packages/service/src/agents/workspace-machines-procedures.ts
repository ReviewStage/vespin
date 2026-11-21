/**
 * workspace-machines-procedures.ts -- the machines a workspace owns, as Settings › Machines reads and changes them: listed to its members, renamed and removed by its owners and admins.
 *
 * A workspace's machine is a box or a Mac one of its owners or admins
 * connected to it by approving its pairing for the workspace
 * (`hosts-procedures.ts`'s `approvePairing`). Every procedure is the
 * account's own, on its bearer or its browser's session
 * (`accountMiddleware`). A workspace the account is not in is not found;
 * a list answers its members alone, and a rename or a remove its owners and
 * admins alone (`managedWorkspace`), not permitted to any other member. A
 * machine the workspace does not hold standing is not found.
 *
 * A rename gives the machine the name its members see from now on, which
 * its own register never changes; it is kept on one line as a box's own
 * name is (`cleanMachineName`), and refused as invalid where nothing that
 * draws is left. A remove stamps it removed, as a member's own host's
 * Remove does (`removeHostOf`): its secret is refused at once and its box
 * cleans itself up as it hears so, and every member's agent's running turns
 * on it settle lost.
 */

import {
  renameWorkspaceMachine,
  workspaceOwnedMachinesOf,
} from "@repo/database/models/device-store";
import { MACHINE_OWNER } from "@repo/features/device-agent-wire";
import { cleanMachineName } from "@repo/features/machine-name";
import { Effect } from "effect";
import { answeredWorkspace, managedWorkspace } from "../accounts/workspace-access.js";
import {
  recordServerEvent,
  SERVER_EVENT,
  SERVER_HOST_PAIRING_ACTION,
} from "../events/server-events.js";
import {
  HOSTED_REFUSAL,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import { removeHostOf } from "./hosts-procedures.js";

export interface WorkspaceMachinesProcedureSeams {
  /** The account behind a request: its bearer, or a browser's session cookie (`accountMiddleware`). */
  resolveUserId: UserIdResolver;
}

/** A rename or a remove answered with the transaction it was written in, or refused as not found where the workspace held no such machine standing. */
const doneOrNotFound = (txid: string | undefined) =>
  txid === undefined
    ? Effect.fail(HOSTED_REFUSAL.NOT_FOUND)
    : Effect.succeed({ done: true as const, txid });

/** A name an admin gave, kept on one line, or refused as invalid where nothing that draws is left. */
const keptName = (name: string) => {
  const kept = cleanMachineName(name);

  return kept === "" ? Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST) : Effect.succeed(kept);
};

/** The workspace machines resource, on the account's bearer or session. */
export function workspaceMachinesProcedures(seams: WorkspaceMachinesProcedureSeams) {
  const signedIn = hosted.workspaceMachines.use(accountMiddleware(seams.resolveUserId));

  return {
    list: signedIn.list.effect(function* ({ context, input }) {
      yield* answeredWorkspace(context.userId, input.workspaceId);

      const machines = yield* hostedStoreOrUnavailable(
        workspaceOwnedMachinesOf(context.userId, input.workspaceId),
      );

      return {
        machines: machines.map(({ lastSeenAt, ...machine }) => ({
          ...machine,
          seenAt: lastSeenAt.getTime(),
        })),
      };
    }),
    rename: signedIn.rename.effect(function* ({ context, input }) {
      yield* managedWorkspace(context.userId, input.workspaceId);
      const name = yield* keptName(input.name);

      return yield* doneOrNotFound(
        yield* hostedStoreOrUnavailable(renameWorkspaceMachine(input.workspaceId, input.id, name)),
      );
    }),
    remove: signedIn.remove.effect(function* ({ context, input }) {
      yield* managedWorkspace(context.userId, input.workspaceId);

      const removed = yield* removeHostOf({
        deviceId: input.id,
        owner: { kind: MACHINE_OWNER.WORKSPACE, workspaceId: input.workspaceId },
      });

      if (removed !== undefined) {
        yield* recordServerEvent(
          SERVER_EVENT.HOST_PAIRING_CHANGE,
          { userId: context.userId },
          { action: SERVER_HOST_PAIRING_ACTION.REMOVE },
        );
      }

      return yield* doneOrNotFound(removed);
    }),
  };
}
