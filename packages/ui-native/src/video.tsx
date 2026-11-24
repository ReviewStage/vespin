// video.tsx -- a video a message carried, played in iOS's own player through expo-video, at its own shape held to the media's one rule, or saying so where its bytes did not land.

import { HStack, Image, Button as SwiftUIButton, Text as SwiftUIText } from "@expo/ui/swift-ui";
import * as SwiftModifiers from "@expo/ui/swift-ui/modifiers";
import {
  accessibilityHint,
  accessibilityLabel,
  buttonStyle,
  controlSize,
  font,
  lineLimit,
  monospacedDigit,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { MEDIA_READ_WORDS } from "@repo/features/media-read-words";
import { playheadText } from "@repo/features/time-format";
import { useEvent, useEventListener } from "expo";
import { useVideoPlayer, type VideoPlayer, VideoView } from "expo-video";
import { useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useAccessibilitySize } from "./accessibility.js";
import { GLYPH, glyphImage } from "./glyph.js";
import { HeldMenu, useKeptActs } from "./held-menu.js";
import { InlineHost } from "./inline-host.js";
import { KEPT_KIND } from "./keep-model.js";
import { MediaBox } from "./media-box.js";
import { MediaFailed } from "./media-failed.js";
import { mediaFrame } from "./media-frame.js";
import { Press } from "./press.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, RADIUS, SPACE } from "./tokens/space.js";
import { ROLE_SIZE, TYPE_ROLE } from "./tokens/type.js";

/** What a video says where the system's player cannot play it, such as a WebM, which iOS's player has no reader for. */
const CANNOT_PLAY = "This video can't play here.";

/** What the system's player stands as to a flow that drives the app, once it has read the video's file and can play it. */
const VIDEO_PLAYER_ID = "video-player";

/** What a video not yet played is heard to do, as a press on its play mark starts it in place. */
const PLAYS_IN_PLACE = "Plays the video";

/** What Open in Safari is heard to do. */
const OPENS_IN_SAFARI = "Opens the video in Safari";

/** What opens a video the player cannot play where it plays. */
const OPEN_IN_SAFARI = "Open in Safari";

/** What a playable video is heard to do, as a video in Messages opens: the system's player full screen, whose controls VoiceOver reads there. */
const OPENS_FULL_SCREEN = "Opens the video full screen";

const styles = StyleSheet.create({
  frame: { width: "100%", borderRadius: RADIUS.BLOCK, overflow: "hidden" },
  unplayable: {
    alignItems: "center",
    justifyContent: "center",
    padding: SPACE.ROW,
    gap: SPACE.TIGHT,
  },
  spinner: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  playMark: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  // Note that at an accessibility size an unplayable well grows with its words rather than holding the film's shape, which would cut them off.
  grown: { aspectRatio: undefined, minHeight: 120, overflow: "visible" },
});

/** How long the player's video runs, in seconds, once its file is read; none before then, or for a stream with no end. */
function useVideoLength(player: VideoPlayer): number | undefined {
  // Note that a file the player read before this listens is taken as it stands, since its load has already gone by.
  const duration = useEvent(player, "sourceLoad")?.duration ?? player.duration;

  return duration > 0 ? duration : undefined;
}

/**
 * Whether the player has played the video it now plays, so a video stands
 * with its play mark until it is first played and leaves the system's
 * controls to it after. Note that the played source is kept rather than a
 * flag, since expo-video loads a new source into the same player, so a new
 * video in the same place stands its mark again.
 */
function usePlayedOnce(player: VideoPlayer, source: string): boolean {
  const [playedSource, setPlayedSource] = useState<string | undefined>(
    player.playing ? source : undefined,
  );

  useEventListener(player, "playingChange", ({ isPlaying }) => {
    if (isPlaying) setPlayedSource(source);
  });

  return playedSource === source;
}

/**
 * A video's play mark over its first frame until it is first played, as
 * Messages and Photos mark a video so it never reads as a picture: the play
 * glyph and how long it runs in the system's glass capsule, which starts it
 * in place where the system's own controls take over. iOS draws its glass
 * solid where the reader turned on Reduce Transparency.
 */
function PlayMark({
  label,
  runs,
  onPress,
}: {
  readonly label: string;
  /** How long the video runs, as a player says it ("0:12"); none where it isn't known. */
  readonly runs: string | undefined;
  readonly onPress: () => void;
}) {
  const colors = useColors();

  return (
    <View style={styles.playMark} pointerEvents="box-none">
      <InlineHost matchContents>
        <SwiftUIButton
          onPress={onPress}
          modifiers={[
            buttonStyle("glass"),
            SwiftModifiers.buttonBorderShape("capsule"),
            controlSize("large"),
            tint(colors.TEXT),
            accessibilityLabel(runs === undefined ? label : `${label}, ${runs}`),
            accessibilityHint(PLAYS_IN_PLACE),
          ]}
        >
          <HStack spacing={SPACE.TIGHT}>
            <Image {...glyphImage(GLYPH.RUN)} size={MARK_SIZE.GLYPH + 2} />
            {runs === undefined ? null : (
              <SwiftUIText
                modifiers={[
                  font({ textStyle: TYPE_ROLE.ROW_LINE, weight: "semibold" }),
                  monospacedDigit(),
                  lineLimit(1),
                ]}
              >
                {runs}
              </SwiftUIText>
            )}
          </HStack>
        </SwiftUIButton>
      </InlineHost>
    </View>
  );
}

type VideoProps = {
  /** The file the video plays from, such as one the thread wrote under the app's caches; none while its bytes are on their way, which stands its well alone, and `null` where they could not be read, which says so in its well. */
  readonly source: string | null | undefined;
  /** What the video is, its file's name, heard in its place. */
  readonly label: string;
  /** Opens the video where it plays, offered where the system's player cannot read it; none offers nothing. */
  readonly onOpenElsewhere?: (() => void) | undefined;
  /** A tile's fixed shape, width over height, as wide as its tile; the video's own shape and size, held to `MEDIA_BOUNDS`, where none is given. */
  readonly tileAspect?: number | undefined;
  /** Reads the video again where its bytes could not be read; none offers nothing. */
  readonly onRetry?: (() => void) | undefined;
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
export function Video({ source, label, onOpenElsewhere, tileAspect, onRetry }: VideoProps) {
  const colors = useColors();
  const large = useAccessibilitySize();
  const player = useVideoPlayer(source ?? null);
  const view = useRef<VideoView>(null);
  const { status } = useEvent(player, "statusChange", { status: player.status });
  // Note that a track the player read before this listens is taken as it stands, since its change has already gone by.
  const { videoTrack } = useEvent(player, "videoTrackChange", { videoTrack: player.videoTrack });
  const natural = videoTrack?.size;
  const failed = status === "error";
  const length = useVideoLength(player);
  const played = usePlayedOnce(player, source ?? "");

  // Note that a tile fills its tile at the tile's shape, and any other video stands at its own shape and size, held to the one rule every message's media keeps (`mediaFrame`) in its box (`MediaBox`).
  const frame = tileAspect === undefined ? mediaFrame(natural) : undefined;
  const tiled = { aspectRatio: tileAspect ?? frame?.aspectRatio };

  const acts = useKeptActs(
    source == null ? undefined : { kind: KEPT_KIND.VIDEO, source, name: label },
  );

  // Note that a video whose bytes could not be read says so in its well with Try again, as a picture does, rather than spin as one still on its way.
  if (source === null) {
    return (
      <MediaBox frame={frame}>
        <MediaFailed
          line={MEDIA_READ_WORDS.VIDEO_FAILED}
          heard={`${label} ${MEDIA_READ_WORDS.COULD_NOT_READ}`}
          onRetry={onRetry}
          style={[styles.frame, tiled]}
        />
      </MediaBox>
    );
  }

  if (source === undefined || failed) {
    // Note that a well offering Open in Safari stands as two elements to VoiceOver, its words and its link, since one element would hide the link.
    const offers = failed && onOpenElsewhere !== undefined;

    return (
      <MediaBox frame={frame}>
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
                style={{ fontSize: ROLE_SIZE.ROW_LINE, color: colors.TEXT_MUTED }}
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
                  style={{
                    fontSize: ROLE_SIZE.ROW_LINE,
                    fontWeight: "600",
                    color: colors.TEXT_BODY,
                  }}
                >
                  {OPEN_IN_SAFARI}
                </Text>
              </Press>
            ) : null}
          </View>
        </HeldMenu>
      </MediaBox>
    );
  }

  // Note that the player stands as one element, its name, which opens it full screen, as a video in Messages does, because the system's inline player nests a dozen views under it, and a thread's video in an iPad's split view stood past the depth XCTest can serialize (Foundation's "Too many nested arrays or dictionaries"), so no flow could read that screen.
  // Note that the frame is heard with the video's length while its play mark stands, since the frame is the one element and the mark inside it isn't heard on its own.
  const marked = status === "readyToPlay" && !played;
  const runs = length === undefined ? undefined : playheadText(length * 1000);

  return (
    <MediaBox frame={frame}>
      <HeldMenu acts={acts}>
        <View
          style={[styles.frame, tiled]}
          accessible
          accessibilityLabel={marked && runs !== undefined ? `${label}, ${runs}` : label}
          accessibilityHint={OPENS_FULL_SCREEN}
          onAccessibilityTap={() => void view.current?.enterFullscreen()}
          testID={status === "readyToPlay" ? VIDEO_PLAYER_ID : undefined}
        >
          <VideoView
            ref={view}
            player={player}
            // Note that the system's controls stand only once the video has played, so its own play button never shows under the play mark.
            nativeControls={played}
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
          {marked ? <PlayMark label={label} runs={runs} onPress={() => player.play()} /> : null}
        </View>
      </HeldMenu>
    </MediaBox>
  );
}
