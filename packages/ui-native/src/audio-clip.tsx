// audio-clip.tsx -- a sound clip a message carried, played through expo-video's player with no picture, as a strip at its message's width: play and pause, where it stands, and its time.

import { playheadText } from "@repo/features/time-format";
import { SymbolView } from "expo-symbols";
import { useVideoPlayer, type VideoPlayerStatus } from "expo-video";
import { useEffect, useState } from "react";
import {
  type AccessibilityActionEvent,
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useAccessibilitySize, useScaledSize } from "./accessibility.js";
import { GLYPH, glyphSymbol } from "./glyph.js";
import { HeldMenu, useKeptActs } from "./held-menu.js";
import { KEPT_KIND } from "./keep-model.js";
import { Press } from "./press.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, SPACE } from "./tokens/space.js";
import { TEXT_SIZE } from "./tokens/type.js";

/** What a clip says where the player cannot play it, such as an Ogg, which AVPlayer has no reader for. */
const CANNOT_PLAY = "This clip can't play here.";

/** What a clip's play and pause are called, aloud and in VoiceOver's actions. */
const PLAYBACK_WORD = { PLAY: "Play", PAUSE: "Pause" } as const;

/** What the strip stands as to a flow that drives the app, once the player has read the clip's file and can play it. */
const AUDIO_CLIP_ID = "audio-clip";

/** How often, in seconds, the player says where it stands while it plays, often enough that the bar moves smoothly under a short clip. */
const TIME_STEP_SECONDS = 0.25;

/** The playhead's time as `playheadText` takes it. */
const SECOND_MS = 1000;

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
  // Note that at an accessibility size the time stands under the bar rather than beside it, so the bar keeps its room and the time is never cut.
  stacked: { flexWrap: "wrap" },
  button: { alignItems: "center", justifyContent: "center", borderRadius: 999 },
  barPress: { flex: 1, minWidth: 80, height: BAR_PRESS_HEIGHT, justifyContent: "center" },
  bar: { height: BAR_HEIGHT, borderRadius: BAR_HEIGHT / 2, overflow: "hidden" },
  fill: { height: "100%" },
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
  /** The file the clip plays from, written under the app's caches by its type's extension; none while its bytes are on their way. */
  readonly source: string | undefined;
  /** What the clip is, its caption or its file's name, heard in its place. */
  readonly label: string;
};

/**
 * A sound clip, played in place by the system's own player (AVPlayer,
 * through expo-video, with no picture), as Messages plays a voice message: a
 * round play button that turns to pause while it plays, a bar of where it
 * stands that a press moves to, and its time as the panel's player says it
 * ("0:04 / 0:12"). A clip played to its end stands back at its start. Note
 * that one the player cannot read, such as an Ogg before the service keeps
 * its AAC copy, says so in its place rather than standing as a button that
 * never plays; and one whose bytes are on their way, or that the player
 * still reads, stands the system's spinner where its button will be. To
 * VoiceOver the strip is one element, its label, valued by its time, whose
 * activation and magic tap play and pause it, and whose actions name Play
 * or Pause. Its long press offers what `keep-model.ts` offers a clip.
 */
export function AudioClip({ source, label }: AudioClipProps) {
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
    source === undefined ? undefined : { kind: KEPT_KIND.SOUND, source, name: label },
  );

  const failed = playback.status === "error";
  const ready = source !== undefined && playback.status === "readyToPlay";
  const duration = playback.duration > 0 ? playback.duration : player.duration;
  const share = duration > 0 ? Math.min(1, playback.at / duration) : 0;
  const time = `${playheadText(playback.at * SECOND_MS)} / ${playheadText(duration * SECOND_MS)}`;
  const playWord = playback.playing ? PLAYBACK_WORD.PAUSE : PLAYBACK_WORD.PLAY;

  const toggle = () => {
    if (!ready) return;

    if (playback.playing) player.pause();
    else player.play();
  };

  // A press on the bar moves the clip to where it was pressed.
  const seek = (x: number) => {
    if (!ready || barWidth <= 0 || duration <= 0) return;
    const at = (Math.max(0, Math.min(x, barWidth)) / barWidth) * duration;
    player.currentTime = at;
    setPlayback((held) => ({ ...held, at }));
  };

  const heard = (event: AccessibilityActionEvent) => {
    const { actionName } = event.nativeEvent;

    if (actionName === "activate" || actionName === "magicTap" || actionName === playWord) {
      toggle();
    }
  };

  if (failed) {
    return (
      <HeldMenu acts={acts}>
        <View
          style={[styles.strip, styles.unplayable, { backgroundColor: colors.WELL }]}
          accessible
          accessibilityLabel={`${label}. ${CANNOT_PLAY}`}
        >
          <Text style={{ flexShrink: 1, fontSize: TEXT_SIZE.FOOTNOTE, color: colors.TEXT_MUTED }}>
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
        accessibilityLabel={label}
        accessibilityValue={{ text: ready ? time : undefined }}
        accessibilityState={{ busy: !ready }}
        accessibilityActions={
          ready
            ? [{ name: "activate" }, { name: "magicTap" }, { name: playWord, label: playWord }]
            : []
        }
        onAccessibilityAction={heard}
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
        <Press
          onPress={(event) => seek(event.nativeEvent.locationX)}
          onLayout={(event) => setBarWidth(event.nativeEvent.layout.width)}
          style={styles.barPress}
        >
          <View style={[styles.bar, { backgroundColor: colors.CHIP_EDGE }]}>
            <View
              style={[styles.fill, { width: `${share * 100}%`, backgroundColor: colors.TEXT }]}
            />
          </View>
        </Press>
        <Text
          style={{
            fontSize: TEXT_SIZE.CAPTION,
            color: colors.TEXT_MUTED,
            fontVariant: ["tabular-nums"],
          }}
        >
          {time}
        </Text>
      </View>
    </HeldMenu>
  );
}
