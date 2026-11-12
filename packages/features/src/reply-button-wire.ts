import { Schema as EffectSchema } from "effect";
import { agentStartRequestFields, hasWordsOrFiles } from "./agent-wire.js";
import { decodedStep, encodedStep } from "./link-grammar.js";
import { isLinkHome, LINK_ORIGIN } from "./link-home.js";
import { parsedUrl } from "./parsed-url.js";

/**
 * reply-button-wire.ts -- a reply button: what an agent's button in its reply does once a member presses it, starting a new agent on a brief it wrote or sending its words to a running agent, and how a press stands.
 *
 * An agent makes a button with `add_suggestion` and writes its link beside the
 * line of its reply the button is about, `<home>/<workspace>/agent/<agent-id>/button/<button-id>`,
 * which the app draws as the button (`readReplyButtonLink`). It is no place
 * `link-grammar.ts` reads, so a build that knows no buttons, or a window with
 * the experiment off, draws it as the plain link it is. What it does is
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

/** The steps a button's link spells after its workspace's. */
const BUTTON_STEP = { AGENT: "agent", BUTTON: "button" } as const;

/** An id a button's link names: a uuid's spelling, as the store keeps both. */
const LINK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** A button's link read: the workspace it was written under, the agent whose reply holds it, and the button. */
export interface ReplyButtonLink {
  readonly workspace: string;
  readonly agentId: string;
  readonly buttonId: string;
}

/** The link an agent writes a button by, under its workspace's step. */
export function replyButtonLinkOf(link: ReplyButtonLink): string {
  const steps = [
    link.workspace,
    BUTTON_STEP.AGENT,
    link.agentId,
    BUTTON_STEP.BUTTON,
    link.buttonId,
  ];

  return [LINK_ORIGIN, ...steps.map(encodedStep)].join("/");
}

/** The button a link names, on our home by the web's scheme or the desktop's; nothing for any other address. */
export function readReplyButtonLink(target: string): ReplyButtonLink | undefined {
  const url = parsedUrl(target);

  if (url === undefined || !isLinkHome(url)) return undefined;
  const steps = url.pathname.replace(/\/$/u, "").split("/").slice(1).map(decodedStep);
  const [workspace, agentStep, agentId, buttonStep, buttonId, ...rest] = steps;

  if (workspace === undefined || workspace === "" || rest.length > 0) return undefined;

  if (agentStep !== BUTTON_STEP.AGENT || buttonStep !== BUTTON_STEP.BUTTON) return undefined;

  if (agentId === undefined || !LINK_ID.test(agentId)) return undefined;

  if (buttonId === undefined || !LINK_ID.test(buttonId)) return undefined;

  return { workspace, agentId, buttonId };
}

/**
 * What a member sends from a suggestion's draft: its words as they left
 * them, the files they attached, and, for a new agent, the title, branch,
 * and model with its effort the draft held, each bounded as a Start's is.
 * Words or files or both, never neither. A send to a running agent carries
 * no title, branch, or model, which the press refuses.
 */
export const replyButtonSentSchema = EffectSchema.Struct({
  words: agentStartRequestFields.note.schema,
  attachments: agentStartRequestFields.attachments,
  title: agentStartRequestFields.title,
  branch: agentStartRequestFields.branch,
  model: agentStartRequestFields.model,
  effort: agentStartRequestFields.effort,
  disabledServers: agentStartRequestFields.disabledServers,
  runsOn: agentStartRequestFields.runsOn,
  permissionMode: agentStartRequestFields.permissionMode,
}).check(EffectSchema.makeFilter(({ words, attachments }) => hasWordsOrFiles(words, attachments)));

export type ReplyButtonSent = typeof replyButtonSentSchema.Type;

/** The words a suggestion's line opens with, before a link to the agent that suggested it. */
export const SUGGESTION_LEAD = "Suggested by";

/** Where a suggestion line's lead ends and the member's words begin. */
const LEAD_END = ":\n\n";

/**
 * A suggestion's words as the agent they reach reads them: a lead naming the
 * agent that suggested them, by a link to it, over the words the member
 * sent, so the model, a retry, and a fork hand the link on with the words.
 * The transcript draws the lead as the line's head (`suggestionWords`).
 */
export function suggestionLine(mention: string, words: string): string {
  return `${SUGGESTION_LEAD} ${mention}${LEAD_END}${words}`;
}

/** A suggestion line's words as the transcript shows them under its head: the member's alone, the lead left out. */
export function suggestionWords(text: string): string {
  const end = text.indexOf(LEAD_END);

  return text.startsWith(`${SUGGESTION_LEAD} `) && end >= 0
    ? text.slice(end + LEAD_END.length)
    : text;
}

/** An agent a button names: its id, the task it stands on, whose box a message is drafted in, and its title as its tab names it. */
const namedAgentSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  taskId: EffectSchema.String,
  title: EffectSchema.String,
});

/** A button's press as it stands: when it was claimed, by whom by name where their account stands, whether by the member reading it, and the agent it reached once it landed. */
const replyButtonPressSchema = EffectSchema.Struct({
  at: EffectSchema.Number,
  by: EffectSchema.NullOr(EffectSchema.String),
  byReader: EffectSchema.Boolean,
  agent: EffectSchema.NullOr(namedAgentSchema),
});

/**
 * A button as the window draws it: its label, what a press does with the
 * brief whole, where a start runs (the button agent's repository, null for
 * none), the agent a send goes to, and its press, none until pressed.
 */
export const replyButtonViewSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  agentId: EffectSchema.String,
  label: EffectSchema.String,
  action: replyButtonActionSchema,
  repository: EffectSchema.NullOr(EffectSchema.String),
  sendTo: EffectSchema.NullOr(namedAgentSchema),
  pressed: EffectSchema.NullOr(replyButtonPressSchema),
});

export type ReplyButtonView = typeof replyButtonViewSchema.Type;
