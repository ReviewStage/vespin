// choice-list.tsx -- a decide ask's options as a compact bordered card: one radio row each, the recommended one tagged, a detail line under its label, and the media it carries under it.

import { Button, HStack, Image, RNHostView, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import * as SwiftModifiers from "@expo/ui/swift-ui/modifiers";
import {
  accessibilityLabel,
  background,
  buttonStyle,
  font,
  foregroundStyle,
  frame,
  padding,
  strokeBorder,
} from "@expo/ui/swift-ui/modifiers";
import { RECOMMENDED } from "@repo/features/inbox-list-model";
import { Fragment } from "react";
import { CARD_WORDS_INSET, CardDivider } from "./ask-card.js";
import { type ChoiceMedia, ChoiceMediaTiles } from "./choice-media.js";
import { GLYPH, type Glyph, glyphImage } from "./glyph.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, RADIUS, SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

export type Choice = {
  /** The option's short label, which also names it. */
  readonly label: string;
  /** A line saying what picking it means. */
  readonly detail?: string | undefined;
  /** The pictures, recordings, pages, and addresses it carries, drawn under its row. */
  readonly media?: readonly ChoiceMedia[] | undefined;
};

/** A pick of none of the options, a row after them: its words, whether it stands picked, and what a press on it does. */
export type NoneChoice = {
  readonly label: string;
  readonly picked: boolean;
  readonly onPress: () => void;
};

type ChoiceListProps = {
  readonly choices: readonly Choice[];
  /** The labels of the options the agent recommends. */
  readonly recommended?: readonly string[] | undefined;
  /** The labels picked so far. */
  readonly picked: readonly string[];
  /** Whether a person may pick several, which draws Reminders' round checks once picked; the caller says so in `title`, since an unpicked row reads as a circle either way. */
  readonly multiple?: boolean | undefined;
  /** Called with the labels picked once a row is pressed. */
  readonly onChange: (picked: readonly string[]) => void;
  /** Words over the card, small and muted. */
  readonly title?: string | undefined;
  /** None of these, offered as a row after the options where their media asks a pick of them; none where it is not offered. */
  readonly none?: NoneChoice | undefined;
};

/** How thick the card's and the tag's edges are drawn. */
const HAIRLINE = 0.5;

/** The mark leading an option, 18 pt: a ring filled with the accent at its heart once picked, or, where several may be picked, Reminders' round check, since iOS has no square checkbox. */
function pickMark(picked: boolean, multiple: boolean): Glyph {
  if (multiple) return picked ? GLYPH.ROUND_BOX_TICKED : GLYPH.ROUND_BOX;

  return picked ? GLYPH.RADIO_PICKED : GLYPH.ROUND_BOX;
}

/** The small bordered tag after the recommended option's label, muted, as the panel's stands, so copper is left for the option picked. */
function RecommendedTag() {
  const colors = useColors();

  return (
    <Text
      modifiers={[
        font({ textStyle: TYPE_ROLE.TIME, weight: "semibold" }),
        foregroundStyle(colors.TEXT_MUTED),
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

/** What pressing `label` leaves picked: it alone for one choice, or it toggled among several. */
function nextPicked(
  picked: readonly string[],
  label: string,
  multiple: boolean,
): readonly string[] {
  if (!multiple) return [label];

  return picked.includes(label) ? picked.filter((each) => each !== label) : [...picked, label];
}

/** One option's row: its mark, its label in 15 pt with the tag, and its detail in 13 pt muted. */
function ChoiceRow({
  choice,
  picked,
  recommended,
  multiple,
  onPress,
}: {
  readonly choice: Choice;
  readonly picked: boolean;
  readonly recommended: boolean;
  readonly multiple: boolean;
  readonly onPress: () => void;
}) {
  const colors = useColors();

  return (
    <Button
      onPress={onPress}
      modifiers={[
        buttonStyle("plain"),
        accessibilityLabel(
          [
            choice.label,
            recommended ? RECOMMENDED : undefined,
            picked ? "picked" : undefined,
            choice.detail,
          ]
            .filter((part) => part !== undefined)
            .join(", "),
        ),
      ]}
    >
      <HStack
        spacing={SPACE.ROW}
        alignment="top"
        modifiers={[
          padding({ horizontal: SPACE.EDGE - 2, vertical: SPACE.ROW + 1 }),
          SwiftModifiers.contentShape(SwiftModifiers.shapes.rectangle()),
        ]}
      >
        <Image
          {...glyphImage(pickMark(picked, multiple))}
          size={MARK_SIZE.LEAD}
          color={picked ? colors.ACCENT : colors.TEXT_MUTED}
        />
        <VStack alignment="leading" spacing={2}>
          <HStack spacing={SPACE.TIGHT + 2}>
            <Text
              modifiers={[font({ textStyle: TYPE_ROLE.ROW_TITLE }), foregroundStyle(colors.TEXT)]}
            >
              {choice.label}
            </Text>
            {recommended ? <RecommendedTag /> : null}
          </HStack>
          {choice.detail === undefined ? null : (
            <Text
              modifiers={[
                font({ textStyle: TYPE_ROLE.ROW_LINE }),
                foregroundStyle(colors.TEXT_MUTED),
              ]}
            >
              {choice.detail}
            </Text>
          )}
        </VStack>
        <Spacer />
      </HStack>
    </Button>
  );
}

/** What an option carries, under its row: every piece as an equal tile, in React Native views SwiftUI hosts. */
function ChoiceMediaBlock({ media }: { readonly media: readonly ChoiceMedia[] }) {
  return (
    <RNHostView matchContents={{ vertical: true }}>
      <ChoiceMediaTiles media={media} />
    </RNHostView>
  );
}

/**
 * A decide ask's options as a compact card on the surface inside a hairline:
 * a radio row each, pressed to pick it, the recommended one tagged, with a
 * hairline between the rows. The picked mark is drawn in the accent, since
 * an ask is for you.
 */
export function ChoiceList(props: ChoiceListProps) {
  const { choices, recommended = [], picked, multiple = false, onChange, title, none } = props;
  const colors = useColors();

  return (
    <VStack alignment="leading" spacing={SPACE.TIGHT * 2}>
      {title === undefined ? null : (
        <Text
          modifiers={[
            font({ textStyle: TYPE_ROLE.GROUP_HEADER, weight: "medium" }),
            foregroundStyle(colors.TEXT_MUTED),
          ]}
        >
          {title}
        </Text>
      )}
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
        {choices.map((choice, index) => (
          <Fragment key={choice.label}>
            {index === 0 ? null : <CardDivider inset={CARD_WORDS_INSET.MARKED} />}
            <ChoiceRow
              choice={choice}
              picked={picked.includes(choice.label)}
              recommended={recommended.includes(choice.label)}
              multiple={multiple}
              onPress={() => onChange(nextPicked(picked, choice.label, multiple))}
            />
            {choice.media === undefined || choice.media.length === 0 ? null : (
              <ChoiceMediaBlock media={choice.media} />
            )}
          </Fragment>
        ))}
        {none === undefined ? null : (
          <>
            <CardDivider inset={CARD_WORDS_INSET.MARKED} />
            <ChoiceRow
              choice={{ label: none.label }}
              picked={none.picked}
              recommended={false}
              multiple={multiple}
              onPress={none.onPress}
            />
          </>
        )}
      </VStack>
    </VStack>
  );
}
