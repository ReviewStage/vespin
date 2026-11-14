// media-failed.tsx -- what stands where a picture's, a recording's or a file's bytes did not land: the failure's glyph, the panel's short line, and Try again, which reads them again.

import { SymbolView } from "expo-symbols";
import { type StyleProp, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { BUTTON_LOOK, Button } from "./button.js";
import { GLYPH, glyphSymbol } from "./glyph.js";
import { InlineHost } from "./inline-host.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, SPACE } from "./tokens/space.js";
import { TEXT_SIZE } from "./tokens/type.js";

/** What reads a file again, as the app's other failures name it. */
const TRY_AGAIN = "Try again";

const styles = StyleSheet.create({
  well: {
    alignItems: "center",
    justifyContent: "center",
    gap: SPACE.TIGHT,
    padding: SPACE.ROW,
  },
  said: { alignItems: "center", gap: SPACE.TIGHT },
  // Note that a failure stands as tall as its words and Try again need, at least a short well's height, rather than at the media's shape, which cut off Try again at a large text size and in a decide option's small tile.
  grows: { aspectRatio: undefined, minHeight: 120, overflow: "visible" },
});

/**
 * A failed read's stand-in, in the box the media would have stood in, as
 * the panel's failed picture stands (`@repo/ui`'s `PictureStandIn`): the
 * failure's glyph over the panel's short line (`MEDIA_READ_WORDS`), then
 * Try again where it can read them again, rather than a spinner that never
 * ends. Its whole sentence, with the media's own name, is what VoiceOver
 * hears for the box, Try again standing apart as its own button.
 */
export function MediaFailed({
  line,
  heard,
  onRetry,
  style,
}: {
  /** The short line the box says, such as "Couldn't load image". */
  readonly line: string;
  /** The whole sentence it is heard as, the media's name first. */
  readonly heard: string;
  /** Reads the media again; none offers nothing. */
  readonly onRetry?: (() => void) | undefined;
  /** The box it stands in, the media's own frame and well, whose shape gives way to the room its words need. */
  readonly style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();

  return (
    <View style={[styles.well, { backgroundColor: colors.WELL }, style, styles.grows]}>
      <View style={styles.said} accessible accessibilityLabel={heard}>
        <SymbolView
          name={glyphSymbol(GLYPH.FAILED)}
          size={MARK_SIZE.LEAD}
          tintColor={colors.TEXT_MUTED}
        />
        <Text
          style={{ fontSize: TEXT_SIZE.FOOTNOTE, color: colors.TEXT_MUTED, textAlign: "center" }}
        >
          {line}
        </Text>
      </View>
      {onRetry === undefined ? null : (
        <InlineHost matchContents>
          <Button label={TRY_AGAIN} look={BUTTON_LOOK.BORDERED} onPress={onRetry} />
        </InlineHost>
      )}
    </View>
  );
}
