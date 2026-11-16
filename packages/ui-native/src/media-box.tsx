// media-box.tsx -- the box a picture or a recording stands in by the media's one rule: as wide as its column allows, up to its frame's width, its height following from its shape at the width it gets.

import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import type { MediaFrame } from "./media-frame.js";

const styles = StyleSheet.create({
  box: { width: "100%" },
});

/**
 * Stands media at its frame's width or its column's, whichever is less,
 * the media inside it as wide as the box at its own shape. Note that the
 * width is settled here, a level above the shape, because Yoga sets a
 * box's height from its shape before it clamps the box's width, so one box
 * holding both stood narrowed in a narrow column yet as tall as its frame.
 * A box narrower than its row stands where its row aligns it, as a sent
 * line's pictures stand at its end. Media with no frame, such as a tile,
 * stands as its tile gives it.
 */
export function MediaBox({
  frame,
  children,
}: {
  readonly frame: MediaFrame | undefined;
  readonly children: ReactElement;
}) {
  if (frame === undefined) return children;

  return <View style={[styles.box, { maxWidth: frame.width }]}>{children}</View>;
}
