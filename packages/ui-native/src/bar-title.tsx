// bar-title.tsx -- a page's name in its bar with a muted line under it, such as an agent's state and model: UIKit's own subtitle in a compact window's stack, and a split view's detail column's title.

import {
  Button,
  Host,
  HStack,
  Image,
  Spacer,
  Text as SwiftUIText,
  VStack,
} from "@expo/ui/swift-ui";
import {
  accessibilityHidden,
  accessibilityIdentifier,
  accessibilityLabel,
  buttonStyle,
  font,
  foregroundStyle,
  lineLimit,
} from "@expo/ui/swift-ui/modifiers";
import { StyleSheet } from "react-native";
import { GLYPH, glyphImage } from "./glyph.js";
import { BAR_KIND, barSubtitle } from "./interactions.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** What stands under a page's name in its bar: its words, and what a press on them opens with what VoiceOver says it does, where they open anything. */
export type BarSubtitle = {
  readonly words: string;
  readonly onPress?: (() => void) | undefined;
  /** What a press on the line says it does, to VoiceOver, before its words, such as "Change model". */
  readonly label?: string | undefined;
};

/** What the line's press is found by in the app's flows, in a split view's column bar. */
const BAR_SUBTITLE_ID = "bar-subtitle";

const styles = StyleSheet.create({
  // A host of no size, which draws nothing and takes no touch.
  probe: { position: "absolute", width: 0, height: 0 },
});

/** What VoiceOver hears for the line: its press's label, then its words. */
function spokenLine(subtitle: BarSubtitle): string {
  return subtitle.label === undefined ? subtitle.words : `${subtitle.label}, ${subtitle.words}`;
}

/**
 * The words under a compact page's title in the native stack's bar, as Mail
 * names a mailbox's count under its name: UIKit's own subtitle, written by
 * `barSubtitle` from a host of no size, for a page whose content is React
 * Native's own, such as the agent's transcript, so no `Screen` carries it.
 * Note that it stays mounted with empty words, which draw no line, so the
 * line comes and goes without the host being made again.
 */
export function StackSubtitle({ words }: { readonly words: string }) {
  return (
    <Host style={styles.probe} modifiers={[barSubtitle(BAR_KIND.STACK, words)]}>
      <Spacer />
    </Host>
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
