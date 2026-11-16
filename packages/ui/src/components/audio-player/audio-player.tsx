import { isAudioType } from "@repo/features/conversation-picture-wire";
import { playheadText } from "@repo/features/time-format";
import { useEffect, useId, useRef, useState } from "react";
import { ExpandIcon, PauseIcon, PlayIcon } from "../../icons/lucide-glyphs.js";
import { motionHeld } from "../../motion-timing.js";
import { notePictureOrigin } from "../../picture-expand.js";
import { usePlayingFrames } from "../../playing-frames.js";
import { WAVEFORM_FLOOR, waveformPeaks } from "../../waveform.js";
import { BUTTON_VARIANT, IconButton } from "../button/button.js";
import { CARD_CORNER, CARD_ELEMENT, CARD_PADDING, Card } from "../card/card.js";
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
 * (`audio-player.css`). Beside it stand Play and Pause, how far it has run of how long,
 * and Expand where the place has a viewer to open. There is no volume
 * control and no mute: the system's volume is the one a reader already
 * reaches for, as for a recording's sound (`../video-player/`).
 *
 * While focus is in the player its keys are a video's: Space or K plays or
 * pauses, the left and right arrows seek five seconds, and Home and End go
 * to the start and the end, each kept from the place around it, such as
 * the viewer whose arrows walk its files; a button's own Space presses the
 * button.
 *
 * Where a picture would be drawn, it plays in place (`INLINE`) in a card a
 * picture's stand-in wide, at most its column's width. A place that has a
 * viewer to open hands `onExpand`: Expand pauses it here and opens the
 * viewer, which grows from the card as it grows from a picture's tile. In
 * the viewer (`VIEWER`) it stands as wide as the place makes it, its
 * waveform taller, and plays at once, unless motion is held still
 * (`motionHeld`: reduced motion or a capture run), where it waits for Play.
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

/** How far an arrow key seeks, in seconds. */
const ARROW_SEEK_S = 5;

/** The keys that play or pause the player while focus is in it. */
const TOGGLE_KEYS: ReadonlySet<string> = new Set([" ", "k", "K"]);

/** How far each arrow seeks, in seconds, while focus is in the player. */
const SEEK_KEYS: ReadonlyMap<string, number> = new Map([
  ["ArrowLeft", -ARROW_SEEK_S],
  ["ArrowRight", ARROW_SEEK_S],
]);

/** Where Home and End send the clip: its start, or its end. */
const END_KEYS = { START: "Home", END: "End" } as const;

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

/** Plays a paused clip, or pauses a playing one. */
function toggleOf(audio: HTMLAudioElement | null): void {
  if (audio === null) return;

  if (audio.paused) audio.play().catch(() => undefined);
  else audio.pause();
}

/** Where a clip ends, in seconds, or where it stands while its length is not yet known. */
function endOf(audio: HTMLAudioElement): number {
  return Number.isFinite(audio.duration) ? audio.duration : audio.currentTime;
}

/**
 * Answers a key pressed while focus is in the player: plays or pauses,
 * seeks, or goes to an end, and keeps the key from the place around it.
 * Note that Space on one of its buttons is left to the button, which it
 * presses.
 */
function playerKey(event: React.KeyboardEvent<HTMLElement>, audio: HTMLAudioElement | null): void {
  if (audio === null || event.metaKey || event.ctrlKey || event.altKey) return;
  const onButton = event.target instanceof HTMLButtonElement;
  const seek = SEEK_KEYS.get(event.key);

  if (TOGGLE_KEYS.has(event.key) && !(onButton && event.key === " ")) {
    if (!event.repeat) toggleOf(audio);
  } else if (seek !== undefined) {
    audio.currentTime = Math.min(endOf(audio), Math.max(0, audio.currentTime + seek));
  } else if (event.key === END_KEYS.START || event.key === END_KEYS.END) {
    audio.currentTime = event.key === END_KEYS.START ? 0 : endOf(audio);
  } else {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
}

/** One of the player's buttons, its name its hint. */
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

/** A sound clip played in place of a picture or in the viewer: Play, its waveform as the scrubber, its time, and Expand. */
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
  /** Opens the clip in the viewer; without one, the player offers no Expand. */
  onExpand?: (() => void) | undefined;
}): React.JSX.Element {
  const url = useBlobUrl(dataUrl);
  const peaks = useWaveform(dataUrl);
  const audio = useRef<HTMLAudioElement>(null);
  const frame = useRef<HTMLSpanElement>(null);
  const [playback, setPlayback] = useState<Playback>({ playing: false, at: 0, duration: 0 });
  const viewer = place === AUDIO_PLAYER_PLACE.VIEWER;
  // Note that whether it starts is read once, as it mounts, because a clip hears autoplay only then.
  const [starts] = useState(() => viewer && !motionHeld());

  const read = (shown: HTMLAudioElement) => {
    const duration = Number.isFinite(shown.duration) ? shown.duration : 0;
    setPlayback({ playing: !shown.paused, at: Math.min(shown.currentTime, duration), duration });
  };

  // While it plays, its place is read on every frame, so the scrubber and the waveform's played bars glide rather than step at each `timeupdate`.
  usePlayingFrames(playback.playing, () => {
    if (audio.current !== null) read(audio.current);
  });

  const time = `${playheadText(playback.at * MS_PER_SECOND)} / ${playheadText(playback.duration * MS_PER_SECOND)}`;
  const played = playback.duration === 0 ? 0 : playback.at / playback.duration;

  const expand =
    onExpand === undefined
      ? undefined
      : () => {
          audio.current?.pause();

          if (frame.current !== null) notePictureOrigin(frame.current);
          onExpand();
        };

  const player = (
    // biome-ignore lint/a11y/useSemanticElements: a player holds a clip and its controls, not a form's controls, so it is no `<fieldset>`.
    <span
      ref={frame}
      // Note that the card's inset is the video bar's, so Play and Expand stand as far from its edge as a video's do.
      className={`ui-audio-player-frame flex w-full items-center gap-ui-8 focus:outline-none ${viewer ? "" : "p-ui-6"}`}
      data-playing={playback.playing}
      tabIndex={-1}
      role="group"
      aria-label={label === "" ? AUDIO_LABEL.PLAYER : `${AUDIO_LABEL.CLIP}: ${label}`}
      // Note that the player hears a key before the control it lands on, because the scrubber steps on an arrow itself.
      onKeyDownCapture={(event) => playerKey(event, audio.current)}
    >
      {/* Note that the clip carries no captions track, because no maker of an agent's clips writes one. */}
      {/* biome-ignore lint/a11y/useMediaCaption: an agent's sound clip has no captions to carry. */}
      <audio
        ref={audio}
        src={url}
        autoPlay={starts}
        preload={viewer ? "auto" : "metadata"}
        onLoadedMetadata={(event) => read(event.currentTarget)}
        onDurationChange={(event) => read(event.currentTarget)}
        onTimeUpdate={(event) => read(event.currentTarget)}
        onPlay={(event) => read(event.currentTarget)}
        onPause={(event) => read(event.currentTarget)}
        onEnded={(event) => read(event.currentTarget)}
      />
      <PlayerButton
        label={playback.playing ? AUDIO_LABEL.PAUSE : AUDIO_LABEL.PLAY}
        icon={playback.playing ? <PauseIcon /> : <PlayIcon />}
        onPress={() => toggleOf(audio.current)}
      />
      <span
        className={`ui-audio-player-scrubber relative block min-w-0 flex-1 ${viewer ? "h-ui-64" : "h-ui-32"}`}
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
      </span>
      <span className="ui-audio-player-time flex-none text-caption text-muted-foreground tabular-nums">
        {time}
      </span>
      {expand === undefined ? null : (
        <PlayerButton label={AUDIO_LABEL.EXPAND} icon={<ExpandIcon />} onPress={expand} />
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
