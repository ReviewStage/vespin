// problem-line.tsx -- what went wrong, said in a row's line: the muted words led by the alert glyph in the attention ink, never red words, since the act beside them says how to mend it.

import { HStack, Text } from "@expo/ui/swift-ui";
import { accessibilityIdentifier, font, foregroundStyle } from "@expo/ui/swift-ui/modifiers";
import { GLYPH } from "./glyph.js";
import { GlyphImage } from "./glyph-label.js";
import { useColors } from "./tokens/colors.js";
import { SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/**
 * A line saying what went wrong, as every row and note says a refusal or a
 * broken connection: its words in the muted ink at a row line's size, led
 * by the alert glyph in the attention ink on their first baseline, so the
 * line reads as needing the reader without the alarm of red words.
 */
export function ProblemLine({
  text,
  id,
}: {
  readonly text: string;
  /** What a flow finds the line by, such as an ask's note. */
  readonly id?: string | undefined;
}) {
  const colors = useColors();

  return (
    <HStack
      spacing={SPACE.TIGHT}
      alignment="firstTextBaseline"
      modifiers={id === undefined ? [] : [accessibilityIdentifier(id)]}
    >
      <GlyphImage glyph={GLYPH.FAILED} textStyle={TYPE_ROLE.ROW_LINE} color={colors.ATTENTION} />
      <Text
        modifiers={[font({ textStyle: TYPE_ROLE.ROW_LINE }), foregroundStyle(colors.TEXT_MUTED)]}
      >
        {text}
      </Text>
    </HStack>
  );
}
