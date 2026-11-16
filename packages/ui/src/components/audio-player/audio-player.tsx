import { isAudioType } from "@repo/features/conversation-picture-wire";
import { playheadText } from "@repo/features/time-format";
import { useEffect, useId, useRef, useState } from "react";
import { ExpandIcon, PauseIcon, PlayIcon } from "../../icons/lucide-glyphs.js";
import { useMediaPlace } from "../../media-place.js";
import { motionHeld } from "../../motion-timing.js";
import { notePictureOrigin } from "../../picture-expand.js";
import { usePlayingFrames } from "../../playing-frames.js";
import { WAVEFORM_FLOOR, waveformPeaks } from "../../waveform.js";
import { BUTTON_CORNERS, BUTTON_VARIANT, ICON_BUTTON_SIZE, IconButton } from "../button/button.js";
import { CARD_CORNER, CARD_ELEMENT, CARD_PADDING, Card } from "../card/card.js";
import {
  MEDIA_PILL,
  MEDIA_SPEEDS,
  mediaKey,
  NORMAL_SPEED,
  nextSpeed,
  SpeedButton,
  setSpeed,
  toggleOf,
} from "../media-controls/media-controls.js";
import { SLIDER_LENGTH, SLIDER_LOOK, Slider } from "../slider/slider.js";
import { Tooltip } from "../tooltip/hint.js";
import { dataUrlBytes, dataUrlMediaType, useBlobUrl } from "../video-player/video-player.js";

/**
 * audio-player.tsx -- a sound clip an agent made, played where a picture of it would be drawn, in its transcript, its inbox item, and a description, and in the file viewer an Expand opens.
 *
 * A clip is drawn as its waveform, the loudness of each stretch of it as a
 * bar (`../../waveform.ts`), read from its samples once the browser has
 * decoded them, a flat line standing in until then and for good where the
 * browser cannot decode it. The waveform is the scrubber: its bars up to
 * where the clip stands are in the words' ink and the rest muted, with no
 * dot over them, as a voice message's waveform stands, and a bare slider
 * over it (`SLIDER_LOOK.BARE`) takes a press or a drag anywhere along it to
 * seek there and the slider's own keys to step it; the keyboard's ring
 * stands around the waveform while the slider holds the focus
 * (`audio-player.css`). While a pointer is over the waveform, where the
 * device hovers, a thin line stands at the pointer with the time a press
 * there would go to in the window's hint pill beside it, as SoundCloud draws
 * it; it is decoration, hidden from a reader, and lets the press through to
 * the slider under it. Before the waveform stands Play, a round disc in the
 * text's ink, larger than the controls beside it, as a voice message's Play
 * is the one press it exists for; after it, how far it has run of how long,
 * its speed in the time's muted ink, which a press walks round a voice
 * message's 1×, 1.5×, and 2×,
 * and Expand where the place has a viewer to open. There is no volume
 * control and no mute: the system's volume is the one a reader already
 * reaches for, as for a recording's sound (`../video-player/`).
 *
 * While focus is in the player its keys are a video's
 * (`../media-controls/`): Space or K plays or pauses, the left and right
 * arrows seek five seconds, Home and End go to the start and the end, and
 * < and > step the speed, each kept from the place around it, such as the
 * viewer whose arrows walk its files; a button's own Space presses the
 * button.
 *
 * Where a picture would be drawn, it plays in place (`INLINE`) in a card a
 * picture's stand-in wide, at most its column's width. A place that has a
 * viewer to open hands `onExpand`: Expand pauses it here and opens the
 * viewer, which grows from the card as it grows from a picture's tile. In
 * the viewer (`VIEWER`) it uses the room as Quick Look does: its waveform
 * tall across the place, Play centered under it with the time on one side
 * and the speed on the other, and no Expand; and it plays at once, unless motion is held still
 * (`motionHeld`: reduced motion or a capture run), where it waits for Play.
 * A clip keeps its place wherever it is drawn, as a recording does
 * (`useMediaPlace`): the viewer an Expand opens goes on from where the card
 * left it, and the card, played again once the viewer closes, from where
 * the viewer did.
 *
 * The bytes arrive as a picture's do, as a `data:` URL, and play from a
 * `blob:` address made of them (`useBlobUrl`), since neither window's
 * content policy lets media load from a `data:` address.
 *
 * It is drawn in Tailwind utilities over the theme, its inline frame a
 * `Card` and its controls `@repo/ui`'s own; shadcn/ui has no player.
 */

/** What the player and its controls are named for a reader. */
const AUDIO_LABEL = {
  CLIP: "Sound clip",
  PLAYER: "Sound clip player",
  PLAY: "Play",
  PAUSE: "Pause",
  SEEK: "Seek",
  EXPAND: "Expand",
} as const;

/** How many bars a waveform is drawn in, whatever its width, each stretching to its share of it. */
const BARS = 96;

/** Each bar's width and its pitch, the gap after it, in the waveform's own units, which stretch with it. */
const BAR = { WIDTH: 2, PITCH: 3 } as const;

/** The waveform's height in its own units: a bar at the loudest stands this tall. */
const WAVEFORM_HEIGHT = 100;

/** The milliseconds in a second, for the playhead in the one clock a clip is told in. */
const MS_PER_SECOND = 1_000;

/** The rate a clip is decoded at for its waveform, which only its loudness is read from. */
const DECODE_RATE = 44_100;

/** How many clips' waveforms are kept, the latest drawn; past it the oldest is let go, since each is keyed by its whole `data:` URL. */
const WAVEFORMS_KEPT = 16;

/** A waveform with nothing read into it: every bar at the floor, a line. */
const FLAT: readonly number[] = Array.from({ length: BARS }, () => WAVEFORM_FLOOR);

/** Where a clip plays: in place of a picture, or in the file viewer. */
export const AUDIO_PLAYER_PLACE = {
  INLINE: "inline",
  VIEWER: "viewer",
} as const;

export type AudioPlayerPlace = (typeof AUDIO_PLAYER_PLACE)[keyof typeof AUDIO_PLAYER_PLACE];

/** Where a clip stands in its run, as the player draws it. */
interface Playback {
  readonly playing: boolean;
  readonly at: number;
  readonly duration: number;
  readonly speed: number;
}

/** Each clip's waveform, by its `data:` URL, the latest drawn last. */
const waveforms = new Map<string, readonly number[]>();

/** Keeps `dataUrl`'s waveform, letting the oldest go past `WAVEFORMS_KEPT`. */
function keepWaveform(dataUrl: string, peaks: readonly number[]): void {
  waveforms.delete(dataUrl);
  waveforms.set(dataUrl, peaks);
  const oldest = waveforms.keys().next().value;

  if (waveforms.size > WAVEFORMS_KEPT && oldest !== undefined) waveforms.delete(oldest);
}

/** Whether a `data:` URL a picture read answered holds a sound clip, played rather than drawn. */
export function isAudioDataUrl(dataUrl: string): boolean {
  return isAudioType(dataUrlMediaType(dataUrl));
}

/** The clip's waveform, decoded from its samples. */
async function decodedWaveform(dataUrl: string): Promise<readonly number[]> {
  const decoder = new OfflineAudioContext({
    numberOfChannels: 1,
    length: 1,
    sampleRate: DECODE_RATE,
  });

  const decoded = await decoder.decodeAudioData(dataUrlBytes(dataUrl).buffer);

  const channels = Array.from({ length: decoded.numberOfChannels }, (_, channel) =>
    decoded.getChannelData(channel),
  );

  return waveformPeaks(channels, BARS);
}

/**
 * The clip's waveform once its samples are decoded, kept for the next player
 * that draws it; nothing while they are, and a flat line where the browser
 * decodes none.
 */
function useWaveform(dataUrl: string): readonly number[] | undefined {
  const [read, setRead] = useState(() => waveforms.get(dataUrl));
  useEffect(() => {
    const kept = waveforms.get(dataUrl);
    let current = true;
    setRead(kept);

    if (kept !== undefined) return;

    if (typeof OfflineAudioContext === "undefined") {
      setRead(FLAT);

      return;
    }

    decodedWaveform(dataUrl)
      .then((peaks) => {
        keepWaveform(dataUrl, peaks);

        if (current) setRead(peaks);
      })
      .catch(() => {
        if (current) setRead(FLAT);
      });

    return () => {
      current = false;
    };
  }, [dataUrl]);

  return read;
}

/** One of the player's quiet buttons, its name its hint. */
function PlayerButton({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: React.ReactNode;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Tooltip label={label}>
      <IconButton icon={icon} label={label} variant={BUTTON_VARIANT.QUIET} onClick={onPress} />
    </Tooltip>
  );
}

/** Play, or Pause while it plays: the player's one large press, a round disc in the text's ink, its name its hint. */
function PlayButton({
  playing,
  onPress,
}: {
  playing: boolean;
  onPress: () => void;
}): React.JSX.Element {
  const label = playing ? AUDIO_LABEL.PAUSE : AUDIO_LABEL.PLAY;

  return (
    <Tooltip label={label}>
      <IconButton
        icon={playing ? <PauseIcon /> : <PlayIcon />}
        label={label}
        variant={BUTTON_VARIANT.INK}
        corners={BUTTON_CORNERS.ROUND}
        size={ICON_BUTTON_SIZE.LARGE}
        onClick={onPress}
      />
    </Tooltip>
  );
}

/** The time a clip told in minutes and seconds: "0:04". */
function clipTime(seconds: number): string {
  return playheadText(seconds * MS_PER_SECOND);
}

/**
 * The line over the waveform at `at` (a share of its width), in the accent
 * so it reads over played and unplayed bars alike, and the time a
 * press there would go to, in the hint pill beside it, on the side with
 * room: after the line in the waveform's first half, before it in its
 * second. Only where the device hovers; a touch screen draws none. It is
 * hidden from a reader and lets a press through to the slider under it.
 */
function HoverTime({ at, duration }: { at: number; duration: number }): React.JSX.Element {
  const side = at < 0.5 ? "left-ui-4" : "right-ui-4";

  return (
    <span
      className="ui-audio-player-hover pointer-events-none absolute inset-y-0 hidden [@media(hover:hover)]:block"
      style={{ left: `${String(at * 100)}%` }}
      aria-hidden="true"
    >
      <span className="absolute inset-y-0 left-0 w-px -translate-x-1/2 bg-accent-fill" />
      <span className={`absolute top-1/2 -translate-y-1/2 ${side} ${MEDIA_PILL}`}>
        {clipTime(at * duration)}
      </span>
    </span>
  );
}

/**
 * The clip's waveform, its bars up to `played` (a share of its length) in
 * the words' ink, cut exactly there, and the rest muted, stretched to the
 * room it stands in;
 * a flat line while its samples are read. It is hidden from a reader, since
 * the slider over it says where the clip stands.
 */
function Waveform({
  peaks,
  played,
}: {
  peaks: readonly number[] | undefined;
  played: number;
}): React.JSX.Element {
  const shown = peaks ?? FLAT;
  const reach = useId();
  const width = shown.length * BAR.PITCH;

  const bars = shown.map((peak, at) => {
    const height = peak * WAVEFORM_HEIGHT;

    return (
      <rect
        // Note that a bar's place is its identity: a waveform never reorders.
        key={at}
        x={at * BAR.PITCH}
        y={(WAVEFORM_HEIGHT - height) / 2}
        width={BAR.WIDTH}
        height={height}
      />
    );
  });

  return (
    <svg
      className="ui-audio-player-waveform block size-full"
      viewBox={`0 0 ${String(width)} ${String(WAVEFORM_HEIGHT)}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <clipPath id={reach}>
        <rect x={0} y={0} width={played * width} height={WAVEFORM_HEIGHT} />
      </clipPath>
      <g className="fill-border-strong">{bars}</g>
      {/* Note that the played bars are the same bars cut at where the clip stands, so the ink runs on through a bar rather than lighting it whole. */}
      <g className="fill-foreground" clipPath={`url(#${reach})`}>
        {bars}
      </g>
    </svg>
  );
}

/** A sound clip played in place of a picture or in the viewer: Play, its waveform as the scrubber, its time, its speed, and Expand. */
export function AudioPlayer({
  dataUrl,
  label,
  place = AUDIO_PLAYER_PLACE.INLINE,
  onExpand,
}: {
  dataUrl: string;
  /** What the clip is, in words: its caption, its alt text, or its file's name; empty where it has none. */
  label: string;
  /** Where it plays, which sets how large it stands and whether it starts at once. */
  place?: AudioPlayerPlace | undefined;
  /** Opens the clip in the viewer; without one, and in the viewer itself, the player offers no Expand. */
  onExpand?: (() => void) | undefined;
}): React.JSX.Element {
  const url = useBlobUrl(dataUrl);
  const peaks = useWaveform(dataUrl);
  const audio = useRef<HTMLAudioElement>(null);
  const frame = useRef<HTMLSpanElement>(null);

  const [playback, setPlayback] = useState<Playback>({
    playing: false,
    at: 0,
    duration: 0,
    speed: NORMAL_SPEED,
  });

  // Where the pointer stands over the waveform, a share of its width, while it hovers there.
  const [hover, setHover] = useState<number>();
  const viewer = place === AUDIO_PLAYER_PLACE.VIEWER;
  // Note that whether it starts is read once, as it mounts, because a clip hears autoplay only then.
  const [starts] = useState(() => viewer && !motionHeld());
  const kept = useMediaPlace(dataUrl);

  // Note that a read keeps the place unless `moved` says it moved nothing, as a change of speed, which must not claim another player's place.
  const read = (shown: HTMLAudioElement, moved = true) => {
    const duration = Number.isFinite(shown.duration) ? shown.duration : 0;

    setPlayback({
      playing: !shown.paused,
      at: Math.min(shown.currentTime, duration),
      duration,
      speed: shown.playbackRate,
    });

    if (moved) kept.keep(shown);
  };

  // Once its length is known, the clip goes to where it was left, or its start.
  const resume = (shown: HTMLAudioElement) => {
    kept.resume(shown);
    read(shown);
  };

  // While it plays, its place is read on every frame, so the scrubber and the waveform's played bars glide rather than step at each `timeupdate`.
  usePlayingFrames(playback.playing, () => {
    if (audio.current !== null) read(audio.current);
  });

  const time = `${clipTime(playback.at)} / ${clipTime(playback.duration)}`;
  const played = playback.duration === 0 ? 0 : playback.at / playback.duration;

  const expand =
    onExpand === undefined || viewer
      ? undefined
      : () => {
          audio.current?.pause();

          if (frame.current !== null) notePictureOrigin(frame.current);
          onExpand();
        };

  // A pointer over the waveform says where a press would go; a finger, which hovers nothing, says nothing.
  const follow = (event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType === "touch") return;
    const box = event.currentTarget.getBoundingClientRect();
    setHover(
      box.width === 0
        ? undefined
        : Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
    );
  };

  const play = <PlayButton playing={playback.playing} onPress={() => toggleOf(audio.current)} />;

  const speed = (
    <SpeedButton
      speed={playback.speed}
      variant={BUTTON_VARIANT.SUBTLE}
      onPress={() => setSpeed(audio.current, nextSpeed(MEDIA_SPEEDS.CLIP, playback.speed))}
    />
  );

  const shownTime = (
    <span className="ui-audio-player-time flex-none text-caption text-muted-foreground tabular-nums">
      {time}
    </span>
  );

  const scrubber = (
    <span
      className={`ui-audio-player-scrubber relative block min-w-0 ${viewer ? "h-audio-player-viewer w-full" : "h-ui-32 flex-1"}`}
      onPointerMove={follow}
      onPointerLeave={() => setHover(undefined)}
    >
      <Waveform peaks={peaks} played={played} />
      <Slider
        label={AUDIO_LABEL.SEEK}
        value={playback.at}
        max={playback.duration}
        step={0.1}
        length={SLIDER_LENGTH.FILL}
        look={SLIDER_LOOK.BARE}
        valueText={time}
        onChange={(at) => {
          if (audio.current !== null) audio.current.currentTime = at;
        }}
      />
      {hover === undefined || playback.duration === 0 ? null : (
        <HoverTime at={hover} duration={playback.duration} />
      )}
    </span>
  );

  const player = (
    // biome-ignore lint/a11y/useSemanticElements: a player holds a clip and its controls, not a form's controls, so it is no `<fieldset>`.
    <span
      ref={frame}
      // Note that the card's inset is the video bar's, so Play and Expand stand as far from its edge as a video's do.
      className={`ui-audio-player-frame flex w-full focus:outline-none ${viewer ? "flex-col gap-ui-16" : "items-center gap-ui-8 p-ui-6"}`}
      data-playing={playback.playing}
      tabIndex={-1}
      role="group"
      aria-label={label === "" ? AUDIO_LABEL.PLAYER : `${AUDIO_LABEL.CLIP}: ${label}`}
      // Note that the player hears a key before the control it lands on, because the scrubber steps on an arrow itself.
      onKeyDownCapture={(event) => mediaKey(event, audio.current, MEDIA_SPEEDS.CLIP)}
    >
      {/* Note that the clip carries no captions track, because no maker of an agent's clips writes one. */}
      {/* biome-ignore lint/a11y/useMediaCaption: an agent's sound clip has no captions to carry. */}
      <audio
        ref={audio}
        src={url}
        autoPlay={starts}
        preload={viewer ? "auto" : "metadata"}
        onLoadedMetadata={(event) => {
          // A new address is a new clip, whose place is taken up afresh.
          kept.forget();
          resume(event.currentTarget);
        }}
        onDurationChange={(event) => resume(event.currentTarget)}
        onTimeUpdate={(event) => read(event.currentTarget)}
        onPlay={(event) => {
          // Played again after another player moved the same clip, it goes on from there.
          kept.rejoin(event.currentTarget);
          read(event.currentTarget);
        }}
        onPause={(event) => read(event.currentTarget)}
        onEnded={(event) => read(event.currentTarget)}
        onRateChange={(event) => read(event.currentTarget, false)}
        // A new address resets the old one's time before its own loads, which is no place of the old clip's.
        onEmptied={kept.forget}
      />
      {viewer ? (
        <>
          {scrubber}
          {/* The time and the speed stand beside Play in columns of one width either side, so Play stands at the waveform's middle. */}
          <span className="ui-audio-player-controls grid w-full grid-cols-[1fr_auto_1fr] items-center gap-ui-16">
            <span className="flex justify-self-end">{shownTime}</span>
            {play}
            <span className="flex justify-self-start">{speed}</span>
          </span>
        </>
      ) : (
        <>
          {play}
          {scrubber}
          {shownTime}
          {speed}
          {expand === undefined ? null : (
            <PlayerButton label={AUDIO_LABEL.EXPAND} icon={<ExpandIcon />} onPress={expand} />
          )}
        </>
      )}
    </span>
  );

  // In the viewer the card around it is the viewer's own.
  if (viewer) {
    return (
      <span className="ui-audio-player block w-full" data-place={place}>
        {player}
      </span>
    );
  }

  return (
    <Card
      as={CARD_ELEMENT.SPAN}
      corner={CARD_CORNER.CONTROL}
      padding={CARD_PADDING.NONE}
      className="ui-audio-player block w-audio-player max-w-full"
      data-place={place}
    >
      {player}
    </Card>
  );
}
