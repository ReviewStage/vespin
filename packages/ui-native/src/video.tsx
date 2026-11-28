// video.tsx -- a video a message carried, played in iOS's own player through expo-video, at its own shape held to the media's one rule, or saying so where its bytes did not land.

import { MEDIA_READ_WORDS } from "@repo/features/media-read-words";
import { playheadText } from "@repo/features/time-format";
import { Predicate } from "effect";
import { useEvent } from "expo";
import { SymbolView } from "expo-symbols";
import { useVideoPlayer, type VideoPlayer, type VideoSource, VideoView } from "expo-video";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useAccessibilitySize } from "./accessibility.js";
import { GLYPH, glyphSymbol } from "./glyph.js";
import { HeldMenu, useKeptActs } from "./held-menu.js";
import { KEPT_KIND } from "./keep-model.js";
import { MediaBox } from "./media-box.js";
import { MediaFailed } from "./media-failed.js";
import { mediaFrame } from "./media-frame.js";
import { NativeText as Text } from "./native-text.js";
import {
  type PictureRef,
  type PictureSource,
  usePictureEvents,
  usePictureRef,
} from "./picture-source.js";
import { Press } from "./press.js";
import { BRAND_COLOR } from "./tokens/brand-colors.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, RADIUS, SPACE } from "./tokens/space.js";
import { ROLE_SIZE } from "./tokens/type.js";

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
  frame: { width: "100%", borderRadius: RADIUS.BLOCK, overflow: "hidden" },
  unplayable: {
    alignItems: "center",
    justifyContent: "center",
    padding: SPACE.ROW,
    gap: SPACE.TIGHT,
  },
  playMark: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
  },
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
 * What the system's player reads a video from: a file of the app's, or an
 * address with the header its read carries, which expo-video keeps on disk
 * as it plays (`useCaching`), so a recording played once plays again with no
 * read; none while its bytes are on their way.
 */
function playerSource(source: PictureSource | null | undefined): VideoSource {
  if (source == null) return null;

  if (Predicate.isString(source)) return source;

  return { uri: source.uri, headers: { ...source.headers }, useCaching: true };
}

/**
 * Tells the page a recording the player could not read from the service's
 * address, once for each address, so the page asks for it once more under
 * a renewed header, as a picture's loader does; one that fails again stands
 * as one the player cannot play.
 */
function useRefusedOnce(source: PictureSource | null | undefined, failed: boolean): void {
  const events = usePictureEvents();
  const told = useRef<string | undefined>(undefined);
  const address = source == null || Predicate.isString(source) ? undefined : source.uri;

  useEffect(() => {
    if (!failed || address === undefined || told.current === address) return;
    told.current = address;
    events?.failed(address);
  }, [address, events, failed]);
}

type VideoProps = {
  /** What the video plays from: a file, such as one the thread wrote under the app's caches, or the service's address with the header its read carries, or one kept by its id that it reads where it is drawn (`PictureByIdProvider`); none while its bytes are on their way, which stands its well alone, and `null` where they could not be read, which says so in its well. */
  readonly source: PictureRef | null | undefined;
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
 * A video in the system's own player, standing paused on its first frame
 * with the system's own controls over it from the start, its play button,
 * scrubber, full screen, and Picture in Picture, as a message's video stands
 * in Messages and Photos; no mark or control of ours stands over it. Note
 * that one the player cannot read, such as the WebM an agent's browser
 * records, says so in its place and offers where it plays, rather than
 * standing as a player that never starts; and one whose bytes are not yet
 * at hand stands the system's spinner in its well, so it never reads as an
 * empty box, while one the player still reads shows the player's own wait. To VoiceOver, a player that can play is one element, the
 * video's name, which opens the system's player full screen, where its
 * controls are read, as a video in Messages is.
 */
export function Video({ source: ref, label, onOpenElsewhere, tileAspect, onRetry }: VideoProps) {
  const colors = useColors();
  const large = useAccessibilitySize();
  const source = usePictureRef(ref);
  const player = useVideoPlayer(playerSource(source));
  const view = useRef<VideoView>(null);
  const [full, setFull] = useState(false);
  const floating = useRef(false);
  const { status } = useEvent(player, "statusChange", { status: player.status });
  // Note that a track the player read before this listens is taken as it stands, since its change has already gone by.
  const { videoTrack } = useEvent(player, "videoTrackChange", { videoTrack: player.videoTrack });
  const natural = videoTrack?.size;
  const failed = status === "error";
  useRefusedOnce(source, failed);
  const length = useVideoLength(player);

  // Note that a tile fills its tile at the tile's shape, and any other video stands at its own shape and size, held to the one rule every message's media keeps (`mediaFrame`) in its box (`MediaBox`).
  const frame = tileAspect === undefined ? mediaFrame(natural) : undefined;
  const tiled = { aspectRatio: tileAspect ?? frame?.aspectRatio };

  // Note that one the player can play is offered to Photos, as an MP4 is, and one it cannot, such as a WebM, only shared.
  const acts = useKeptActs(
    source == null
      ? undefined
      : { kind: KEPT_KIND.VIDEO, source, name: label, plays: status === "readyToPlay" },
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
                style={{
                  fontSize: ROLE_SIZE.ROW_LINE,
                  color: colors.TEXT_MUTED,
                }}
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
  // Note that a video stands in its message as its still first frame under the system's play mark, and a tap opens it in the system's own player full screen with every control there, play, the scrubber, and Picture in Picture, as Messages opens one (the developer, Nov 26, 2026), because at a message's width the system's inline controls leave full screen and Picture in Picture out of their bar. The controls stand only while it is full screen, since inline they would take the tap.
  const runs = length === undefined ? undefined : playheadText(length * 1000);
  const open = () => void view.current?.enterFullscreen();

  // Note that the video pauses as full screen closes, so its still stands again under its mark rather than playing on behind it, as Messages leaves one; but not where it closed into Picture in Picture, which closes full screen too and plays on in its window.
  const closeFullScreen = () => {
    if (!floating.current) player.pause();
    setFull(false);
  };

  // Note that Picture in Picture may start after full screen's close paused it, the two events reaching here in either order, so its start plays the video on in its window.
  const startFloating = () => {
    floating.current = true;
    player.play();
  };

  return (
    <MediaBox frame={frame}>
      <HeldMenu acts={acts}>
        <Press onPress={open} accessible={false}>
          <View
            style={[styles.frame, tiled]}
            accessible
            accessibilityLabel={runs === undefined ? label : `${label}, ${runs}`}
            accessibilityHint={OPENS_FULL_SCREEN}
            onAccessibilityTap={open}
            testID={status === "readyToPlay" ? VIDEO_PLAYER_ID : undefined}
          >
            <VideoView
              ref={view}
              player={player}
              nativeControls={full}
              onFullscreenEnter={() => setFull(true)}
              onFullscreenExit={closeFullScreen}
              onPictureInPictureStart={startFloating}
              onPictureInPictureStop={() => {
                floating.current = false;
              }}
              contentFit="contain"
              fullscreenOptions={{ enable: true }}
              allowsPictureInPicture
              style={[StyleSheet.absoluteFill, { backgroundColor: colors.WELL }]}
            />
            {/* Note that the mark stands in white in either theme, as the system's stands over a video, since it is drawn over the video's frame, never the page. */}
            <View style={styles.playMark} pointerEvents="none">
              <SymbolView
                name={glyphSymbol(GLYPH.VIDEO_PLAY)}
                size={MARK_SIZE.VIDEO_PLAY}
                tintColor={BRAND_COLOR.LIGHT.ON_ACCENT}
              />
            </View>
          </View>
        </Press>
      </HeldMenu>
    </MediaBox>
  );
}
