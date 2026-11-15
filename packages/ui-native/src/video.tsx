// video.tsx -- a video a message carried, played in iOS's own player through expo-video, at its message's width.

import { useVideoPlayer, type VideoPlayerStatus, VideoView } from "expo-video";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useAccessibilitySize } from "./accessibility.js";
import { HeldMenu, useKeptActs } from "./held-menu.js";
import { KEPT_KIND } from "./keep-model.js";
import { Press } from "./press.js";
import { useColors } from "./tokens/colors.js";
import { SPACE } from "./tokens/space.js";
import { TEXT_SIZE } from "./tokens/type.js";

/** What a video says where the system's player cannot play it, such as a WebM, which iOS's player has no reader for. */
const CANNOT_PLAY = "This video can't play here.";

/** What the system's player stands as to a flow that drives the app, once it has read the video's file and can play it. */
const VIDEO_PLAYER_ID = "video-player";

/** What Open in Safari is heard to do. */
const OPENS_IN_SAFARI = "Opens the video in Safari";

/** What opens a video the player cannot play where it plays. */
const OPEN_IN_SAFARI = "Open in Safari";

/** What a playable video is heard to do, as a video in Messages opens: the system's player full screen, whose controls VoiceOver reads there. */
const OPENS_FULL_SCREEN = "Opens the video full screen";

const styles = StyleSheet.create({
  frame: { width: "100%", aspectRatio: 16 / 9, borderRadius: 8, overflow: "hidden" },
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
  /** A tile's fixed shape, width over height; a film's 16 by 9 where none is given. */
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
 * empty box. To VoiceOver, a player that can play is one element, the
 * video's name, which opens the system's player full screen, where its
 * controls are read, as a video in Messages is.
 */
export function Video({ source, label, onOpenElsewhere, tileAspect }: VideoProps) {
  const colors = useColors();
  const large = useAccessibilitySize();
  const tiled = tileAspect === undefined ? undefined : { aspectRatio: tileAspect };
  const player = useVideoPlayer(source ?? null);
  const view = useRef<VideoView>(null);
  const [status, setStatus] = useState<VideoPlayerStatus>(player.status);
  useEffect(() => {
    setStatus(player.status);
    const listening = player.addListener("statusChange", ({ status: next }) => setStatus(next));

    return () => listening.remove();
  }, [player]);
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

  // Note that the player stands as one element, its name, which opens it full screen, as a video in Messages does, because the system's inline player nests a dozen views under it, and a thread's video in an iPad's split view stood past the depth XCTest can serialize (Foundation's "Too many nested arrays or dictionaries"), so no flow could read that screen.
  return (
    <HeldMenu acts={acts}>
      <View
        style={[styles.frame, tiled]}
        accessible
        accessibilityLabel={label}
        accessibilityHint={OPENS_FULL_SCREEN}
        onAccessibilityTap={() => void view.current?.enterFullscreen()}
        testID={status === "readyToPlay" ? VIDEO_PLAYER_ID : undefined}
      >
        <VideoView
          ref={view}
          player={player}
          nativeControls
          contentFit="contain"
          fullscreenOptions={{ enable: true }}
          allowsPictureInPicture
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
