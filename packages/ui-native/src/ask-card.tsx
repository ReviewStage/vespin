// ask-card.tsx -- the rows a do ask's steps and an answer ask's fields stand in, as a decide ask's options do, inside the composer over its field: a row each, a hairline between them, and the ask's acts under them.

import {
  Divider,
  HStack,
  Image,
  Picker,
  Spacer,
  Button as SwiftUIButton,
  TextField,
  type TextFieldRef,
  Toggle,
  Toolbar,
  ToolbarItem,
  useNativeState,
  VStack,
} from "@expo/ui/swift-ui";
import * as SwiftModifiers from "@expo/ui/swift-ui/modifiers";
import {
  accessibilityHidden,
  accessibilityIdentifier,
  accessibilityLabel,
  buttonStyle,
  font,
  foregroundStyle,
  frame,
  keyboardType,
  labelsHidden,
  padding,
  pickerStyle,
  tag,
  textFieldStyle,
  tint,
  toggleStyle,
} from "@expo/ui/swift-ui/modifiers";
import { FIELD_WORDS, SELECTION_WORDS } from "@repo/features/words";
import { Predicate } from "effect";
import { Fragment, type ReactNode, useRef } from "react";
import { useAccessibilitySize, useAnnounced } from "./accessibility.js";
import { BUTTON_LOOK, Button } from "./button.js";
import { GLYPH, type Glyph, glyphImage } from "./glyph.js";
import { ProblemLine } from "./problem-line.js";
import { Text } from "./text.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** What a flow finds an ask's note by. */
const ASK_NOTE_ID = "ask-note";

/** A row's inner margins, as a decide option's: none at its sides, since the composer's head already stands its rows in as far as the field's words, so the two line up. */
export const ASK_ROW_PADDING = { horizontal: 0, vertical: SPACE.ROW + 1 } as const;

/** Where a row's words start among the ask's rows: past its margin, and past its leading mark where it has one, as a step's round check. */
export const CARD_WORDS_INSET = {
  BARE: ASK_ROW_PADDING.horizontal,
  MARKED: ASK_ROW_PADDING.horizontal + MARK_SIZE.LEAD + SPACE.ROW,
} as const;

/** A hairline between an ask's rows, starting where the words do, as iOS insets a list's separator past a row's leading mark. */
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

/**
 * An ask's rows, a hairline between each from where their words start,
 * standing on the composer's glass with no card of their own, as the
 * panel's box holds an ask's controls as its body with no card, border, or
 * head of their own (`inbox-answer-box.tsx`).
 */
function AskRows({
  inset,
  children,
}: {
  readonly inset: number;
  readonly children: readonly ReactNode[];
}) {
  return (
    <VStack
      alignment="leading"
      spacing={0}
      modifiers={[frame({ maxWidth: Number.POSITIVE_INFINITY, alignment: "leading" })]}
    >
      {children.map((child, index) => (
        // Note that the rows are keyed by their place, since they never reorder while the ask stands.
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

/**
 * One step: its checkbox, the accent's once ticked, and its Markdown words,
 * the whole row pressed to tick it or let it go, as the panel's checkbox and
 * the decide card's square marks are. Note that it is not the system's
 * switch, which takes a press on its knob alone, never on the step's words.
 */
function StepRow({
  step,
  ticked,
  onPress,
}: {
  readonly step: string;
  readonly ticked: boolean;
  readonly onPress: () => void;
}) {
  const colors = useColors();

  return (
    <SwiftUIButton
      onPress={onPress}
      modifiers={[buttonStyle("plain"), accessibilityLabel(ticked ? `${step}, ${TICKED}` : step)]}
    >
      <HStack
        spacing={SPACE.ROW}
        alignment="top"
        modifiers={[
          padding(ASK_ROW_PADDING),
          SwiftModifiers.contentShape(SwiftModifiers.shapes.rectangle()),
        ]}
      >
        <Image
          {...glyphImage(ticked ? GLYPH.ROUND_BOX_TICKED : GLYPH.ROUND_BOX)}
          size={MARK_SIZE.LEAD}
          color={ticked ? colors.ACCENT : colors.TEXT_MUTED}
        />
        <Text
          markdownEnabled
          modifiers={[font({ textStyle: TYPE_ROLE.ROW_TITLE }), foregroundStyle(colors.TEXT)]}
        >
          {step}
        </Text>
        <Spacer />
      </HStack>
    </SwiftUIButton>
  );
}

/** A do ask's steps as checkbox rows, by their place from the first at 0, with its acts under them. */
export function StepList({
  steps,
  ticked,
  onToggle,
  acts,
}: {
  readonly steps: readonly string[];
  readonly ticked: readonly number[];
  /** Called with a step's place once its toggle is pressed. */
  readonly onToggle: (index: number) => void;
  readonly acts: readonly AskAct[];
}) {
  return (
    <VStack alignment="leading" spacing={SPACE.ROW}>
      {steps.length === 0 ? null : (
        <AskRows inset={CARD_WORDS_INSET.MARKED}>
          {steps.map((step, index) => (
            <StepRow
              key={step}
              step={step}
              ticked={ticked.includes(index)}
              onPress={() => onToggle(index)}
            />
          ))}
        </AskRows>
      )}
      <AskActs acts={acts} />
    </VStack>
  );
}

/** A field's label, with "Optional" after it in the muted ink where it may be left empty, as the panel's form says it. */
function FieldWords({
  label,
  optional,
  textStyle,
  ink,
  hidden = false,
}: {
  readonly label: string;
  /** Whether the label says the field is optional after it, where nothing else in the row does. */
  readonly optional: boolean;
  readonly textStyle: (typeof TYPE_ROLE)[keyof typeof TYPE_ROLE];
  readonly ink: string;
  /** Whether VoiceOver passes over the words, where the control beside them is heard by them already. */
  readonly hidden?: boolean;
}) {
  const colors = useColors();

  return (
    <Text
      modifiers={[
        font({ textStyle, weight: "medium" }),
        foregroundStyle(ink),
        accessibilityHidden(hidden),
      ]}
    >
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
    <VStack alignment="leading" spacing={SPACE.TIGHT} modifiers={[padding(ASK_ROW_PADDING)]}>
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
 * A select: its label over the system's menu picker at the leading edge, as
 * a text field stands under its name in the same card, so a long value such
 * as "Every member (recommended)" has the row's width rather than squeezing
 * its label into a column beside it; it reads "None" until an option is
 * picked, as Settings' pickers do, the recommended option said as such.
 */
function SelectRow({
  field,
  recommendedWord,
  onChange,
}: {
  readonly field: AnswerField;
  readonly recommendedWord: string;
  readonly onChange: (value: string) => void;
}) {
  const colors = useColors();

  return (
    <VStack alignment="leading" spacing={SPACE.TIGHT} modifiers={[padding(ASK_ROW_PADDING)]}>
      <FieldWords
        label={field.label}
        optional={!field.required}
        textStyle={TYPE_ROLE.ROW_LINE}
        ink={colors.TEXT_MUTED}
      />
      <Picker<string>
        label={field.label}
        selection={Predicate.isString(field.value) ? field.value : ""}
        onSelectionChange={onChange}
        modifiers={[pickerStyle("menu"), labelsHidden(), tint(colors.TEXT)]}
      >
        <Text modifiers={[tag("")]}>{SELECTION_WORDS.NONE}</Text>
        {(field.options ?? []).map((option) => (
          <Text key={option} modifiers={[tag(option)]}>
            {option === field.recommended ? `${option} (${recommendedWord})` : option}
          </Text>
        ))}
      </Picker>
    </VStack>
  );
}

/**
 * A boolean: its words, then the system's switch at the row's end, as
 * Settings' rows stand. Note that the switch stands apart from its words,
 * its own label hidden (`labelsHidden`) and heard by VoiceOver, the words
 * beside it hidden from VoiceOver so they are heard once, because a toggle
 * holding its words is one element as wide as the row, whose center is on
 * its words, where a press never flips it; the switch alone carries the id a
 * flow presses it by.
 */
function BooleanRow({
  field,
  onChange,
}: {
  readonly field: AnswerField;
  readonly onChange: (value: boolean) => void;
}) {
  const colors = useColors();
  const heard = field.required ? field.label : `${field.label}, ${FIELD_WORDS.OPTIONAL}`;

  return (
    <HStack spacing={SPACE.ROW} modifiers={[padding(ASK_ROW_PADDING)]}>
      <FieldWords
        label={field.label}
        optional={!field.required}
        textStyle={TYPE_ROLE.ROW_TITLE}
        ink={colors.TEXT}
        hidden
      />
      <Spacer />
      <Toggle
        isOn={field.value === true}
        onIsOnChange={onChange}
        modifiers={[
          toggleStyle("switch"),
          tint(colors.ACCENT),
          labelsHidden(),
          accessibilityIdentifier(`answer-field-${field.label}`),
        ]}
      >
        <Text>{heard}</Text>
      </Toggle>
    </HStack>
  );
}

/**
 * An answer ask's fields as rows of the system's form controls, a row
 * each: a text or number field under its label, a select's menu picker, a
 * boolean's toggle. Note that they are rows in the composer's head rather
 * than a SwiftUI `Form`, because a `Form` scrolls on its own and the head
 * scrolls in place once tall (`BarHead`); its rows are the controls a `Form`
 * holds.
 */
export function AnswerFields({
  fields,
  recommendedWord,
  onChange,
}: {
  readonly fields: readonly AnswerField[];
  /** What a select's recommended option is called after it: the panel's "recommended". */
  readonly recommendedWord: string;
  /** Called with a field's label and what it now holds. */
  readonly onChange: (label: string, value: string | boolean) => void;
}) {
  const focused = useRef<TextFieldRef | null>(null);

  // Note that a field letting the keyboard go clears the hold only while it is still the one held, since the next field's focus can arrive before the last one's blur.
  const onFocused = (field: TextFieldRef | null, now: boolean) => {
    if (now) focused.current = field;
    else if (focused.current === field) focused.current = null;
  };

  const card = (
    <AskRows inset={CARD_WORDS_INSET.BARE}>
      {fields.map((field) => {
        const change = (value: string | boolean) => onChange(field.label, value);

        if (field.kind === ANSWER_FIELD.BOOLEAN) {
          return <BooleanRow key={field.label} field={field} onChange={change} />;
        }

        if (field.kind === ANSWER_FIELD.SELECT) {
          return (
            <SelectRow
              key={field.label}
              field={field}
              recommendedWord={recommendedWord}
              onChange={change}
            />
          );
        }

        return (
          <TypedFieldRow key={field.label} field={field} onChange={change} onFocused={onFocused} />
        );
      })}
    </AskRows>
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
