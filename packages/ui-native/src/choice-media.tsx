// choice-media.tsx -- what one option of a decide ask carries, under its row on the choice card: every picture, recording, page, and address as an equal tile with its caption, in React Native views SwiftUI hosts.

import { SymbolView } from "expo-symbols";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Picture } from "./markdown.js";
import type { SfSymbol } from "./sf-symbol.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, RADIUS, SPACE } from "./tokens/space.js";
import { TEXT_SIZE } from "./tokens/type.js";
import { Video } from "./video.js";

/** What a piece of an option's media is drawn as: a picture, a recording in the system's player, a page the agent showed, or a live address. */
export const CHOICE_MEDIA = {
  PICTURE: "picture",
  VIDEO: "video",
  PAGE: "page",
  LINK: "link",
} as const;

export type ChoiceMediaKind = (typeof CHOICE_MEDIA)[keyof typeof CHOICE_MEDIA];

/** One piece of an option's media: what it is, its caption, the file it is drawn from where it is one, and what opens it where it is a page or an address. */
export type ChoiceMedia = {
  readonly kind: ChoiceMediaKind;
  /** Its caption, a page's title, or an address's words, under its tile. */
  readonly title: string;
  /** The file a picture or a recording is drawn from; none while its bytes are on their way. */
  readonly source?: string | undefined;
  /** Opens a page or an address, or a recording the system's player cannot read. */
  readonly onOpen?: (() => void) | undefined;
};

/** Every tile's shape, a window's, as the panel's thumbs are: 16 by 10. */
const TILE_SHAPE = 16 / 10;

/** The SF Symbol a page's or an address's tile stands as, since neither has a picture of its own here. */
const TILE_SYMBOL: Partial<Record<ChoiceMediaKind, SfSymbol>> = {
  [CHOICE_MEDIA.PAGE]: "doc.richtext",
  [CHOICE_MEDIA.LINK]: "safari",
};

/** The word a page's and an address's tile is named by, before its caption. */
const TILE_WORD: Partial<Record<ChoiceMediaKind, string>> = {
  [CHOICE_MEDIA.PAGE]: "Page",
  [CHOICE_MEDIA.LINK]: "Link",
};

const styles = StyleSheet.create({
  tiles: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: SPACE.ROW,
    paddingHorizontal: SPACE.EDGE - 2,
    paddingBottom: SPACE.ROW,
  },
  tile: { width: "48%", gap: SPACE.TIGHT },
  symbol: {
    width: "100%",
    aspectRatio: TILE_SHAPE,
    borderRadius: RADIUS.TAG * 2,
    alignItems: "center",
    justifyContent: "center",
  },
});

/** A page's or an address's tile: its symbol on the well, opening it on a press. */
function SymbolTile({ piece }: { readonly piece: ChoiceMedia }) {
  const colors = useColors();
  const symbol = TILE_SYMBOL[piece.kind];
  if (symbol === undefined) return null;
  return (
    <Pressable
      onPress={() => piece.onOpen?.()}
      accessibilityRole="link"
      accessibilityLabel={`${TILE_WORD[piece.kind] ?? ""}: ${piece.title}`}
      style={[styles.symbol, { backgroundColor: colors.WELL }]}
    >
      <SymbolView name={symbol} size={MARK_SIZE.LEAD} tintColor={colors.TEXT_MUTED} />
    </Pressable>
  );
}

/** One piece as its tile: a picture opening full screen, a recording in the system's player, or a page's or an address's symbol, its caption under it. */
function ChoiceMediaTile({ piece }: { readonly piece: ChoiceMedia }) {
  const colors = useColors();
  return (
    <View style={styles.tile}>
      {piece.kind === CHOICE_MEDIA.PICTURE ? (
        <Picture source={piece.source} alt={piece.title} shape={TILE_SHAPE} />
      ) : piece.kind === CHOICE_MEDIA.VIDEO ? (
        <Video
          source={piece.source}
          label={piece.title}
          onOpenElsewhere={piece.onOpen}
          shape={TILE_SHAPE}
        />
      ) : (
        <SymbolTile piece={piece} />
      )}
      <Text
        numberOfLines={1}
        style={{ fontSize: TEXT_SIZE.FOOTNOTE, color: colors.TEXT_MUTED }}
        accessibilityElementsHidden
      >
        {piece.title}
      </Text>
    </View>
  );
}

/**
 * An option's media, one tile each of one size, two to a row, wrapping
 * under: as the panel draws them, so a choice between designs reads the
 * same on a phone. A picture stands whole in its tile and opens full screen
 * on a press, as a message's does; a recording plays in the system's
 * player, full screen from its controls; a page and an address stand as
 * their symbol and open on a press. Each caption is one line, cut short
 * where it runs long, and each tile is heard by its whole caption.
 */
export function ChoiceMediaTiles({ media }: { readonly media: readonly ChoiceMedia[] }) {
  return (
    <View style={styles.tiles}>
      {/* Note that a tile is keyed by its place, because an option may carry the same page or address twice and its list never reorders. */}
      {media.map((piece, index) => (
        <ChoiceMediaTile key={index} piece={piece} />
      ))}
    </View>
  );
}
