// inbox-ask.tsx -- a thread's open ask as its card, the box under the thread, and its ⋯ menu: a decide's options, a do's steps with Mark done and Couldn't do it, an answer's fields, a notice's Got it, the composer that sends them with a note, replies, or starts a new thread with the agent, and Remind me, New thread, and Resolve.

import { ASK_PRESS, askHeadWords, INBOX_BOX_WORDS, RESOLVE } from "@repo/features/inbox-ask-words";
import {
  fieldValueOf,
  picksNone,
  shownTicks,
  withNoneOfThese,
  withPicks,
  withStep,
  withValue,
} from "@repo/features/inbox-draft";
import { knownAsk, RECOMMENDED } from "@repo/features/inbox-list-model";
import {
  INBOX_ASK,
  INBOX_FIELD,
  INBOX_FILE_TYPE,
  INBOX_OPTION_MEDIA,
  INBOX_REPLY,
  INBOX_STATUS,
  type InboxItem,
  type InboxOption,
  type InboxOptionMedia,
  type InboxOptionPage,
  knownOptionMedia,
  NONE_OF_THESE,
  openAskOf,
  optionsCarryMedia,
  recommendedLabels,
} from "@repo/features/inbox-wire";
import {
  ANSWER_FIELD,
  type AnswerField,
  type AnswerFieldKind,
  AnswerFields,
  AskActs,
  AskNote,
  type BarMenu,
  CHOICE_MEDIA,
  type Choice,
  ChoiceList,
  type ChoiceMedia,
  Composer,
  ComposerFoot,
  StepList,
} from "@repo/ui-native";
import { Predicate } from "effect";
import type { ReactNode } from "react";
import type { ThreadAnswer } from "../inbox/use-thread-answer.js";
import { REMIND_ME } from "./inbox-remind.js";

/** The ⋯ menu a thread's bar holds. */
const THREAD_MORE = { label: "More", symbol: "ellipsis" } as const;

/** Each field type an answer ask names, as the card draws it. */
const FIELD_KIND = {
  [INBOX_FIELD.TEXT]: ANSWER_FIELD.TEXT,
  [INBOX_FIELD.NUMBER]: ANSWER_FIELD.NUMBER,
  [INBOX_FIELD.SELECT]: ANSWER_FIELD.SELECT,
  [INBOX_FIELD.BOOLEAN]: ANSWER_FIELD.BOOLEAN,
} as const satisfies Record<(typeof INBOX_FIELD)[keyof typeof INBOX_FIELD], AnswerFieldKind>;

/**
 * What a field typed as `kind` holds once its words are `typed`: words, a
 * number where they read as one, or nothing where they are empty. Note that
 * a number's comma is read as its decimal point, since the decimal pad types
 * one in many regions, and words that read as no number are kept as typed,
 * so the box holds the answer back (`use-thread-answer.ts`) rather than send
 * it without them.
 */
function typedValue(
  kind: AnswerFieldKind,
  typed: string | boolean,
): string | number | boolean | undefined {
  if (Predicate.isBoolean(typed)) return typed;

  if (typed.trim() === "") return undefined;

  if (kind !== ANSWER_FIELD.NUMBER) return typed;
  const number = Number(typed.trim().replace(",", "."));

  return Number.isFinite(number) ? number : typed;
}

/** What an open ask's option media is opened and drawn by: each file's bytes as read, a page in the app or Safari, an address in Safari, and a recording the player cannot read on the web. */
export interface OptionMediaDoors {
  readonly source: (attachmentId: string) => string | undefined;
  readonly openPage: (page: InboxOptionPage) => void;
  readonly openLink: (address: string) => void;
  readonly openVideoElsewhere: () => void;
}

/** What a picture's and a recording's tile is called where its agent gave it no caption. */
const PICTURE_WORD = "Picture";
const RECORDING_WORD = "Recording";

/** One piece of an option's media as the card draws it: a file from its bytes as read, under its caption, and a page or an address opened through `doors`. */
function cardMedia(piece: InboxOptionMedia, doors: OptionMediaDoors): ChoiceMedia {
  switch (piece.type) {
    case INBOX_OPTION_MEDIA.FILE: {
      const recording = piece.mediaType === INBOX_FILE_TYPE.WEBM;

      return {
        kind: recording ? CHOICE_MEDIA.VIDEO : CHOICE_MEDIA.PICTURE,
        title: piece.caption ?? (recording ? RECORDING_WORD : PICTURE_WORD),
        source: doors.source(piece.attachmentId),
        onOpen: recording ? doors.openVideoElsewhere : undefined,
      };
    }

    case INBOX_OPTION_MEDIA.PAGE:
      return {
        kind: CHOICE_MEDIA.PAGE,
        title: piece.title,
        onOpen: () => doors.openPage(piece),
      };
    case INBOX_OPTION_MEDIA.LINK:
      return {
        kind: CHOICE_MEDIA.LINK,
        title: piece.label ?? piece.url,
        onOpen: () => doors.openLink(piece.url),
      };
  }
}

/** An option as the card draws it: its label, its detail, and its media. */
function cardChoice(option: InboxOption, doors: OptionMediaDoors): Choice {
  const media = knownOptionMedia(option).map((piece) => cardMedia(piece, doors));

  return { label: option.label, detail: option.detail, media };
}

/** The files an open ask's options carry, by attachment and kind, which the thread reads beside its messages' own. */
export function openAskFiles(item: InboxItem) {
  const ask = openAsk(item);

  if (ask?.type !== INBOX_ASK.DECIDE) return [];

  return ask.options.flatMap((option) =>
    knownOptionMedia(option).flatMap((piece) =>
      piece.type === INBOX_OPTION_MEDIA.FILE ? [piece] : [],
    ),
  );
}

/** The thread's open ask, where it stands open and this build knows it; none otherwise. */
function openAsk(item: InboxItem) {
  if (item.status !== INBOX_STATUS.OPEN) return undefined;
  const asking = openAskOf(item.thread ?? []);

  return asking === undefined || !knownAsk(asking.ask) ? undefined : asking.ask;
}

/** Whether the open ask's controls stand over the box, which are its answer, the box's words going beside them as a note: any ask but one of words alone. */
function controlsStand(item: InboxItem): boolean {
  const ask = openAsk(item);

  return ask !== undefined && (ask.type !== INBOX_ASK.ANSWER || ask.fields !== undefined);
}

/**
 * The open ask's card under the thread, as the panel's box draws its
 * controls: a decide's options to pick, the recommended tagged; a do's steps
 * to tick, with Mark done and Couldn't do it, each sending at once with the
 * note typed; an answer's fields to fill. A notice asking nothing offers Got
 * it while the box is empty, as the panel's Send reads then, which settles it
 * without messaging its agent. What the last send said where it did not go
 * stands under it. None where nothing is asked and nothing was said.
 */
export function OpenAskCard({
  item,
  answer,
  doors,
}: {
  readonly item: InboxItem;
  readonly answer: ThreadAnswer;
  readonly doors: OptionMediaDoors;
}): ReactNode {
  const { draft, onDraft, note, send, nods, acknowledge, asNew } = answer;
  // Note that the ask's controls step aside while the box starts a new thread, since nothing picked there goes with it, and come back as they were.
  const ask = asNew ? undefined : openAsk(item);
  const said = note === undefined ? null : <AskNote words={note} />;

  if (ask === undefined && nods) {
    return (
      <>
        <AskActs
          acts={[{ label: INBOX_BOX_WORDS.GOT_IT, symbol: "checkmark", onPress: acknowledge }]}
        />
        {said}
      </>
    );
  }

  if (ask === undefined) return said;

  if (ask.type === INBOX_ASK.DECIDE) {
    const cards = optionsCarryMedia(ask);

    return (
      <>
        <ChoiceList
          choices={ask.options.map((option) => cardChoice(option, doors))}
          recommended={recommendedLabels(ask)}
          picked={draft.choices}
          multiple={ask.multiple === true}
          // Note that a pick of several says so over its card, in the panel's words, since its round marks read as a pick of one until something is picked.
          title={ask.multiple === true ? askHeadWords(ask, undefined) : undefined}
          onChange={(choices) => onDraft(withPicks(draft, choices))}
          none={
            cards
              ? {
                  label: NONE_OF_THESE,
                  picked: picksNone(draft),
                  onPress: () => onDraft(withNoneOfThese(draft)),
                }
              : undefined
          }
        />
        {said}
      </>
    );
  }

  if (ask.type === INBOX_ASK.DO) {
    // A press sends at once, with the steps ticked and the note typed, as the panel's press and Send do together.
    const press = (reply: typeof INBOX_REPLY.DONE | typeof INBOX_REPLY.NOT_DONE) =>
      send({ ...draft, press: reply });

    const ticked = shownTicks(ask, draft);

    return (
      <>
        <StepList
          steps={ask.steps.length === 0 ? [item.title] : ask.steps}
          ticked={ticked}
          onToggle={(at) => onDraft(withStep(ask, draft, at))}
          acts={[
            { label: ASK_PRESS.DONE, symbol: "checkmark", onPress: () => press(INBOX_REPLY.DONE) },
            {
              label: ASK_PRESS.NOT_DONE,
              symbol: "arrow.uturn.backward",
              onPress: () => press(INBOX_REPLY.NOT_DONE),
            },
          ]}
        />
        {said}
      </>
    );
  }

  if (ask.fields === undefined) return said;

  const fields: readonly AnswerField[] = ask.fields.map((field) => {
    const kind = FIELD_KIND[field.type];
    const value = fieldValueOf(draft, field.label);

    return {
      kind,
      label: field.label,
      required: field.required === true,
      value: Predicate.isBoolean(value) ? value : value === undefined ? "" : String(value),
      options: field.options,
      recommended: field.recommended,
    };
  });

  return (
    <>
      <AnswerFields
        fields={fields}
        recommendedWord={RECOMMENDED.toLowerCase()}
        onChange={(label, typed) => {
          const kind = fields.find((field) => field.label === label)?.kind ?? ANSWER_FIELD.TEXT;
          onDraft(withValue(draft, label, typedValue(kind, typed)));
        }}
      />
      {said}
    </>
  );
}

/**
 * The box under a thread: the composer, its line asking for a note while an
 * ask's controls stand over it and a reply otherwise, Send lit once an answer
 * is picked; docked in a compact window, or at a split view column's foot.
 * Its + holds the panel's "Send as a new thread to" the thread's agent,
 * which turns the next send into a new thread's first message, its line
 * asking to start one.
 */
export function ThreadComposer({
  item,
  answer,
  agentName,
  inColumn = false,
}: {
  readonly item: InboxItem;
  readonly answer: ThreadAnswer;
  /** The thread's agent's name, which the new thread's switch names. */
  readonly agentName: string;
  /** Whether it stands at a SwiftUI column's foot, a split view's detail, rather than docked over the screen. */
  readonly inColumn?: boolean;
}) {
  const { draft, onDraft, answerReady, send, asNew, setAsNew, start } = answer;

  const placeholder = asNew
    ? INBOX_BOX_WORDS.NEW_THREAD_PLACEHOLDER
    : controlsStand(item)
      ? INBOX_BOX_WORDS.NOTE_PLACEHOLDER
      : INBOX_BOX_WORDS.REPLY_PLACEHOLDER;

  const props = {
    placeholder,
    words: draft.note,
    onWords: (note: string) => onDraft({ ...draft, note }),
    // Note that a new thread starts from words alone, so no picked answer lights Send for one.
    sendable: !asNew && answerReady,
    onSend: () => (asNew ? start() : send()),
    addMenu: {
      actions: [],
      switches: [
        {
          label: `${INBOX_BOX_WORDS.SEND_AS_NEW} ${agentName}`,
          on: asNew,
          onPress: () => setAsNew(!asNew),
        },
      ],
    },
  };

  return inColumn ? <ComposerFoot {...props} /> : <Composer {...props} />;
}

/** What the ⋯ menu's act that turns the box to a new thread with the agent says. */
const NEW_THREAD = "New thread";

/**
 * The thread's ⋯ menu: Remind me, on any thread, open or settled, as the
 * panel's menu offers it; New thread, which turns the box's next send into a
 * new thread with the agent while it replies; and Resolve while it stands
 * open.
 */
export function threadMenu(item: InboxItem, answer: ThreadAnswer, onRemind: () => void): BarMenu {
  const resolve =
    item.status === INBOX_STATUS.OPEN
      ? [{ label: RESOLVE, symbol: "checkmark.circle", onPress: answer.resolve } as const]
      : [];

  const newThread = answer.asNew
    ? []
    : [{ label: NEW_THREAD, symbol: "plus.bubble", onPress: () => answer.setAsNew(true) } as const];

  return {
    ...THREAD_MORE,
    choices: [],
    actions: [{ ...REMIND_ME, onPress: onRemind }, ...newThread, ...resolve],
  };
}
