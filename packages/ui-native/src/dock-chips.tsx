// dock-chips.tsx -- what stands over an agent's composer as one row of glass capsules, each a count and a noun, a press opening what it holds, with the one it opened standing under the row.

import { Button, HStack, Image, ScrollView, VStack } from "@expo/ui/swift-ui";
import {
  accessibilityHidden,
  accessibilityHint,
  accessibilityLabel,
  accessibilityValue,
  buttonStyle,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  padding,
  resizable,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import type { ReactNode } from "react";
import { useScaledSize } from "./accessibility.js";
import { type Glyph, glyphImage, type MarkLook } from "./glyph.js";
import { Text } from "./text.js";
import { type StatusTone, toneColor, useColors } from "./tokens/colors.js";
import { MARK_SIZE, SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** What a capsule whose subject is at work now is heard to stand as. */
const IN_USE_HEARD = "In use";

/** What a capsule that opens in place is heard to stand as, as VoiceOver says a disclosure's state. */
const OPEN_HEARD = { OPEN: "Expanded", FOLDED: "Collapsed" } as const;

/** How a file's address begins, the one address SwiftUI draws a picture from. */
const FILE_ADDRESS = "file://";

/** How far the row stands from what it opened, and its capsules from one another. */
const ROW_GAP = SPACE.TIGHT * 2;

/** How far the row's capsules stand clear of the scroll's edge above and below, so the glass's shadow is never cut. */
const SHADOW_ROOM = 2;

/** One capsule of the row: what it holds, as a glyph and a few words, and what a press on it does. */
export type DockChip = {
  /** Which capsule it is, unique in its row. */
  readonly id: string;
  readonly glyph: Glyph;
  /** The tone its glyph stands in, for a glyph that is a status mark, such as a pull request's state; the muted ink otherwise. */
  readonly tone?: StatusTone | undefined;
  /** A picture in the glyph's place, as a file's address, such as an app's icon; its glyph stands in until it is read, and where it is no file. */
  readonly icon?: string | undefined;
  /** What it holds in a few words: "Approval", "Inbox", "#128", "2 queued". */
  readonly words: string;
  /** Whether what it names is at work now, such as the app an agent is in, its words then in copper; none at rest. */
  readonly active?: boolean | undefined;
  /** A status mark after its words, such as how a pull request's checks went; none where it has none. */
  readonly after?: MarkLook | undefined;
  /** What VoiceOver hears it as, where its marks say more than its words; its words otherwise. */
  readonly heard?: string | undefined;
  /** How many of what it holds wait on the reader, counted in copper at its end; none at rest. */
  readonly waiting?: number | undefined;
  /** What a press does, as VoiceOver hears it: "Opens the thread in the Inbox". */
  readonly hint: string;
  /** Whether what it holds stands open under the row, for a capsule that opens in place; none for one that goes elsewhere. */
  readonly open?: boolean | undefined;
  readonly onPress: () => void;
};

/** One capsule: the system's glass button, its glyph or its picture and words in the ink, its words in copper while what it names is at work, a status mark in its tone, its count in copper; one standing open is lifted on the well, as a picked capsule stands. */
function Capsule({ chip }: { readonly chip: DockChip }) {
  const colors = useColors();
  const glyph = useScaledSize(MARK_SIZE.GLYPH);
  const waiting = chip.waiting ?? 0;
  const opens = chip.open !== undefined;
  const heard = chip.heard ?? chip.words;

  return (
    <Button
      onPress={chip.onPress}
      modifiers={[
        buttonStyle(chip.open === true ? "glassProminent" : "glass"),
        tint(chip.open === true ? colors.WELL : colors.TEXT),
        accessibilityLabel(waiting > 0 ? `${heard}, ${waiting} waiting` : heard),
        ...(chip.active === true ? [accessibilityValue(IN_USE_HEARD)] : []),
        ...(opens
          ? [accessibilityValue(chip.open === true ? OPEN_HEARD.OPEN : OPEN_HEARD.FOLDED)]
          : []),
        accessibilityHint(chip.hint),
      ]}
    >
      <HStack spacing={ROW_GAP}>
        {/* Note that SwiftUI reads a picture from a file alone, so one held as any other address stands as the glyph. */}
        {chip.icon?.startsWith(FILE_ADDRESS) === true ? (
          <Image
            uiImage={chip.icon}
            modifiers={[resizable(), frame({ width: glyph, height: glyph }), accessibilityHidden()]}
          />
        ) : (
          <Image
            {...glyphImage(chip.glyph)}
            size={glyph}
            color={chip.tone === undefined ? colors.TEXT_MUTED : toneColor(colors, chip.tone)}
          />
        )}
        <Text
          modifiers={[
            font({
              textStyle: TYPE_ROLE.ROW_LINE,
              weight: chip.active === true ? "semibold" : "medium",
            }),
            foregroundStyle(chip.active === true ? colors.ACCENT : colors.TEXT_BODY),
            lineLimit(1),
          ]}
        >
          {chip.words}
        </Text>
        {chip.after === undefined ? null : (
          <Image
            {...glyphImage(chip.after.symbol)}
            size={glyph}
            color={toneColor(colors, chip.after.tone)}
          />
        )}
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
 * that waits on the reader and a status's tone only on its mark, such as a
 * pull request's state and its checks ("#128 · Queued" and a running
 * check), the row scrolling sideways where the capsules
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
