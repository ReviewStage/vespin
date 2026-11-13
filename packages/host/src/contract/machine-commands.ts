import { ACT } from "@repo/sync";
import { Schema as EffectSchema } from "effect";
import { machineCommandAnswerSchema } from "../machine-command-ask.js";
import { contractOf, declaredActs, hostAct } from "./declared-act.js";

/**
 * machine-commands.ts -- the developer's answer to a command an agent asked to run on this Mac, and what Settings shows of computer use here, declared.
 *
 * The host's Mac commands concern answers each (`compose-machine-commands.ts`):
 * an answer's ask goes from the document as the host hears it, so that act
 * answers nothing of its own; computer use's status is the Mac's two
 * grants as the helper reads them and the apps agents use without asking,
 * each named and drawn by the helper; the apps the composer's @ list
 * offers, and one app's icon as a row of it is drawn; and asking for the grants raises
 * macOS's own prompts and answers the grants as they then stand. Only a
 * panel asks any of them.
 */

/** Whether macOS lets the helper capture other apps' windows and post input to them. */
const computerPermissionsSchema = EffectSchema.Struct({
  screenRecording: EffectSchema.Boolean,
  accessibility: EffectSchema.Boolean,
});

/** Computer use on this Mac as Settings shows it: its grants, and each app allowed without asking by its bundle id, its name, and its icon as a 64px PNG. */
export const computerUseStatusSchema = EffectSchema.Struct({
  permissions: computerPermissionsSchema,
  apps: EffectSchema.Array(
    EffectSchema.Struct({
      bundleId: EffectSchema.String,
      name: EffectSchema.String,
      iconPng: EffectSchema.optionalKey(EffectSchema.String),
    }),
  ),
});

export type ComputerUseStatus = typeof computerUseStatusSchema.Type;

/** One app on this Mac as the composer's @ list offers it. */
const macAppSchema = EffectSchema.Struct({
  name: EffectSchema.String,
  /** Its bundle id, which a mention of it names; an app with none is named by its name. */
  bundleId: EffectSchema.optionalKey(EffectSchema.String),
  /** Whether it runs now; one that does not is launched behind the developer's windows by the agent's first read. */
  running: EffectSchema.Boolean,
  /** Whether the developer answered Always allow for it. */
  allowed: EffectSchema.Boolean,
  /** Its icon as a 64px PNG, where it runs; an installed app's is read on its own (`COMPUTER_USE_APP_ICON`). */
  iconPng: EffectSchema.optionalKey(EffectSchema.String),
});

export type MacApp = typeof macAppSchema.Type;

/** The apps agents may be pointed at on this Mac: those running first, then those installed, none they are never offered. */
export const macAppsSchema = EffectSchema.Struct({ apps: EffectSchema.Array(macAppSchema) });

/** The Mac commands' acts, answered by the Mac commands composer. */
export const MACHINE_COMMAND_ACTS = declaredActs({
  MACHINE_COMMAND_ANSWER: hostAct({
    input: machineCommandAnswerSchema,
    output: EffectSchema.Void,
    refusal: "Could not answer for that command on this Mac.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
  }),
  COMPUTER_USE_STATUS: hostAct({
    input: EffectSchema.Struct({}),
    output: computerUseStatusSchema,
    refusal: "Could not read computer use on this Mac.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
  }),
  COMPUTER_USE_APPS: hostAct({
    input: EffectSchema.Struct({}),
    output: macAppsSchema,
    refusal: "Could not list the apps on this Mac.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
  }),
  COMPUTER_USE_APP_ICON: hostAct({
    input: EffectSchema.Struct({ app: EffectSchema.String }),
    output: EffectSchema.Struct({ iconPng: EffectSchema.optionalKey(EffectSchema.String) }),
    refusal: "Could not draw that app's icon.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
  }),
  COMPUTER_USE_ASK_PERMISSIONS: hostAct({
    input: EffectSchema.Struct({}),
    output: computerPermissionsSchema,
    refusal: "Could not ask macOS for computer use's permissions.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
  }),
});

export const machineCommandActsContract = contractOf(MACHINE_COMMAND_ACTS);
