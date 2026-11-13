import { ACT } from "@repo/sync";
import { Schema as EffectSchema } from "effect";
import { macCommandAnswerSchema } from "../mac-command-ask.js";
import { contractOf, declaredActs, hostAct } from "./declared-act.js";

/**
 * mac-commands.ts -- the developer's answer to a command an agent asked to run on this Mac, and what Settings shows of computer use here, declared.
 *
 * The host's Mac commands concern answers each (`compose-mac-commands.ts`):
 * an answer's ask goes from the document as the host hears it, so that act
 * answers nothing of its own; computer use's status is the Mac's two
 * grants as the helper reads them and the apps agents use without asking,
 * each named and drawn by the helper, and asking for the grants raises
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

/** The Mac commands' acts, answered by the Mac commands composer. */
export const MAC_COMMAND_ACTS = declaredActs({
  MAC_COMMAND_ANSWER: hostAct({
    input: macCommandAnswerSchema,
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
  COMPUTER_USE_ASK_PERMISSIONS: hostAct({
    input: EffectSchema.Struct({}),
    output: computerPermissionsSchema,
    refusal: "Could not ask macOS for computer use's permissions.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
  }),
});

export const macCommandActsContract = contractOf(MAC_COMMAND_ACTS);
