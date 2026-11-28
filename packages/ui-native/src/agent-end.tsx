// agent-end.tsx -- where an agent's page offers it a way on once it takes no message: the bar that stands in the composer's place while it is archived, with Unarchive, and the line over the composer where only a new agent goes on, with Continue in new agent.

import { HStack, VStack } from "@expo/ui/swift-ui";
import { foregroundStyle, frame } from "@expo/ui/swift-ui/modifiers";
import { useAccessibilitySize } from "./accessibility.js";
import { AskNote } from "./ask-card.js";
import { BUTTON_LOOK, Button } from "./button.js";
import { font } from "./font.js";
import { GlassBar } from "./glass-bar.js";
import { GLYPH, type Glyph } from "./glyph.js";
import { Text } from "./text.js";
import { useColors } from "./tokens/colors.js";
import { SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** What the archived bar says, in the panel's words (`archived-note.tsx`). */
const ARCHIVED_WORDS = {
  SAYS: "This agent is archived",
  UNARCHIVE: "Unarchive",
  UNARCHIVING: "Unarchiving",
} as const;

/** A press standing beside words: what it says, what it says while its act is out, and its act. */
type EndPress = {
  readonly label: string;
  readonly symbol?: Glyph | undefined;
  readonly busy: boolean;
  readonly busyLabel: string;
  readonly onPress: () => void;
};

/**
 * Muted words with one bordered press at their end, stacked under them at
 * an accessibility size, as an alert's buttons stack. Note that the press is
 * keyed by its words, so a busy press is drawn anew rather than left saying
 * what it first said.
 */
function WordsWithPress({ words, press }: { readonly words: string; readonly press: EndPress }) {
  const colors = useColors();
  const large = useAccessibilitySize();
  const label = press.busy ? press.busyLabel : press.label;

  const said = (
    <Text
      modifiers={[
        font({ textStyle: TYPE_ROLE.ROW_LINE }),
        foregroundStyle(colors.TEXT_MUTED),
        frame({ maxWidth: Number.POSITIVE_INFINITY, alignment: "leading" }),
      ]}
    >
      {words}
    </Text>
  );

  const button = (
    <Button
      key={label}
      label={label}
      symbol={press.symbol}
      look={BUTTON_LOOK.BORDERED}
      disabled={press.busy}
      onPress={press.onPress}
    />
  );

  return large ? (
    <VStack alignment="leading" spacing={SPACE.TIGHT * 2}>
      {said}
      {button}
    </VStack>
  ) : (
    <HStack spacing={SPACE.ROW}>
      {said}
      {button}
    </HStack>
  );
}

/**
 * What stands in an agent's composer's place while the agent is archived,
 * in the same glass at the page's foot, as the panel's note stands in its
 * box's place: that it is archived, and Unarchive, busy while it is out,
 * with why the last act did not go over it. An archived agent reads but
 * takes no message until it is brought back, so no field stands as a dead
 * control.
 */
export function ArchivedBar({
  unarchiving,
  note,
  onUnarchive,
}: {
  /** Whether the Unarchive is out, which holds its press busy. */
  readonly unarchiving: boolean;
  /** Why the last act did not go; none while none failed. */
  readonly note: string | undefined;
  readonly onUnarchive: () => void;
}) {
  return (
    <GlassBar head={note === undefined ? undefined : <AskNote words={note} />}>
      <WordsWithPress
        words={ARCHIVED_WORDS.SAYS}
        press={{
          label: ARCHIVED_WORDS.UNARCHIVE,
          symbol: GLYPH.UNARCHIVE,
          busy: unarchiving,
          busyLabel: ARCHIVED_WORDS.UNARCHIVING,
          onPress: onUnarchive,
        }}
      />
    </GlassBar>
  );
}

/**
 * Over the composer's field, inside its glass, where the agent's last turn
 * failed in a way only a new agent goes on past, as the panel's failed end
 * line ends on its press: why it failed, and Continue in new agent, or
 * Continue again once another agent continued it, which opens the new
 * agent's draft on the agent's whole transcript.
 */
export function ContinueLine({
  words,
  label,
  onContinue,
}: {
  /** Why the turn failed, as the panel's end line says it ("Failed: …"). */
  readonly words: string;
  /** What the press says: Continue in new agent, or Continue again. */
  readonly label: string;
  readonly onContinue: () => void;
}) {
  return (
    <WordsWithPress
      words={words}
      press={{
        label,
        symbol: GLYPH.CONTINUE,
        busy: false,
        busyLabel: label,
        onPress: onContinue,
      }}
    />
  );
}
