// ask-card.tsx -- the card a do ask's steps and an answer ask's fields stand in, as a decide ask's options do: a bordered card on the surface, a row each, and the ask's acts under it.

import {
  Divider,
  HStack,
  Image,
  Picker,
  Spacer,
  Button as SwiftUIButton,
  Text,
  TextField,
  Toggle,
  useNativeState,
  VStack,
} from "@expo/ui/swift-ui";
import * as SwiftModifiers from "@expo/ui/swift-ui/modifiers";
import {
  accessibilityIdentifier,
  accessibilityLabel,
  background,
  buttonStyle,
  font,
  foregroundStyle,
  frame,
  keyboardType,
  labelsHidden,
  padding,
  pickerStyle,
  strokeBorder,
  tag,
  textFieldStyle,
  tint,
  toggleStyle,
} from "@expo/ui/swift-ui/modifiers";
import { FIELD_WORDS } from "@repo/features/words";
import { Predicate } from "effect";
import { Fragment, type ReactNode } from "react";
import { useAccessibilitySize, useAnnounced } from "./accessibility.js";
import { Chip } from "./button.js";
import { GLYPH, type Glyph, glyphImage } from "./glyph.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, RADIUS, SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** How thick the card's edge is drawn: a hairline, as the decide card's is. */
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

/** What a select's picker reads before an option is picked. */
const CHOOSE = "Choose";

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
  readonly onPress: () => void;
};

/** The bordered card on the surface the rows stand in, a hairline between each from where their words start. */
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
          colors.SURFACE,
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

/** What the box's last send said where it did not go, under the ask: what the answer lacks, or the refusal, in the danger's ink. */
export function AskNote({ words }: { readonly words: string }) {
  const colors = useColors();
  // Note that a note stands because a send did not go, so VoiceOver is told it at once, rather than the reader finding it only by walking the screen.
  useAnnounced(words, true);

  return (
    <Text
      modifiers={[
        font({ textStyle: TYPE_ROLE.ROW_LINE }),
        foregroundStyle(colors.DANGER_TEXT),
        accessibilityIdentifier("ask-note"),
      ]}
    >
      {words}
    </Text>
  );
}

/** The card's acts in a row under it, each a small capsule with its glyph, as the panel's presses under an ask stand; one to a line at the accessibility sizes, as a page's chips stand, rather than squeezed side by side. */
export function AskActs({ acts }: { readonly acts: readonly AskAct[] }) {
  const chips = acts.map((act) => (
    <Chip key={act.label} label={act.label} symbol={act.symbol} onPress={act.onPress} />
  ));

  return useAccessibilitySize() ? (
    <VStack alignment="leading" spacing={SPACE.TIGHT * 2}>
      {chips}
    </VStack>
  ) : (
    <HStack spacing={SPACE.TIGHT * 2}>{chips}</HStack>
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
          padding(ROW_PADDING),
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

/** A do ask's steps as a card of checkbox rows, by their place from the first at 0, with its acts under it. */
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
        <Card inset={CARD_WORDS_INSET.MARKED}>
          {steps.map((step, index) => (
            <StepRow
              key={step}
              step={step}
              ticked={ticked.includes(index)}
              onPress={() => onToggle(index)}
            />
          ))}
        </Card>
      )}
      <AskActs acts={acts} />
    </VStack>
  );
}

/** A field's label, with "Optional" after it in the muted ink where it may be left empty, as the panel's form says it. */
function FieldWords({
  label,
  required,
  textStyle,
  ink,
}: {
  readonly label: string;
  readonly required: boolean;
  readonly textStyle: (typeof TYPE_ROLE)[keyof typeof TYPE_ROLE];
  readonly ink: string;
}) {
  const colors = useColors();

  return (
    <Text modifiers={[font({ textStyle, weight: "medium" }), foregroundStyle(ink)]}>
      <Text>{label}</Text>
      {required ? null : (
        <Text
          modifiers={[font({ textStyle: TYPE_ROLE.ROW_LINE }), foregroundStyle(colors.TEXT_MUTED)]}
        >
          {`  ${FIELD_WORDS.OPTIONAL}`}
        </Text>
      )}
    </Text>
  );
}

/**
 * A text or number field: its label over the system's plain field, as the
 * panel stands a field's name over it, the field with no box of its own
 * inside the card's (one layer, as a Form's field stands in its row) and
 * prompting with its label while it is empty, as Contacts' fields do, so an
 * empty one never reads as a gap; heard by its label, a number's with the
 * decimal pad.
 */
function TypedFieldRow({
  field,
  onChange,
}: {
  readonly field: AnswerField;
  readonly onChange: (value: string) => void;
}) {
  const colors = useColors();
  const text = useNativeState(Predicate.isString(field.value) ? field.value : "");

  return (
    <VStack alignment="leading" spacing={SPACE.TIGHT} modifiers={[padding(ROW_PADDING)]}>
      <FieldWords
        label={field.label}
        required={field.required}
        textStyle={TYPE_ROLE.ROW_LINE}
        ink={colors.TEXT_MUTED}
      />
      <TextField
        text={text}
        placeholder={field.label}
        onTextChange={onChange}
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
 * A select: its label and the system's menu picker on one row, the label
 * leading and the picker's value at its end, as a Form's picker row stands;
 * it reads "Choose" until an option is picked, the recommended option said
 * as such.
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
    <HStack spacing={SPACE.ROW} modifiers={[padding(ROW_PADDING)]}>
      <FieldWords
        label={field.label}
        required={field.required}
        textStyle={TYPE_ROLE.ROW_TITLE}
        ink={colors.TEXT}
      />
      <Spacer />
      <Picker<string>
        label={field.label}
        selection={Predicate.isString(field.value) ? field.value : ""}
        onSelectionChange={onChange}
        modifiers={[pickerStyle("menu"), labelsHidden(), tint(colors.TEXT)]}
      >
        <Text modifiers={[tag("")]}>{CHOOSE}</Text>
        {(field.options ?? []).map((option) => (
          <Text key={option} modifiers={[tag(option)]}>
            {option === field.recommended ? `${option} (${recommendedWord})` : option}
          </Text>
        ))}
      </Picker>
    </HStack>
  );
}

/**
 * A boolean: the system's switch with its label, as Settings' rows stand,
 * the system laying out the words and the switch at the row's end and
 * hearing them as one control.
 */
function BooleanRow({
  field,
  onChange,
}: {
  readonly field: AnswerField;
  readonly onChange: (value: boolean) => void;
}) {
  const colors = useColors();

  return (
    <Toggle
      isOn={field.value === true}
      onIsOnChange={onChange}
      modifiers={[toggleStyle("switch"), tint(colors.ACCENT), padding(ROW_PADDING)]}
    >
      <FieldWords
        label={field.label}
        required={field.required}
        textStyle={TYPE_ROLE.ROW_TITLE}
        ink={colors.TEXT}
      />
    </Toggle>
  );
}

/**
 * An answer ask's fields as a card of the system's form controls, a row
 * each: a text or number field under its label, a select's menu picker, a
 * boolean's toggle. Note that it is a card in the thread's scroll rather
 * than a SwiftUI `Form`, because a `Form` scrolls on its own and the thread
 * it stands in already does; its rows are the controls a `Form` holds.
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
  return (
    <Card inset={CARD_WORDS_INSET.BARE}>
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

        return <TypedFieldRow key={field.label} field={field} onChange={change} />;
      })}
    </Card>
  );
}
