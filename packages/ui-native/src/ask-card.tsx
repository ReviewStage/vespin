// ask-card.tsx -- the card a do ask's steps and an answer ask's fields stand in, as a decide ask's options do: a bordered card on the surface, a row each, and the ask's acts under it.

import {
  Divider,
  HStack,
  Image,
  Spacer,
  Button as SwiftUIButton,
  TextField,
  type TextFieldRef,
  Toolbar,
  ToolbarItem,
  useNativeState,
  VStack,
} from "@expo/ui/swift-ui";
import * as SwiftModifiers from "@expo/ui/swift-ui/modifiers";
import {
  accessibilityAddTraits,
  accessibilityIdentifier,
  accessibilityLabel,
  accessibilityValue,
  background,
  buttonStyle,
  fixedSize,
  font,
  foregroundStyle,
  frame,
  keyboardType,
  lineLimit,
  padding,
  strokeBorder,
  textFieldStyle,
} from "@expo/ui/swift-ui/modifiers";
import { RECOMMENDED } from "@repo/features/inbox-list-model";
import { fieldValueWords } from "@repo/features/inbox-wire";
import { linkLabels } from "@repo/features/mention-link";
import { FIELD_WORDS } from "@repo/features/words";
import { Predicate } from "effect";
import { Fragment, type ReactNode, useRef } from "react";
import { Pressable } from "react-native";
import { useAccessibilitySize, useAnnounced } from "./accessibility.js";
import { BUTTON_LOOK, Button } from "./button.js";
import { GLYPH, type Glyph, glyphImage } from "./glyph.js";
import { HostedViews } from "./hosted-views.js";
import { MARKDOWN_LOOK, Markdown } from "./markdown.js";
import { ProblemLine } from "./problem-line.js";
import { PickedCheck } from "./settings-form.js";
import { useSteppedBack } from "./stepped-back.js";
import { Text } from "./text.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, PRESS_SIZE, RADIUS, SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** How thick the card's edge is drawn: a hairline, as the decide card's is. */
/** What a flow finds an ask's note by. */
const ASK_NOTE_ID = "ask-note";

const HAIRLINE = 0.5;

/** A row's inner margins, as a decide option's. */
const ROW_PADDING = { horizontal: SPACE.EDGE - 2, vertical: SPACE.ROW + 1 } as const;

/** Where a row's words start in the card: past its margin, and past its leading mark where it has one, as a step's round check. */
export const CARD_WORDS_INSET = {
  BARE: ROW_PADDING.horizontal,
  MARKED: ROW_PADDING.horizontal + MARK_SIZE.LEAD + SPACE.ROW,
} as const;

/** A hairline between a card's rows, starting where the words do, as iOS insets a list's separator past a row's leading mark. */
export function CardDivider({ inset }: { readonly inset: number }) {
  return <Divider modifiers={[padding({ leading: inset })]} />;
}

/** What a ticked step is heard as after its words. */
const TICKED = "ticked";

/** What lowers a number pad, which has no return key of its own. */
const KEYBOARD_DONE = "Done";

/** The kinds of field an answer ask types its values in. */
export const ANSWER_FIELD = {
  TEXT: "text",
  NUMBER: "number",
  SELECT: "select",
  BOOLEAN: "boolean",
} as const;

export type AnswerFieldKind = (typeof ANSWER_FIELD)[keyof typeof ANSWER_FIELD];

/** One field as the card draws it: its kind, its label, what it holds, and a select's options with the one recommended. */
export type AnswerField = {
  readonly kind: AnswerFieldKind;
  readonly label: string;
  /** Whether it must be filled; one that need not be says "Optional" after its label. */
  readonly required: boolean;
  /** A text or number field's words, a select's option, or a boolean's state. */
  readonly value: string | boolean;
  readonly options?: readonly string[] | undefined;
  readonly recommended?: string | undefined;
};

/** One act under the card, such as Mark done: its words and its glyph. */
export type AskAct = {
  readonly label: string;
  readonly symbol: Glyph;
  /** Whether it is the lesser of the card's acts, such as Couldn't do it beside Mark done, which stands quiet, as the panel's does. */
  readonly quiet?: boolean | undefined;
  readonly onPress: () => void;
};

/** The bordered card on its own fill (`CARD`), set off from the page's ground, the rows standing in it, a hairline between each from where their words start. */
function Card({
  inset,
  children,
}: {
  readonly inset: number;
  readonly children: readonly ReactNode[];
}) {
  const colors = useColors();

  return (
    <VStack
      alignment="leading"
      spacing={0}
      modifiers={[
        frame({ maxWidth: Number.POSITIVE_INFINITY, alignment: "leading" }),
        background(
          colors.CARD,
          SwiftModifiers.shapes.roundedRectangle({ cornerRadius: RADIUS.CARD }),
        ),
        strokeBorder({
          content: colors.CHIP_EDGE,
          // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- @expo/ui names this parameter `shape`.
          shape: "roundedRectangle",
          cornerRadius: RADIUS.CARD,
          style: { lineWidth: HAIRLINE },
        }),
      ]}
    >
      {children.map((child, index) => (
        // Note that the rows are keyed by their place, since they never reorder while the card stands.
        <Fragment key={index}>
          {index === 0 ? null : <CardDivider inset={inset} />}
          {child}
        </Fragment>
      ))}
    </VStack>
  );
}

/** What the box's last send said where it did not go, under the ask: what the answer lacks, or the refusal, as every refusal stands (`ProblemLine`), never red words. */
export function AskNote({ words }: { readonly words: string }) {
  // Note that a note stands because a send did not go, so VoiceOver is told it at once, rather than the reader finding it only by walking the screen.
  useAnnounced(words, true);

  return <ProblemLine text={words} id={ASK_NOTE_ID} />;
}

/**
 * The card's acts in a row under it, at the system's regular size so each
 * stands a 44 pt target: the main act, such as Mark done, filled in the
 * accent as a screen's one act is, and a quiet one beside it, such as
 * Couldn't do it, its words alone in the ink, as the panel's quiet button.
 */
export function AskActs({ acts }: { readonly acts: readonly AskAct[] }) {
  const stacked = useAccessibilitySize();

  const buttons = acts.map((act) => (
    <Button
      key={act.label}
      label={act.label}
      symbol={act.symbol}
      look={act.quiet === true ? BUTTON_LOOK.PLAIN : BUTTON_LOOK.PROMINENT}
      onPress={act.onPress}
    />
  ));

  // Note that past the accessibility sizes the acts stand one under the other, as a row's end does, because two regular buttons side by side run past an iPhone's width there.
  return stacked ? (
    <VStack alignment="leading" spacing={SPACE.TIGHT * 2}>
      {buttons}
    </VStack>
  ) : (
    <HStack spacing={SPACE.TIGHT * 2}>{buttons}</HStack>
  );
}

/** What settles an open ask without answering it, as the panel's × beside its question: its words, heard on the ×, and its press. */
export type AskResolve = {
  readonly label: string;
  readonly onPress: () => void;
};

/**
 * An open ask's card with the × that resolves it without an answer at its
 * top end, as the panel's question stands its × (`DraftQuestion`): the
 * system's close mark in the muted ink, a full press's size, heard by its
 * act's words. The card alone where nothing resolves it.
 */
export function ResolvableAsk({
  resolve,
  children,
}: {
  readonly resolve: AskResolve | undefined;
  readonly children: ReactNode;
}) {
  const colors = useColors();

  if (resolve === undefined) return children;

  return (
    <HStack alignment="top" spacing={0}>
      {children}
      <SwiftUIButton
        onPress={resolve.onPress}
        modifiers={[buttonStyle("plain"), accessibilityLabel(resolve.label)]}
      >
        <Image
          {...glyphImage(GLYPH.CLOSE)}
          size={MARK_SIZE.GLYPH}
          color={colors.TEXT_MUTED}
          modifiers={[
            // Note that the mark is drawn small, as the panel's compact ×, while its press stands as large as Apple asks of a target.
            frame({ minWidth: PRESS_SIZE, minHeight: PRESS_SIZE, alignment: "top" }),
            SwiftModifiers.contentShape(SwiftModifiers.shapes.rectangle()),
          ]}
        />
      </SwiftUIButton>
    </HStack>
  );
}

/** The small bordered tag after the recommended option's label, muted, as the panel's stands, so copper is left for the option picked; its one word on one line at every size, never broken inside the tag. */
export function RecommendedTag() {
  const colors = useColors();

  return (
    <Text
      modifiers={[
        font({ textStyle: TYPE_ROLE.TIME, weight: "semibold" }),
        foregroundStyle(colors.TEXT_MUTED),
        // Note that the tag keeps its own width, since at the largest sizes the row's column offered it less and SwiftUI broke its word as "Recommend-ed".
        lineLimit(1),
        fixedSize(),
        padding({ horizontal: 5, vertical: 1 }),
        strokeBorder({
          content: colors.CHIP_EDGE,
          // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- @expo/ui names this parameter `shape`.
          shape: "roundedRectangle",
          cornerRadius: RADIUS.TAG,
          style: { lineWidth: 1 },
        }),
      ]}
    >
      {RECOMMENDED}
    </Text>
  );
}

/** A checkbox's mark, the accent's once ticked, as a step's, a yes or no's, and a held yes or no's lead their row. */
function TickMark({ ticked }: { readonly ticked: boolean }) {
  const colors = useColors();

  return (
    <Image
      {...glyphImage(ticked ? GLYPH.ROUND_BOX_TICKED : GLYPH.ROUND_BOX)}
      size={MARK_SIZE.LEAD}
      color={ticked ? colors.ACCENT : colors.TEXT_MUTED}
    />
  );
}

/**
 * One step: its checkbox, the accent's once ticked, and its words drawn as
 * the thread's Markdown draws them, so a link of ours, bare or a mention,
 * stands as its chip (`@repo/features/mention-link`'s `linkChipOf`), as the
 * panel's step draws it. A press on the box or on the words ticks the step
 * or lets it go, as the panel's checkbox and the decide card's square marks
 * take one, but a chip's press opens its link and ticks nothing, as the
 * panel's link in a step does. Note that the words stand in a React Native
 * host beside the box, never inside a SwiftUI button, which would take the
 * chip's press for its own; and that the box is the step's one element
 * VoiceOver toggles, heard by its words, while the words' lines offer each
 * chip they hold as their own actions.
 */
function StepRow({
  step,
  ticked,
  onPress,
  repository,
  onOpenLink,
}: {
  readonly step: string;
  readonly ticked: boolean;
  /** Ticks the step or lets it go; none for an ask no longer waiting, whose step stands as the answer left it. */
  readonly onPress: (() => void) | undefined;
  readonly repository: string | null | undefined;
  readonly onOpenLink: (address: string) => void;
}) {
  const heard = linkLabels(step);
  const stepped = useSteppedBack();
  const heardAs = accessibilityLabel(ticked ? `${heard}, ${TICKED}` : heard);

  return (
    <HStack
      spacing={SPACE.ROW}
      alignment="top"
      modifiers={[
        padding(ROW_PADDING),
        frame({ maxWidth: Number.POSITIVE_INFINITY, alignment: "leading" }),
      ]}
    >
      {onPress === undefined ? (
        <HStack modifiers={[SwiftModifiers.accessibilityElement("combine"), heardAs]}>
          <TickMark ticked={ticked} />
        </HStack>
      ) : (
        <SwiftUIButton onPress={onPress} modifiers={[buttonStyle("plain"), heardAs]}>
          <TickMark ticked={ticked} />
        </SwiftUIButton>
      )}
      <HostedViews matchContents={{ vertical: true }}>
        <Pressable accessible={false} onPress={onPress}>
          <Markdown
            words={step}
            look={stepped ? MARKDOWN_LOOK.STEPPED_BACK : MARKDOWN_LOOK.MESSAGE}
            repository={repository}
            onOpenLink={onOpenLink}
          />
        </Pressable>
      </HostedViews>
    </HStack>
  );
}

/** A do ask's steps as a card of checkbox rows, by their place from the first at 0, with its acts under it; with no `onToggle`, standing as an answer left it, ticked as it ticked them, taking no press. */
export function StepList({
  steps,
  ticked,
  onToggle,
  acts = [],
  repository,
  onOpenLink,
}: {
  readonly steps: readonly string[];
  readonly ticked: readonly number[];
  /** Called with a step's place once its toggle is pressed; none for an ask no longer waiting. */
  readonly onToggle?: ((index: number) => void) | undefined;
  /** The acts under the card; none for an ask no longer waiting. */
  readonly acts?: readonly AskAct[] | undefined;
  /** The thread's repository, `owner/name`, whose GitHub pages are its files' chips. */
  readonly repository: string | null | undefined;
  /** Opens a link or a chip pressed in a step's words, by the address it was written as, where the app draws it or in Safari. */
  readonly onOpenLink: (address: string) => void;
}) {
  return (
    <VStack alignment="leading" spacing={SPACE.ROW}>
      {steps.length === 0 ? null : (
        <Card inset={CARD_WORDS_INSET.MARKED}>
          {steps.map((step, index) => (
            <StepRow
              key={step}
              step={step}
              ticked={ticked.includes(index)}
              onPress={onToggle === undefined ? undefined : () => onToggle(index)}
              repository={repository}
              onOpenLink={onOpenLink}
            />
          ))}
        </Card>
      )}
      {acts.length === 0 ? null : <AskActs acts={acts} />}
    </VStack>
  );
}

/** A field's label, with "Optional" after it in the muted ink where it may be left empty, as the panel's form says it. */
function FieldWords({
  label,
  optional,
  textStyle,
  ink,
}: {
  readonly label: string;
  /** Whether the label says the field is optional after it, where nothing else in the row does. */
  readonly optional: boolean;
  readonly textStyle: (typeof TYPE_ROLE)[keyof typeof TYPE_ROLE];
  readonly ink: string;
}) {
  const colors = useColors();

  return (
    <Text modifiers={[font({ textStyle, weight: "medium" }), foregroundStyle(ink)]}>
      <Text>{label}</Text>
      {optional ? (
        <Text
          modifiers={[font({ textStyle: TYPE_ROLE.ROW_LINE }), foregroundStyle(colors.TEXT_MUTED)]}
        >
          {`  ${FIELD_WORDS.OPTIONAL}`}
        </Text>
      ) : null}
    </Text>
  );
}

/**
 * A text or number field: its label over the system's plain field, as the
 * panel stands a field's name over it, the field with no box of its own
 * inside the card's (one layer, as a Form's field stands in its row); a
 * field prompts "Required" or "Optional" while it is empty, as iOS's account
 * forms do, so it never reads as a gap nor repeats the label over it, and
 * its label says nothing more; heard by its label, a number's with the
 * decimal pad.
 */
function TypedFieldRow({
  field,
  onChange,
  onFocused,
}: {
  readonly field: AnswerField;
  readonly onChange: (value: string) => void;
  /** Called with the field and whether it now holds the keyboard, so the card's Done lowers the one focused. */
  readonly onFocused: (field: TextFieldRef | null, focused: boolean) => void;
}) {
  const colors = useColors();
  const text = useNativeState(Predicate.isString(field.value) ? field.value : "");
  const fieldRef = useRef<TextFieldRef>(null);

  return (
    <VStack alignment="leading" spacing={SPACE.TIGHT} modifiers={[padding(ROW_PADDING)]}>
      <FieldWords
        label={field.label}
        optional={false}
        textStyle={TYPE_ROLE.ROW_LINE}
        ink={colors.TEXT_MUTED}
      />
      <TextField
        ref={fieldRef}
        text={text}
        placeholder={field.required ? FIELD_WORDS.REQUIRED : FIELD_WORDS.OPTIONAL}
        onTextChange={onChange}
        onFocusChange={(focused) => onFocused(fieldRef.current, focused)}
        modifiers={[
          textFieldStyle("plain"),
          font({ textStyle: TYPE_ROLE.ROW_TITLE }),
          foregroundStyle(colors.TEXT),
          frame({ maxWidth: Number.POSITIVE_INFINITY, alignment: "leading" }),
          accessibilityLabel(field.label),
          accessibilityIdentifier(`answer-field-${field.label}`),
          ...(field.kind === ANSWER_FIELD.NUMBER ? [keyboardType("decimal-pad")] : []),
        ]}
      />
    </VStack>
  );
}

/**
 * One of a select's options, a row under its label: its words, the
 * recommended one tagged as a decide's option is, and the copper check at
 * its end once picked; a press on the one picked lets it go, as the panel's
 * pill is taken back, since a field left empty is sent without it.
 */
function SelectOptionRow({
  option,
  recommended,
  picked,
  onPress,
}: {
  readonly option: string;
  readonly recommended: boolean;
  readonly picked: boolean;
  readonly onPress: () => void;
}) {
  const colors = useColors();

  return (
    <SwiftUIButton
      onPress={onPress}
      modifiers={[
        buttonStyle("plain"),
        accessibilityLabel(recommended ? `${option}, ${RECOMMENDED}` : option),
        ...(picked ? [accessibilityAddTraits(["isSelected"])] : []),
      ]}
    >
      <HStack
        spacing={SPACE.TIGHT + 2}
        modifiers={[
          padding(ROW_PADDING),
          SwiftModifiers.contentShape(SwiftModifiers.shapes.rectangle()),
        ]}
      >
        <Text modifiers={[font({ textStyle: TYPE_ROLE.ROW_TITLE }), foregroundStyle(colors.TEXT)]}>
          {option}
        </Text>
        {recommended ? <RecommendedTag /> : null}
        <Spacer />
        {picked ? <PickedCheck /> : null}
      </HStack>
    </SwiftUIButton>
  );
}

/**
 * A select: its label, then each of its options as a row of the card, as
 * the panel's form stands every option as a pill under the label, so the
 * one the agent recommends is seen tagged before any is picked rather than
 * hidden behind a menu reading "None"; nothing stands picked until the
 * reader picks, as the panel's form starts.
 */
function SelectRows({
  field,
  onChange,
}: {
  readonly field: AnswerField;
  readonly onChange: (value: string) => void;
}) {
  const colors = useColors();
  const picked = Predicate.isString(field.value) ? field.value : "";

  return (
    <VStack alignment="leading" spacing={0}>
      <VStack alignment="leading" modifiers={[padding({ ...ROW_PADDING, bottom: 0 })]}>
        <FieldWords
          label={field.label}
          optional={!field.required}
          textStyle={TYPE_ROLE.ROW_LINE}
          ink={colors.TEXT_MUTED}
        />
      </VStack>
      {(field.options ?? []).map((option, index) => (
        <Fragment key={option}>
          {index === 0 ? null : <CardDivider inset={CARD_WORDS_INSET.BARE} />}
          <SelectOptionRow
            option={option}
            recommended={option === field.recommended}
            picked={option === picked}
            onPress={() => onChange(option === picked ? "" : option)}
          />
        </Fragment>
      ))}
    </VStack>
  );
}

/**
 * A yes or no: its checkbox beside its name, "Optional" after it where it
 * may be left empty, as the panel's form draws one, the whole row pressed to
 * tick it or let it go, as the panel's checkbox is pressed by its words too.
 * Note that it is not the system's switch, which takes a press on its knob
 * alone, and which the panel's form draws nowhere.
 */
function BooleanRow({
  field,
  onChange,
}: {
  readonly field: AnswerField;
  readonly onChange: (value: boolean) => void;
}) {
  const colors = useColors();
  const ticked = field.value === true;
  const optional = !field.required;
  const heard = optional ? `${field.label}, ${FIELD_WORDS.OPTIONAL}` : field.label;

  return (
    <SwiftUIButton
      onPress={() => onChange(!ticked)}
      modifiers={[buttonStyle("plain"), accessibilityLabel(ticked ? `${heard}, ${TICKED}` : heard)]}
    >
      <HStack
        spacing={SPACE.ROW}
        alignment="top"
        modifiers={[
          padding(ROW_PADDING),
          SwiftModifiers.contentShape(SwiftModifiers.shapes.rectangle()),
        ]}
      >
        <TickMark ticked={ticked} />
        <FieldWords
          label={field.label}
          optional={optional}
          textStyle={TYPE_ROLE.ROW_TITLE}
          ink={colors.TEXT}
        />
        <Spacer />
      </HStack>
    </SwiftUIButton>
  );
}

/**
 * A field as an answer filled it, taking nothing, as the panel's held form
 * stands: a yes or no as its checkbox, ticked where it was, beside its
 * name; any other field its name, muted, over what was put in it, which
 * stays empty where the answer left it so.
 */
function HeldFieldRow({ field }: { readonly field: AnswerField }) {
  const colors = useColors();
  const ink = useSteppedBack() ? colors.TEXT_MUTED : colors.TEXT;

  if (field.kind === ANSWER_FIELD.BOOLEAN) {
    const ticked = field.value === true;

    return (
      <HStack
        spacing={SPACE.ROW}
        modifiers={[
          padding(ROW_PADDING),
          SwiftModifiers.accessibilityElement("combine"),
          accessibilityLabel(field.label),
          // Note that the answer is heard as its value, yes or no, so a no is said rather than left silent; a yes or no the answer left empty says nothing.
          ...(Predicate.isBoolean(field.value)
            ? [accessibilityValue(fieldValueWords(field.value))]
            : []),
        ]}
      >
        <TickMark ticked={ticked} />
        <FieldWords
          label={field.label}
          optional={!field.required}
          textStyle={TYPE_ROLE.ROW_TITLE}
          ink={ink}
        />
        <Spacer />
      </HStack>
    );
  }

  const words = Predicate.isString(field.value) ? field.value : "";

  return (
    <VStack
      alignment="leading"
      spacing={SPACE.TIGHT}
      modifiers={[
        padding(ROW_PADDING),
        frame({ maxWidth: Number.POSITIVE_INFINITY, alignment: "leading" }),
        SwiftModifiers.accessibilityElement("combine"),
      ]}
    >
      <FieldWords
        label={field.label}
        optional={false}
        textStyle={TYPE_ROLE.ROW_LINE}
        ink={colors.TEXT_MUTED}
      />
      {words === "" ? null : (
        <Text modifiers={[font({ textStyle: TYPE_ROLE.ROW_TITLE }), foregroundStyle(ink)]}>
          {words}
        </Text>
      )}
    </VStack>
  );
}

/**
 * An answer ask's fields as a card of the system's form controls, a row
 * each: a text or number field under its label, a select's options as rows
 * under its label, the recommended one tagged, and a yes or no's checkbox. Note that it is a card in the thread's scroll rather
 * than a SwiftUI `Form`, because a `Form` scrolls on its own and the thread
 * it stands in already does; its rows are the controls a `Form` holds. With
 * no `onChange`, the card stands as an answer filled it (`HeldFieldRow`).
 */
export function AnswerFields({
  fields,
  onChange,
}: {
  readonly fields: readonly AnswerField[];
  /** Called with a field's label and what it now holds; none for an ask no longer waiting. */
  readonly onChange?: ((label: string, value: string | boolean) => void) | undefined;
}) {
  if (onChange === undefined) {
    return (
      <Card inset={CARD_WORDS_INSET.BARE}>
        {fields.map((field) => (
          <HeldFieldRow key={field.label} field={field} />
        ))}
      </Card>
    );
  }

  return <OpenFields fields={fields} onChange={onChange} />;
}

/** An open answer ask's fields, as `AnswerFields` draws them while the ask waits. */
function OpenFields({
  fields,
  onChange,
}: {
  readonly fields: readonly AnswerField[];
  readonly onChange: (label: string, value: string | boolean) => void;
}) {
  const focused = useRef<TextFieldRef | null>(null);

  // Note that a field letting the keyboard go clears the hold only while it is still the one held, since the next field's focus can arrive before the last one's blur.
  const onFocused = (field: TextFieldRef | null, now: boolean) => {
    if (now) focused.current = field;
    else if (focused.current === field) focused.current = null;
  };

  const card = (
    <Card inset={CARD_WORDS_INSET.BARE}>
      {fields.map((field) => {
        const change = (value: string | boolean) => onChange(field.label, value);

        if (field.kind === ANSWER_FIELD.BOOLEAN) {
          return <BooleanRow key={field.label} field={field} onChange={change} />;
        }

        if (field.kind === ANSWER_FIELD.SELECT) {
          return <SelectRows key={field.label} field={field} onChange={change} />;
        }

        return (
          <TypedFieldRow key={field.label} field={field} onChange={change} onFocused={onFocused} />
        );
      })}
    </Card>
  );

  // Note that a number pad has no return key, so a card holding a number field stands one Done over the keyboard, as Settings' and Contacts' number pads do, lowering whichever field is focused. It's the card's, mounted once for as long as the card holds a number field, because adding a toolbar item as a field takes focus changed the field's view and let the keyboard go.
  return fields.some((field) => field.kind === ANSWER_FIELD.NUMBER) ? (
    <Toolbar>
      {card}
      <Toolbar.Content>
        {/* Note that a flexible space stands before Done in one group, as Settings' stands it at the bar's trailing edge, because iOS 26 centers a keyboard bar's lone item, which neither a `Spacer` inside it nor a `ToolbarSpacer` moved. */}
        <ToolbarItem placement="keyboard" spacerBefore>
          <SwiftUIButton label={KEYBOARD_DONE} onPress={() => void focused.current?.blur()} />
        </ToolbarItem>
      </Toolbar.Content>
    </Toolbar>
  ) : (
    card
  );
}
