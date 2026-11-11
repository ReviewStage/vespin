// inbox-ask.tsx -- a thread's open ask as its card, the box under the thread, and its ⋯ menu: a decide's options, a do's steps with Mark done and Couldn't do it, an answer's fields, the composer that sends them with a note or replies, and Remind me and Resolve.

import { ASK_PRESS, INBOX_BOX_WORDS, RESOLVE } from "@repo/features/inbox-ask-words";
import { fieldValueOf, shownTicks, withStep, withValue } from "@repo/features/inbox-draft";
import { knownAsk, RECOMMENDED } from "@repo/features/inbox-list-model";
import {
  INBOX_ASK,
  INBOX_FIELD,
  INBOX_REPLY,
  INBOX_STATUS,
  type InboxItem,
  openAskOf,
  recommendedLabels,
} from "@repo/features/inbox-wire";
import {
  ANSWER_FIELD,
  type AnswerField,
  type AnswerFieldKind,
  AnswerFields,
  AskNote,
  type BarMenu,
  ChoiceList,
  Composer,
  ComposerFoot,
  StepList,
} from "@repo/ui-native";
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
  if (typeof typed === "boolean") return typed;
  if (typed.trim() === "") return undefined;
  if (kind !== ANSWER_FIELD.NUMBER) return typed;
  const number = Number(typed.trim().replace(",", "."));
  return Number.isFinite(number) ? number : typed;
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
 * note typed; an answer's fields to fill. What the last send said where it did
 * not go stands under it. None where nothing is asked and nothing was said.
 */
export function OpenAskCard({
  item,
  answer,
}: {
  readonly item: InboxItem;
  readonly answer: ThreadAnswer;
}): ReactNode {
  const { draft, onDraft, note, send } = answer;
  const ask = openAsk(item);
  const said = note === undefined ? null : <AskNote words={note} />;
  if (ask === undefined) return said;
  if (ask.type === INBOX_ASK.DECIDE) {
    return (
      <>
        <ChoiceList
          choices={ask.options}
          recommended={recommendedLabels(ask)}
          picked={draft.choices}
          multiple={ask.multiple === true}
          onChange={(choices) => onDraft({ ...draft, choices })}
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
      value: typeof value === "boolean" ? value : value === undefined ? "" : String(value),
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
 */
export function ThreadComposer({
  item,
  answer,
  inColumn = false,
}: {
  readonly item: InboxItem;
  readonly answer: ThreadAnswer;
  /** Whether it stands at a SwiftUI column's foot, a split view's detail, rather than docked over the screen. */
  readonly inColumn?: boolean;
}) {
  const { draft, onDraft, answerReady, send } = answer;
  const props = {
    placeholder: controlsStand(item)
      ? INBOX_BOX_WORDS.NOTE_PLACEHOLDER
      : INBOX_BOX_WORDS.REPLY_PLACEHOLDER,
    words: draft.note,
    onWords: (note: string) => onDraft({ ...draft, note }),
    sendable: answerReady,
    onSend: () => send(),
  };
  return inColumn ? <ComposerFoot {...props} /> : <Composer {...props} />;
}

/** The thread's ⋯ menu: Remind me, on any thread, open or settled, as the panel's menu offers it, and Resolve while it stands open. */
export function threadMenu(item: InboxItem, answer: ThreadAnswer, onRemind: () => void): BarMenu {
  const resolve =
    item.status === INBOX_STATUS.OPEN
      ? [{ label: RESOLVE, symbol: "checkmark.circle", onPress: answer.resolve } as const]
      : [];
  return {
    ...THREAD_MORE,
    choices: [],
    actions: [{ ...REMIND_ME, onPress: onRemind }, ...resolve],
  };
}
