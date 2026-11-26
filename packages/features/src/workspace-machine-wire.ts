import { Schema as EffectSchema } from "effect";
import { DEVICE_ARCH, DEVICE_PLATFORM } from "./device-agent-wire.js";
import { countedNumber, wireUuidSchema } from "./service-wire.js";
import { workspaceIdSchema } from "./task-wire.js";

/**
 * workspace-machine-wire.ts -- the machines a workspace owns, as a released build lists, renames, and removes them: kept only so those builds are answered, since no workspace owns a machine.
 *
 * A desktop from v0.41.0 to v0.42.0 and an iPhone build at
 * `HOSTED_API_VERSION` 7 to 10 list a workspace's machines in Settings ›
 * Machines and may rename or remove one. No machine is connected to a
 * workspace, so the service answers every list with none and every rename
 * or remove as not found (`workspace-machines-procedures.ts`). These go once
 * the floor reaches 11, from which no build asks (`client-identity.ts`).
 */

/** The most characters a machine's name may hold, as a released build names one. */
const MACHINE_NAME_MAX_CHARS = 200;

/** The query a workspace's machines are listed under. */
const WORKSPACE_MACHINES_QUERY = {
  WORKSPACE_ID: "workspaceId",
} as const;

/** A workspace's machines listed (GET), under the workspace's id. */
export const workspaceMachinesQuerySchema = EffectSchema.Struct({
  [WORKSPACE_MACHINES_QUERY.WORKSPACE_ID]: workspaceIdSchema,
});

/**
 * One machine the workspace owns, as a released build reads it: its name,
 * its platform and architecture, who connected it, null once that account
 * is gone, which networks its agents may reach, and when it last beat, in
 * epoch milliseconds. Note that the service lists none.
 */
const workspaceMachineSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  name: EffectSchema.String,
  platform: EffectSchema.Literals(Object.values(DEVICE_PLATFORM)),
  arch: EffectSchema.Literals(Object.values(DEVICE_ARCH)),
  connectedBy: EffectSchema.NullOr(EffectSchema.String),
  network: EffectSchema.String,
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
