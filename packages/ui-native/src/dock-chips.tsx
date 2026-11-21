// dock-chips.tsx -- what stands over an agent's composer as one row of glass capsules, each a count and a noun, a press opening what it holds, with the one it opened standing under the row.

import { Button, HStack, Image, ScrollView, Text, VStack } from "@expo/ui/swift-ui";
import {
  accessibilityHint,
  accessibilityLabel,
  accessibilityValue,
  buttonStyle,
  font,
  foregroundStyle,
  lineLimit,
  padding,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import type { ReactNode } from "react";
import { useScaledSize } from "./accessibility.js";
import { BAR_GLASS } from "./glass-bar.js";
import { type Glyph, glyphImage } from "./glyph.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** What a capsule that opens in place is heard to stand as, as VoiceOver says a disclosure's state. */
const OPEN_HEARD = { OPEN: "Expanded", FOLDED: "Collapsed" } as const;

/** How far the row stands from what it opened, and its capsules from one another. */
const ROW_GAP = SPACE.TIGHT * 2;

/** How far the row's capsules stand clear of the scroll's edge above and below, so the glass's shadow is never cut. */
const SHADOW_ROOM = 2;

/** One capsule of the row: what it holds, as a glyph and a few words, and what a press on it does. */
export type DockChip = {
  /** Which capsule it is, unique in its row. */
  readonly id: string;
  readonly glyph: Glyph;
  /** What it holds in a few words: "Approval", "Inbox", "#128", "2 queued". */
  readonly words: string;
  /** How many of what it holds wait on the reader, counted in copper at its end; none at rest. */
  readonly waiting?: number | undefined;
  /** What a press does, as VoiceOver hears it: "Opens the thread in the Inbox". */
  readonly hint: string;
  /** Whether what it holds stands open under the row, for a capsule that opens in place; none for one that goes elsewhere. */
  readonly open?: boolean | undefined;
  readonly onPress: () => void;
};

/** One capsule: the system's glass button, its glyph and words in the ink, its count in copper; one standing open is lifted on the well, as a picked capsule stands. */
function Capsule({ chip }: { readonly chip: DockChip }) {
  const colors = useColors();
  const glyph = useScaledSize(MARK_SIZE.GLYPH);
  const waiting = chip.waiting ?? 0;
  const opens = chip.open !== undefined;

  return (
    <Button
      onPress={chip.onPress}
      modifiers={[
        buttonStyle(chip.open === true ? "glassProminent" : "glass"),
        tint(chip.open === true ? colors.WELL : colors.TEXT),
        accessibilityLabel(waiting > 0 ? `${chip.words}, ${waiting} waiting` : chip.words),
        ...(opens
          ? [accessibilityValue(chip.open === true ? OPEN_HEARD.OPEN : OPEN_HEARD.FOLDED)]
          : []),
        accessibilityHint(chip.hint),
      ]}
    >
      <HStack spacing={ROW_GAP}>
        <Image {...glyphImage(chip.glyph)} size={glyph} color={colors.TEXT_MUTED} />
        <Text
          modifiers={[
            font({ textStyle: TYPE_ROLE.ROW_LINE, weight: "medium" }),
            foregroundStyle(colors.TEXT_BODY),
            lineLimit(1),
          ]}
        >
          {chip.words}
        </Text>
        {waiting > 0 ? (
          <Text
            modifiers={[
              font({ textStyle: TYPE_ROLE.ROW_LINE, weight: "semibold" }),
              foregroundStyle(colors.ACCENT),
            ]}
          >
            {String(waiting)}
          </Text>
        ) : null}
      </HStack>
    </Button>
  );
}

/**
 * What stands over an agent's composer, as one row: a capsule of the
 * system's glass for each thing that waits there, each a count and a noun
 * ("Approval 1", "Inbox 7", "#128", "2 queued"), copper only on a count
 * that waits on the reader, the row scrolling sideways where the capsules
 * outrun the column, as Messages' and ChatGPT's capsules stand over their
 * fields. A press on one opens what it holds: elsewhere, such as a thread or
 * a pull request's page, or in place, its content (`opened`) standing under
 * the row, one at a time. The row stands one line tall however much waits,
 * so the transcript keeps the screen; nothing stands while nothing waits.
 */
export function DockChips({
  chips,
  opened,
}: {
  readonly chips: readonly DockChip[];
  /** What the capsule standing open holds, under the row; none while none is open. */
  readonly opened?: ReactNode;
}) {
  if (chips.length === 0 && opened === undefined) return null;

  return (
    <VStack spacing={ROW_GAP}>
      {chips.length === 0 ? null : (
        <ScrollView axes="horizontal" showsIndicators={false}>
          <HStack spacing={ROW_GAP} modifiers={[padding({ vertical: SHADOW_ROOM })]}>
            {chips.map((chip) => (
              <Capsule key={chip.id} chip={chip} />
            ))}
          </HStack>
        </ScrollView>
      )}
      {opened}
    </VStack>
  );
}

/** What a capsule opened in place stands in when it brings no glass of its own, such as a held call's banner: the bar's glass, its content inset from its edge. */
export function DockPanel({ children }: { readonly children: ReactNode }) {
  return (
    <VStack modifiers={[padding({ horizontal: SPACE.ROW, vertical: SPACE.ROW }), ...BAR_GLASS]}>
      {children}
    </VStack>
  );
}
