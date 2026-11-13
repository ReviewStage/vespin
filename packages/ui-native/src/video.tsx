// video.tsx -- a video a message carried, played in iOS's own player through expo-video, at its message's width.

import { useVideoPlayer, type VideoPlayerStatus, type VideoTrack, VideoView } from "expo-video";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useAccessibilitySize } from "./accessibility.js";
import { HeldMenu, useKeptActs } from "./held-menu.js";
import { KEPT_KIND } from "./keep-model.js";
import { Press } from "./press.js";
import { useColors } from "./tokens/colors.js";
import { RADIUS, SPACE } from "./tokens/space.js";
import { TEXT_SIZE } from "./tokens/type.js";

/** What a video says where the system's player cannot play it, such as a WebM, which iOS's player has no reader for. */
const CANNOT_PLAY = "This video can't play here.";

/** What the system's player stands as to a flow that drives the app, once it has read the video's file and can play it. */
const VIDEO_PLAYER_ID = "video-player";

/** What Open in Safari is heard to do. */
const OPENS_IN_SAFARI = "Opens the video in Safari";

/** What opens a video the player cannot play where it plays. */
const OPEN_IN_SAFARI = "Open in Safari";

/** A film's shape, width over height, which a video's well stands at until the player has read its own. */
const FILM_ASPECT = 16 / 9;

/** The tallest a video stands, width over height: a portrait recording stands no taller than 3 by 4, its picture fitted inside, so one video never fills the screen. */
const TALLEST_ASPECT = 3 / 4;

/** A video's own shape, width over height, as its track reads, held no taller than `TALLEST_ASPECT`; none while the track is not read. */
function trackAspect(track: VideoTrack | null): number | undefined {
  if (track === null || track.size.width <= 0 || track.size.height <= 0) return undefined;

  return Math.max(TALLEST_ASPECT, track.size.width / track.size.height);
}

const styles = StyleSheet.create({
  frame: {
    width: "100%",
    aspectRatio: FILM_ASPECT,
    borderRadius: RADIUS.BLOCK,
    overflow: "hidden",
  },
  unplayable: {
    alignItems: "center",
    justifyContent: "center",
    padding: SPACE.ROW,
    gap: SPACE.TIGHT,
  },
  spinner: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  // Note that at an accessibility size an unplayable well grows with its words rather than holding the film's shape, which would cut them off.
  grown: { aspectRatio: undefined, minHeight: 120, overflow: "visible" },
});

type VideoProps = {
  /** The file the video plays from, such as one the thread wrote under the app's caches; none while its bytes are on their way, which stands its well alone. */
  readonly source: string | undefined;
  /** What the video is, its file's name, heard in its place. */
  readonly label: string;
  /** Opens the video where it plays, offered where the system's player cannot read it; none offers nothing. */
  readonly onOpenElsewhere?: (() => void) | undefined;
  /** A tile's fixed shape, width over height; the video's own, once the player has read it, where none is given. */
  readonly tileAspect?: number | undefined;
};

/**
 * A video in the system's own player, its controls, full screen, and
 * Picture in Picture the system's, standing paused until it is played, as a
 * message's video stands. Note that one the player cannot read, such as the
 * WebM an agent's browser records, says so in its place and offers where it
 * plays, rather than standing as a player that never starts; and one whose
 * bytes are on their way, or that the player still reads, stands the
 * system's spinner in its well, as Photos does, so it never reads as an
 * empty box.
 */
export function Video({ source, label, onOpenElsewhere, tileAspect }: VideoProps) {
  const colors = useColors();
  const large = useAccessibilitySize();
  const player = useVideoPlayer(source ?? null);
  const [status, setStatus] = useState<VideoPlayerStatus>(player.status);
  const [ownAspect, setOwnAspect] = useState(() => trackAspect(player.videoTrack));
  useEffect(() => {
    setStatus(player.status);
    setOwnAspect(trackAspect(player.videoTrack));
    const listening = player.addListener("statusChange", ({ status: next }) => setStatus(next));

    const tracking = player.addListener("videoTrackChange", ({ videoTrack }) =>
      setOwnAspect(trackAspect(videoTrack)),
    );

    return () => {
      listening.remove();
      tracking.remove();
    };
  }, [player]);
  // Note that a tile keeps the shape its grid gives it, and a message's video takes its own once read, as Messages draws one, rather than a film's 16 by 9 whatever was recorded.
  const aspect = tileAspect ?? ownAspect;
  const tiled = aspect === undefined ? undefined : { aspectRatio: aspect };
  const failed = status === "error";

  const acts = useKeptActs(
    source === undefined ? undefined : { kind: KEPT_KIND.VIDEO, source, name: label },
  );

  if (source === undefined || failed) {
    // Note that a well offering Open in Safari stands as two elements to VoiceOver, its words and its link, since one element would hide the link.
    const offers = failed && onOpenElsewhere !== undefined;

    return (
      <HeldMenu acts={acts}>
        <View
          style={[
            styles.frame,
            tiled,
            styles.unplayable,
            failed && large ? styles.grown : null,
            { backgroundColor: colors.WELL },
          ]}
          accessible={!offers}
          accessibilityLabel={offers ? undefined : failed ? `${label}. ${CANNOT_PLAY}` : label}
        >
          {failed ? null : <ActivityIndicator color={colors.TEXT_MUTED} />}
          {failed ? (
            <Text
              style={{ fontSize: TEXT_SIZE.FOOTNOTE, color: colors.TEXT_MUTED }}
              accessibilityLabel={`${label}. ${CANNOT_PLAY}`}
            >
              {CANNOT_PLAY}
            </Text>
          ) : null}
          {offers ? (
            <Press
              onPress={onOpenElsewhere}
              accessibilityRole="link"
              accessibilityHint={OPENS_IN_SAFARI}
              hitSlop={SPACE.ROW}
            >
              <Text
                style={{ fontSize: TEXT_SIZE.FOOTNOTE, fontWeight: "600", color: colors.TEXT_BODY }}
              >
                {OPEN_IN_SAFARI}
              </Text>
            </Press>
          ) : null}
        </View>
      </HeldMenu>
    );
  }

  return (
    <HeldMenu acts={acts}>
      <View style={[styles.frame, tiled]}>
        <VideoView
          player={player}
          nativeControls
          contentFit="contain"
          fullscreenOptions={{ enable: true }}
          allowsPictureInPicture
          accessibilityLabel={label}
          testID={status === "readyToPlay" ? VIDEO_PLAYER_ID : undefined}
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.WELL }]}
        />
        {status === "readyToPlay" ? null : (
          <View style={styles.spinner} pointerEvents="none">
            <ActivityIndicator color={colors.TEXT_MUTED} />
          </View>
        )}
      </View>
    </HeldMenu>
  );
}
