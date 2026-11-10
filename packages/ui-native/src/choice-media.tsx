// choice-media.tsx -- what one option of a decide ask carries, under its row on the choice card: its pictures and recordings side by side, each opening full screen, in React Native views SwiftUI hosts.

import { ScrollView, StyleSheet, View } from "react-native";
import { Picture } from "./markdown.js";
import { SPACE } from "./tokens/space.js";
import { Video } from "./video.js";

/** What a piece of an option's media is drawn as: a picture, a recording in the system's player, a page the agent showed, or a live address. */
export const CHOICE_MEDIA = {
  PICTURE: "picture",
  VIDEO: "video",
  PAGE: "page",
  LINK: "link",
} as const;

export type ChoiceMediaKind = (typeof CHOICE_MEDIA)[keyof typeof CHOICE_MEDIA];

/** One piece of an option's media: what it is, its words, the file it is drawn from where it is one, and what opens it where it is a page or an address. */
export type ChoiceMedia = {
  readonly key: string;
  readonly kind: ChoiceMediaKind;
  /** Its caption, a page's title, or an address's words. */
  readonly title: string;
  /** The file a picture or a recording is drawn from; none while its bytes are on their way. */
  readonly source?: string | undefined;
  /** Opens a page or an address, or a recording the system's player cannot read. */
  readonly onOpen?: (() => void) | undefined;
};

/** How wide a picture or a recording stands in the strip: two side by side on a phone, the next peeking in. */
const TILE_WIDTH = 168;

const styles = StyleSheet.create({
  strip: { gap: SPACE.ROW, paddingHorizontal: SPACE.EDGE - 2, paddingBottom: SPACE.ROW },
  tile: { width: TILE_WIDTH },
});

/** Whether a piece is drawn in the strip, a picture or a recording, rather than as a row. */
export function inStrip(media: ChoiceMedia): boolean {
  return media.kind === CHOICE_MEDIA.PICTURE || media.kind === CHOICE_MEDIA.VIDEO;
}

/**
 * An option's pictures and recordings in one row that scrolls across where
 * it outruns the card: a picture opening full screen on a press, as a
 * message's does, and a recording in the system's player, which plays it
 * full screen. Its words are each piece's own, heard in its place.
 */
export function ChoiceMediaStrip({ media }: { readonly media: readonly ChoiceMedia[] }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.strip}
    >
      {media.map((piece) => (
        <View key={piece.key} style={styles.tile}>
          {piece.kind === CHOICE_MEDIA.VIDEO ? (
            <Video source={piece.source} label={piece.title} onOpenElsewhere={piece.onOpen} />
          ) : (
            <Picture source={piece.source} alt={piece.title} />
          )}
        </View>
      ))}
    </ScrollView>
  );
}
