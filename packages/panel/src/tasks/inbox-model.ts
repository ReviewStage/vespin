import { AGENT_CALL_FAILURE, type AgentCallFailure } from "@repo/features/agent-view";
import type { AgentAttachment, AgentSummary } from "@repo/features/agent-wire";
import type { FileChip } from "@repo/features/attachment-model";
import { INBOX_MISSING, type InboxMissing } from "@repo/features/inbox-ask-words";
import {
  type InboxDoAsk,
  inboxLineAsk,
  knownAsk,
  type TasklessInboxAgent,
  waitsOnReaderNow,
} from "@repo/features/inbox-list-model";
import {
  codeLinesReadable,
  INBOX_ASK,
  INBOX_BOUNDS,
  INBOX_FIELD,
  INBOX_REPLY,
  INBOX_RESPONSE,
  INBOX_STATUS,
  type InboxAnswers,
  type InboxAsk,
  type InboxAsking,
  type InboxChoice,
  type InboxCodeBlock,
  type InboxFieldValue,
  type InboxForm,
  type InboxFormValue,
  type InboxItem,
  type InboxMessage,
  type InboxReadAsk,
  type InboxReply,
  type InboxReplyKind,
  type InboxResponse,
  inboxAnswersRefusal,
  inboxReplyRefusal,
  openAskOf,
} from "@repo/features/inbox-wire";
import { markdownTree } from "@repo/features/markdown-tree";
import type { TaskFileRequest } from "@repo/features/task-wire";
import type { TasksFileAnswer } from "@repo/features/tasks-view";
import type { AppInboxTasklessItem, AppInboxWaitingItem } from "@repo/host/app-state";
import { isWireString } from "@repo/wire";
import { UNHEARD_OFFLINE } from "./agent-model.js";
import type { SnippetLines } from "./code-snippet-model.js";
import { refusalLine, refusalPasses } from "./file-tab-model.js";

/**
 * inbox-model.ts -- the panel's Inbox as pure decisions beside the list's own (`@repo/features/inbox-list-model`): what an item's answer is, how a settled one reads, and how its files and code are drawn.
 *
 * Which items the list holds, in what order, and what each row's line says
 * are the list model's, which the iOS app reads too; what is here is the
 * panel's alone. A task's board, which counts what waits, holds what waits the
 * oldest posted first, since it has held its agent longest, and what is
 * settled, answered or taken back by its agent, the latest changed first.
 * Every item the task's inbox holds is
 * drawn, whether or not the window's list of agents has caught up with the
 * agent that posted it, since the service reads the inbox by task and an
 * agent's items go with it. A reply's answer is held to the same rule the
 * service holds it to (`inbox-wire.ts`'s `inboxAnswersRefusal`), so a press
 * the service would refuse is never sent, and a version 4 answer to its
 * response's (`inboxReplyRefusal`). A code block's lines
 * are read as the File tab reads a file, at the block's commit, with a few
 * of the file around them, the lines it points at lit. Nothing here draws.
 */

/**
 * What the developer has put on a card so far: the options picked on a
 * choice, the fields filled on a form, their note, and the files they
 * attached to it; the steps ticked in its open `do` ask and the
 * answer pressed in it and attached to the reply (Mark done or Couldn't
 * do it), a `decide`'s pick being its choices and an `answer`'s fields
 * filled its values.
 */
export interface InboxDraft {
  readonly choices: readonly string[];
  readonly values: readonly InboxFormValue[];
  readonly note: string;
  readonly attachments: readonly AgentAttachment[];
  readonly steps?: readonly number[] | undefined;
  readonly press?: InboxReplyKind | undefined;
}

export const EMPTY_INBOX_DRAFT: InboxDraft = { choices: [], values: [], note: "", attachments: [] };

/** Why a card's last send did not go, or was not taken: its words, and the refusal they say where the service refused it. */
export interface InboxNote {
  readonly words: string;
  readonly failure?: AgentCallFailure | undefined;
}

/** What a card says under its box: the note's words, and whether Unarchive follows them. */
export interface InboxNoteReading {
  readonly words: string;
  readonly unarchive: boolean;
}

/** What a card says of a send refused because its agent is archived on its own. */
const AGENT_ARCHIVED_NOTE = "This agent is archived.";

/**
 * What a card says of its last send, by its agent as the window lists it.
 * Note that the service refuses a send to an agent archived on its own as
 * one that names nothing, so a refusal naming no agent says the agent is
 * archived, with Unarchive after it, where the list reads it archived, and
 * that the agent no longer exists only where it does not. A send no answer
 * came back for says the developer is offline while the app does not reach
 * the service, since the Offline mark says why.
 */
export function inboxNoteReading(
  note: InboxNote,
  agent: AgentSummary | undefined,
  connected: boolean,
): InboxNoteReading {
  const archived = note.failure === AGENT_CALL_FAILURE.NOT_FOUND && agent?.archivedAt !== undefined;
  if (archived) return { words: AGENT_ARCHIVED_NOTE, unarchive: true };
  const offline = !connected && note.failure === AGENT_CALL_FAILURE.UNANSWERED;
  return { words: offline ? UNHEARD_OFFLINE.ALONE : note.words, unarchive: false };
}

/** One file a message on the thread carried, as an item read names it. */
type InboxFile = NonNullable<InboxMessage["files"]>[number];

/**
 * The files a message on the thread carried as chips, in the
 * order they were attached: each by its name and type, its bytes as the
 * `data:` URL its read came back as where it did, and none while it is
 * read or where the read did not answer, which draws the chip by its name
 * alone.
 */
export function inboxFileChips(
  files: readonly InboxFile[],
  urls: ReadonlyMap<string, string>,
): FileChip[] {
  return files.map((file) => ({
    name: file.name,
    mediaType: file.mediaType,
    url: urls.get(file.attachmentId) ?? "",
  }));
}

/** The board as the tab draws it. */
export interface InboxBoardView {
  readonly open: readonly InboxItem[];
  /** The open items that wait on the reader at `now` (`waitsOnReaderNow`), in the order of `open`: what the task's Inbox counts, since a teammate's open item waits on the teammate and one the reader set a reminder on waits on nobody until it comes due. */
  readonly waiting: readonly InboxItem[];
  readonly settled: readonly InboxItem[];
}

/** The task's board from its inbox: what waits the oldest posted first, and what is settled the latest changed first; `readerId` and `now` say which of what waits waits on the reader. */
export function inboxBoard(
  items: readonly InboxItem[],
  readerId: string | undefined,
  now: number,
): InboxBoardView {
  const open = items
    .filter((item) => item.status === INBOX_STATUS.OPEN)
    .toSorted((a, b) => a.postedAt - b.postedAt);
  return {
    open,
    waiting: open.filter((item) => waitsOnReaderNow(item, readerId, now)),
    settled: items
      .filter((item) => item.status !== INBOX_STATUS.OPEN)
      .toSorted((a, b) => b.updatedAt - a.updatedAt),
  };
}

/**
 * The thread a call's row names by its key among a board's items: the
 * latest posted under it, of the agent whose row it was where the row names
 * one, since more than one agent may post under the same key.
 */
export function keyedItem(
  board: InboxBoardView,
  key: string,
  agentId: string | undefined,
): InboxItem | undefined {
  return [...board.open, ...board.settled]
    .filter((item) => item.key === key && (agentId === undefined || item.agentId === agentId))
    .reduce<InboxItem | undefined>(
      (latest, item) => (latest === undefined || item.postedAt > latest.postedAt ? item : latest),
      undefined,
    );
}

/** What the draft holds for the field, or nothing where it is untouched. */
export function fieldValueOf(draft: InboxDraft, label: string): InboxFieldValue | undefined {
  return draft.values.find((each) => each.label === label)?.value;
}

/** The draft with the field set to the value, or cleared where none. */
export function withValue(
  draft: InboxDraft,
  label: string,
  value: InboxFieldValue | undefined,
): InboxDraft {
  const others = draft.values.filter((each) => each.label !== label);
  return { ...draft, values: value === undefined ? others : [...others, { label, value }] };
}

/**
 * The answer's kind for what the card holds: a press where one was given,
 * else the decision an approval or a to-do holds, the nod a note is
 * answered by, the options picked, the form filled, or the developer's
 * words or files.
 */
function replyKindOf(
  response: InboxResponse,
  draft: InboxDraft,
  press: InboxReplyKind | undefined,
): InboxReplyKind | undefined {
  if (press !== undefined) return press;
  if (response.type === INBOX_RESPONSE.APPROVAL || response.type === INBOX_RESPONSE.TODO) {
    return decidedOf(response, draft);
  }
  if (response.type === INBOX_RESPONSE.NONE) return INBOX_REPLY.ACKNOWLEDGED;
  if (response.type === INBOX_RESPONSE.CHOICE && draft.choices.length > 0) return INBOX_REPLY.CHOSE;
  if (response.type === INBOX_RESPONSE.FORM) {
    return formSendable(response, draft) ? INBOX_REPLY.SUBMITTED : undefined;
  }
  return draft.note.trim() === "" && draft.attachments.length === 0
    ? undefined
    : INBOX_REPLY.ANSWERED;
}

/** A form's values as sent, in the form's own order: words trimmed, a field left blank left out, and a switch left alone sent as no. */
function sentValues(form: Pick<InboxForm, "fields">, draft: InboxDraft): readonly InboxFormValue[] {
  return form.fields.flatMap((field) => {
    const held = fieldValueOf(draft, field.label);
    const value =
      held === undefined ? (field.type === INBOX_FIELD.BOOLEAN ? false : undefined) : held;
    if (value === undefined) return [];
    const sent = isWireString(value) ? value.trim() : value;
    return sent === "" ? [] : [{ label: field.label, value: sent }];
  });
}

/**
 * Whether the developer filled any field of a form: a value of theirs it
 * sends. Note that a switch left alone fills nothing, though it is sent as no.
 */
function formFilledIn(form: Pick<InboxForm, "fields">, draft: InboxDraft): boolean {
  const held = new Set(draft.values.map((value) => value.label));
  return sentValues(form, draft).some((value) => held.has(value.label));
}

/**
 * Whether a form holds something to send: every required field filled, or,
 * where some are left empty, a field the developer filled, or words or
 * files of their own, since a form filled in part sends what was filled.
 */
function formSendable(form: Pick<InboxForm, "fields">, draft: InboxDraft): boolean {
  const sent = new Set(sentValues(form, draft).map((value) => value.label));
  if (form.fields.every((field) => field.required !== true || sent.has(field.label))) return true;
  if (draft.note.trim() !== "" || draft.attachments.length > 0) return true;
  return formFilledIn(form, draft);
}

/**
 * The answer the card holds, or nothing where it holds none the response
 * takes, as a version 4 response is answered: a choice is answered by its options, with the note beside them,
 * or by the developer's own words; an approval and a task by the decision
 * picked, or a press given, and an item asking nothing by its nod, with the
 * note beside them; words by words; a
 * form by its fields, with the note beside them. The files attached go
 * beside any of these, and stand for the developer's own words where they
 * wrote none, as a message's do; they travel apart from the answer.
 */
export function inboxReply(
  response: InboxResponse,
  draft: InboxDraft,
  press?: InboxReplyKind,
): InboxReply | undefined {
  const reply = replyKindOf(response, draft, press);
  if (reply === undefined) return undefined;
  const note = draft.note.trim();
  // A note past the wire's bound is no answer the service would take, so the card offers no send for it.
  if (note.length > INBOX_BOUNDS.MAX_NOTE_CHARS) return undefined;
  const answer: InboxReply = {
    reply,
    ...(reply === INBOX_REPLY.CHOSE ? { choices: draft.choices } : undefined),
    ...(response.type === INBOX_RESPONSE.FORM
      ? { values: sentValues(response, draft) }
      : undefined),
    ...(note === "" ? undefined : { note }),
  };
  return inboxReplyRefusal(response, answer, draft.attachments) === undefined ? answer : undefined;
}

/**
 * What the open ask's answer still lacks where the box holds nothing it can
 * send (`inboxThreadSend`), or nothing where it sends, no ask it knows
 * waits, or the developer wrote or attached something of their own, which
 * a box refuses only past its bound, as its counter says: a `decide` with
 * no pick lacks an option, and a `do` with nothing ticked or pressed its
 * decision, an option of its two; an `answer`'s fields their first required
 * field left empty, or their first empty where none is, since a form filled
 * in part sends what was filled; and an `answer` of words alone its words.
 */
export function inboxMissing(
  thread: readonly InboxMessage[],
  draft: InboxDraft,
): InboxMissing | undefined {
  if (inboxThreadSend(thread, draft) !== undefined) return undefined;
  if (draft.note.trim() !== "" || draft.attachments.length > 0) return undefined;
  const asking = openAskOf(thread);
  if (asking === undefined || !knownAsk(asking.ask)) return undefined;
  const { ask } = asking;
  switch (ask.type) {
    case INBOX_ASK.DECIDE:
    case INBOX_ASK.DO:
      return { kind: INBOX_MISSING.OPTION };
    case INBOX_ASK.ANSWER: {
      if (ask.fields === undefined) return { kind: INBOX_MISSING.WORDS };
      // Note that a yes-or-no left alone sends no, so it is never what a form lacks.
      const sent = new Set(sentValues({ fields: ask.fields }, draft).map((value) => value.label));
      const empty = ask.fields.filter((field) => !sent.has(field.label));
      const first = empty.find((field) => field.required === true) ?? empty[0];
      return first === undefined ? undefined : { kind: INBOX_MISSING.FIELD, label: first.label };
    }
  }
}

/** A response decided by a pick of two, the one going ahead and the one holding back: an approval, or a to-do. */
type InboxDecided = Extract<
  InboxResponse,
  { type: typeof INBOX_RESPONSE.APPROVAL | typeof INBOX_RESPONSE.TODO }
>;

/** What an approval or a to-do may be decided as, the one going ahead first, as its cards stand. */
function decisionsOf(
  response: InboxDecided,
): readonly { readonly reply: InboxReplyKind; readonly label: string }[] {
  const { ahead, back } = INBOX_PRESSES[response.type];
  return [ahead, back];
}

/**
 * The decision the card holds for an approval or a to-do, or none yet.
 * Note that the draft holds it as its one pick, by its reply's kind, so it
 * is kept with the card's words as a choice's pick is.
 */
function decidedOf(response: InboxDecided, draft: InboxDraft): InboxReplyKind | undefined {
  const held = draft.choices[0];
  return decisionsOf(response).find((decision) => decision.reply === held)?.reply;
}

/**
 * The draft after the option labeled is picked by its number: the one
 * pick of a choice of one, which picking again keeps, or one more of a
 * choice of several, which picking again lets go, as a press on its row
 * would.
 */
export function withChoice(
  choice: Pick<InboxChoice, "multiple">,
  draft: InboxDraft,
  label: string,
): InboxDraft {
  if (choice.multiple !== true) return { ...draft, choices: [label] };
  const choices = draft.choices.includes(label)
    ? draft.choices.filter((each) => each !== label)
    : [...draft.choices, label];
  return { ...draft, choices };
}

/** How many steps a `do` ask shows: its own, or one, the item's title, for a to-do from before version 5 that named none. */
function shownSteps(ask: Pick<InboxDoAsk, "steps">): number {
  return Math.max(ask.steps.length, 1);
}

/** A fenced block a to-do's step holds: its code, its lines kept, and the language its fence names, none where it names none. */
interface StepFence {
  readonly code: string;
  readonly lang: string | undefined;
}

/**
 * A to-do's step as its box draws it: its words, the box's label, and the
 * fenced blocks standing at its top level, each drawn under the words as a
 * card to copy from, so a command keeps its lines rather than running into
 * the label's one line. Note that a fence inside a list or a quote stays in
 * the words, as a part of the block holding it.
 */
export function stepParts(step: string): {
  readonly say: string;
  readonly fences: readonly StepFence[];
} {
  const fences = markdownTree(step).children.filter(
    (node): node is Extract<typeof node, { type: "code" }> => node.type === "code",
  );
  // Note that the words are what stands between the fences, each run apart from the next as a paragraph.
  const ends = [
    0,
    ...fences.flatMap((fence) => [
      fence.position?.start.offset ?? 0,
      fence.position?.end.offset ?? 0,
    ]),
    step.length,
  ];
  const runs = Array.from({ length: ends.length / 2 }, (_, at) =>
    step.slice(ends[2 * at], ends[2 * at + 1]).trim(),
  );
  return {
    say: runs.filter((run) => run !== "").join("\n\n"),
    fences: fences.map((fence) => ({ code: fence.value, lang: fence.lang ?? undefined })),
  };
}

/** The steps the draft ticks, in order, each once. */
function tickedSteps(draft: Pick<InboxDraft, "steps">): readonly number[] {
  return [...new Set(draft.steps ?? [])].toSorted((a, b) => a - b);
}

/** Every step a `do` ask shows, by place, in order. */
function everyStep(ask: Pick<InboxDoAsk, "steps">): readonly number[] {
  return Array.from({ length: shownSteps(ask) }, (_, at) => at);
}

/** Whether the reader ticked every step a `do` ask shows by hand. */
function everyStepTicked(
  ask: Pick<InboxDoAsk, "steps">,
  draft: Pick<InboxDraft, "steps">,
): boolean {
  const ticked = new Set(tickedSteps(draft));
  return everyStep(ask).every((at) => ticked.has(at));
}

/**
 * The decision a `do` ask's draft holds: the press given, Mark done or
 * Couldn't do it, or else Mark done where every step is ticked by hand,
 * which nothing stores, so letting a step go takes it back off. Note that
 * a press given wins, so Couldn't do it stands with every step ticked.
 */
export function doDecision(
  ask: Pick<InboxDoAsk, "steps">,
  draft: Pick<InboxDraft, "steps" | "press">,
): InboxReplyKind | undefined {
  if (draft.press === INBOX_REPLY.DONE || draft.press === INBOX_REPLY.NOT_DONE) return draft.press;
  return everyStepTicked(ask, draft) ? INBOX_REPLY.DONE : undefined;
}

/**
 * The steps a `do` ask's card shows ticked: every one while Mark done is
 * pressed, which ticks them all, or else those the reader ticked by hand,
 * which the draft keeps apart so Couldn't do it still sends only those.
 */
export function shownTicks(
  ask: Pick<InboxDoAsk, "steps">,
  draft: Pick<InboxDraft, "steps" | "press">,
): readonly number[] {
  return draft.press === INBOX_REPLY.DONE ? everyStep(ask) : tickedSteps(draft);
}

/**
 * The draft with the step at `at` ticked, or let go where the card shows
 * it ticked. Note that letting a step go under Mark done takes the press
 * off and keeps the others ticked, as the card showed them.
 */
export function withStep(
  ask: Pick<InboxDoAsk, "steps">,
  draft: InboxDraft,
  at: number,
): InboxDraft {
  const ticked = shownTicks(ask, draft);
  if (!ticked.includes(at)) return { ...draft, steps: [...ticked, at] };
  const steps = ticked.filter((each) => each !== at);
  return draft.press === INBOX_REPLY.DONE
    ? { ...draft, steps, press: undefined }
    : { ...draft, steps };
}

/**
 * The draft after a `do` ask's Mark done or Couldn't do it is pressed: the
 * decision it holds (`doDecision`) taken off where it is the one pressed,
 * or else given. Note that taking off a Mark done every step's hand tick
 * stands for lets those ticks go, or it would stand again at once.
 */
export function withDoPress(
  ask: Pick<InboxDoAsk, "steps">,
  draft: InboxDraft,
  reply: typeof INBOX_REPLY.DONE | typeof INBOX_REPLY.NOT_DONE,
): InboxDraft {
  if (doDecision(ask, draft) !== reply) return { ...draft, press: reply };
  const released = { ...draft, press: undefined };
  return reply === INBOX_REPLY.DONE && everyStepTicked(ask, released)
    ? { ...released, steps: [] }
    : released;
}

/**
 * The answer the draft attaches to the reply for the open ask, or none: a
 * `decide`'s options picked, a `do`'s Mark done with every step ticked,
 * pressed or every step ticked by hand, Couldn't do it with the steps
 * ticked, or, with no press, the steps ticked as an answer deciding
 * nothing, an `answer`'s fields' values once
 * any is filled, as a form filled in part sends what was filled, or its
 * Answer, whose words are the reply's own. Note that the title standing as a `do`'s
 * one step is ticked on the card alone, since the ask names no such step.
 */
function attachedAnswers(asking: InboxAsking, draft: InboxDraft): InboxAnswers | undefined {
  const { ask } = asking;
  if (!knownAsk(ask)) return undefined;
  const id = asking.message.id;
  switch (ask.type) {
    case INBOX_ASK.DECIDE:
      return draft.choices.length === 0
        ? undefined
        : { ask: id, reply: INBOX_REPLY.CHOSE, choices: draft.choices };
    case INBOX_ASK.DO: {
      const decision = doDecision(ask, draft);
      const named = (steps: readonly number[]) => steps.filter((at) => at < ask.steps.length);
      if (decision === INBOX_REPLY.DONE) {
        return { ask: id, reply: decision, steps: named(everyStep(ask)) };
      }
      const ticked = named(tickedSteps(draft));
      if (decision === INBOX_REPLY.NOT_DONE) return { ask: id, reply: decision, steps: ticked };
      // Steps ticked with no press go as they stand, an answer that decides nothing.
      return ticked.length === 0
        ? undefined
        : { ask: id, reply: INBOX_REPLY.ANSWERED, steps: ticked };
    }
    case INBOX_ASK.ANSWER:
      // A form's fields attach as they are filled, with no press, any filled in part sending what was filled.
      if (ask.fields !== undefined) {
        return formFilledIn({ fields: ask.fields }, draft)
          ? {
              ask: id,
              reply: INBOX_REPLY.SUBMITTED,
              values: sentValues({ fields: ask.fields }, draft),
            }
          : undefined;
      }
      // An ask of words alone is answered by the reply's own words or files, which the box holds as its one field.
      return draft.note.trim() === "" && draft.attachments.length === 0
        ? undefined
        : { ask: id, reply: INBOX_REPLY.ANSWERED };
  }
}

/**
 * A settled ask's answer as the draft its controls held when it was sent,
 * which its box draws them filled in with: a `decide`'s picks, a `do`'s
 * steps ticked and its press, the title standing as the one step of a
 * `do` that names none ticked where it was marked done, and an `answer`'s
 * values. A field or a step the answer left empty stands empty.
 */
export function answeredDraft(ask: InboxAsk, answers: InboxAnswers): InboxDraft {
  const titleStep = ask.type === INBOX_ASK.DO && ask.steps.length === 0;
  const done = answers.reply === INBOX_REPLY.DONE;
  return {
    ...EMPTY_INBOX_DRAFT,
    choices: answers.choices ?? [],
    values: answers.values ?? [],
    steps: titleStep ? (done ? [0] : []) : (answers.steps ?? []),
    press: answers.reply,
  };
}

/**
 * The draft after the open ask's option numbered `number`, counted from
 * one, is picked by its key: a `decide`'s, as `withChoice` picks it, the
 * first of two buttons going ahead; none for any other ask.
 */
export function askNumberedPick(
  ask: InboxReadAsk,
  draft: InboxDraft,
  number: number,
): InboxDraft | undefined {
  if (!knownAsk(ask) || ask.type !== INBOX_ASK.DECIDE) return undefined;
  const option = ask.options[number - 1];
  return option === undefined ? undefined : withChoice(ask, draft, option.label);
}

/** What a reply sends on a thread: its words, its files, and the answer to the open ask it carries, if any. */
export interface InboxThreadSend {
  readonly text: string;
  readonly attachments: readonly AgentAttachment[];
  readonly answers?: InboxAnswers;
}

/**
 * What the box sends on a thread, or nothing where the service would take
 * nothing: a plain reply of words or files or both, never neither, or the
 * answer attached, with whatever words and files go with it, which the ask
 * must take as it stands (`inboxAnswersRefusal`); words within the bound.
 */
export function inboxThreadSend(
  thread: readonly InboxMessage[],
  draft: InboxDraft,
): InboxThreadSend | undefined {
  const text = draft.note.trim();
  if (text.length > INBOX_BOUNDS.MAX_MESSAGE_CHARS) return undefined;
  const { attachments } = draft;
  const asking = openAskOf(thread);
  const answers = asking === undefined ? undefined : attachedAnswers(asking, draft);
  if (asking === undefined || answers === undefined || !knownAsk(asking.ask)) {
    return text === "" && attachments.length === 0 ? undefined : { text, attachments };
  }
  const refusal = inboxAnswersRefusal(asking.ask, answers, text, attachments);
  return refusal === undefined ? { text, attachments, answers } : undefined;
}

/** The message that answers an ask, where the thread read carries it. */
export function answerOf(
  thread: readonly InboxMessage[],
  messageId: string,
): InboxMessage | undefined {
  return thread.find((message) => message.answers?.ask === messageId);
}

/**
 * The two ways an approval and a to-do are decided, the one that holds
 * back and the one that goes ahead, as a version 4 response names them.
 */
const INBOX_PRESSES = {
  [INBOX_RESPONSE.APPROVAL]: {
    back: { reply: INBOX_REPLY.DECLINED, label: "Decline" },
    ahead: { reply: INBOX_REPLY.APPROVED, label: "Approve" },
  },
  [INBOX_RESPONSE.TODO]: {
    back: { reply: INBOX_REPLY.NOT_DONE, label: "Couldn't do it" },
    ahead: { reply: INBOX_REPLY.DONE, label: "Done" },
  },
} as const;

/**
 * The steps of an item's open to-do its row shows ticked, as its box
 * shows them (`shownTicks`): every one while Mark done is pressed in its
 * draft, else those ticked by hand; none where no draft stands.
 */
export function inboxShownTicks(
  item: InboxItem,
  draft: Pick<InboxDraft, "steps" | "press"> | undefined,
): readonly number[] {
  if (draft === undefined) return [];
  const ask = inboxLineAsk(item);
  if (ask === undefined || ask.type !== INBOX_ASK.DO) return draft.steps ?? [];
  return shownTicks(ask, draft);
}

/** What a line of threads none of which waits on the developer says: "1 thread", "4 threads". */
export function threadsWords(count: number): string {
  return count === 1 ? "1 thread" : `${count} threads`;
}

/**
 * An agent with no task as the Inbox names it, from its own row where main
 * lists none of its items, a link naming one whose items are all settled:
 * its title, as main's read names it; the automation that started it, by
 * the name its run kept; and its repository and workspace where they are known.
 */
export function inboxAgentOf(agent: {
  readonly id: string;
  readonly title: string | null;
  readonly model: string;
  readonly automationId?: string | null | undefined;
  readonly automationName?: string | undefined;
  readonly repository?: string | null | undefined;
  readonly workspaceId?: string | undefined;
}): TasklessInboxAgent {
  return {
    agentId: agent.id,
    agentTitle: agent.title,
    agentModel: agent.model,
    automationId: agent.automationId ?? null,
    automationName: agent.automationName ?? null,
    repository: agent.repository ?? null,
    ...(agent.workspaceId === undefined ? undefined : { workspaceId: agent.workspaceId }),
  };
}

/**
 * Whether an open item of an agent with no task, as main lists it, waits on
 * the reader: addressed to them, or else its agent started by them, or by
 * nobody the service names, or listed before the reader's own id is known,
 * as `readersItem` reads an item. Main lists every member's, as the Inbox
 * lists them, and counts only these.
 */
export function waitsOnReader(
  entry: Pick<AppInboxTasklessItem, "startedBy" | "waitsOn">,
  readerId: string | undefined,
): boolean {
  const waitsOn = entry.waitsOn ?? entry.startedBy;
  return waitsOn === undefined || readerId === undefined || waitsOn === readerId;
}

/**
 * Whether an open item main lists holds an ask open rather than being a
 * notice. One from a service before it, which says nothing, counts as
 * asking, as every item did.
 */
export function holdsAsk(item: Pick<AppInboxWaitingItem, "asking">): boolean {
  return item.asking !== false;
}

/** How many lines of the file a code block's card draws above and below the lines it points at. */
const CODE_CONTEXT_LINES = 3;

/** Where a code block's card stands with its lines. */
export const CODE_READ = {
  READING: "reading",
  READY: "ready",
  /** The lines are not drawn, for the reason the card says. */
  NOTICE: "notice",
} as const;

export type CodeRead =
  | { readonly kind: typeof CODE_READ.READING }
  | { readonly kind: typeof CODE_READ.READY; readonly code: SnippetLines }
  | {
      readonly kind: typeof CODE_READ.NOTICE;
      readonly line: string;
      /** Whether reading again may draw the lines, which the card offers. */
      readonly again: boolean;
    };

/** What a code block's card says where its lines did not come back. */
const CODE_UNREAD = "These lines could not be read.";

/**
 * The window a code block's card reads: the lines it points at with a few
 * of the file around them, at the block's commit. Note that the window may
 * run past the file's end, which the service answers with the lines it has.
 */
export function codeWindow(block: InboxCodeBlock): TaskFileRequest {
  return {
    path: block.path,
    firstLine: Math.max(1, block.startLine - CODE_CONTEXT_LINES),
    lastLine: block.endLine + CODE_CONTEXT_LINES,
    ref: block.sha,
  };
}

/**
 * Why a code block's lines are not read at all, or nothing where they are
 * read: the task reads its own repository alone, which the agent's
 * repository was when it started but may not be once the task names
 * another, and lines that run backwards or past the bound are no window
 * the File tab's read takes. Note that GitHub spells a repository's name in
 * any case.
 */
export function codeNotice(block: InboxCodeBlock, repository: string | null): string | undefined {
  if (repository === null || repository.toLowerCase() !== block.repo.toLowerCase()) {
    return `These lines are in ${block.repo}, which this task no longer reads.`;
  }
  if (!codeLinesReadable(block)) return "These lines cannot be read.";
  return undefined;
}

/**
 * A code block's lines as its card holds them once the read answered: the
 * window the service read at the block's commit, the block's lines lit in
 * it; or why they are not drawn, a file that ends before they do included, and
 * whether reading again may draw them.
 */
export function codeReadOf(block: InboxCodeBlock, answer: TasksFileAnswer): CodeRead {
  if ("refusal" in answer) {
    return {
      kind: CODE_READ.NOTICE,
      line: refusalLine(answer.refusal, answer.branch, block.sha),
      again: refusalPasses(answer.refusal),
    };
  }
  if (!("file" in answer)) return { kind: CODE_READ.NOTICE, line: CODE_UNREAD, again: true };
  const { file } = answer;
  // Note that a file ending inside the lines is said too, because a card
  // drawing some of them would read, and copy, as all the agent meant.
  if (file.firstLine + file.lines.length <= block.endLine) {
    return {
      kind: CODE_READ.NOTICE,
      line: "The file ends before these lines do at this commit.",
      again: false,
    };
  }
  return {
    kind: CODE_READ.READY,
    code: {
      ref: { path: block.path, startLine: block.startLine, endLine: block.endLine },
      firstLine: file.firstLine,
      lines: file.lines,
    },
  };
}

/** A code block's card where the read did not land at all, as main refusing the act leaves it. */
export const CODE_READ_FAILED: CodeRead = {
  kind: CODE_READ.NOTICE,
  line: CODE_UNREAD,
  again: true,
};
