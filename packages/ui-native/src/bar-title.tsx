// bar-title.tsx -- a page's name in its bar with a muted line under it, such as an agent's state and model, in a compact window's stack and in a split view's detail column.

import { Button, HStack, Image, Text as SwiftUIText, VStack } from "@expo/ui/swift-ui";
import {
  accessibilityHidden,
  accessibilityLabel,
  buttonStyle,
  font,
  foregroundStyle,
  lineLimit,
} from "@expo/ui/swift-ui/modifiers";
import { SymbolView } from "expo-symbols";
import { StyleSheet, Text, View } from "react-native";
import { GLYPH, glyphImage, glyphSymbol } from "./glyph.js";
import { Press } from "./press.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE } from "./tokens/space.js";
import { BAR_TITLE, TEXT_SIZE, TYPE_ROLE } from "./tokens/type.js";

/** What stands under a page's name in its bar: its words, and what a press on them opens with what VoiceOver says it does, where they open anything. */
export type BarSubtitle = {
  readonly words: string;
  readonly onPress?: (() => void) | undefined;
  /** What a press on the line says it does, to VoiceOver, before its words, such as "Change model". */
  readonly label?: string | undefined;
};

const styles = StyleSheet.create({
  stack: { alignItems: "center" },
  line: { flexDirection: "row", alignItems: "center", gap: 2 },
});

/** What VoiceOver hears for the line: its press's label, then its words. */
function spokenLine(subtitle: BarSubtitle): string {
  return subtitle.label === undefined ? subtitle.words : `${subtitle.label}, ${subtitle.words}`;
}

/**
 * A compact window's stack bar's title with a line under it, as Mail names
 * a mailbox's count under its name: the name in the bar's ink, and the
 * line small and muted, with a chevron after it where a press on it opens
 * something. Note that it stands as the stack's title view, which React
 * Native lays out at its own size, since the stack's own title has no line
 * under it.
 */
export function StackBarTitle({
  title,
  subtitle,
}: {
  readonly title: string;
  readonly subtitle: BarSubtitle;
}) {
  const colors = useColors();
  const pressed = subtitle.onPress !== undefined;

  const words = (
    <View style={styles.line}>
      <Text
        numberOfLines={1}
        style={{ fontSize: TEXT_SIZE.CAPTION, color: colors.TEXT_MUTED }}
        maxFontSizeMultiplier={1.4}
      >
        {subtitle.words}
      </Text>
      {pressed ? (
        <SymbolView
          name={glyphSymbol(GLYPH.UNFOLDED)}
          size={MARK_SIZE.GLYPH - 6}
          weight="semibold"
          tintColor={colors.TEXT_MUTED}
          accessibilityElementsHidden
        />
      ) : null}
    </View>
  );

  return (
    <View style={styles.stack}>
      <Text
        numberOfLines={1}
        accessibilityRole="header"
        style={{ ...BAR_TITLE.SCREEN, color: colors.TEXT }}
        maxFontSizeMultiplier={1.4}
      >
        {title}
      </Text>
      {pressed ? (
        <Press
          onPress={subtitle.onPress}
          accessibilityRole="button"
          accessibilityLabel={spokenLine(subtitle)}
          hitSlop={8}
          testID="bar-subtitle"
        >
          {words}
        </Press>
      ) : (
        <View accessible accessibilityLabel={spokenLine(subtitle)}>
          {words}
        </View>
      )}
    </View>
  );
}

/**
 * A split view's detail column's title with a line under it, in the bar's
 * middle: the name in the bar's ink and the line small and muted under it,
 * the whole a plain press where the line opens something, so the bar's
 * glass is the one layer around it, as the path title stands.
 */
export function ColumnBarTitle({
  title,
  subtitle,
}: {
  readonly title: string;
  readonly subtitle: BarSubtitle;
}) {
  const colors = useColors();

  const stack = (
    <VStack spacing={0}>
      <SwiftUIText
        modifiers={[
          font({ textStyle: TYPE_ROLE.SCREEN_TITLE }),
          foregroundStyle(colors.TEXT),
          lineLimit(1),
        ]}
      >
        {title}
      </SwiftUIText>
      <HStack spacing={2}>
        <SwiftUIText
          modifiers={[
            font({ textStyle: TYPE_ROLE.TIME }),
            foregroundStyle(colors.TEXT_MUTED),
            lineLimit(1),
          ]}
        >
          {subtitle.words}
        </SwiftUIText>
        {subtitle.onPress === undefined ? null : (
          <Image
            {...glyphImage(GLYPH.UNFOLDED)}
            size={MARK_SIZE.GLYPH - 6}
            color={colors.TEXT_MUTED}
            modifiers={[accessibilityHidden(true)]}
          />
        )}
      </HStack>
    </VStack>
  );

  if (subtitle.onPress === undefined) return stack;

  return (
    <Button
      onPress={subtitle.onPress}
      modifiers={[buttonStyle("plain"), accessibilityLabel(`${title}, ${spokenLine(subtitle)}`)]}
    >
      {stack}
    </Button>
  );
}
