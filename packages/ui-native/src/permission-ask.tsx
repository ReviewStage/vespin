// permission-ask.tsx -- a row heading a list that asks the reader to turn on something the app needs, in the place it matters, as Apple asks: its glyph, a title and one line of why, the act that raises the system's own question or opens Settings, and Not Now.

import { HStack, VStack } from "@expo/ui/swift-ui";
import {
  foregroundStyle,
  frame,
  listRowBackground,
  listRowSeparator,
  padding,
} from "@expo/ui/swift-ui/modifiers";
import { BUTTON_LOOK, BUTTON_SIZE, Button } from "./button.js";
import { font } from "./font.js";
import type { Glyph } from "./glyph.js";
import { GlyphImage } from "./glyph-label.js";
import { Text } from "./text.js";
import { useColors } from "./tokens/colors.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** The space between the glyph and the words, and between the words and the acts, in points. */
const ASK_SPACING = 10;

/** The room above and below the row's contents, in points. */
const ASK_VERTICAL = 12;

export type PermissionAskProps = {
  readonly glyph: Glyph;
  readonly title: string;
  /** Why the app asks, in one line. */
  readonly line: string;
  /** The act's words, such as "Turn On Notifications": never "Allow", since nothing is allowed until the system asks. */
  readonly act: string;
  readonly onAct: () => void;
  /** Not Now's words. */
  readonly dismiss: string;
  readonly onDismiss: () => void;
};

/**
 * What a list says first while the app still lacks something the reader would
 * want, such as notifications, in the list it serves rather than at launch, as
 * Apple's guidance asks: the reason first, then the act that raises the
 * system's own question (or, once refused, opens Settings), then Not Now,
 * which lets it go. Note that the act is bordered rather than filled, since
 * the row asks rather than leads the list, and the glyph stands in the muted
 * ink, as a row's glyphs do. It goes in a `RowList`'s `lead`.
 */
export function PermissionAsk({
  glyph,
  title,
  line,
  act,
  onAct,
  dismiss,
  onDismiss,
}: PermissionAskProps) {
  const colors = useColors();

  return (
    <HStack
      alignment="top"
      spacing={ASK_SPACING}
      modifiers={[
        listRowBackground(colors.GROUND),
        listRowSeparator("hidden"),
        padding({ vertical: ASK_VERTICAL }),
      ]}
    >
      <GlyphImage glyph={glyph} textStyle={TYPE_ROLE.ROW_TITLE} color={colors.TEXT_MUTED} />
      <VStack
        alignment="leading"
        spacing={ASK_SPACING}
        modifiers={[frame({ maxWidth: Number.POSITIVE_INFINITY, alignment: "leading" })]}
      >
        <VStack alignment="leading" spacing={2}>
          <Text
            modifiers={[
              font({ textStyle: TYPE_ROLE.ROW_TITLE, weight: "semibold" }),
              foregroundStyle(colors.TEXT),
            ]}
          >
            {title}
          </Text>
          <Text
            modifiers={[
              font({ textStyle: TYPE_ROLE.ROW_LINE }),
              foregroundStyle(colors.TEXT_MUTED),
            ]}
          >
            {line}
          </Text>
        </VStack>
        <HStack spacing={ASK_SPACING}>
          <Button
            label={act}
            look={BUTTON_LOOK.BORDERED}
            size={BUTTON_SIZE.SMALL}
            onPress={onAct}
          />
          <Button
            label={dismiss}
            look={BUTTON_LOOK.PLAIN}
            size={BUTTON_SIZE.SMALL}
            onPress={onDismiss}
          />
        </HStack>
      </VStack>
    </HStack>
  );
}
