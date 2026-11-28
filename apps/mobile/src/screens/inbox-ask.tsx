// inbox-ask.tsx -- a thread's open ask as its card, the box under the thread, and its ⋯ menu: a decide's options, a do's steps with Mark done and Couldn't do it, an answer's fields, the composer that sends them with a note, replies, or starts a new thread with the agent, its empty Send a notice's Got it, and its ⋯ menu as the panel's row menu: Copy link, Mark as read or unread, Remind me, and Resolve.

import { isAudioType, isVideoType } from "@repo/features/conversation-picture-wire";
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
import { INBOX_READ_MARK, isUnread, knownAsk, RECOMMENDED } from "@repo/features/inbox-list-model";
import {
  INBOX_ASK,
  INBOX_FIELD,
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
import { APP_COMMAND, APP_SHORTCUTS } from "@repo/settings/shortcuts";
import {
  ANSWER_FIELD,
  type AnswerField,
  type AnswerFieldKind,
  AnswerFields,
  AskNote,
  type BarAction,
  type BarFootItem,
  type BarMenu,
  CHOICE_MEDIA,
  type Choice,
  ChoiceList,
  type ChoiceMedia,
  Composer,
  ComposerFoot,
  GLYPH,
  MentionSuggestions,
  StepList,
} from "@repo/ui-native";
import { Predicate } from "effect";
import { type ReactNode, useMemo, useState } from "react";
import { useAgentBox } from "../agents/agent-box.js";
import { useFollowedAgent } from "../agents/use-agent.js";
import type { ThreadAnswer } from "../inbox/use-thread-answer.js";
import { useNewestNote } from "../newest-note.js";
import {
  attachedFiles,
  PICKER_FAILED,
  pickPictures,
  takePictures,
} from "../use-attached-pictures.js";
import { useDictation } from "../use-dictation.js";
import { useMentionOffer } from "../use-mention-offer.js";
import { usePillField } from "../use-pill-field.js";
import { REMIND_ME } from "./inbox-remind.js";

/** The ⋯ menu a thread's bar holds. */
const THREAD_MORE = { label: "More", symbol: GLYPH.MORE } as const;

/** The box's + item that attaches pictures, as an agent's composer names it. */
const ATTACH_PHOTOS = { label: "Photos", symbol: GLYPH.ATTACH } as const;

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
  /** A file's bytes as read: none while on their way, and `null` where they could not be read. */
  readonly source: (attachmentId: string) => string | null | undefined;
  /** Reads a file whose bytes could not be read again. */
  readonly retry: (attachmentId: string) => void;
  readonly openPage: (page: InboxOptionPage) => void;
  readonly openLink: (address: string) => void;
  readonly openVideoElsewhere: () => void;
  /** The repository of what holds the thread, `owner/name`, whose GitHub pages a step's words draw as its files' chips. */
  readonly repository: string | null | undefined;
}

/** What a picture's, a recording's, and a sound clip's tile is called where its agent gave it no caption, as the CLI names each. */
const PICTURE_WORD = "Picture";
const RECORDING_WORD = "Recording";
const SOUND_CLIP_WORD = "Sound clip";

/** One piece of an option's media as the card draws it: a file from its bytes as read, under its caption, and a page or an address opened through `doors`. */
function cardMedia(piece: InboxOptionMedia, doors: OptionMediaDoors): ChoiceMedia {
  switch (piece.type) {
    case INBOX_OPTION_MEDIA.FILE: {
      const recording = isVideoType(piece.mediaType);
      const source = doors.source(piece.attachmentId);

      if (isAudioType(piece.mediaType)) {
        return {
          kind: CHOICE_MEDIA.AUDIO,
          title: piece.caption ?? SOUND_CLIP_WORD,
          source,
          onRetry: () => doors.retry(piece.attachmentId),
        };
      }

      return {
        kind: recording ? CHOICE_MEDIA.VIDEO : CHOICE_MEDIA.PICTURE,
        title: piece.caption ?? (recording ? RECORDING_WORD : PICTURE_WORD),
        source,
        onRetry: () => doors.retry(piece.attachmentId),
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
 * note typed; an answer's fields to fill. A notice asking nothing has no
 * card: its Got it is the box's empty Send (`ThreadComposer`), as the
 * panel's is. What the last send said where it did not go stands in the
 * box's head, beside the words it put back. None where nothing is asked.
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
  const { draft, onDraft, send, asNew } = answer;
  // Note that the ask's controls step aside while the box starts a new thread, since nothing picked there goes with it, and come back as they were.
  const ask = asNew ? undefined : openAsk(item);

  if (ask === undefined) return null;

  if (ask.type === INBOX_ASK.DECIDE) {
    const cards = optionsCarryMedia(ask);

    return (
      <ChoiceList
        choices={ask.options.map((option) => cardChoice(option, doors))}
        recommended={recommendedLabels(ask)}
        picked={draft.choices}
        multiple={ask.multiple === true}
        // Note that a pick of several says so over its card, in the panel's words, since its round marks read as a pick of one until something is picked.
        title={ask.multiple === true ? askHeadWords(ask, undefined) : undefined}
        onChange={(choices) => onDraft(withPicks(draft, choices))}
        repository={doors.repository}
        onOpenLink={doors.openLink}
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
    );
  }

  if (ask.type === INBOX_ASK.DO) {
    // A press sends at once, with the steps ticked and the note typed, as the panel's press and Send do together.
    const press = (reply: typeof INBOX_REPLY.DONE | typeof INBOX_REPLY.NOT_DONE) =>
      send({ ...draft, press: reply });

    const ticked = shownTicks(ask, draft);

    return (
      <StepList
        steps={ask.steps.length === 0 ? [item.title] : ask.steps}
        ticked={ticked}
        onToggle={(at) => onDraft(withStep(ask, draft, at))}
        repository={doors.repository}
        onOpenLink={doors.openLink}
        acts={[
          { label: ASK_PRESS.DONE, symbol: GLYPH.CHECK, onPress: () => press(INBOX_REPLY.DONE) },
          {
            label: ASK_PRESS.NOT_DONE,
            symbol: GLYPH.UNDO,
            quiet: true,
            onPress: () => press(INBOX_REPLY.NOT_DONE),
          },
        ]}
      />
    );
  }

  if (ask.fields === undefined) return null;

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
    <AnswerFields
      fields={fields}
      recommendedWord={RECOMMENDED.toLowerCase()}
      onChange={(label, typed) => {
        const kind = fields.find((field) => field.label === label)?.kind ?? ANSWER_FIELD.TEXT;
        onDraft(withValue(draft, label, typedValue(kind, typed)));
      }}
    />
  );
}

/** A notice's empty Send, as the panel's reads Got it. */
const GOT_IT_SEND = { label: INBOX_BOX_WORDS.GOT_IT, symbol: GLYPH.CHECK } as const;

/**
 * The box under a thread: the agent's own composer, as the panel's thread
 * box is its agent box (`inbox-answer-box.tsx`), writing to the thread's
 * agent and reading off it what the agent's page reads (`useAgentBox`): the
 * Machine chip after the +, the model chip at the row's end, whose choices
 * hold the model, its effort, Fast, and the permission mode, the + menu's
 * MCP servers, and Dictate before Send. Left out, as the panel leaves them
 * out of its thread box: Stop, since an empty Send here settles a notice,
 * and the agent's dock and queue, since a thread is no transcript. Its line
 * asks for a note while an ask's controls stand over it and a reply
 * otherwise, Send lit once an answer is picked; docked in a compact window,
 * or at a split view column's foot, where the model's choices pop over the
 * chip since no sheet can stand in a SwiftUI column.
 * A notice waiting on the reader's nod, where opening did not settle it,
 * reads Got it on the empty box's Send, as the panel's Send does, which
 * settles it without messaging its agent, with Undo; a word or a picture
 * makes it Send again.
 * Its + attaches pictures from Photos, as the panel's box attaches files,
 * held on the thread's draft until a send carries them, each standing as
 * its marker's pill in the words, as an agent's composer stands it, and an
 * `@` offers what the thread's task can mention, a pick standing as its
 * pill (`usePillField`), and holds the panel's "Send as a new thread to" the
 * thread's agent, which turns the next send into a new thread's first
 * message, its line asking to start one. What the picker or a bound said
 * of the pictures stands in the field's head.
 */
export function ThreadComposer({
  item,
  answer,
  agentName,
  inColumn,
  place,
}: {
  readonly item: InboxItem;
  /** The workspace and task the thread stands in, whose agents, tasks, people and pages an `@` offers. */
  readonly place: { readonly workspaceId: string; readonly taskId: string | undefined };
  readonly answer: ThreadAnswer;
  /** The thread's agent's name, which the new thread's switch names. */
  readonly agentName: string;
  /** Whether it stands at a SwiftUI column's foot, a split view's detail, rather than docked over the screen. */
  readonly inColumn?: boolean | undefined;
}) {
  const { draft, onDraft, note: sendNote, answerReady, sendTyped, asNew, setAsNew } = answer;
  const { nods } = answer;
  const [pictureNote, setPictureNote] = useState<string | undefined>(undefined);
  // What the composer reads off the thread's agent, read as the agent's page reads it, so the two stand alike.
  const box = useAgentBox(item.agentId, useFollowedAgent(item.agentId), inColumn === true);

  // Note that the pictures picked are named and bounded against the draft as it stands when the picker answers, since a refused send may have put words and pictures back while it stood open.
  const attach = () => {
    pickPictures(draft.attachments.length)
      .then((picked) => {
        if (picked.length === 0) return;
        let note: string | undefined;
        onDraft((now) => {
          const taken = takePictures(now.attachments, picked);
          note = taken.note;

          return { ...now, attachments: [...now.attachments, ...taken.files] };
        });
        setPictureNote(note);
      })
      // Note that a picker that did not open says so in the box's head, as a refusal does, rather than leaving the press unanswered.
      .catch((cause: unknown) => {
        console.error("The photo picker did not open.", cause);
        setPictureNote(PICKER_FAILED);
      });
  };

  const detach = (name: string) => {
    setPictureNote(undefined);
    onDraft((now) => ({
      ...now,
      attachments: now.attachments.filter((file) => file.name !== name),
    }));
  };

  // The files the draft holds, by the names their markers name, each a pill in the words.
  const pictures = useMemo(() => attachedFiles(draft.attachments), [draft.attachments]);
  const onNote = (note: string) => onDraft((now) => ({ ...now, note }));
  const pillField = usePillField(draft.note, onNote, { attached: pictures, detach });
  const dictated = useDictation(draft.note, onNote);
  // Note that one pick holds the newest refusal, the picker's, a send's, a dictation's, or a chip's, so an older one never hides why the last act did not go, as on the agent's page.
  const said = useNewestNote([pictureNote, sendNote, dictated.note, ...box.notes]);

  // Note that the thread's own agent, whom the reply goes to, is left out of what an `@` offers, as on its own page.
  const mentions = useMentionOffer({ ...place, agentId: item.agentId }, pillField.mentions);

  // Note that the box's head holds what an `@` offers, then the newest refusal.
  const head =
    mentions === undefined && said === undefined ? undefined : (
      <>
        {mentions === undefined ? null : (
          <MentionSuggestions
            groups={mentions.groups}
            empty={mentions.empty}
            crumb={mentions.crumb}
            onPick={mentions.pick}
          />
        )}
        {said === undefined ? null : <AskNote words={said} />}
      </>
    );

  const placeholder = asNew
    ? INBOX_BOX_WORDS.NEW_THREAD_PLACEHOLDER
    : controlsStand(item)
      ? INBOX_BOX_WORDS.NOTE_PLACEHOLDER
      : INBOX_BOX_WORDS.REPLY_PLACEHOLDER;

  const props = {
    placeholder,
    words: draft.note,
    onWords: onNote,
    pills: pillField.pills,
    // Note that a new thread starts from words alone, so no picked answer lights Send for one.
    sendable: !asNew && (answerReady || nods),
    onSend: sendTyped,
    sendAs: nods ? GOT_IT_SEND : undefined,
    // Note that what a send that did not go said stands in the box's head with the pictures, beside the words it put back, as a comment's reply says it.
    head,
    tools: box.tools,
    trailing: box.trailing,
    dictation: dictated.dictation,
    addMenu: {
      actions: [{ ...ATTACH_PHOTOS, onPress: attach }],
      submenus: box.submenus,
      switches: [
        {
          label: `${INBOX_BOX_WORDS.SEND_AS_NEW} ${agentName}`,
          on: asNew,
          onPress: () => setAsNew(!asNew),
        },
      ],
    },
  };

  if (inColumn) return <ComposerFoot {...props} />;

  return (
    <>
      <Composer {...props} />
      {box.sheet}
    </>
  );
}

/** What the thread's ⋯ menu acts through: its read mark, Remind me's times, and its link copied. */
export interface ThreadMenuDoors {
  readonly onMark: (unread: boolean) => void;
  readonly remind: BarMenu;
  readonly onCopyLink: () => void;
}

/**
 * The thread's ⋯ menu, as the panel's row menu offers an item's acts
 * (`inbox-item-actions.tsx`): Copy link; Mark as read or unread, whichever
 * its mark is not; Resolve while it stands open; and Remind me's times, on
 * any thread, open or settled, as a submenu last, since a bar's menu holds
 * its submenus after its acts. A new thread with the agent stays the box's
 * own, under its +.
 */
export function threadMenu(item: InboxItem, answer: ThreadAnswer, doors: ThreadMenuDoors): BarMenu {
  const unread = isUnread(item);

  const resolve =
    item.status === INBOX_STATUS.OPEN
      ? [{ label: RESOLVE, symbol: GLYPH.RESOLVED, onPress: answer.resolve } as const]
      : [];

  return {
    ...THREAD_MORE,
    choices: [],
    actions: [
      {
        label: APP_SHORTCUTS[APP_COMMAND.COPY_LINK].label,
        symbol: GLYPH.LINK,
        onPress: doors.onCopyLink,
      },
      {
        label: unread ? INBOX_READ_MARK.READ : INBOX_READ_MARK.UNREAD,
        symbol: unread ? GLYPH.MARK_READ : GLYPH.MARK_UNREAD,
        onPress: () => doors.onMark(!unread),
      },
      ...resolve,
    ],
    submenus: [doors.remind],
  };
}

/**
 * A thread's main acts as a wide window's detail bar stands them, in the
 * place of Mail's Reply and Trash: its read mark, whichever the thread's is
 * not, Remind me's times as a menu, and Resolve, dimmed once the thread is settled so the bar
 * keeps its shape. The rest stay in ⋯ (`menuWithout`); a compact window's
 * stack keeps every act in ⋯.
 */
export function threadActs(
  item: InboxItem,
  answer: ThreadAnswer,
  doors: ThreadMenuDoors,
): readonly BarFootItem[] {
  const unread = isUnread(item);

  return [
    {
      label: unread ? INBOX_READ_MARK.READ : INBOX_READ_MARK.UNREAD,
      symbol: unread ? GLYPH.MARK_READ : GLYPH.MARK_UNREAD,
      onPress: () => doors.onMark(!unread),
    },
    doors.remind,
    {
      label: RESOLVE,
      symbol: GLYPH.RESOLVED,
      disabled: item.status !== INBOX_STATUS.OPEN,
      onPress: answer.resolve,
    },
  ];
}

/** A thread's acts while none is picked, dimmed rather than gone, as Mail's bar stands over No Message Selected. */
export const NO_THREAD_ACTS: readonly BarAction[] = [
  {
    label: INBOX_READ_MARK.UNREAD,
    symbol: GLYPH.MARK_UNREAD,
    disabled: true,
    onPress: () => undefined,
  },
  { ...REMIND_ME, disabled: true, onPress: () => undefined },
  { label: RESOLVE, symbol: GLYPH.RESOLVED, disabled: true, onPress: () => undefined },
];
