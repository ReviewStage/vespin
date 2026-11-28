// pull-request-card.tsx -- a pull request as a transcript or a thread draws it: a compact bordered card of its state's glyph, its title, and its line counts, which opens its page, with its acts as regular bordered buttons under it.

import { Button, HStack, Spacer, VStack } from "@expo/ui/swift-ui";
import * as SwiftModifiers from "@expo/ui/swift-ui/modifiers";
import {
  accessibilityIdentifier,
  background,
  buttonStyle,
  foregroundStyle,
  lineLimit,
  padding,
  strokeBorder,
} from "@expo/ui/swift-ui/modifiers";
import type { PullRequestMarkState } from "@repo/features/pull-request-model";
import { Button as Act, BUTTON_LOOK, BUTTON_SIZE } from "./button.js";
import { font } from "./font.js";
import { PULL_REQUEST_LOOK } from "./inbox-line-model.js";
import { LineCounts } from "./line-counts.js";
import { type LongPressGroup, LongPressMenu } from "./list-row.js";
import { ToneGlyph } from "./marks.js";
import { Text } from "./text.js";
import { useColors } from "./tokens/colors.js";
import { RADIUS, SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** How thick the card's edge is drawn. */
const HAIRLINE = 0.5;

/** What a flow finds a pull request's card by, wherever it stands, such as an agent's transcript or the task list. */
const PULL_REQUEST_CARD_ID = "pull-request-card";

/** One act a pull request offers under its card, such as Review or Merge. */
export type PullRequestAct = {
  readonly label: string;
  readonly onPress: () => void;
};

type PullRequestCardProps = {
  /** Where its mark says it stands (`pullRequestMarkState`): queued where it is open and the merge queue holds it. */
  readonly state: PullRequestMarkState;
  /** Its title, led by its number where one is given: "#7911 Draw the Inbox". */
  readonly title: string;
  readonly number?: number | undefined;
  /** The lines it adds and removes, in the complete green and the danger red. */
  readonly additions?: number | undefined;
  readonly deletions?: number | undefined;
  /** Its acts, drawn as regular bordered buttons under the card. */
  readonly acts?: readonly PullRequestAct[] | undefined;
  /** Opens its own page, as a press on the card asks; none where it has no page to open. */
  readonly onOpen?: (() => void) | undefined;
  /** What its long press holds, as the panel's pull request row's right-click offers it: Copy GitHub link, then where a press does not open it; nothing where none is given. */
  readonly menu?: readonly LongPressGroup[] | undefined;
};

/**
 * A pull request on a page: its state's glyph in GitHub's color, the one
 * status tone the card carries, its number and title in the row title's style, and its added
 * and removed lines in green and red, on the surface inside a hairline; its
 * acts stand under it as the system's regular bordered buttons in the ink.
 * Note that they are regular rather than small capsules, because an act
 * under a card is a press the reader came for, as Mail's Reply under a
 * message is, and a small capsule's 28 pt fell short of Apple's 44 pt
 * target.
 */
export function PullRequestCard({
  state,
  title,
  number,
  additions,
  deletions,
  acts = [],
  onOpen,
  menu = [],
}: PullRequestCardProps) {
  const colors = useColors();
  const look = PULL_REQUEST_LOOK[state];

  const card = (
    <HStack
      spacing={SPACE.ROW}
      modifiers={[
        accessibilityIdentifier(PULL_REQUEST_CARD_ID),
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
      {additions === undefined || deletions === undefined ? null : (
        <LineCounts additions={additions} deletions={deletions} />
      )}
    </HStack>
  );

  return (
    <VStack alignment="leading" spacing={SPACE.TIGHT * 2}>
      <LongPressMenu groups={menu}>
        {onOpen === undefined ? (
          card
        ) : (
          <Button onPress={onOpen} modifiers={[buttonStyle("plain")]}>
            {card}
          </Button>
        )}
      </LongPressMenu>
      {acts.length === 0 ? null : (
        <HStack spacing={SPACE.TIGHT + 2}>
          {acts.map((act) => (
            <Act
              key={act.label}
              label={act.label}
              look={BUTTON_LOOK.BORDERED}
              size={BUTTON_SIZE.REGULAR}
              onPress={act.onPress}
            />
          ))}
        </HStack>
      )}
    </VStack>
  );
}
