// file-chip.tsx -- a file a message carried that is neither a picture nor a video, such as a PDF: its chip after the message's words, naming it and its size, which opens the file full screen in the system's Quick Look, and whose long press offers Share and, for a text file, Copy.

import { SymbolView } from "expo-symbols";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useAccessibilitySize } from "./accessibility.js";
import { GLYPH, type Glyph, glyphSymbol } from "./glyph.js";
import { HeldMenu, useKeptActs, useQuickLook } from "./held-menu.js";
import { KEPT_KIND, type Kept } from "./keep-model.js";
import { Press } from "./press.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, PRESS_SIZE, RADIUS, SPACE } from "./tokens/space.js";
import { TEXT_SIZE } from "./tokens/type.js";

/** The type a PDF is read as, which its chip names as a PDF. */
const PDF_TYPE = "application/pdf";

/** The glyph a file's chip leads with, as the panel's: a page of words for a PDF or a text file, a blank page for any other. */
const FILE_SYMBOL = {
  DOCUMENT: GLYPH.FILE_TEXT,
  OTHER: GLYPH.FILE,
} as const satisfies Record<string, Glyph>;

/** What a file's chip says. */
const FILE_WORDS = {
  /** A file whose type names no extension. */
  FILE: "File",
  PDF: "PDF",
  OPENS: "Opens the file",
} as const;

/** The longest extension a chip names a file's kind by, past which it says File. */
const MAX_EXTENSION = 5;

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    maxWidth: "100%",
    minHeight: PRESS_SIZE,
    gap: SPACE.ROW,
    paddingHorizontal: SPACE.ROW + 2,
    paddingVertical: SPACE.TIGHT * 2,
    borderRadius: RADIUS.TAG * 2,
    borderWidth: StyleSheet.hairlineWidth,
  },
  words: { flexShrink: 1, gap: 1 },
  facts: { flexDirection: "row", flexWrap: "wrap", columnGap: SPACE.ROW - 2 },
});

/** A file's kind as its chip names it: PDF, its extension in capitals, or File where it has none to name. */
function kindOf(name: string, mediaType: string): string {
  if (mediaType === PDF_TYPE) return FILE_WORDS.PDF;
  const dot = name.lastIndexOf(".");
  const extension = dot <= 0 ? "" : name.slice(dot + 1);

  return extension === "" || extension.length > MAX_EXTENSION
    ? FILE_WORDS.FILE
    : extension.toUpperCase();
}

/** Whether a file is drawn as a page of words: a PDF or a text file. */
function isDocument(mediaType: string): boolean {
  return mediaType === PDF_TYPE || mediaType.startsWith("text/");
}

type FileChipProps = {
  /** The file's name, as it was attached. */
  readonly name: string;
  /** The file's type, which names its kind and its glyph. */
  readonly mediaType: string;
  /** The file's address on the device, under the app's caches; none while its bytes are on their way. */
  readonly source: string | undefined;
  /** The file's size in words, such as "48 KB"; none until its bytes are read. */
  readonly size: string | undefined;
};

/**
 * A file's chip after a message's words, as the panel stands a file's chip:
 * its glyph, its name on one line, cut in its middle so its extension
 * stays, and its kind and its size under it as muted words apart, on
 * `SURFACE` inside a hairline. A press opens it full screen in the
 * system's Quick Look, grown from the chip, which draws a PDF, a text file,
 * a spreadsheet or any other kind the system reads, and whose share button
 * opens it in another app; a file Quick Look can't read opens the share
 * sheet instead. While its bytes are on their way the system's spinner
 * stands in its glyph's place and a press does nothing. At an accessibility
 * size its name wraps rather than cuts.
 */
export function FileChip({ name, mediaType, source, size }: FileChipProps) {
  const colors = useColors();
  const large = useAccessibilitySize();
  const kind = kindOf(name, mediaType);
  const heard = [name, kind, size].filter((part) => part !== undefined).join(", ");
  const fact = { fontSize: TEXT_SIZE.CAPTION, color: colors.TEXT_MUTED };

  const kept: Kept | undefined =
    source === undefined ? undefined : { kind: KEPT_KIND.FILE, source, name, mediaType };

  const acts = useKeptActs(kept);
  const { mark, open } = useQuickLook(kept);

  return (
    <HeldMenu acts={acts}>
      <Press
        ref={mark}
        onPress={open}
        disabled={open === undefined}
        accessibilityRole="button"
        accessibilityLabel={heard}
        accessibilityHint={FILE_WORDS.OPENS}
        accessibilityState={{ busy: source === undefined }}
        style={[styles.chip, { backgroundColor: colors.SURFACE, borderColor: colors.CHIP_EDGE }]}
      >
        {source === undefined ? (
          <ActivityIndicator color={colors.TEXT_MUTED} style={{ width: MARK_SIZE.LEAD }} />
        ) : (
          <SymbolView
            name={glyphSymbol(isDocument(mediaType) ? FILE_SYMBOL.DOCUMENT : FILE_SYMBOL.OTHER)}
            size={MARK_SIZE.LEAD}
            tintColor={colors.TEXT_MUTED}
          />
        )}
        <View style={styles.words}>
          <Text
            numberOfLines={large ? undefined : 1}
            ellipsizeMode="middle"
            style={{ fontSize: TEXT_SIZE.SUBHEADLINE, fontWeight: "500", color: colors.TEXT }}
          >
            {name}
          </Text>
          {/* Note that its kind and its size stand as two muted words apart, never joined by a separator. */}
          <View style={styles.facts}>
            <Text style={fact}>{kind}</Text>
            {size === undefined ? null : <Text style={fact}>{size}</Text>}
          </View>
        </View>
      </Press>
    </HeldMenu>
  );
}
