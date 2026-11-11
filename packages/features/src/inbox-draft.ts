/**
 * inbox-draft.ts -- what a reader has put on an Inbox thread's box so far, and the one message it sends: the answer to the open ask it attaches, its words and files, or nothing the service would refuse.
 *
 * The panel's box and the iOS app's thread both hold a draft and send what
 * `inboxThreadSend` reads from it, so a press on either sends the same
 * bytes: a `decide`'s picks, a `do`'s steps ticked and its Mark done or
 * Couldn't do it, an `answer`'s fields filled, or the reply's own words. A
 * reply's answer is held to the rule the service holds it to
 * (`inbox-wire.ts`'s `inboxAnswersRefusal`), so a press the service would
 * refuse is never sent, and a version 4 answer to its response's
 * (`inboxReplyRefusal`). Nothing here draws.
 */

import { isWireString } from "@repo/wire";
import type { AgentAttachment } from "./agent-wire.js";
import { INBOX_MISSING, type InboxMissing } from "./inbox-ask-words.js";
import { type InboxDoAsk, inboxLineAsk, knownAsk } from "./inbox-list-model.js";
import {
  INBOX_ASK,
  INBOX_BOUNDS,
  INBOX_FIELD,
  INBOX_REPLY,
  INBOX_RESPONSE,
  type InboxAnswers,
  type InboxAsk,
  type InboxAsking,
  type InboxChoice,
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
  optionsCarryMedia,
} from "./inbox-wire.js";
import { markdownTree } from "./markdown-tree.js";

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
  const picking = picksNone(draft) ? { ...draft, press: undefined } : draft;
  if (choice.multiple !== true) return { ...picking, choices: [label] };
  const choices = picking.choices.includes(label)
    ? picking.choices.filter((each) => each !== label)
    : [...picking.choices, label];
  return { ...picking, choices };
}

/**
 * Whether the draft picks none of a choice's options, None of these, which
 * a choice whose options carry media offers (`optionsCarryMedia`): held as
 * a pick pressed with no option in it, as its answer is sent.
 */
export function picksNone(draft: Pick<InboxDraft, "choices" | "press">): boolean {
  return draft.press === INBOX_REPLY.CHOSE && draft.choices.length === 0;
}

/** The draft after None of these is pressed: every option let go and none picked, or, where it stood picked, let go itself. */
export function withNoneOfThese(draft: InboxDraft): InboxDraft {
  return picksNone(draft)
    ? { ...draft, press: undefined }
    : { ...draft, choices: [], press: INBOX_REPLY.CHOSE };
}

/** The draft holding the options picked, as a list of them answers a press: None of these let go once an option is. */
export function withPicks(draft: InboxDraft, choices: readonly string[]): InboxDraft {
  return choices.length > 0 && picksNone(draft)
    ? { ...draft, choices, press: undefined }
    : { ...draft, choices };
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
      if (draft.choices.length > 0) {
        return { ask: id, reply: INBOX_REPLY.CHOSE, choices: draft.choices };
      }
      // None of these is a pick of no option, which only a choice of cards offers.
      return picksNone(draft) && optionsCarryMedia(ask)
        ? { ask: id, reply: INBOX_REPLY.CHOSE, choices: [] }
        : undefined;
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
