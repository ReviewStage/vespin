// audio-clip.tsx -- a sound clip a message carried, played through expo-video's player with no picture, as a strip at its message's width: play and pause, its time, and where it stands.

import { MEDIA_READ_WORDS } from "@repo/features/media-read-words";
import { playheadText } from "@repo/features/time-format";
import { SymbolView } from "expo-symbols";
import { useVideoPlayer, type VideoPlayerStatus } from "expo-video";
import { useEffect, useState } from "react";
import {
  type AccessibilityActionEvent,
  ActivityIndicator,
  Animated,
  Easing,
  StyleSheet,
  View,
} from "react-native";
import { useAccessibilitySize, useReduceMotion, useScaledSize } from "./accessibility.js";
import { GLYPH, glyphSymbol } from "./glyph.js";
import { HeldMenu, useKeptActs } from "./held-menu.js";
import { KEPT_KIND } from "./keep-model.js";
import { MediaFailed } from "./media-failed.js";
import { NativeText as Text } from "./native-text.js";
import { Press } from "./press.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, SPACE } from "./tokens/space.js";
import { ROLE_SIZE } from "./tokens/type.js";

/** What a clip says where the player cannot play it, such as an Ogg, which AVPlayer has no reader for. */
const CANNOT_PLAY = "This clip can't play here.";

/** What a clip's play and pause are called, aloud and in VoiceOver's actions. */
const PLAYBACK_WORD = { PLAY: "Play", PAUSE: "Pause" } as const;

/** What the strip stands as to a flow that drives the app, once the player has read the clip's file and can play it. */
const AUDIO_CLIP_ID = "audio-clip";

/** How far, in seconds, VoiceOver's swipe up or down moves a clip, as a podcast app's skip does. */
const SEEK_STEP_SECONDS = 5;

/** How often, in seconds, the player says where it stands while it plays, which the bar's glide is set back on (`useGlide`). */
const TIME_STEP_SECONDS = 0.25;

/** The playhead's time as `playheadText` takes it. */
const SECOND_MS = 1000;

/**
 * How far, in seconds, one glide runs the bar ahead of the player's last
 * report: past the next report, so the bar never stands waiting on a late
 * one, and no further, since each report starts the glide again and a
 * native timing animation lays out its every frame before it runs.
 */
const GLIDE_SECONDS = TIME_STEP_SECONDS * 2;

/** How tall the bar is drawn, and how tall the press around it stands, so a finger finds it. */
const BAR_HEIGHT = 4;
const BAR_PRESS_HEIGHT = 28;

/** The play button's round, at the standard size. */
const BUTTON_SIZE = 32;

const styles = StyleSheet.create({
  strip: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.ROW,
    paddingVertical: SPACE.TIGHT * 2,
    paddingHorizontal: SPACE.ROW,
    borderRadius: 8,
  },
  // Note that at an accessibility size the bar stands on a row of its own under the play button and the time, whatever the strip's width, so the bar keeps its room and the time is never cut.
  stacked: { flexWrap: "wrap" },
  stackedBar: { flexBasis: "100%" },
  button: { alignItems: "center", justifyContent: "center", borderRadius: 999 },
  barPress: { flex: 1, minWidth: 80, height: BAR_PRESS_HEIGHT, justifyContent: "center" },
  bar: { height: BAR_HEIGHT, borderRadius: BAR_HEIGHT / 2, overflow: "hidden" },
  // Note that the fill is scaled from its left edge rather than sized, because the native driver moves a transform alone.
  fill: { width: "100%", height: "100%", transformOrigin: "left" },
  unplayable: { justifyContent: "center", minHeight: BUTTON_SIZE + SPACE.TIGHT * 4 },
});

/** Where the player stands: what it reads, whether it plays, and where it is in seconds of how long. */
interface Playback {
  readonly status: VideoPlayerStatus;
  readonly playing: boolean;
  readonly at: number;
  readonly duration: number;
}

type AudioClipProps = {
  /** The file the clip plays from, written under the app's caches by its type's extension; none while its bytes are on their way, and `null` where they could not be read. */
  readonly source: string | null | undefined;
  /** What the clip is, its caption or its file's name, heard in its place. */
  readonly label: string;
  /** Reads a clip whose bytes could not be read again; none offers nothing. */
  readonly onRetry?: (() => void) | undefined;
};

/**
 * The bar's fill, as a share of the clip, gliding between the player's
 * reports of where it stands, which come a quarter second apart: while the
 * clip plays, the fill runs on the native driver at the clip's own pace a
 * little past where the next report will set it (`GLIDE_SECONDS`), so it
 * moves on every frame the screen draws, and each report sets it back where
 * the clip stands, so it never drifts from the player. Paused, ended, or
 * sought, it stands where the clip does, and where the reader reduces motion
 * it steps with each report rather than gliding.
 */
function useGlide(at: number, duration: number, playing: boolean): Animated.Value {
  const share = duration > 0 ? Math.min(1, at / duration) : 0;
  const [glide] = useState(() => new Animated.Value(share));
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    glide.setValue(share);
    const seconds = Math.min(GLIDE_SECONDS, duration - at);

    if (!playing || reduceMotion || seconds <= 0) return;

    const run = Animated.timing(glide, {
      toValue: share + seconds / duration,
      duration: seconds * SECOND_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    });

    run.start();

    return () => run.stop();
  }, [glide, share, at, duration, playing, reduceMotion]);

  return glide;
}

/**
 * A sound clip, played in place by the system's own player (AVPlayer,
 * through expo-video, with no picture), as Messages plays a voice message: a
 * round play button that turns to pause while it plays, its time beside it
 * as the panel's player says it ("0:04 / 0:12"), as a video's bar stands it,
 * and a bar of where it stands that a press moves to. A clip played to its end stands back at its start. Note
 * that one the player cannot read, such as an Ogg before the service keeps
 * its AAC copy, says so in its place rather than standing as a button that
 * never plays; and one whose bytes are on their way, or that the player
 * still reads, stands the system's spinner where its button will be; one
whose bytes could not be read says so with Try again, as a picture does. To
 * VoiceOver the strip is one adjustable element, its label, valued by its
 * time: a double tap or the magic tap plays and pauses it, a swipe up or down
 * moves it five seconds on or back, and its actions name Play or Pause. Its
 * long press offers what `keep-model.ts` offers a clip.
 */
export function AudioClip({ source, label, onRetry }: AudioClipProps) {
  const colors = useColors();
  const large = useAccessibilitySize();
  const buttonSize = useScaledSize(BUTTON_SIZE);
  const glyphSize = useScaledSize(MARK_SIZE.GLYPH);
  const [barWidth, setBarWidth] = useState(0);

  const player = useVideoPlayer(source ?? null, (made) => {
    made.timeUpdateEventInterval = TIME_STEP_SECONDS;
  });

  const [playback, setPlayback] = useState<Playback>({
    status: player.status,
    playing: player.playing,
    at: 0,
    duration: 0,
  });

  useEffect(() => {
    setPlayback({ status: player.status, playing: player.playing, at: 0, duration: 0 });
    const step = (next: Partial<Playback>) => setPlayback((held) => ({ ...held, ...next }));

    const listening = [
      player.addListener("statusChange", ({ status }) => step({ status })),
      player.addListener("sourceLoad", ({ duration }) => step({ duration })),
      player.addListener("playingChange", ({ isPlaying }) => step({ playing: isPlaying })),
      player.addListener("timeUpdate", ({ currentTime }) => step({ at: currentTime })),
      // A clip played to its end stands back at its start, so a press plays it again.
      player.addListener("playToEnd", () => {
        player.currentTime = 0;
        step({ at: 0 });
      }),
    ];

    return () => {
      for (const each of listening) each.remove();
    };
  }, [player]);

  const acts = useKeptActs(
    source == null ? undefined : { kind: KEPT_KIND.SOUND, source, name: label },
  );

  const failed = playback.status === "error";
  const ready = source != null && playback.status === "readyToPlay";
  const duration = playback.duration > 0 ? playback.duration : player.duration;
  const glide = useGlide(playback.at, duration, playback.playing);
  const time = `${playheadText(playback.at * SECOND_MS)} / ${playheadText(duration * SECOND_MS)}`;
  const playWord = playback.playing ? PLAYBACK_WORD.PAUSE : PLAYBACK_WORD.PLAY;

  const toggle = () => {
    if (!ready) return;

    if (playback.playing) player.pause();
    else player.play();
  };

  // The clip moved to `seconds` in, held inside its length.
  const seekTo = (seconds: number) => {
    if (!ready || duration <= 0) return;
    const at = Math.max(0, Math.min(seconds, duration));
    player.currentTime = at;
    setPlayback((held) => ({ ...held, at }));
  };

  // A press on the bar moves the clip to where it was pressed.
  const seekAt = (x: number) => {
    if (barWidth > 0) seekTo((Math.max(0, Math.min(x, barWidth)) / barWidth) * duration);
  };

  // Note that a double tap and the magic tap reach `onAccessibilityTap` and `onMagicTap` alone, since React Native's iOS view lists every named action as a custom one; a swipe up or down reaches here as increment or decrement.
  const heard = (event: AccessibilityActionEvent) => {
    const { actionName } = event.nativeEvent;

    if (actionName === playWord) toggle();
    else if (actionName === "increment") seekTo(playback.at + SEEK_STEP_SECONDS);
    else if (actionName === "decrement") seekTo(playback.at - SEEK_STEP_SECONDS);
  };

  // Note that a clip whose bytes could not be read says so in the strip's place with Try again, rather than spin as one still on its way.
  if (source === null) {
    return (
      <MediaFailed
        line={MEDIA_READ_WORDS.AUDIO_FAILED}
        heard={`${label} ${MEDIA_READ_WORDS.COULD_NOT_READ}`}
        onRetry={onRetry}
        style={styles.strip}
      />
    );
  }

  if (failed) {
    return (
      <HeldMenu acts={acts}>
        <View
          style={[styles.strip, styles.unplayable, { backgroundColor: colors.WELL }]}
          accessible
          accessibilityLabel={`${label}. ${CANNOT_PLAY}`}
        >
          <Text
            style={{
              flexShrink: 1,
              fontSize: ROLE_SIZE.ROW_LINE,
              color: colors.TEXT_MUTED,
            }}
          >
            {CANNOT_PLAY}
          </Text>
        </View>
      </HeldMenu>
    );
  }

  return (
    <HeldMenu acts={acts}>
      <View
        style={[styles.strip, large ? styles.stacked : null, { backgroundColor: colors.WELL }]}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ text: ready ? time : undefined }}
        accessibilityState={{ busy: !ready }}
        accessibilityActions={ready ? [{ name: playWord, label: playWord }] : []}
        onAccessibilityAction={heard}
        onAccessibilityTap={toggle}
        onMagicTap={toggle}
        testID={ready ? AUDIO_CLIP_ID : undefined}
      >
        <View style={[styles.button, { width: buttonSize, height: buttonSize }]}>
          {ready ? (
            <Press
              onPress={toggle}
              hitSlop={SPACE.TIGHT}
              style={[
                styles.button,
                { width: buttonSize, height: buttonSize, backgroundColor: colors.SURFACE },
              ]}
            >
              <SymbolView
                name={glyphSymbol(playback.playing ? GLYPH.PAUSE : GLYPH.PLAY)}
                size={glyphSize}
                tintColor={colors.TEXT}
              />
            </Press>
          ) : (
            <ActivityIndicator color={colors.TEXT_MUTED} />
          )}
        </View>
        <Text
          style={{
            fontSize: ROLE_SIZE.TIME,
            color: colors.TEXT_MUTED,
            fontVariant: ["tabular-nums"],
          }}
        >
          {time}
        </Text>
        <Press
          onPress={(event) => seekAt(event.nativeEvent.locationX)}
          onLayout={(event) => setBarWidth(event.nativeEvent.layout.width)}
          style={[styles.barPress, large ? styles.stackedBar : null]}
        >
          <View style={[styles.bar, { backgroundColor: colors.CHIP_EDGE }]}>
            <Animated.View
              style={[
                styles.fill,
                { backgroundColor: colors.TEXT, transform: [{ scaleX: glide }] },
              ]}
            />
          </View>
        </Press>
      </View>
    </HeldMenu>
  );
}
