// video.tsx -- a video a message carried, played in iOS's own player through expo-video, at its message's width.

import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useColors } from "./tokens/colors.js";
import { SPACE } from "./tokens/space.js";
import { TEXT_SIZE } from "./tokens/type.js";

/** What a video says where the system's player cannot play it, such as a WebM, which iOS's player has no reader for. */
const CANNOT_PLAY = "This video can't play here.";

/** What opens a video the player cannot play where it plays. */
const OPEN_IN_SAFARI = "Open in Safari";

const styles = StyleSheet.create({
  frame: { width: "100%", aspectRatio: 16 / 9, borderRadius: 8, overflow: "hidden" },
  unplayable: {
    alignItems: "center",
    justifyContent: "center",
    padding: SPACE.ROW,
    gap: SPACE.TIGHT,
  },
});

type VideoProps = {
  /** The file the video plays from, such as one the thread wrote under the app's caches; none while its bytes are on their way, which stands its well alone. */
  readonly source: string | undefined;
  /** What the video is, its file's name, heard in its place. */
  readonly label: string;
  /** Opens the video where it plays, offered where the system's player cannot read it; none offers nothing. */
  readonly onOpenElsewhere?: (() => void) | undefined;
};

/**
 * A video in the system's own player, its controls, full screen, and
 * Picture in Picture the system's, standing paused until it is played, as a
 * message's video stands. Note that one the player cannot read, such as the
 * WebM an agent's browser records, says so in its place and offers where it
 * plays, rather than standing as a player that never starts.
 */
export function Video({ source, label, onOpenElsewhere }: VideoProps) {
  const colors = useColors();
  const player = useVideoPlayer(source ?? null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
    const listening = player.addListener("statusChange", ({ status }) => {
      setFailed(status === "error");
    });
    return () => listening.remove();
  }, [player]);
  if (source === undefined || failed) {
    // Note that a well offering Open in Safari stands as two elements to VoiceOver, its words and its link, since one element would hide the link.
    const offers = failed && onOpenElsewhere !== undefined;
    return (
      <View
        style={[styles.frame, styles.unplayable, { backgroundColor: colors.WELL }]}
        accessible={!offers}
        accessibilityLabel={offers ? undefined : failed ? `${label}. ${CANNOT_PLAY}` : label}
      >
        {failed ? (
          <Text
            style={{ fontSize: TEXT_SIZE.FOOTNOTE, color: colors.TEXT_MUTED }}
            accessibilityLabel={`${label}. ${CANNOT_PLAY}`}
          >
            {CANNOT_PLAY}
          </Text>
        ) : null}
        {offers ? (
          <Pressable onPress={onOpenElsewhere} accessibilityRole="link" hitSlop={SPACE.ROW}>
            <Text
              style={{ fontSize: TEXT_SIZE.FOOTNOTE, fontWeight: "600", color: colors.ACCENT_TEXT }}
            >
              {OPEN_IN_SAFARI}
            </Text>
          </Pressable>
        ) : null}
      </View>
    );
  }
  return (
    <VideoView
      player={player}
      nativeControls
      contentFit="contain"
      fullscreenOptions={{ enable: true }}
      allowsPictureInPicture
      accessibilityLabel={label}
      style={[styles.frame, { backgroundColor: colors.WELL }]}
    />
  );
}
