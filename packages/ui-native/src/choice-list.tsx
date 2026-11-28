// choice-list.tsx -- a decide ask's options as a compact bordered card: one row each, its words drawn as Markdown so a link of ours stands as its chip, checked at its end in copper once picked, as iOS's Settings checks a choice, the recommended one tagged, a detail line under its label, and the media it carries under it.

import { Button, HStack, RNHostView, VStack } from "@expo/ui/swift-ui";
import * as SwiftModifiers from "@expo/ui/swift-ui/modifiers";
import {
  accessibilityAddTraits,
  accessibilityLabel,
  background,
  buttonStyle,
  foregroundStyle,
  frame,
  padding,
  strokeBorder,
} from "@expo/ui/swift-ui/modifiers";
import { RECOMMENDED } from "@repo/features/inbox-list-model";
import { linkLabels } from "@repo/features/mention-link";
import { Fragment } from "react";
import { Pressable } from "react-native";
import { useAccessibilitySize, useScaledSize } from "./accessibility.js";
import { CARD_WORDS_INSET, CardDivider, RecommendedTag } from "./ask-card.js";
import { type ChoiceMedia, ChoiceMediaTiles } from "./choice-media.js";
import { font } from "./font.js";
import { MARKDOWN_LOOK, Markdown } from "./markdown.js";
import { PickedCheck } from "./settings-form.js";
import { useSteppedBack } from "./stepped-back.js";
import { Text } from "./text.js";
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
  /** Picks it; none for an ask no longer waiting, whose row stands as it was answered. */
  readonly onPress?: (() => void) | undefined;
};

type ChoiceListProps = {
  readonly choices: readonly Choice[];
  /** The labels of the options the agent recommends. */
  readonly recommended?: readonly string[] | undefined;
  /** The labels picked so far. */
  readonly picked: readonly string[];
  /** Whether a person may pick several, each pick checked at its row's end; the caller says so in `title`, since the rows read the same either way. */
  readonly multiple?: boolean | undefined;
  /** Called with the labels picked once a row is pressed; none for an ask no longer waiting, whose rows stand as it was answered and take no press. */
  readonly onChange?: ((picked: readonly string[]) => void) | undefined;
  /** Words over the card, small and muted. */
  readonly title?: string | undefined;
  /** None of these, offered as a row after the options where their media asks a pick of them; none where it is not offered. */
  readonly none?: NoneChoice | undefined;
  /** The thread's repository, `owner/name`, whose GitHub pages are its files' chips. */
  readonly repository: string | null | undefined;
  /** Opens a link or a chip pressed in an option's words, by the address it was written as, where the app draws it or in Safari. */
  readonly onOpenLink: (address: string) => void;
};

/** How thick the card's edge is drawn. */
const HAIRLINE = 0.5;

/** What pressing `label` leaves picked: it alone for one choice, or it toggled among several. */
function nextPicked(
  picked: readonly string[],
  label: string,
  multiple: boolean,
): readonly string[] {
  if (!multiple) return [label];

  return picked.includes(label) ? picked.filter((each) => each !== label) : [...picked, label];
}

/** What a row is heard as: its label, the recommended tag, and its detail, each link said by its label rather than its address, as a step is heard. */
function heardAs(choice: Choice, recommended: boolean): string {
  const detail = choice.detail === undefined ? undefined : linkLabels(choice.detail);

  return [linkLabels(choice.label), recommended ? RECOMMENDED : undefined, detail]
    .filter((part) => part !== undefined)
    .join(", ");
}

/**
 * One option's row: its label as the thread's Markdown draws it, over its
 * detail in the row line's muted look, so a link of ours in either stands
 * as its chip (`@repo/features/mention-link`'s `linkChipOf`), as the panel's
 * option draws it; then the tag and the copper check at its end once
 * picked, the tag standing under the words instead at an accessibility
 * size, so they keep their lines. A press on the words or on the row's end
 * picks the option, but a chip's press opens its link and picks nothing, as
 * a step's chip ticks nothing (`StepRow`). Note that the words stand in a
 * React Native host beside the row's end, never inside a SwiftUI button,
 * which would take the chip's press for its own; and that the end is the
 * row's one element VoiceOver picks, heard by its words, while the words'
 * lines offer each chip they hold as their own actions.
 */
function ChoiceRow({
  choice,
  picked,
  recommended,
  onPress,
  repository,
  onOpenLink,
}: {
  readonly choice: Choice;
  readonly picked: boolean;
  readonly recommended: boolean;
  /** Picks the option; none for an ask no longer waiting, whose row stands as it was answered. */
  readonly onPress: (() => void) | undefined;
  readonly repository: string | null | undefined;
  readonly onOpenLink: (address: string) => void;
}) {
  const stacked = useAccessibilitySize();
  const stepped = useSteppedBack();
  const markSize = useScaledSize(MARK_SIZE.GLYPH);
  const tag = recommended ? <RecommendedTag /> : null;

  const heard = [
    accessibilityLabel(heardAs(choice, recommended)),
    ...(picked ? [accessibilityAddTraits(["isSelected"])] : []),
  ];

  const end = (
    <>
      {stacked ? null : tag}
      {picked ? <PickedCheck /> : null}
    </>
  );

  return (
    <HStack
      spacing={SPACE.ROW}
      modifiers={[
        padding({ horizontal: SPACE.EDGE - 2, vertical: SPACE.ROW + 1 }),
        frame({ maxWidth: Number.POSITIVE_INFINITY, alignment: "leading" }),
      ]}
    >
      <VStack alignment="leading" spacing={SPACE.TIGHT}>
        <RNHostView matchContents={{ vertical: true }}>
          <Pressable accessible={false} onPress={onPress} style={{ gap: 2 }}>
            <Markdown
              words={choice.label}
              look={stepped ? MARKDOWN_LOOK.STEPPED_BACK : MARKDOWN_LOOK.MESSAGE}
              repository={repository}
              onOpenLink={onOpenLink}
            />
            {choice.detail === undefined ? null : (
              <Markdown
                words={choice.detail}
                look={MARKDOWN_LOOK.LINE}
                repository={repository}
                onOpenLink={onOpenLink}
              />
            )}
          </Pressable>
        </RNHostView>
        {stacked ? tag : null}
      </VStack>
      {onPress === undefined ? (
        // Note that a row taking no press keeps its end as the element VoiceOver hears, the button's look and press left out.
        <HStack
          spacing={SPACE.ROW}
          modifiers={[frame({ minWidth: markSize, minHeight: markSize }), ...heard]}
        >
          {end}
        </HStack>
      ) : (
        <Button onPress={onPress} modifiers={[buttonStyle("plain"), ...heard]}>
          {/* Note that the end keeps the check's room while nothing is picked, so it is still a press and an element VoiceOver finds. */}
          <HStack
            spacing={SPACE.ROW}
            modifiers={[
              frame({ minWidth: markSize, minHeight: markSize }),
              SwiftModifiers.contentShape(SwiftModifiers.shapes.rectangle()),
            ]}
          >
            {end}
          </HStack>
        </Button>
      )}
    </HStack>
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
 * a row each, pressed to pick it, the recommended one tagged, with a hairline
 * between the rows. Each pick is checked at its row's end in copper, as
 * `PickRows` and iOS's own Settings check a choice, with no mark leading an
 * unpicked row, whether one or several may be picked. With no `onChange`,
 * the card stands as an answered ask left it, as the panel's held controls
 * do: its picks checked at full strength, and no row taking a press.
 */
export function ChoiceList(props: ChoiceListProps) {
  const {
    choices,
    recommended = [],
    picked,
    multiple = false,
    onChange,
    title,
    none,
    repository,
    onOpenLink,
  } = props;

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
        {choices.map((choice, index) => (
          <Fragment key={choice.label}>
            {index === 0 ? null : <CardDivider inset={CARD_WORDS_INSET.BARE} />}
            <ChoiceRow
              choice={choice}
              picked={picked.includes(choice.label)}
              recommended={recommended.includes(choice.label)}
              onPress={
                onChange === undefined
                  ? undefined
                  : () => onChange(nextPicked(picked, choice.label, multiple))
              }
              repository={repository}
              onOpenLink={onOpenLink}
            />
            {choice.media === undefined || choice.media.length === 0 ? null : (
              <ChoiceMediaBlock media={choice.media} />
            )}
          </Fragment>
        ))}
        {none === undefined ? null : (
          <>
            <CardDivider inset={CARD_WORDS_INSET.BARE} />
            <ChoiceRow
              choice={{ label: none.label }}
              picked={none.picked}
              recommended={false}
              onPress={none.onPress}
              repository={repository}
              onOpenLink={onOpenLink}
            />
          </>
        )}
      </VStack>
    </VStack>
  );
}
