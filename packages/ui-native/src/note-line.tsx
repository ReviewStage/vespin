// note-line.tsx -- one quiet line a transcript says among its rows, led by its glyph: where the session was compacted, cleared, or moved, or where its goal moved, as the panel's `NoteLine` step and trail say it.

import { SymbolView } from "expo-symbols";
import { StyleSheet, Text, View } from "react-native";
import { useAccessibilitySize, useScaledSize } from "./accessibility.js";
import { type Glyph, glyphSymbol } from "./glyph.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, SPACE } from "./tokens/space.js";
import { ROLE_SIZE } from "./tokens/type.js";

const styles = StyleSheet.create({
  // Note that the line stands in a call's row's columns and at its height, so it keeps the transcript's rhythm as the panel's step does.
  line: { flexDirection: "row", alignItems: "center", gap: SPACE.ROW - 2, minHeight: 28 },
});

/**
 * A quiet line: its glyph in the muted ink, or the ink it is handed (a met
 * goal's tick in the complete tone), and its words in the muted ink at a
 * row line's size, in a call's row's columns, so it lines up with the calls
 * around it. It says what followed in the session rather than asking
 * anything, so it takes no press, and VoiceOver hears its words alone.
 */
export function NoteLine({
  glyph,
  words,
  glyphInk,
}: {
  readonly glyph: Glyph;
  readonly words: string;
  /** The ink its glyph stands in; the muted ink where none is handed. */
  readonly glyphInk?: string | undefined;
}) {
  const colors = useColors();
  const size = useScaledSize(MARK_SIZE.GLYPH);
  const large = useAccessibilitySize();

  return (
    <View style={styles.line} accessible accessibilityLabel={words}>
      <SymbolView
        name={glyphSymbol(glyph)}
        size={size}
        tintColor={glyphInk ?? colors.TEXT_MUTED}
        accessibilityElementsHidden
      />
      <Text
        numberOfLines={large ? undefined : 2}
        style={{ flex: 1, fontSize: ROLE_SIZE.ROW_LINE, color: colors.TEXT_MUTED }}
      >
        {words}
      </Text>
    </View>
  );
}
