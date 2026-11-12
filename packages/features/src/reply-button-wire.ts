import { Schema as EffectSchema } from "effect";

/**
 * reply-button-wire.ts -- a reply button: what an agent's button in its reply does once a member presses it, starting a new agent on a brief it wrote or sending its words to a running agent, and how a press stands.
 *
 * An agent makes a button with `add_button` and writes its link beside the
 * line of its reply the button is about; the app draws that link as the
 * button (`link-grammar.ts`'s `LINK_DESTINATION.BUTTON`). What it does is
 * kept with the button when it is made, so its label cannot say one thing
 * and do another, and its brief never stands in the reply's words. A press
 * runs it once, as the member who pressed it, and every press after it,
 * from anyone, answers that first one; the button is then drawn as the chip
 * of the agent it started or sent to. All of it stands behind the Reply
 * buttons workspace experiment (`@repo/settings`'s `EXPERIMENT.REPLY_BUTTONS`).
 */

/** What a button does once pressed: start a new agent on the button agent's task, or send to an agent already running. */
export const REPLY_BUTTON_ACTION = {
  START: "start",
  SEND: "send",
} as const;

export type ReplyButtonActionKind = (typeof REPLY_BUTTON_ACTION)[keyof typeof REPLY_BUTTON_ACTION];

export const REPLY_BUTTON_BOUNDS = {
  /** The longest label a button draws, which stays one short line beside the words it is about. */
  MAX_LABEL_CHARS: 60,
} as const;

/** A start as a button keeps it: the brief the new agent is handed as its first message, and what the agent named of its start. */
const startActionSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(REPLY_BUTTON_ACTION.START),
  prompt: EffectSchema.String,
  title: EffectSchema.optionalKey(EffectSchema.String),
  branch: EffectSchema.optionalKey(EffectSchema.String),
  model: EffectSchema.optionalKey(EffectSchema.String),
  effort: EffectSchema.optionalKey(EffectSchema.String),
});

/** A send as a button keeps it: the running agent it goes to, and the words it sends. */
const sendActionSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(REPLY_BUTTON_ACTION.SEND),
  agentId: EffectSchema.String,
  text: EffectSchema.String,
});

/** What a button does once pressed, as it is kept with the button. */
export const replyButtonActionSchema = EffectSchema.Union([startActionSchema, sendActionSchema]);

export type ReplyButtonAction = typeof replyButtonActionSchema.Type;
