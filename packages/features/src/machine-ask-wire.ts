/**
 * machine-ask-wire.ts -- an ask a machine holds for its owner's answer, as it travels through the service so any of the owner's devices may answer it: the ask a machine posts, the answer a device gives, and the ask taken down.
 *
 * A machine that claims a command it may run only once its owner allows it,
 * a shell command under Ask every time or an action on an app not yet
 * allowed, posts the ask under the command's id, and the account's own
 * devices, that machine among them, follow it (`machine-ask-live.ts`). The
 * first answer the service takes is the answer, from whichever device; the
 * machine takes it and takes the ask down. A window that runs out, the
 * machine says closed; the ask stands a while longer, and an Allow given
 * then stands as a grant: the agent is told to try again, and its next ask
 * of the same on that machine is answered with it. Only the account that
 * owns the machine posts, reads, answers, or takes down its asks.
 */

import { Schema as EffectSchema } from "effect";
import { appName, COMPUTER_BOUNDS, MACHINE_COMMAND_BOUNDS } from "./machine-command-wire.js";
import { wireUuidSchema } from "./service-wire.js";

/** What an ask's numbers are held to. */
export const MACHINE_ASK_BOUNDS = {
  /** The most seconds an ask's window may run, its call waiting through it: an ask and a run together at their longest. */
  MAX_WINDOW_SECONDS: 900,
  /**
   * How long an ask stands from when it was asked, past its window, so an
   * answer given late may still let the agent try again; the scheduled
   * sweep takes down one standing longer.
   */
  STANDS_SECONDS: 3_600,
  /** How long past its window an ask whose machine never said it closed counts as closed, as a machine that quit leaves one. */
  LAPSE_GRACE_SECONDS: 60,
  /** The most characters of the words a denial hands the agent. */
  MAX_NOTE_CHARS: 2_000,
  /** The most characters of an app's bundle id. */
  MAX_BUNDLE_ID_CHARS: 255,
} as const;

/**
 * What the owner answers an ask: run it this once, run it and every later
 * one without asking, or not at all. The same three the machine's own
 * prompt answers.
 */
export const MACHINE_ASK_DECISION = {
  ALLOW_ONCE: "allow-once",
  ALLOW_ALWAYS: "allow-always",
  DENY: "deny",
} as const;

export type MachineAskDecision = (typeof MACHINE_ASK_DECISION)[keyof typeof MACHINE_ASK_DECISION];

export const machineAskDecisionSchema = EffectSchema.Literals(Object.values(MACHINE_ASK_DECISION));

/** The words a denial hands the agent. */
export const machineAskNoteSchema = EffectSchema.String.check(
  EffectSchema.isMinLength(1),
  EffectSchema.isMaxLength(MACHINE_ASK_BOUNDS.MAX_NOTE_CHARS),
);

/** A shell command's ask: its text. */
const shellAskSchema = EffectSchema.Struct({
  command: EffectSchema.String.check(
    EffectSchema.isMinLength(1),
    EffectSchema.isMaxLength(MACHINE_COMMAND_BOUNDS.MAX_COMMAND_CHARS),
  ),
});

/** An app's ask: the app as the machine names and draws it, its icon a 64px PNG's base64. */
const appAskSchema = EffectSchema.Struct({
  app: EffectSchema.Struct({
    name: appName,
    bundleId: EffectSchema.optionalKey(
      EffectSchema.String.check(
        EffectSchema.isMinLength(1),
        EffectSchema.isMaxLength(MACHINE_ASK_BOUNDS.MAX_BUNDLE_ID_CHARS),
      ),
    ),
    iconPng: EffectSchema.optionalKey(
      EffectSchema.String.check(EffectSchema.isMaxLength(COMPUTER_BOUNDS.MAX_ICON_CHARS)),
    ),
  }),
});

/** What an ask asks about: a shell command, or an app. */
export const machineAskSubjectSchema = EffectSchema.Union([shellAskSchema, appAskSchema]);

export type MachineAskSubject = typeof machineAskSubjectSchema.Type;

/** An app as a machine keys the apps it always allows: by its bundle id where it has one, else its name. */
export function machineAskAppKey(app: {
  readonly name: string;
  readonly bundleId?: string;
}): string {
  return app.bundleId ?? app.name;
}

/**
 * An ask a machine posts as it shows it (POST): the claimed command's id,
 * which the ask goes by, the machine that claimed it, what it asks, and how
 * many seconds its window runs from now. The agent that asked is read off
 * the command, never named here.
 */
export const machineAskRequestSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  deviceId: wireUuidSchema,
  subject: machineAskSubjectSchema,
  windowSeconds: EffectSchema.Int.check(
    EffectSchema.isBetween({ minimum: 1, maximum: MACHINE_ASK_BOUNDS.MAX_WINDOW_SECONDS }),
  ),
});

export type MachineAskRequest = typeof machineAskRequestSchema.Type;

/** An ask answered from any of its owner's devices (POST): its id, the decision, and for a denial, the words the owner gave the agent with it. */
export const machineAskAnswerRequestSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  decision: machineAskDecisionSchema,
  note: EffectSchema.optionalKey(machineAskNoteSchema),
});

export type MachineAskAnswerRequest = typeof machineAskAnswerRequestSchema.Type;

/** One ask by its id (POST): taken down by its machine once it took an answer or was withdrawn, or said closed as its window ran out. */
export const machineAskIdRequestSchema = EffectSchema.Struct({ id: wireUuidSchema });

/** An answer as it stands on an ask: the decision, and for a denial, the owner's words. */
const standingAnswerSchema = EffectSchema.Struct({
  decision: machineAskDecisionSchema,
  note: EffectSchema.optionalKey(machineAskNoteSchema),
});

export type MachineAskStandingAnswer = typeof standingAnswerSchema.Type;

/**
 * What a post or a window's close answers: the answer that already stands
 * on the ask, where one does, which the machine takes as given in time,
 * such as the owner's late Allow of the same ask before; none while it
 * waits, or once it was said closed.
 */
export const machineAskStandsSchema = EffectSchema.Struct({
  answer: EffectSchema.optionalKey(standingAnswerSchema),
});

/** The answer that stands on the ask, this one or one given before it, and the transaction this one was written in, which a device's read waits for. */
export const machineAskAnsweredSchema = EffectSchema.Struct({
  ...standingAnswerSchema.fields,
  txid: EffectSchema.optionalKey(EffectSchema.String),
});

export type MachineAskAnswered = typeof machineAskAnsweredSchema.Type;

/**
 * The words an agent is handed, as its owner's, once its ask was allowed
 * after its window closed and its call was answered as not answered: what
 * was allowed, and to try again, which its machine now lets through.
 */
export function lateAllowedWords(subject: MachineAskSubject): string {
  const allowed = "command" in subject ? "the command you asked to run" : subject.app.name;

  return `I allowed ${allowed} on my machine after your request timed out. Try it again.`;
}

/** That the ask is down, whether or not it still stood. */
export const machineAskClosedAnswerSchema = EffectSchema.Struct({
  closed: EffectSchema.Literal(true),
});
