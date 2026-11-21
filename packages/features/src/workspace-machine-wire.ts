import { Schema as EffectSchema } from "effect";
import { DEVICE_ARCH, DEVICE_PLATFORM, machineNetworkSchema } from "./device-agent-wire.js";
import { MACHINE_NAME_MAX_CHARS } from "./host-wire.js";
import { countedNumber, wireUuidSchema } from "./service-wire.js";
import { workspaceIdSchema } from "./task-wire.js";

/**
 * workspace-machine-wire.ts -- the machines a workspace owns, which every member's agents may run on: listed to its members, renamed and removed by its owners and admins.
 *
 * A workspace's machine is a box or a Mac an owner or an admin connected to
 * the workspace by approving its pairing for it (`host-wire.ts`'s
 * `hostPairingTargetSchema`), rather than as their own. It is the
 * workspace's, never any member's, and stays with it when the member who
 * connected it leaves or is deleted. Its name is its admins' to give, which
 * its own register never changes.
 */

/** The query a workspace's machines are listed under. */
const WORKSPACE_MACHINES_QUERY = {
  WORKSPACE_ID: "workspaceId",
} as const;

/** A workspace's machines listed (GET), under the workspace's id. */
export const workspaceMachinesQuerySchema = EffectSchema.Struct({
  [WORKSPACE_MACHINES_QUERY.WORKSPACE_ID]: workspaceIdSchema,
});

/**
 * One machine the workspace owns, as its members read it: its name, its
 * platform and architecture, who connected it, null once that account is
 * gone, which networks its agents may reach beyond the open internet, and
 * when it last beat, in epoch milliseconds.
 */
const workspaceMachineSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  name: EffectSchema.String,
  platform: EffectSchema.Literals(Object.values(DEVICE_PLATFORM)),
  arch: EffectSchema.Literals(Object.values(DEVICE_ARCH)),
  connectedBy: EffectSchema.NullOr(EffectSchema.String),
  network: machineNetworkSchema,
  seenAt: countedNumber,
});

/** What a list answers: the workspace's machines, by name. */
export const workspaceMachinesAnswerSchema = EffectSchema.Struct({
  machines: EffectSchema.Array(workspaceMachineSchema),
});

/** One of the workspace's machines named (POST), as a remove names it. */
export const workspaceMachineRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  id: wireUuidSchema,
});

/** One of the workspace's machines renamed (POST): the name it goes by from now on, on one line. */
export const workspaceMachineRenameRequestSchema = EffectSchema.Struct({
  ...workspaceMachineRequestSchema.fields,
  name: EffectSchema.String.check(
    EffectSchema.isMinLength(1),
    EffectSchema.isMaxLength(MACHINE_NAME_MAX_CHARS),
  ),
});

/** What a rename or a remove answers: done, and the transaction it was written in, which a reader following the workspace's machines waits for. */
export const workspaceMachineDoneAnswerSchema = EffectSchema.Struct({
  done: EffectSchema.Literal(true),
  txid: EffectSchema.String,
});
