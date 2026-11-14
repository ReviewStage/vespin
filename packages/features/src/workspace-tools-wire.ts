/**
 * workspace-tools-wire.ts -- whose Mac an agent's `run_on_mac` runs on, whether it would run there now, and the machines its default may be set to, as the agent's composer reads it.
 *
 * The Mac is the machine a call would go to now, as the service routes it:
 * the agent's default machine, or else the one it runs on, or else its
 * task's assignee's, or its starter's, that listened last. `run_on_mac` is
 * answered off where the service would refuse a call now. An agent its catalog offers no `run_on_mac`, one that
 * runs on a device, is answered nothing. A new read, which a released
 * desktop never calls, so each field may change with the panel that reads
 * it.
 */

import { Schema as EffectSchema } from "effect";

/** Why the service would refuse the agent's `run_on_mac` now. */
export const RUN_ON_MAC_OFF = {
  /** No machine the agent's commands may go to can take one now. */
  MAC_AWAY: "mac-away",
} as const;

/** The member whose Mac the agent's commands run on. */
const runOnMacOwnerSchema = EffectSchema.Struct({
  userId: EffectSchema.String,
  name: EffectSchema.String,
});

/** The machine a call would go to, by its id and name; absent where it would go to the member's Macs from before machines claimed, or to none. */
const runOnMacMachineSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  name: EffectSchema.String,
});

const runOnMacOnSchema = EffectSchema.Struct({
  on: EffectSchema.Literal(true),
  owner: runOnMacOwnerSchema,
  machine: EffectSchema.optionalKey(runOnMacMachineSchema),
});

const runOnMacOffSchema = EffectSchema.Struct({
  on: EffectSchema.Literal(false),
  reason: EffectSchema.Literals(Object.values(RUN_ON_MAC_OFF)),
  owner: runOnMacOwnerSchema,
  machine: EffectSchema.optionalKey(runOnMacMachineSchema),
});

/** Whose Mac `run_on_mac` runs on, whether it would run there now, and why not where it would not. */
const runOnMacStandingSchema = EffectSchema.Union([runOnMacOnSchema, runOnMacOffSchema]);

export type RunOnMacStanding = typeof runOnMacStandingSchema.Type;

/** A machine the agent's default may be set to: its id and name, whose it is, and whether it listened for commands lately. */
const defaultMachineSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  name: EffectSchema.String,
  owner: runOnMacOwnerSchema,
  online: EffectSchema.Boolean,
});

export type DefaultMachine = typeof defaultMachineSchema.Type;

/** Where the agent's `run_on_mac` stands, and the machines its default may be set to, those of the people who let the task's agents use them; nothing for an agent offered none. */
export const workspaceToolsAnswerSchema = EffectSchema.Struct({
  runOnMac: EffectSchema.optionalKey(runOnMacStandingSchema),
  machines: EffectSchema.optionalKey(EffectSchema.Array(defaultMachineSchema)),
});

/** The machine an agent's terminal commands and computer use go to when a call names none, by its id. */
export const defaultMachineRequestSchema = EffectSchema.Struct({
  machineId: EffectSchema.String,
});

/** A task's followers' machines, each with whose it is, whether its owner lets the task's agents use it, and whether it listened lately, as a follower's card lists them. */
export const taskMachinesAnswerSchema = EffectSchema.Struct({
  machines: EffectSchema.Array(
    EffectSchema.Struct({ ...defaultMachineSchema.fields, lets: EffectSchema.Boolean }),
  ),
});

export type TaskMachinesAnswer = typeof taskMachinesAnswerSchema.Type;

export type WorkspaceToolsAnswer = typeof workspaceToolsAnswerSchema.Type;
