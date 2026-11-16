// picture-set.tsx -- several pictures a message carried, side by side as Messages groups a run of photos, each a square tile cropped to fill it, a lone one standing at its own size.

import { StyleSheet, View } from "react-native";
import { Picture } from "./markdown.js";
import { MEDIA_BOUNDS } from "./media-frame.js";
import { SPACE } from "./tokens/space.js";

/** How far apart a set's tiles stand. */
const TILE_GAP = SPACE.TIGHT;

/** A tile's side: two to a row inside the widest a message's media stands. */
const TILE_SIDE = (MEDIA_BOUNDS.WIDTH - TILE_GAP) / 2;

const styles = StyleSheet.create({
  set: { flexDirection: "row", flexWrap: "wrap", gap: TILE_GAP, maxWidth: MEDIA_BOUNDS.WIDTH },
  tile: { width: TILE_SIDE },
  // Note that a set standing at its row's end, as a sent line's does, lays an odd last tile at that end too.
  atEnd: { justifyContent: "flex-end" },
});

/** One picture of a set: its key, what it is drawn from (none on its way, `null` where it could not be read), its words, and what reads it again. */
export type SetPicture = {
  readonly key: string;
  readonly source: string | null | undefined;
  readonly alt: string;
  readonly onRetry?: (() => void) | undefined;
};

/**
 * The pictures a message carried: one alone at its own size by the media's
 * one rule, and two or more as a set of square tiles two to a row, each
 * cropped to fill its tile, as Messages and the panel stand a run of photos
 * rather than one under another down the screen. A press on a tile opens
 * that picture whole, and each says its own failure with Try again.
 */
export function PictureSet({
  pictures,
  atEnd = false,
}: {
  readonly pictures: readonly SetPicture[];
  /** Whether it stands at its row's end, as a sent line's pictures do, its tiles laid from that end. */
  readonly atEnd?: boolean | undefined;
}) {
  const [only] = pictures;

  if (only === undefined) return null;

  if (pictures.length === 1) {
    return <Picture source={only.source} alt={only.alt} onRetry={only.onRetry} />;
  }

  return (
    <View style={[styles.set, atEnd ? styles.atEnd : null]}>
      {pictures.map((picture) => (
        <View key={picture.key} style={styles.tile}>
          <Picture
            source={picture.source}
            alt={picture.alt}
            onRetry={picture.onRetry}
            tileAspect={1}
            fill
          />
        </View>
      ))}
    </View>
  );
}
