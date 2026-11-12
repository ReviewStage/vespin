// pull-request-card.tsx -- a pull request as a transcript or a thread draws it: a compact bordered card of its state's glyph, its title, and its line counts, which opens its page, with its acts as small pills under it.

import { Button, HStack, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import * as SwiftModifiers from "@expo/ui/swift-ui/modifiers";
import {
  background,
  buttonStyle,
  font,
  foregroundStyle,
  lineLimit,
  monospacedDigit,
  padding,
  strokeBorder,
} from "@expo/ui/swift-ui/modifiers";
import type { PullRequestState } from "@repo/features/agent-wire";
import { Chip } from "./button.js";
import { PULL_REQUEST_LOOK } from "./inbox-line-model.js";
import { ToneGlyph } from "./marks.js";
import { useColors } from "./tokens/colors.js";
import { RADIUS, SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** How thick the card's edge is drawn. */
const HAIRLINE = 0.5;

/** One act a pull request offers under its card, such as Review or Merge. */
export type PullRequestAct = {
  readonly label: string;
  readonly onPress: () => void;
};

type PullRequestCardProps = {
  readonly state: PullRequestState;
  /** Its title, led by its number where one is given: "#7911 Draw the Inbox". */
  readonly title: string;
  readonly number?: number | undefined;
  /** The lines it adds and removes, in the complete green and the danger red. */
  readonly additions?: number | undefined;
  readonly deletions?: number | undefined;
  /** Its acts, drawn as small pills under the card. */
  readonly acts?: readonly PullRequestAct[] | undefined;
  /** Opens its own page, as a press on the card asks; none where it has no page to open. */
  readonly onOpen?: (() => void) | undefined;
};

/** A line count as the card ends with it: "+1.9k", "−312". */
function lineCount(sign: string, count: number): string {
  const short = count >= 1000 ? `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(count);

  return `${sign}${short}`;
}

/**
 * A pull request on a page: its state's glyph in GitHub's color, the one
 * status tone the card carries, its number and title in 15 pt, and its added
 * and removed lines in green and red, on the surface inside a hairline; its
 * acts stand under it as small pills.
 */
export function PullRequestCard({
  state,
  title,
  number,
  additions,
  deletions,
  acts = [],
  onOpen,
}: PullRequestCardProps) {
  const colors = useColors();
  const look = PULL_REQUEST_LOOK[state];
  const count = [font({ textStyle: TYPE_ROLE.TIME }), monospacedDigit()];

  const card = (
    <HStack
      spacing={SPACE.ROW}
      modifiers={[
        padding({ horizontal: SPACE.EDGE - 4, vertical: SPACE.ROW }),
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
      <ToneGlyph glyph={look.symbol} tone={look.tone} textStyle={TYPE_ROLE.ROW_TITLE} />
      <Text
        modifiers={[
          font({ textStyle: TYPE_ROLE.ROW_TITLE, weight: "medium" }),
          foregroundStyle(colors.TEXT),
          lineLimit(1),
        ]}
      >
        {number === undefined ? title : `#${number} ${title}`}
      </Text>
      <Spacer />
      {additions === undefined ? null : (
        <Text modifiers={[...count, foregroundStyle(colors.COMPLETE)]}>
          {lineCount("+", additions)}
        </Text>
      )}
      {deletions === undefined ? null : (
        <Text modifiers={[...count, foregroundStyle(colors.DANGER_TEXT)]}>
          {lineCount("−", deletions)}
        </Text>
      )}
    </HStack>
  );

  return (
    <VStack alignment="leading" spacing={SPACE.TIGHT * 2}>
      {onOpen === undefined ? (
        card
      ) : (
        <Button onPress={onOpen} modifiers={[buttonStyle("plain")]}>
          {card}
        </Button>
      )}
      {acts.length === 0 ? null : (
        <HStack spacing={SPACE.TIGHT + 2}>
          {acts.map((act) => (
            <Chip key={act.label} label={act.label} onPress={act.onPress} />
          ))}
        </HStack>
      )}
    </VStack>
  );
}
