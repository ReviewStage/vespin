import { Schema } from "effect";

/**
 * mac-command-ask.ts -- a command an agent asked to run on this Mac, held for the developer's answer: the ask every window draws, and the answer one gives.
 *
 * With Settings › This Mac on Ask every time, the host claims a shell
 * command, and for any setting, an action on an app not yet allowed, and
 * holds it here until the developer answers or the command's own
 * timeout passes (`compose-mac-commands.ts`); the asks waiting ride the
 * document (`app-state.ts`'s `macCommands`), the panel draws the oldest as a
 * prompt, and its answer comes back by the ask's id.
 */

/** One shell command waiting on the developer: the ask's id, which is the command's, the shell text, and when the Mac asked, by its clock. */
const macShellAskSchema = Schema.Struct({
  id: Schema.String,
  command: Schema.String,
  askedAt: Schema.Number,
});

export type MacShellAsk = typeof macShellAskSchema.Type;

/**
 * One app an agent asked to use, waiting on the developer: the ask's id,
 * which is the action's command's, the app by its name, bundle id, and icon
 * as a 64px PNG, and when the Mac asked, by its clock.
 */
const macAppAskSchema = Schema.Struct({
  id: Schema.String,
  app: Schema.Struct({
    name: Schema.String,
    bundleId: Schema.optionalKey(Schema.String),
    iconPng: Schema.optionalKey(Schema.String),
  }),
  askedAt: Schema.Number,
});

export type MacAppAsk = typeof macAppAskSchema.Type;

const macCommandAskSchema = Schema.Union([macShellAskSchema, macAppAskSchema]);

export type MacCommandAsk = typeof macCommandAskSchema.Type;

/** Whether an ask is of a shell command, read off the field only a shell ask carries. */
export function isMacShellAsk(ask: MacCommandAsk): ask is MacShellAsk {
  return "command" in ask;
}

/** The asks waiting, the earliest first, as the host tells them. */
export const macCommandAsksSchema = Schema.Struct({
  asks: Schema.Array(macCommandAskSchema),
});

/**
 * What the developer answers an ask: run it this once, run it and every later
 * one without asking, or not at all. For an app, this once holds the app for
 * the agent that asked until the account or the setting moves, and every
 * later one adds the app to the apps agents use without asking.
 */
export const MAC_COMMAND_DECISION = {
  ALLOW_ONCE: "allow-once",
  ALLOW_ALWAYS: "allow-always",
  DENY: "deny",
} as const;

export type MacCommandDecision = (typeof MAC_COMMAND_DECISION)[keyof typeof MAC_COMMAND_DECISION];

/** One ask answered, by its id. */
export const macCommandAnswerSchema = Schema.Struct({
  id: Schema.String,
  decision: Schema.Literals(Object.values(MAC_COMMAND_DECISION)),
});

export type MacCommandAnswer = typeof macCommandAnswerSchema.Type;
