// reaction-chips.tsx -- the reactions a message was given, under its words: a capsule to each kind, its emoji and how many gave it, lit in copper where the reader gave it, a press giving the reader's own or taking it back.

import { StyleSheet, Text, View } from "react-native";
import { Press } from "./press.js";
import { useColors } from "./tokens/colors.js";
import { PRESS_SIZE, SPACE } from "./tokens/space.js";
import { ROLE_SIZE } from "./tokens/type.js";

/** A capsule's own height at the default text size, in points: a footnote line and its insets, its press reaching the least a target stands as past it. */
const CHIP_HEIGHT = 28;

/** How much of the accent a lit capsule's fill washes with, as two hex digits of alpha: a tenth, as `@repo/ui`'s `CHIP_LOOK.REACTION` washes it. */
const LIT_WASH = "1a";

/** The room a press reaches past a capsule above and below it, so a finger finds a target `PRESS_SIZE` tall. */
const PRESS_REACH = (PRESS_SIZE - CHIP_HEIGHT) / 2;

/** What the row is heard as, as the panel's reaction row is named. */
const REACTIONS_WORDS = "Reactions";

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: SPACE.TIGHT + 2,
    paddingTop: SPACE.TIGHT + 2,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.TIGHT,
    minHeight: CHIP_HEIGHT,
    paddingHorizontal: SPACE.ROW - 2,
    borderRadius: CHIP_HEIGHT / 2,
    borderWidth: StyleSheet.hairlineWidth,
  },
  emoji: { fontSize: ROLE_SIZE.ROW_LINE },
  count: { fontSize: ROLE_SIZE.TIME, fontVariant: ["tabular-nums"], fontWeight: "500" },
});

/** One reaction as its capsule draws it: what tells it apart, its emoji, how many gave it, what it is heard as, and whether the reader gave it. */
export interface ReactionChipLook {
  readonly key: string;
  readonly emoji: string;
  readonly count: number;
  readonly label: string;
  readonly reacted: boolean;
}

/**
 * A message's reactions as the panel's `ReactionRow` stands them under its
 * words, each capsule `@repo/ui`'s `ReactionChip` in its reaction look
 * (`CHIP_LOOK.REACTION`): one to each kind, in the order given, its emoji
 * then its count, on the chip's fill inside a hairline with its count
 * muted, or lit, its edge and count in the accent over a soft tint of it,
 * where the reader gave it. Each is one button, heard as who gave it
 * (`chatReactionWords`) and as selected where the reader did; a press hands
 * its key on, which gives the reader's own or takes it back. The capsules
 * wrap onto further lines rather than run past the column. Nothing where
 * none was given.
 */
export function ReactionChips({
  reactions,
  onPress,
}: {
  readonly reactions: readonly ReactionChipLook[];
  readonly onPress: (key: string) => void;
}) {
  const colors = useColors();

  if (reactions.length === 0) return null;

  return (
    <View style={styles.row} accessibilityLabel={REACTIONS_WORDS}>
      {reactions.map((reaction) => (
        <Press
          key={reaction.key}
          onPress={() => onPress(reaction.key)}
          hitSlop={{ top: PRESS_REACH, bottom: PRESS_REACH }}
          accessibilityRole="button"
          accessibilityLabel={reaction.label}
          accessibilityState={{ selected: reaction.reacted }}
          style={[
            styles.chip,
            reaction.reacted
              ? { backgroundColor: `${colors.ACCENT}${LIT_WASH}`, borderColor: colors.ACCENT }
              : { backgroundColor: colors.CHIP, borderColor: colors.CHIP_EDGE },
          ]}
        >
          <Text style={styles.emoji} accessible={false}>
            {reaction.emoji}
          </Text>
          <Text
            style={[
              styles.count,
              { color: reaction.reacted ? colors.ACCENT_TEXT : colors.TEXT_MUTED },
            ]}
            accessible={false}
          >
            {reaction.count}
          </Text>
        </Press>
      ))}
    </View>
  );
}
