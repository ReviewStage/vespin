// choice-list.tsx -- a decide ask's options as a compact bordered card: one radio row each, the recommended one tagged, a detail line under its label, and the media it carries under it.

import {
  Button,
  Divider,
  HStack,
  Image,
  RNHostView,
  Spacer,
  Text,
  VStack,
} from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  background,
  buttonStyle,
  contentShape,
  font,
  foregroundStyle,
  frame,
  padding,
  shapes,
  strokeBorder,
} from "@expo/ui/swift-ui/modifiers";
import { RECOMMENDED } from "@repo/features/inbox-list-model";
import { Fragment } from "react";
import {
  CHOICE_MEDIA,
  type ChoiceMedia,
  type ChoiceMediaKind,
  ChoiceMediaStrip,
  inStrip,
} from "./choice-media.js";
import type { SfSymbol } from "./sf-symbol.js";
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
  /** Whether a person may pick several, which draws squares rather than circles. */
  readonly multiple?: boolean | undefined;
  /** Called with the labels picked once a row is pressed. */
  readonly onChange: (picked: readonly string[]) => void;
  /** Words over the card, small and muted. */
  readonly title?: string | undefined;
  /** None of these, offered as a row after the options where their media asks a pick of them; none where it is not offered. */
  readonly none?: NoneChoice | undefined;
};

/** The word a page's or an address's row leads with, and its SF Symbol. */
const LINE_LOOK: Partial<
  Record<ChoiceMediaKind, { readonly word: string; readonly symbol: SfSymbol }>
> = {
  [CHOICE_MEDIA.PAGE]: { word: "Page", symbol: "doc.richtext" },
  [CHOICE_MEDIA.LINK]: { word: "Link", symbol: "safari" },
};

/** How thick the card's and the tag's edges are drawn. */
const HAIRLINE = 0.5;

/** The share of the accent's ink the Recommended tag's edge stands at. */
const TAG_EDGE_OPACITY = "73";

/** The mark leading an option, 18 pt: a ring or a square, the ring filled with the accent at its heart once picked. */
function pickMark(picked: boolean, multiple: boolean) {
  if (multiple) return picked ? "checkmark.square.fill" : "square";
  return picked ? "smallcircle.filled.circle.fill" : "circle";
}

/** The small bordered tag after the recommended option's label, in the accent's words, since a recommendation is for you. */
function RecommendedTag() {
  const colors = useColors();
  return (
    <Text
      modifiers={[
        font({ textStyle: TYPE_ROLE.TIME, weight: "semibold" }),
        foregroundStyle(colors.ACCENT_TEXT),
        padding({ horizontal: 5, vertical: 1 }),
        strokeBorder({
          content: `${colors.ACCENT}${TAG_EDGE_OPACITY}`,
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
          contentShape(shapes.rectangle()),
        ]}
      >
        <Image
          systemName={pickMark(picked, multiple)}
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

/** A page or an address an option carries, as a row under it: its glyph, and its kind and title in 13 pt muted, opening it on a press. */
function MediaLine({ media }: { readonly media: ChoiceMedia }) {
  const colors = useColors();
  const look = LINE_LOOK[media.kind];
  if (look === undefined) return null;
  const words = `${look.word} · ${media.title}`;
  return (
    <Button
      onPress={() => media.onOpen?.()}
      modifiers={[buttonStyle("plain"), accessibilityLabel(words)]}
    >
      <HStack
        spacing={SPACE.ROW}
        modifiers={[
          padding({ horizontal: SPACE.EDGE - 2, vertical: SPACE.TIGHT }),
          contentShape(shapes.rectangle()),
        ]}
      >
        <Image systemName={look.symbol} size={MARK_SIZE.GLYPH} color={colors.TEXT_MUTED} />
        <Text
          modifiers={[font({ textStyle: TYPE_ROLE.ROW_LINE }), foregroundStyle(colors.TEXT_MUTED)]}
        >
          {words}
        </Text>
        <Spacer />
      </HStack>
    </Button>
  );
}

/** What an option carries, under its row: its pictures and recordings in one strip, then a row each for its pages and addresses. */
function ChoiceMediaBlock({ media }: { readonly media: readonly ChoiceMedia[] }) {
  const strip = media.filter(inStrip);
  const lines = media.filter((piece) => !inStrip(piece));
  return (
    <VStack alignment="leading" spacing={0}>
      {strip.length === 0 ? null : (
        <RNHostView matchContents={{ vertical: true }}>
          <ChoiceMediaStrip media={strip} />
        </RNHostView>
      )}
      {lines.map((piece) => (
        <MediaLine key={piece.key} media={piece} />
      ))}
    </VStack>
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
          background(colors.SURFACE, shapes.roundedRectangle({ cornerRadius: RADIUS.CARD })),
          strokeBorder({
            content: colors.CHIP_EDGE,
            shape: "roundedRectangle",
            cornerRadius: RADIUS.CARD,
            style: { lineWidth: HAIRLINE },
          }),
        ]}
      >
        {choices.map((choice, index) => (
          <Fragment key={choice.label}>
            {index === 0 ? null : <Divider />}
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
            <Divider />
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
