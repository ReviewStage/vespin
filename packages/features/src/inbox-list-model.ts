/**
 * inbox-list-model.ts -- the Inbox's list as pure decisions, for every client that draws it: which items each scope lists and in what order, what each row's line says, and what the list's head and its empty list say.
 *
 * The list holds every item of every holder it is handed, the latest
 * changed first, in one run with no groups, the items its scope takes: what
 * needs the reader, what they are not done with, everything, or what they
 * set a reminder on, each scope counting its own. An item is the reader's
 * where it waits on them, or where the service does not say; only the
 * reader's open items need them. A row's line says what the thread asks or
 * how it ended rather than who said it last. The panel's Inbox
 * (`packages/panel/src/tasks/inbox-model.ts` and the rows that draw it) and
 * the iOS app's both read it here, so the two lists cannot disagree.
 * Nothing here draws.
 */

import { ATTACHMENT_VIEW, attachmentView } from "./attachment-model.js";
import { CONVERSATION_MEDIA_TYPE } from "./conversation-picture-wire.js";
import { fillInWords, WRITE_AN_ANSWER } from "./inbox-ask-words.js";
import {
  INBOX_PICTURE_IN_WORDS,
  inboxAttachmentOf,
  inboxPictureDestination,
} from "./inbox-attachment-link.js";
import {
  fieldValueWords,
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_MESSAGE_AUTHOR,
  INBOX_REPLY,
  INBOX_STATUS,
  type InboxAnswers,
  type InboxAsk,
  type InboxForm,
  type InboxFormValue,
  type InboxItem,
  type InboxMessage,
  type InboxReadAsk,
  type InboxReplyKind,
  inboxAgentsTurn,
  inboxWaitsOn,
  openAskOf,
  optionFileIds,
  optionsCarryMedia,
  recommendedLabels,
  threadNeedsReader,
} from "./inbox-wire.js";
import { insideCode } from "./mention-link.js";
import { plainWords } from "./plain-words.js";
import { matchesTokens } from "./search-tokens.js";
import type { TaskSummary } from "./task-wire.js";

/** What a phone's Inbox offers to clear every dot with, as the sidebar's rows offer it on a right-click. */
export const MARK_ALL_READ = "Mark all as read";

/** What marks a thread read or unread, on a row's menu and its swipe. */
export const INBOX_READ_MARK = {
  READ: "Mark as read",
  UNREAD: "Mark as unread",
} as const;

/** What the Inbox's search is named and says before anything is typed. */
export const SEARCH_INBOX = "Search inbox";

/** What the Inbox says while the account's feed of its threads is first read. */
export const READING_INBOX = "Reading your inbox…";

/** What the Inbox, the window's or a task's own, says where a read of its items did not answer. */
export const INBOX_NOT_READ = "The inbox could not be read.";

/** What tries a read again where it did not answer. */
export const RETRY = "Retry";

/** What a task's own Inbox says holding nothing at all. */
export const NOTHING_HERE = "Nothing here";

/** An ask this build knows, as a read carries it, with where it stands. */
export type InboxKnownAsk = Extract<InboxReadAsk, { type: InboxAsk["type"] }>;

/** A `decide` ask as a read carries it. */
export type InboxDecideAsk = Extract<InboxKnownAsk, { type: typeof INBOX_ASK.DECIDE }>;

/** A `do` ask as a read carries it. */
export type InboxDoAsk = Extract<InboxKnownAsk, { type: typeof INBOX_ASK.DO }>;

/** Whether an ask read off the wire is one this build knows, which its type decides. */
export function knownAsk(ask: InboxReadAsk): ask is InboxKnownAsk {
  return Object.values<string>(INBOX_ASK).includes(ask.type);
}

/**
 * Whether the item is a notice waiting on the reader's nod: open, and its
 * thread holding no ask open, so Got it settles it and reaches nobody, and
 * a reply settles it as it reaches the agent.
 */
export function awaitsNod(item: InboxItem): boolean {
  return item.status === INBOX_STATUS.OPEN && openAskOf(item.thread ?? []) === undefined;
}

/** What an option the agent recommends is called: the badge it wears, as a choice's or a form's option or as one of two small buttons, and the word after it on its row. */
export const RECOMMENDED = "Recommended";

/** The most characters an option may spell and still stand as one of two small buttons. */
const BUTTON_OPTION_CHARS = 24;

/**
 * Whether a `decide` is a yes or no in other words, approve or decline,
 * approve or request changes: exactly two short options of one pick with no
 * detail, drawn as two small buttons, the first going ahead and the second
 * holding back.
 */
export function decideButtons(ask: Pick<InboxDecideAsk, "options" | "multiple">): boolean {
  return (
    ask.multiple !== true &&
    !optionsCarryMedia(ask) &&
    ask.options.length === 2 &&
    ask.options.every(
      (option) => option.detail === undefined && option.label.length <= BUTTON_OPTION_CHARS,
    )
  );
}

/** Which way an answer goes: ahead, a check in green, or holding back, a turn back in gray, since holding back failed nothing. */
export const ANSWER_TONE = {
  AHEAD: "ahead",
  BACK: "back",
} as const;

export type AnswerTone = (typeof ANSWER_TONE)[keyof typeof ANSWER_TONE];

/** An answer as words: what the reply's stamp says, attached or sent, and which way it goes. */
export interface AnswerStamp {
  readonly tone: AnswerTone;
  readonly words: string;
}

/** The pick of two buttons' past tense, where its words are an act this build can say done; nothing for another. */
const DONE_WORDS: ReadonlyMap<string, string> = new Map([
  ["Approve", "Approved"],
  ["Decline", "Declined"],
  ["Request changes", "Changes requested"],
]);

/** The two buttons' pick an answer makes, and which of the two it is; none where the ask is no pair of buttons. */
function buttonPick(
  answers: InboxAnswers,
  ask: InboxReadAsk | undefined,
): { readonly label: string; readonly tone: AnswerTone } | undefined {
  if (ask === undefined || !knownAsk(ask) || ask.type !== INBOX_ASK.DECIDE) return undefined;
  if (!decideButtons(ask) || answers.reply !== INBOX_REPLY.CHOSE) return undefined;
  const label = answers.choices?.[0];
  const at = ask.options.findIndex((option) => option.label === label);
  if (label === undefined || at < 0) return undefined;
  return { label, tone: at === 0 ? ANSWER_TONE.AHEAD : ANSWER_TONE.BACK };
}

/** The steps a `do` answer ticked of those its ask shows, "2/3"; nothing where the ask named none. */
function stepCount(answers: InboxAnswers, ask: InboxReadAsk | undefined): string | undefined {
  if (ask === undefined || !knownAsk(ask) || ask.type !== INBOX_ASK.DO) return undefined;
  if (ask.steps.length === 0) return undefined;
  return `${(answers.steps ?? []).length}/${ask.steps.length}`;
}

/** Words with a count after them where there is one. */
function counting(words: string, count: string | undefined): string {
  return count === undefined ? words : `${words} ${count}`;
}

/** Whether an answer holds back: Couldn't do it, or the second of two buttons. */
function toneOf(answers: InboxAnswers, ask: InboxReadAsk | undefined): AnswerTone {
  const pick = buttonPick(answers, ask);
  if (pick !== undefined) return pick.tone;
  return answers.reply === INBOX_REPLY.NOT_DONE || answers.reply === INBOX_REPLY.DECLINED
    ? ANSWER_TONE.BACK
    : ANSWER_TONE.AHEAD;
}

/** What each answer but a pick or a to-do's says it was, once sent. */
const SENT_WORDS = {
  [INBOX_REPLY.CHOSE]: "chose",
  [INBOX_REPLY.APPROVED]: "approved",
  [INBOX_REPLY.DECLINED]: "declined",
  [INBOX_REPLY.ANSWERED]: "answered",
  [INBOX_REPLY.DONE]: "done",
  [INBOX_REPLY.NOT_DONE]: "couldn't do it",
  [INBOX_REPLY.SUBMITTED]: "submitted",
  [INBOX_REPLY.ACKNOWLEDGED]: "got it",
} as const satisfies Record<InboxReplyKind, string>;

/**
 * What a sent answer's stamp says on the thread, in the past: "Approved",
 * "Changes requested", "Chose 7 days", "Done 3/3", "Couldn't do it 1/3",
 * a to-do's steps ticked with no press, "Ticked 2/3", "Submitted", or
 * "Answered". The ask it answers is read where the thread
 * still carries it.
 */
export function sentStamp(answers: InboxAnswers, ask: InboxReadAsk | undefined): AnswerStamp {
  const tone = toneOf(answers, ask);
  const pick = buttonPick(answers, ask);
  const chose = `Chose ${(answers.choices ?? []).join(", ")}`;
  const words = (() => {
    switch (answers.reply) {
      case INBOX_REPLY.CHOSE:
        return pick === undefined ? chose : (DONE_WORDS.get(pick.label) ?? chose);
      case INBOX_REPLY.DONE:
        return counting("Done", stepCount(answers, ask));
      case INBOX_REPLY.NOT_DONE:
        return counting("Couldn't do it", stepCount(answers, ask));
      case INBOX_REPLY.ANSWERED: {
        // A to-do's steps ticked with no press decided nothing, so they say what was ticked.
        const count = answers.steps === undefined ? undefined : stepCount(answers, ask);
        return count === undefined ? sentenceCased(SENT_WORDS[answers.reply]) : `Ticked ${count}`;
      }
      default:
        return sentenceCased(SENT_WORDS[answers.reply]);
    }
  })();
  return { tone, words };
}

/**
 * Whether an item was closed by a member without an answer rather than taken
 * back by its agent. Note that the agent's close always says why, so a closed
 * item with no reason is a member's, whose account may be gone since.
 */
function closedByMember(item: InboxItem): boolean {
  return (
    item.status === INBOX_STATUS.CLOSED &&
    (item.closedBy !== undefined || item.closedReason === undefined)
  );
}

/** A member named on an item, as an answer's or a message's writer. */
type InboxMember = NonNullable<InboxItem["answeredBy"]>;

/** What parts a preview's words, as a menu's detail parts them. */
const PREVIEW_PART = " · ";

/** What files alone say where a message or an answer carried no words. */
function filesWords(files: readonly unknown[] | undefined): string | undefined {
  const count = files?.length ?? 0;
  if (count === 0) return undefined;
  return count === 1 ? "Sent a file" : `Sent ${count} files`;
}

/** A word set as the start of a sentence. */
function sentenceCased(words: string): string {
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/**
 * An item's row's second line, what it asks or how it ended rather than who
 * said it last, since the row's tile names the agent and its title asks the
 * question. While an ask waits, the ask itself (`askLine`): a choice's
 * options, the recommended one said so, "7 days (recommended) / 14 days"; a to-do's
 * steps left and the next, as the reader's draft ticks them (`ticked`), "2
 * steps left · Open Vercel"; a form's fields, "Fill in Name, Domain"; or
 * "Write an answer". Else the thread's latest message: an answer by its
 * answerer and its stamp, "You: Chose 7 days · and say it in the docs", a
 * member's words by their writer, and the agent's words alone, its tile
 * saying who.
 */
export function inboxPreview(
  item: InboxItem,
  nameOf: (member: InboxMember | undefined) => string,
  ticked?: readonly number[],
): string {
  const line = itemLine(item);
  return previewOf(line, nameOf, ticked, line.words);
}

/**
 * What a reader hears of an item's row's second line (`inboxPreview`): the
 * same words, but a message cut to its first line, the one the eye reads
 * before the row cuts it short, so a code block under it is never heard
 * whole.
 */
export function inboxPreviewHeard(
  item: InboxItem,
  nameOf: (member: InboxMember | undefined) => string,
  ticked?: readonly number[],
): string {
  const line = itemLine(item);
  return previewOf(line, nameOf, ticked, line.heard);
}

/** What an item's second line leads with, as its glyph says it: the kind of ask that waits, an answer that settled it, a member's resolve, or words alone. */
export const INBOX_LINE = {
  DECIDE: "decide",
  DO: "do",
  ANSWER: "answer",
  SETTLED: "settled",
  RESOLVED: "resolved",
  SAID: "said",
} as const;

export type InboxLineKind = (typeof INBOX_LINE)[keyof typeof INBOX_LINE];

/** Which glyph leads an item's second line (`inboxPreview`): its open ask's kind, an answer where its latest message carries one, Resolve's where a member resolved it, or none. */
export function inboxLineKind(item: InboxItem): InboxLineKind {
  return itemLine(item).kind;
}

/** A settled item's standing in one word: answered, sent by the member who started it, resolved by a member without an answer, or withdrawn by its agent. */
export const INBOX_SETTLED_STANDING = {
  ANSWERED: "Answered",
  STARTED: "Sent",
  RESOLVED: "Resolved",
  WITHDRAWN: "Withdrawn",
} as const;

/**
 * Where a settled item stands, as its row's card says it under its title,
 * in one word: a close naming its closer is a member's, though it withdrew
 * the ask it left open, then an ask the agent took back, so the card never
 * calls one ending two names.
 */
export function inboxSettledStanding(
  item: InboxItem,
): (typeof INBOX_SETTLED_STANDING)[keyof typeof INBOX_SETTLED_STANDING] {
  if (item.status === INBOX_STATUS.ANSWERED) {
    // A thread a member started stands settled on their own nod until its agent writes on it.
    const thread = item.thread ?? [];
    const sent =
      thread.length > 0 &&
      thread.every((message) => message.author === INBOX_MESSAGE_AUTHOR.MEMBER);
    return sent ? INBOX_SETTLED_STANDING.STARTED : INBOX_SETTLED_STANDING.ANSWERED;
  }
  if (item.closedBy !== undefined) return INBOX_SETTLED_STANDING.RESOLVED;
  const withdrawn = (item.thread ?? []).some(
    (each) => each.ask?.status === INBOX_ASK_STATUS.WITHDRAWN,
  );
  return !withdrawn && closedByMember(item)
    ? INBOX_SETTLED_STANDING.RESOLVED
    : INBOX_SETTLED_STANDING.WITHDRAWN;
}

/** What an open ask asks, as its row's second line says it (`inboxPreview`). */
function askLine(ask: InboxKnownAsk, ticked: readonly number[]): string {
  switch (ask.type) {
    case INBOX_ASK.DECIDE:
      return ask.options
        .map((option) =>
          recommendedLabels(ask).includes(option.label)
            ? `${option.label} (${RECOMMENDED.toLowerCase()})`
            : option.label,
        )
        .join(" / ");
    case INBOX_ASK.DO: {
      const steps = ask.steps.map((step) => plainWords(step));
      if (steps.length === 0) return "Mark done";
      const done = new Set(ticked.filter((at) => at < steps.length));
      const next = steps.find((_, at) => !done.has(at));
      if (next === undefined) return "Every step ticked · Mark done";
      const left = steps.length - done.size;
      return `${left} ${left === 1 ? "step" : "steps"} left${PREVIEW_PART}${next}`;
    }
    case INBOX_ASK.ANSWER:
      return ask.fields === undefined
        ? WRITE_AN_ANSWER
        : fillInWords(ask.fields.map((field) => field.label));
  }
}

/** The glyph an open ask's line leads with, by the kind of ask. */
const ASK_LINE = {
  [INBOX_ASK.DECIDE]: INBOX_LINE.DECIDE,
  [INBOX_ASK.DO]: INBOX_LINE.DO,
  [INBOX_ASK.ANSWER]: INBOX_LINE.ANSWER,
} as const satisfies Record<InboxKnownAsk["type"], InboxLineKind>;

/** What an item's row says of its thread as the item alone says it, read once and kept with it (`itemLine`). */
interface ItemLine {
  readonly kind: InboxLineKind;
  /** The open ask the line says, where one waits that this build knows. */
  readonly ask: InboxKnownAsk | undefined;
  /** The ask's words with no step ticked, or the latest message's words without who said them. */
  readonly words: string;
  /** The same words as a reader hears them: the latest message's first line alone. */
  readonly heard: string;
  /** Whether the latest message is the agent's, whose words its row says alone, its tile saying who. */
  readonly byAgent: boolean;
  /** The member who said the latest message, where the agent did not. */
  readonly member: InboxMember | undefined;
}

/** Each item's line as `itemLine` last read it, kept for as long as the item stands. */
const itemLines = new WeakMap<InboxItem, ItemLine>();

/**
 * What an item's row says of its thread, as the item alone says it: the
 * glyph its line leads with, the ask that waits, and the words of the ask
 * or of the thread's latest message: an answer by its stamp's words first,
 * "Chose 7 days · and say it in the docs", a message's words, or its files
 * where it said nothing. Note that it is read from the thread's markdown
 * once and kept with the item, as its search words are (`inboxItemWords`),
 * because every row of a long Inbox asks for it as it draws, and an item
 * that changes arrives as a new one; who said it, and the steps a draft
 * ticks, are the row's to add (`inboxPreview`).
 */
function itemLine(item: InboxItem): ItemLine {
  const held = itemLines.get(item);
  if (held !== undefined) return held;
  const thread = item.thread ?? [];
  const asking = openAskOf(thread);
  const last = thread.at(-1);
  // Note that a member's resolve says so in its own word, rather than the agent's last words, which would read as still waiting.
  const resolved =
    item.status === INBOX_STATUS.CLOSED &&
    inboxSettledStanding(item) === INBOX_SETTLED_STANDING.RESOLVED;
  const line: ItemLine = resolved
    ? {
        kind: INBOX_LINE.RESOLVED,
        ask: undefined,
        words: INBOX_SETTLED_STANDING.RESOLVED,
        heard: INBOX_SETTLED_STANDING.RESOLVED,
        byAgent: true,
        member: undefined,
      }
    : asking !== undefined && knownAsk(asking.ask)
      ? {
          kind: ASK_LINE[asking.ask.type],
          ask: asking.ask,
          words: askLine(asking.ask, []),
          heard: askLine(asking.ask, []),
          byAgent: true,
          member: undefined,
        }
      : {
          kind: last?.answers === undefined ? INBOX_LINE.SAID : INBOX_LINE.SETTLED,
          ask: undefined,
          words: last === undefined ? "" : lastWords(thread, last, plainWords),
          heard: last === undefined ? "" : lastWords(thread, last, firstWords),
          byAgent: last === undefined || last.author === INBOX_MESSAGE_AUTHOR.AGENT,
          member: last?.member,
        };
  itemLines.set(item, line);
  return line;
}

/** The open ask an item's row says, where one waits that this build knows; none for a thread its line reads as said, settled, or resolved. */
export function inboxLineAsk(item: InboxItem): InboxKnownAsk | undefined {
  return itemLine(item).ask;
}

/** An item's second line from its line's `words`: the ask, as the draft ticks it, or the message's words after who said them where the agent did not. */
function previewOf(
  line: ItemLine,
  nameOf: (member: InboxMember | undefined) => string,
  ticked: readonly number[] | undefined,
  words: string,
): string {
  if (line.ask !== undefined) {
    return ticked === undefined || ticked.length === 0 ? line.words : askLine(line.ask, ticked);
  }
  return line.byAgent ? words : `${nameOf(line.member)}: ${words}`;
}

/** A message's first line that says anything, as plain words (`plainWords`): a fence's line is passed over, and nothing under the first is kept. */
function firstWords(text: string): string {
  return (
    text
      .split("\n")
      .map(plainWords)
      .find((line) => line !== "") ?? ""
  );
}

/**
 * A thread's latest message as its row says it, before who said it: an
 * answer by its stamp's words first, "Chose 7 days · and say it in the
 * docs", a message's words, and its files where it said nothing.
 */
function lastWords(
  thread: readonly InboxMessage[],
  last: InboxMessage,
  read: (text: string) => string,
): string {
  const words = read(last.text);
  const answers = last.answers;
  if (answers === undefined) return words === "" ? (filesWords(last.files) ?? "") : words;
  const stamp = sentStamp(answers, thread.find((each) => each.id === answers.ask)?.ask).words;
  return words === "" ? stamp : `${stamp}${PREVIEW_PART}${words}`;
}

/**
 * What holds an item: the task its agent works on. Note that every item
 * names its task, since every agent works on one.
 */
export interface InboxHolder {
  readonly task: TaskSummary;
}

/**
 * Each task's holder as last made, kept for as long as the task stands.
 * Note that a list read again from the same task is held by the same
 * holder, because the window's document keeps the identity of what a
 * delivery did not change (`keepIdentity`), and every object the list makes
 * of a holder is kept by it in turn.
 */
const keptHolders = new WeakMap<TaskSummary, InboxHolder>();

/** A task as the holder of its items, kept (`keptHolders`). */
export function taskHolder(task: TaskSummary): InboxHolder {
  const kept = keptHolders.get(task);
  if (kept !== undefined) return kept;
  const holder: InboxHolder = { task };
  keptHolders.set(task, holder);
  return holder;
}

/** The words options say: each one's label and the trade-off written under it. */
function optionWords(options: readonly { label: string; detail?: string }[]): readonly string[] {
  return options.flatMap((option) => [option.label, option.detail ?? ""]);
}

/** The words a form's fields say: each one's label and a select's options. */
function fieldWords(fields: readonly InboxForm["fields"][number][]): readonly string[] {
  return fields.flatMap((field) => [field.label, ...(field.options ?? [])]);
}

/** The words a filled form says: each field's label and its value as words. */
function valueWords(values: readonly InboxFormValue[] | undefined): readonly string[] {
  return (values ?? []).flatMap((each) => [each.label, fieldValueWords(each.value)]);
}

/** The words an ask offers: a decision's options, a to-do's steps, and an answer's fields; none of an ask this build does not know. */
function askWords(ask: InboxReadAsk | undefined): readonly string[] {
  if (ask === undefined || !knownAsk(ask)) return [];
  if (ask.type === INBOX_ASK.DECIDE) return optionWords(ask.options);
  if (ask.type === INBOX_ASK.DO) return ask.steps.map(plainWords);
  return fieldWords(ask.fields ?? []);
}

/** Each item's words as `inboxItemWords` last read them, kept for as long as the item stands. */
const itemWords = new WeakMap<InboxItem, readonly string[]>();

/**
 * Every line of words an item says, as a search reads it: its title, and
 * each message of its thread and what that asks, picks, or fills in. Note
 * that it names no address, id, or member, because a query typed is about
 * what was said, and an address holds letters enough to match almost
 * anything. Note too that an item's words are read from its markdown once
 * and kept with it, because a search asks for every item's words on each
 * key, and an item that changes arrives as a new one.
 */
export function inboxItemWords(item: InboxItem): readonly string[] {
  const kept = itemWords.get(item);
  if (kept !== undefined) return kept;
  const said = (item.thread ?? []).flatMap((message) => [
    plainWords(message.text),
    ...askWords(message.ask),
    ...(message.answers?.choices ?? []),
    ...valueWords(message.answers?.values),
  ]);
  const words = [item.title, ...said].filter((each) => each.length > 0);
  itemWords.set(item, words);
  return words;
}

/** Whether an item answers a list's search: every word of it somewhere in the item's words (`inboxItemWords`) or its task's name; any item answers none. */
function searchedItem(holder: InboxHolder, item: InboxItem, search: readonly string[]): boolean {
  return search.length === 0 || matchesTokens([holder.task.name, ...inboxItemWords(item)], search);
}

/** Every task's items as a read holds them, by the task's id. */
export type InboxReads = ReadonlyMap<string, readonly InboxItem[]>;

/**
 * Every task as the Inbox groups it, with its items as `read` holds them:
 * each task main says holds items that the listed workspace's list holds,
 * so one not yet read, or another workspace's, is listed nowhere. Note that
 * a task's status never leaves it out: a task done or canceled is listed,
 * its items with it. Each task's group is the one made last while its
 * items are (`inboxGroup`), so the page drawn again regroups nothing that
 * did not move.
 */
export function inboxGroups(
  read: InboxReads,
  holders: {
    readonly tasks: readonly { readonly taskId: string }[];
    readonly listed: readonly TaskSummary[];
  },
): readonly InboxGroup[] {
  const listed = new Map(holders.listed.map((task) => [task.id, task]));
  return holders.tasks.flatMap(({ taskId }) => {
    const task = listed.get(taskId);
    if (task === undefined) return [];
    return [inboxGroup(taskHolder(task), read.get(taskId) ?? NO_ITEMS)];
  });
}

/**
 * Which items an Inbox lists, as its view's menu chooses: Questions, the
 * questions whose ask waits on the reader's answer (`threadNeedsReader`),
 * which Addressed to never narrows; Open, every
 * thread the reader is not done with, a question not yet answered, a notice
 * not yet opened, or a thread they have not read since it changed or marked
 * unread, bar a withdrawn ask they left alone, which Addressed to then narrows; All, every item, open and
 * settled; or Reminders, the items the reader set a reminder on, which the other three
 * leave out until they come back. Note that Open keeps the value To do was kept by, so a scope
 * kept before it reads as Open. Note too that no scope asks where the
 * item's task stands: an item of a task done or canceled is listed and
 * counted as any other, the Inbox being a feed of what the agents got done.
 */
export const INBOX_SHOW = {
  NEEDS_ME: "needs-me",
  OPEN: "to-do",
  ALL: "all",
  REMINDERS: "reminders",
} as const;

export type InboxShow = (typeof INBOX_SHOW)[keyof typeof INBOX_SHOW];

/** Whom the window's Inbox lists items addressed to: anyone, the reader, or one teammate, by their account and the name they had when chosen, which names them once they leave. */
export const INBOX_WHOSE = {
  EVERYONE: "everyone",
  MINE: "mine",
  PERSON: "person",
} as const;

export type InboxWhose =
  | { readonly kind: typeof INBOX_WHOSE.EVERYONE }
  | { readonly kind: typeof INBOX_WHOSE.MINE }
  | { readonly kind: typeof INBOX_WHOSE.PERSON; readonly userId: string; readonly name: string };

/** Anyone's items, as a task's own Inbox lists them. */
export const EVERYONES: InboxWhose = { kind: INBOX_WHOSE.EVERYONE };

/** The reader's own items, as the window's Inbox lists them until told otherwise. */
export const MINE: InboxWhose = { kind: INBOX_WHOSE.MINE };

/** How many items each scope lists, filtered out by the scope shown or not. */
export interface InboxCounts {
  readonly [INBOX_SHOW.NEEDS_ME]: number;
  readonly [INBOX_SHOW.OPEN]: number;
  readonly [INBOX_SHOW.ALL]: number;
  readonly [INBOX_SHOW.REMINDERS]: number;
}

/** One task and every item it holds, as the list is handed them. */
export interface InboxGroup {
  readonly holder: InboxHolder;
  readonly items: readonly InboxItem[];
}

/** One item the list draws, with what holds it. */
export interface InboxListed {
  readonly holder: InboxHolder;
  readonly item: InboxItem;
}

/** A holder holding nothing, the one empty list every such group holds. */
export const NO_ITEMS: readonly InboxItem[] = [];

/** Each holder's group as last made, kept while it holds the same items (`inboxGroup`). */
const keptGroups = new WeakMap<InboxHolder, InboxGroup>();

/**
 * A holder and every item it holds as one group: the one made last for the
 * holder while its items are the same list, so a list read again from items
 * that did not move groups them in the objects it grouped them in before.
 */
export function inboxGroup(holder: InboxHolder, items: readonly InboxItem[]): InboxGroup {
  const kept = keptGroups.get(holder);
  if (kept?.items === items) return kept;
  const group = { holder, items };
  keptGroups.set(holder, group);
  return group;
}

/** Each item as last listed, kept while the same holder holds it (`inboxListed`). */
const keptListed = new WeakMap<InboxItem, InboxListed>();

/**
 * An item listed under what holds it: the one listed last while its holder
 * is the same, so a list drawn again lists an item that did not move in the
 * object it listed it in before, and the item's row, which is drawn again
 * only for another (`InboxItemRow`), stands as it was.
 */
function inboxListed(holder: InboxHolder, item: InboxItem): InboxListed {
  const kept = keptListed.get(item);
  if (kept?.holder === holder) return kept;
  const listed = { holder, item };
  keptListed.set(item, listed);
  return listed;
}

/**
 * The list as it is drawn: every item it shows in one run, the latest
 * changed first; and the reader it was drawn for, whose items alone need
 * them.
 */
export interface InboxListView {
  readonly readerId: string | undefined;
  readonly items: readonly InboxListed[];
}

/**
 * Whether an item is the reader's: it waits on them (`inboxWaitsOn`), or on
 * nobody the service names, or is read before the reader's own id is known,
 * as main counts what waits on the account and as every item read before.
 */
export function readersItem(item: InboxItem, readerId: string | undefined): boolean {
  const waitsOn = inboxWaitsOn(item)?.userId;
  return waitsOn === undefined || readerId === undefined || waitsOn === readerId;
}

/** Whether an item needs the reader: open, theirs (`readersItem`), and not its agent's turn (`inboxAgentsTurn`); a teammate's open item waits on the teammate. */
function needsReader(item: InboxItem, readerId: string | undefined): boolean {
  return item.status === INBOX_STATUS.OPEN && readersItem(item, readerId) && !inboxAgentsTurn(item);
}

/**
 * Whether an item waits on the reader at `now`: it needs them (`needsReader`)
 * and holds no reminder still ahead (`remindsLater`), what Open lists for them
 * and every count of what needs them counts, the sidebar's Inbox row's among
 * them (`places-waiting.ts`'s `waitingThreads`).
 */
export function waitsOnReaderNow(
  item: InboxItem,
  readerId: string | undefined,
  now: number,
): boolean {
  return needsReader(item, readerId) && !remindsLater(item, now);
}

/**
 * Whether opening the item acknowledges it, as Got it did: a notice that
 * offers Got it (`awaitsNod`), the reader's own (`needsReader`) by an id already
 * known, since an acknowledgment settles it for every member, and one
 * whose agent does not wait to hear back (`needsReply`), since a notice
 * that asks to be heard back would reach its agent on a mere open. A box
 * holding no words or files for it offers no Got it.
 */
export function acknowledgedOnOpen(item: InboxItem, readerId: string | undefined): boolean {
  return (
    readerId !== undefined && needsReader(item, readerId) && awaitsNod(item) && !item.needsReply
  );
}

/**
 * Whether marking the item read by hand at `now` acknowledges it too, as
 * opening it does (`acknowledgedOnOpen`): the reader's own notice, asking
 * nothing, and no reminder on it still ahead (`remindsLater`), since one put
 * away until later keeps it; one whose reminder came due is settled.
 */
export function settledOnRead(item: InboxItem, readerId: string | undefined, now: number): boolean {
  return acknowledgedOnOpen(item, readerId) && !remindsLater(item, now);
}

/** Whether a listed item needs the reader (`needsReader`), whatever its task's status. */
export function needsYou(listed: InboxListed, readerId: string | undefined): boolean {
  return needsReader(listed.item, readerId);
}

/** The groups of an Inbox narrowed to one task: that task's alone, as a task's "needs you" count opens it. */
export function taskGroups(groups: readonly InboxGroup[], taskId: string): readonly InboxGroup[] {
  return groups.filter(({ holder }) => holder.task.id === taskId);
}

/**
 * Every open item, whoever's, the latest changed first, as Home and a
 * person's page list what waits (`use-waiting-items.ts`).
 */
export function openItems(groups: readonly InboxGroup[]): readonly InboxListed[] {
  return groups
    .flatMap(({ holder, items }) => items.map((item) => inboxListed(holder, item)))
    .filter((listed) => needsYou(listed, undefined))
    .toSorted((a, b) => newestFirst(a.item, b.item));
}

/** The latest change first. */
function newestFirst(a: InboxItem, b: InboxItem): number {
  return b.updatedAt - a.updatedAt;
}

/**
 * Where a listed item stands in a list's order: when it changed, as the
 * list first drew it. A list held still while it is shown is drawn from
 * this rather than from the item as it is now, so an answer, which changes
 * it, moves no row (`inboxPlaces`).
 */
export interface InboxPlace {
  readonly at: number;
}

/** No item's place held: every item stands where it is now. */
export const NO_PLACES: ReadonlyMap<string, InboxPlace> = new Map();

/** No search: every item answers it. */
const NO_SEARCH: readonly string[] = [];

/** Whether an item is one Addressed to lists: anyone's, the reader's own (`readersItem`), or one that waits on the teammate (`inboxWaitsOn`). */
function whoseItem(whose: InboxWhose, item: InboxItem, readerId: string | undefined): boolean {
  switch (whose.kind) {
    case INBOX_WHOSE.EVERYONE:
      return true;
    case INBOX_WHOSE.MINE:
      return readersItem(item, readerId);
    case INBOX_WHOSE.PERSON:
      return inboxWaitsOn(item)?.userId === whose.userId;
  }
}

/** Whether Addressed to narrows a scope: every scope but Questions, which names the reader already. */
export function narrowedByWhose(show: InboxShow): boolean {
  return show !== INBOX_SHOW.NEEDS_ME;
}

/** Whether a scope lists the item (`showsItem`) addressed to whom Addressed to names where it narrows the scope (`narrowedByWhose`). */
function scopedItem(
  show: InboxShow,
  whose: InboxWhose,
  item: InboxItem,
  readerId: string | undefined,
): boolean {
  return (
    showsItem(show, item, readerId) && (!narrowedByWhose(show) || whoseItem(whose, item, readerId))
  );
}

/**
 * The list from every task's items, in one run, the latest changed first.
 * The scope shown lists only the items it takes addressed to whom Addressed
 * to names where it narrows the scope (`scopedItem`) that its search finds
 * (`searchedItem`), and the
 * item chosen where one is given. Note that the rows a list draws are given
 * only the chosen item they drew already, kept while it stays chosen
 * (`use-held-inbox-list.ts`), so a settled item leaves a list filtered to
 * exclude it once another is chosen, while the steps through the list are
 * given the item the pane shows, which keeps its place among them so K, J,
 * and Next still reach the rows either side of it. An item whose place is
 * held (`places`) stands there, rather than where it changed last.
 */
export function inboxList(
  tasks: readonly InboxGroup[],
  view: {
    readonly show: InboxShow;
    readonly chosen: string | undefined;
    /** The signed-in account's id, whose own open items alone need them; none counts every item as theirs. */
    readonly readerId: string | undefined;
    /** Whom the items listed are addressed to; anyone where none is given. */
    readonly whose?: InboxWhose | undefined;
    /** The words of the list's search (`searchTokens`), each somewhere in every item listed; none narrows nothing. */
    readonly search?: readonly string[] | undefined;
    /** Where the items held still stand (`inboxPlaces`), each other item where it is now; none holds every item where it is now. */
    readonly places?: ReadonlyMap<string, InboxPlace> | undefined;
  },
): InboxListView {
  const { readerId, whose = EVERYONES, search = NO_SEARCH, places = NO_PLACES } = view;
  const at = (item: InboxItem): number => places.get(item.id)?.at ?? item.updatedAt;
  const items = tasks
    .flatMap(({ holder, items }) =>
      items
        .filter(
          (item) =>
            (scopedItem(view.show, whose, item, readerId) && searchedItem(holder, item, search)) ||
            item.id === view.chosen,
        )
        .map((item) => inboxListed(holder, item)),
    )
    .toSorted((a, b) => at(b.item) - at(a.item));
  return { items, readerId };
}

/**
 * Where each row of a list stands, to hold it still while the list is
 * shown: the place held for it where it has one, else where it is now. An
 * item the list no longer draws holds no place, so once it is listed again
 * it stands where it is then.
 */
export function inboxPlaces(
  view: InboxListView,
  held: ReadonlyMap<string, InboxPlace>,
): ReadonlyMap<string, InboxPlace> {
  return new Map(
    view.items.map(({ item }) => [item.id, held.get(item.id) ?? { at: item.updatedAt }]),
  );
}

/** Whether an item is unread for the reader: changed since they last read it, or marked unread; an item from a service before read state reads as read. */
export function isUnread(item: InboxItem): boolean {
  return item.unread === true;
}

/** Whether the reader set a reminder on the item and it has not come back, as `inboxAtNow` leaves its reminder on it. */
export function hasReminder(item: InboxItem): boolean {
  return item.remindAt !== undefined;
}

/** Whether the reader's reminder on the item is still ahead at `now`, which leaves it out of every count until it comes due. */
function remindsLater(item: Pick<InboxItem, "remindAt">, now: number): boolean {
  return item.remindAt !== undefined && item.remindAt > now;
}

/**
 * An item as it stands for the reader at `now`: put away while its reminder is
 * ahead, read or unread alike; and back where it has passed, as changed
 * then, so it lists at the top, read or unread as it was. A change ends a
 * reminder early by the service answering none. Only an item with a reminder keeps
 * `remindAt` (`hasReminder`), and an item it leaves as it was is the very
 * one handed in.
 */
function itemAtNow(item: InboxItem, now: number): InboxItem {
  const { remindAt, ...rest } = item;
  if (remindAt === undefined || remindAt > now) return item;
  return { ...rest, updatedAt: Math.max(item.updatedAt, remindAt) };
}

/** Every holder's items as they stand for the reader at `now` (`itemAtNow`), each group handed in kept where none of its items moved. */
export function inboxAtNow(groups: readonly InboxGroup[], now: number): readonly InboxGroup[] {
  return groups.map((group) => {
    const items = group.items.map((item) => itemAtNow(item, now));
    return items.every((item, index) => item === group.items[index]) ? group : { ...group, items };
  });
}

/**
 * Whether a thread closed without an answer, its ask withdrawn by its agent,
 * a member, or its task's or agent's settle, says nothing new to the
 * reader: they neither marked it unread nor missed a message written on it
 * since it closed. Note that an item from a service before `settledAt` was
 * kept reads its last change as its close, as the service does.
 */
function closedQuietly(item: InboxItem): boolean {
  if (item.status !== INBOX_STATUS.CLOSED || item.markedUnread === true) return false;
  return item.updatedAt <= (item.settledAt ?? item.updatedAt);
}

/**
 * Whether the reader is done with an item, as its row is drawn gray:
 * settled, answered or closed, and read since, or closed without an answer
 * and saying nothing new (`closedQuietly`), since a withdrawn ask asks
 * nothing of them however unread it stands.
 */
export function isDone(item: InboxItem): boolean {
  return item.status !== INBOX_STATUS.OPEN && (!isUnread(item) || closedQuietly(item));
}

/**
 * Whether a scope lists the item: Questions every question whose ask waits
 * on the reader (`threadNeedsReader`) but for those with a reminder, a
 * notice never; Open every
 * thread the reader is not done with (`isDone`), one still open, one
 * answered since they last read it, or one closed without an answer that
 * they marked unread or that was written on since it closed, as a mail
 * app's inbox keeps what is unread; and All all of them, each leaving out what the
 * reader set a reminder on (`hasReminder`), which Reminders alone lists. Note that Open
 * reads the reader's own read state rather than the thread's status alone,
 * because a notice settles as it is opened (`acknowledgedOnOpen`), so a
 * thread marked unread comes back to Open whatever settled it, and a row
 * drawn gray is one Open has let go.
 */
function showsItem(show: InboxShow, item: InboxItem, readerId: string | undefined): boolean {
  switch (show) {
    case INBOX_SHOW.NEEDS_ME:
      return threadNeedsReader(item, readerId) && !hasReminder(item);
    case INBOX_SHOW.OPEN:
      return !isDone(item) && !hasReminder(item);
    case INBOX_SHOW.ALL:
      return !hasReminder(item);
    case INBOX_SHOW.REMINDERS:
      return hasReminder(item);
  }
}

/** How many of every task's items each scope lists, of those addressed to whom Addressed to names where it narrows the scope (`scopedItem`). */
export function inboxCounts(
  tasks: readonly InboxGroup[],
  readerId: string | undefined,
  whose: InboxWhose = EVERYONES,
): InboxCounts {
  const items = tasks.flatMap(({ holder, items }) =>
    items.map((item) => inboxListed(holder, item)),
  );
  const count = (show: InboxShow) =>
    items.filter(({ item }) => scopedItem(show, whose, item, readerId)).length;
  return {
    [INBOX_SHOW.NEEDS_ME]: count(INBOX_SHOW.NEEDS_ME),
    [INBOX_SHOW.OPEN]: count(INBOX_SHOW.OPEN),
    [INBOX_SHOW.ALL]: count(INBOX_SHOW.ALL),
    [INBOX_SHOW.REMINDERS]: count(INBOX_SHOW.REMINDERS),
  };
}

/** Whether Mark all as read at `now` would change anything: a task's item is unread, or a notice it acknowledges stands (`settledOnRead`), listed or filtered out. */
export function anyToMarkRead(
  tasks: readonly InboxGroup[],
  readerId: string | undefined,
  now: number,
): boolean {
  return tasks.some(({ items }) =>
    items.some((item) => isUnread(item) || settledOnRead(item, readerId, now)),
  );
}

/** Every item the list draws, in the order it draws them. */
export function listedItems(view: InboxListView): readonly InboxListed[] {
  return view.items;
}

/** Where the chosen item stands among those listed, counted from one, and the items either side of it in the list's order. */
export interface InboxSteps {
  readonly at: number;
  readonly total: number;
  readonly previous: InboxListed | undefined;
  readonly next: InboxListed | undefined;
}

/** The chosen item's place among the rows, in the list's own order and filter as drawn; none where the list does not hold it. */
export function inboxSteps(
  view: InboxListView,
  chosen: string | undefined,
): InboxSteps | undefined {
  const rowed = view.items;
  const at = rowed.findIndex(({ item }) => item.id === chosen);
  if (at < 0) return undefined;
  return { at: at + 1, total: rowed.length, previous: rowed[at - 1], next: rowed[at + 1] };
}

/** The list's first and last rows, in its own order and filter as drawn; none where it draws no row. */
export function inboxEnds(
  view: InboxListView,
): { readonly first: InboxListed; readonly last: InboxListed } | undefined {
  const first = view.items[0];
  const last = view.items.at(-1);
  return first === undefined || last === undefined ? undefined : { first, last };
}

/** The scopes a view's menu offers, in its order. */
export const INBOX_SCOPES = [
  INBOX_SHOW.NEEDS_ME,
  INBOX_SHOW.OPEN,
  INBOX_SHOW.ALL,
  INBOX_SHOW.REMINDERS,
] as const satisfies readonly InboxShow[];

/** What each scope is called, in a view's menu and the list's region's name. */
export const INBOX_SHOW_LABEL = {
  [INBOX_SHOW.NEEDS_ME]: "Questions",
  [INBOX_SHOW.OPEN]: "Open",
  [INBOX_SHOW.ALL]: "All",
  [INBOX_SHOW.REMINDERS]: "Reminders",
} as const satisfies Record<InboxShow, string>;

/** What the Reminders scope says holding no item the reader set a reminder on. */
const NO_REMINDERS = "No reminders";

/** What Open says holding no thread the reader is not done with. */
const NOTHING_OPEN = "Nothing open";

/** What Questions says holding no question that waits on the reader, whomever Addressed to names. */
const NOTHING_QUESTIONS = "No questions wait on you";

/** What the list says where its scope and Addressed to leave out every item it holds, by whom Addressed to names. */
export const INBOX_SHOW_EMPTY = {
  [INBOX_WHOSE.MINE]: {
    [INBOX_SHOW.NEEDS_ME]: NOTHING_QUESTIONS,
    [INBOX_SHOW.OPEN]: NOTHING_OPEN,
    [INBOX_SHOW.ALL]: "Nothing addressed to you",
    [INBOX_SHOW.REMINDERS]: NO_REMINDERS,
  },
  [INBOX_WHOSE.EVERYONE]: {
    [INBOX_SHOW.NEEDS_ME]: NOTHING_QUESTIONS,
    [INBOX_SHOW.OPEN]: NOTHING_OPEN,
    [INBOX_SHOW.ALL]: NOTHING_HERE,
    [INBOX_SHOW.REMINDERS]: NO_REMINDERS,
  },
  [INBOX_WHOSE.PERSON]: {
    [INBOX_SHOW.NEEDS_ME]: NOTHING_QUESTIONS,
    [INBOX_SHOW.OPEN]: "Nothing addressed to them",
    [INBOX_SHOW.ALL]: "Nothing addressed to them",
    [INBOX_SHOW.REMINDERS]: NO_REMINDERS,
  },
} as const satisfies Record<InboxWhose["kind"], Record<InboxShow, string>>;

/** One file a message carried, as its thread reads it. */
type InboxMessageFile = NonNullable<InboxMessage["files"]>[number];

/** A comment's files as they are drawn after its words: its pictures, and every other file. */
export interface InboxCommentFiles {
  readonly pictures: readonly InboxMessageFile[];
  readonly others: readonly InboxMessageFile[];
}

/**
 * A comment's files as they are drawn after its words, each in the order
 * attached: a picture its words already draw left out, since it stands
 * where they draw it, as an agent's pictures do, then the pictures and
 * every other file apart, as each is drawn in its own way. A WebM an agent
 * recorded is drawn as a picture is, played in its place (`inbox-pictures.tsx`),
 * so one the words draw is not named again as a file. Note that only
 * a picture the words draw as one is left out (`picturesDrawn`): a file
 * they only link to, quote in code, or name as a picture though it is
 * none is still drawn here, so it can still be opened.
 */
export function inboxCommentFiles(
  files: readonly InboxMessageFile[],
  words: string | undefined,
  itemId: string,
): InboxCommentFiles {
  const picture = (file: InboxMessageFile) =>
    attachmentView({ name: file.name, mediaType: file.mediaType, url: "" }) ===
      ATTACHMENT_VIEW.IMAGE || file.mediaType === CONVERSATION_MEDIA_TYPE.WEBM;
  const drawn = new Set(
    words === undefined ? [] : picturesDrawn(words, itemId).map((each) => each.attachmentId),
  );
  const after = files.filter((file) => !(picture(file) && drawn.has(file.attachmentId)));
  return {
    pictures: after.filter(picture),
    others: after.filter((file) => !picture(file)),
  };
}

/**
 * The item's own pictures a message's words draw, where each is drawn: a
 * picture, `![alt](address)`, whose address names one of the item's, as
 * the pane draws it (`inbox-pictures.tsx`). Note that one written in code
 * is code, which the pane draws as words, and a bare address is a link.
 */
function picturesDrawn(
  text: string,
  itemId: string,
): readonly { readonly at: number; readonly attachmentId: string }[] {
  return [...text.matchAll(INBOX_PICTURE_IN_WORDS)].flatMap((match) => {
    if (insideCode(text, match.index)) return [];
    const named = inboxAttachmentOf(inboxPictureDestination(match[2] ?? ""));
    return named?.itemId === itemId ? [{ at: match.index, attachmentId: named.attachmentId }] : [];
  });
}

/** What a member is called where the reader's directory is not at hand: the reader as You, a member by their name, and one whose account is gone as a former member. */
const MEMBER_WORDS = {
  YOU: "You",
  FORMER: "Former member",
} as const;

/** A member as a row's line or a message's writer names them, without the window's directory: the reader as You, anyone else by the name the item carries. */
export function inboxMemberName(
  member: InboxMember | undefined,
  readerId: string | undefined,
): string {
  if (member === undefined) return MEMBER_WORDS.FORMER;
  return readerId !== undefined && member.userId === readerId ? MEMBER_WORDS.YOU : member.name;
}

/** How a file after a message's words is drawn: a picture, or a video in a player. */
export const INBOX_MEDIA = {
  PICTURE: "picture",
  VIDEO: "video",
} as const;

type InboxMediaKind = (typeof INBOX_MEDIA)[keyof typeof INBOX_MEDIA];

/** One file drawn after a message's words, by the attachment its bytes are read by. */
export interface InboxMessageMedia {
  readonly kind: InboxMediaKind;
  readonly attachmentId: string;
  readonly name: string;
  readonly mediaType: string;
}

/** One message of a thread as a client without the panel's directory draws it: its writer, when, its words, and the files drawn after them. */
export interface InboxThreadMessage {
  readonly id: string;
  /** Who wrote it: the agent, or a member by their name and, where their account still stands, their id, which their picture is found by. */
  readonly writer: {
    readonly name: string;
    readonly agent: boolean;
    readonly userId?: string | undefined;
  };
  readonly at: number;
  readonly words: string;
  /** Whether a member typed it, whose line breaks are kept as typed. */
  readonly typed: boolean;
  readonly media: readonly InboxMessageMedia[];
  /** The item's own files its words draw where they name them, a picture or a video it carried, by the attachment each is read by. */
  readonly drawn: readonly InboxDrawnMedia[];
  /** What the answer it carries says it was, in the past, as the panel's stamp says it: "Chose Both", "Done 3/3"; none on a message that answers nothing. */
  readonly stamp?: AnswerStamp | undefined;
}

/** One of the item's own files a message's words draw in place, and how: a picture, or a video it carried, played where the words name it. */
export interface InboxDrawnMedia {
  readonly kind: InboxMediaKind;
  readonly attachmentId: string;
}

/** A file's kind as a thread draws it after its words, where it draws it: a picture, a video, or none for a file of another kind. */
function mediaKindOf(file: InboxMessageFile): InboxMediaKind | undefined {
  const view = attachmentView({ name: file.name, mediaType: file.mediaType, url: "" });
  if (view === ATTACHMENT_VIEW.IMAGE) return INBOX_MEDIA.PICTURE;
  if (view === ATTACHMENT_VIEW.VIDEO) return INBOX_MEDIA.VIDEO;
  return undefined;
}

/**
 * Each message of an item's thread, in its order, as a client draws it
 * without the panel's member directory: the agent's under `agentName`, a
 * member's under their name (`inboxMemberName`), and after its words its
 * pictures and videos, a picture its words draw already left out
 * (`inboxCommentFiles`), each named in `drawn` instead with what it is: a
 * video the message carried, a WebM an agent recorded among them, is played
 * where its words name it, as the panel plays one, and anything else they
 * name is a picture. Note that a WebM stands as the video it is, though the
 * panel draws it where its pictures stand, since a player is what plays it.
 */
export function inboxThreadMessages(
  item: InboxItem,
  agentName: string,
  readerId: string | undefined,
): readonly InboxThreadMessage[] {
  return (item.thread ?? []).map((message) => {
    const agent = message.author === INBOX_MESSAGE_AUTHOR.AGENT;
    const carried = new Map((message.files ?? []).map((file) => [file.attachmentId, file]));
    const drawn = picturesDrawn(message.text, item.id).map(({ attachmentId }) => {
      const file = carried.get(attachmentId);
      const kind =
        file === undefined ? INBOX_MEDIA.PICTURE : (mediaKindOf(file) ?? INBOX_MEDIA.PICTURE);
      return { kind, attachmentId };
    });
    // Note that a file the words draw stands where they draw it alone, an MP4 among them, which the panel's file split keeps after the words.
    const drawnIds = new Set(drawn.map(({ attachmentId }) => attachmentId));
    // An open ask's options stand on its card with their files, which the message draws nowhere else.
    const onCard =
      message.ask?.status === INBOX_ASK_STATUS.OPEN ? optionFileIds(message.ask) : new Set();
    const files = inboxCommentFiles(message.files ?? [], message.text, item.id);
    const media = [...files.pictures, ...files.others].flatMap((file): InboxMessageMedia[] => {
      const kind = mediaKindOf(file);
      return kind === undefined || drawnIds.has(file.attachmentId) || onCard.has(file.attachmentId)
        ? []
        : [{ kind, attachmentId: file.attachmentId, name: file.name, mediaType: file.mediaType }];
    });
    const { answers } = message;
    const asked =
      answers === undefined ? undefined : item.thread?.find(({ id }) => id === answers.ask);
    return {
      id: message.id,
      writer: {
        name: agent ? agentName : inboxMemberName(message.member, readerId),
        agent,
        userId: agent ? undefined : message.member?.userId,
      },
      at: message.createdAt,
      words: message.text,
      typed: !agent,
      media,
      drawn,
      ...(answers === undefined ? undefined : { stamp: sentStamp(answers, asked?.ask) }),
    };
  });
}

/**
 * The Inbox's one name for an item waiting on the developer's answer, in
 * each form its surfaces say it: the list's filter, a count's words after
 * its figure, and the line where nothing is listed. A settled item reads
 * as answered. Every surface reads its words here, so the name is changed in
 * this one place.
 */
export const NEEDS_YOU = {
  LABEL: "Needs you",
  COUNT: { one: "needs you", many: "need you" } satisfies {
    readonly one: string;
    readonly many: string;
  },
  NONE: "Nothing needs you",
} as const;

/** A count of what waits on the developer with its words, as a card's corner or a badge says it: "1 needs you", "3 need you". */
export function needsYouWords(count: number): string {
  return `${count} ${count === 1 ? NEEDS_YOU.COUNT.one : NEEDS_YOU.COUNT.many}`;
}

/** What a line of threads waiting on the developer says: "1 thread needs you", "3 threads need you". */
export function threadsWaitingWords(waiting: number): string {
  return waiting === 1
    ? `1 thread ${NEEDS_YOU.COUNT.one}`
    : `${waiting} threads ${NEEDS_YOU.COUNT.many}`;
}

/** The items given that wait on the developer, by the agent that posted each, in their order. */
export function waitingByAgent(
  waiting: readonly InboxItem[],
): ReadonlyMap<string, readonly InboxItem[]> {
  const byAgent = new Map<string, InboxItem[]>();
  for (const item of waiting)
    byAgent.set(item.agentId, [...(byAgent.get(item.agentId) ?? []), item]);
  return byAgent;
}
