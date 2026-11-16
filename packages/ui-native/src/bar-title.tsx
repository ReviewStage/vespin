// bar-title.tsx -- a page's name in its bar with a muted line under it, such as an agent's state and model, in a compact window's stack and in a split view's detail column.

import { Button, HStack, Image, Spacer, Text as SwiftUIText, VStack } from "@expo/ui/swift-ui";
import * as SwiftModifiers from "@expo/ui/swift-ui/modifiers";
import {
  accessibilityHidden,
  accessibilityIdentifier,
  accessibilityLabel,
  buttonStyle,
  font,
  foregroundStyle,
  frame,
  lineLimit,
} from "@expo/ui/swift-ui/modifiers";
import { SymbolView } from "expo-symbols";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { GLYPH, glyphImage, glyphSymbol } from "./glyph.js";
import { InlineHost } from "./inline-host.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, PRESS_SIZE, SPACE } from "./tokens/space.js";
import { BAR_TITLE, TEXT_SIZE, TYPE_ROLE } from "./tokens/type.js";

/** What stands under a page's name in its bar: its words, and what a press on them opens with what VoiceOver says it does, where they open anything. */
export type BarSubtitle = {
  readonly words: string;
  readonly onPress?: (() => void) | undefined;
  /** What a press on the line says it does, to VoiceOver, before its words, such as "Change model". */
  readonly label?: string | undefined;
};

/** What the line's press is found by in the app's flows, in either bar. */
const BAR_SUBTITLE_ID = "bar-subtitle";

/** What a compact bar keeps either side of its title view: the screen's edge, one round glass button (Back, or ⋯), and a gap before the words. */
const BAR_SIDE = SPACE.EDGE + PRESS_SIZE + SPACE.ROW;

const styles = StyleSheet.create({
  stack: { alignItems: "center" },
  line: { flexDirection: "row", alignItems: "center", gap: 2 },
  words: { flexShrink: 1 },
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
 * under it; and that the press is a SwiftUI button laid over the words,
 * because a React Native press in the stack's title view dims as a finger
 * lands and never hears it lift (the Mac's shots of #9466), while a
 * SwiftUI host there is UIKit's own view, which the bar hands its touches,
 * as the workspace switcher's beside it takes them. Its width is capped to
 * the room between the bar's two buttons, since React Native measures a
 * title view at its words' own width, which at the accessibility sizes ran
 * into the ⋯'s glass, where the stack's own title would cut short.
 */
export function StackBarTitle({
  title,
  subtitle,
}: {
  readonly title: string;
  readonly subtitle: BarSubtitle;
}) {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const pressed = subtitle.onPress !== undefined;

  const drawn = (
    <View
      style={[styles.stack, { maxWidth: Math.max(0, width - 2 * BAR_SIDE) }]}
      accessibilityElementsHidden={pressed}
      importantForAccessibility={pressed ? "no-hide-descendants" : "auto"}
    >
      <Text
        numberOfLines={1}
        accessibilityRole="header"
        style={{ ...BAR_TITLE.SCREEN, color: colors.TEXT }}
        maxFontSizeMultiplier={1.4}
      >
        {title}
      </Text>
      <View style={styles.line} accessible={!pressed} accessibilityLabel={subtitle.words}>
        <Text
          numberOfLines={1}
          style={[styles.words, { fontSize: TEXT_SIZE.CAPTION, color: colors.TEXT_MUTED }]}
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
    </View>
  );

  if (!pressed) return drawn;

  return (
    <View>
      {drawn}
      {/* Note that the button draws nothing of its own, so the words under it are the one drawing of the title, and it spans them whole, so a press anywhere on the name or the line opens what the line names. */}
      <InlineHost style={StyleSheet.absoluteFill}>
        <Button
          onPress={subtitle.onPress}
          modifiers={[
            buttonStyle("plain"),
            accessibilityLabel(`${title}, ${spokenLine(subtitle)}`),
            accessibilityIdentifier(BAR_SUBTITLE_ID),
          ]}
        >
          <Spacer
            modifiers={[
              frame({ maxWidth: Number.POSITIVE_INFINITY, maxHeight: Number.POSITIVE_INFINITY }),
              SwiftModifiers.contentShape(SwiftModifiers.shapes.rectangle()),
            ]}
          />
        </Button>
      </InlineHost>
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
      modifiers={[
        buttonStyle("plain"),
        accessibilityLabel(`${title}, ${spokenLine(subtitle)}`),
        accessibilityIdentifier(BAR_SUBTITLE_ID),
      ]}
    >
      {stack}
    </Button>
  );
}
