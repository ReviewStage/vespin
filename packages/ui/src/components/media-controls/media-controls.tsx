import { SHORTCUT_KEY } from "@repo/settings/shortcuts";
import { BUTTON_SIZE, Button, type ButtonVariant } from "../button/button.js";
import { Tooltip } from "../tooltip/hint.js";

/**
 * media-controls.tsx -- what a video's player and a sound clip's share: the keys a player answers while focus is in it, the speeds it walks, its speed button, and the pill a player says a time or a speed in.
 *
 * While focus is in a player its keys are the ones video sites share:
 * Space or K plays or pauses, the left and right arrows seek five seconds,
 * Home and End go to the start and the end, and < and > slow it or speed
 * it along its speeds, each kept from the place around it, such as the
 * viewer whose arrows walk its files; a button's own Space presses the
 * button. A player with keys of its own, as a video's frame steps, answers
 * them before handing the rest here.
 *
 * Its speed button says the speed it plays at, and a press walks its speeds
 * round, back to the slowest after the fastest. A speed is set as the
 * medium's default too, because loading its address again puts a medium
 * back at its default.
 *
 * The pill is the window's hint pill, its corner, edge, padding, and type,
 * drawn in the veil's ink, as a video's key flash and a clip's hover time
 * stand over what they play.
 */

/** What the speed button is named for a reader, and its hint, which names the keys that step it. */
const SPEED_LABEL = {
  SPEED: "Playback speed",
  SPEED_HINT: "Playback speed (< slower, > faster)",
} as const;

/** How far an arrow key seeks, in seconds. */
const ARROW_SEEK_S = 5;

/** The keys that play or pause the player while focus is in it. */
const TOGGLE_KEYS: ReadonlySet<string> = new Set([" ", "k", "K"]);

/** How far each arrow seeks, in seconds, while focus is in the player. */
const SEEK_KEYS: ReadonlyMap<string, number> = new Map([
  ["ArrowLeft", -ARROW_SEEK_S],
  ["ArrowRight", ARROW_SEEK_S],
]);

/** Which way each key steps the speed while focus is in the player: < slower, > faster. */
const SPEED_KEYS: ReadonlyMap<string, number> = new Map([
  ["<", -1],
  [">", 1],
]);

/** Where Home and End send the medium: its start, or its end. */
const END_KEYS = { START: SHORTCUT_KEY.HOME.key, END: SHORTCUT_KEY.END.key } as const;

/** The speed a medium starts at, which every list of speeds holds. */
export const NORMAL_SPEED = 1;

/**
 * The speeds each kind of player plays at, slowest first: a video's the
 * video sites' range, and a sound clip's a voice message's, as the
 * messaging apps offer it.
 */
export const MEDIA_SPEEDS = {
  VIDEO: [0.25, 0.5, NORMAL_SPEED, 1.5, 2],
  CLIP: [NORMAL_SPEED, 1.5, 2],
} as const satisfies Record<string, readonly number[]>;

type MediaSpeeds = (typeof MEDIA_SPEEDS)[keyof typeof MEDIA_SPEEDS];

/** What a key asks a player to say it did: how far a jump went in seconds, signed, or the speed it set. */
export const MEDIA_KEY_ACT = {
  JUMP: "jump",
  SPEED: "speed",
} as const;

export type MediaKeyAct =
  | { readonly kind: typeof MEDIA_KEY_ACT.JUMP; readonly seconds: number }
  | { readonly kind: typeof MEDIA_KEY_ACT.SPEED; readonly speed: number };

/** The pill a player says a time or a speed in over what it plays: the window's hint pill, in the veil's ink. */
export const MEDIA_PILL =
  "flex items-center gap-icon-gap rounded-tooltip border border-tooltip-edge bg-veil px-2 py-1 text-tag font-tag whitespace-nowrap tabular-nums text-on-veil [&>svg]:size-caption-leading [&>svg]:flex-none";

/** Plays a paused medium, or pauses a playing one. */
export function toggleOf(media: HTMLMediaElement | null): void {
  if (media === null) return;

  if (media.paused) media.play().catch(() => undefined);
  else media.pause();
}

/** Where a medium ends, in seconds, or where it stands while its length is not yet known. */
export function endOf(media: HTMLMediaElement): number {
  return Number.isFinite(media.duration) ? media.duration : media.currentTime;
}

/** The speed `by` steps along `speeds` from `speed`, held at the slowest and the fastest. */
function speedBy(speeds: readonly number[], speed: number, by: number): number {
  const at = speeds.indexOf(speed);
  const from = at === -1 ? speeds.indexOf(NORMAL_SPEED) : at;

  return speeds[Math.min(speeds.length - 1, Math.max(0, from + by))] ?? NORMAL_SPEED;
}

/** The speed after `speed` as the speed button walks `speeds`, back to the slowest after the fastest. */
export function nextSpeed(speeds: readonly number[], speed: number): number {
  return speeds[(speeds.indexOf(speed) + 1) % speeds.length] ?? NORMAL_SPEED;
}

/** Sets a medium's speed, its default too, because loading its address again puts it back at its default. */
export function setSpeed(media: HTMLMediaElement | null, speed: number): void {
  if (media === null) return;
  media.defaultPlaybackRate = speed;
  media.playbackRate = speed;
}

/** A speed as a player spells it: "0.25×", "1×". */
export function speedText(speed: number): string {
  return `${String(speed)}×`;
}

/** Keeps a key a player answered from the control it landed on and the place around it. */
export function claimKey(event: React.KeyboardEvent<HTMLElement>): void {
  event.preventDefault();
  event.stopPropagation();
}

/** Whether a key is held with a modifier, which a player leaves to the window. */
export function modifiedKey(event: React.KeyboardEvent<HTMLElement>): boolean {
  return event.metaKey || event.ctrlKey || event.altKey;
}

/**
 * Answers a key pressed while focus is in a player: plays or pauses, seeks,
 * goes to an end, or steps the speed along `speeds`, telling `onAct` of a
 * jump or a speed that moved something, and keeps the key from the place
 * around it. Note that Space on one of the player's buttons is left to the
 * button, which it presses.
 */
export function mediaKey(
  event: React.KeyboardEvent<HTMLElement>,
  media: HTMLMediaElement | null,
  speeds: MediaSpeeds,
  onAct?: ((act: MediaKeyAct) => void) | undefined,
): void {
  if (media === null || modifiedKey(event)) return;
  const onButton = event.target instanceof HTMLButtonElement;
  const seek = SEEK_KEYS.get(event.key);
  const speed = SPEED_KEYS.get(event.key);

  if (TOGGLE_KEYS.has(event.key) && !(onButton && event.key === " ")) {
    // A held key plays or pauses once, not again with each repeat; a held arrow goes on.
    if (!event.repeat) toggleOf(media);
  } else if (seek !== undefined) {
    const from = media.currentTime;
    media.currentTime = Math.min(endOf(media), Math.max(0, from + seek));

    // A jump at an end that moves nothing says nothing; one cut short by an end still says the key's step, as the video sites do.
    if (media.currentTime !== from) onAct?.({ kind: MEDIA_KEY_ACT.JUMP, seconds: seek });
  } else if (event.key === END_KEYS.START || event.key === END_KEYS.END) {
    media.currentTime = event.key === END_KEYS.START ? 0 : endOf(media);
  } else if (speed !== undefined) {
    const next = speedBy(speeds, media.playbackRate, speed);

    // A speed key at the slowest or the fastest changes nothing and says nothing.
    if (next !== media.playbackRate) onAct?.({ kind: MEDIA_KEY_ACT.SPEED, speed: next });
    setSpeed(media, next);
  } else {
    return;
  }

  claimKey(event);
}

/** A player's speed button, its words the speed it plays at, which a press walks round; its hint names the keys that step it. */
export function SpeedButton({
  speed,
  variant,
  onPress,
}: {
  speed: number;
  /** Its look: the player's own buttons'. */
  variant: ButtonVariant;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Tooltip label={SPEED_LABEL.SPEED_HINT}>
      <Button
        label={`${SPEED_LABEL.SPEED}: ${speedText(speed)}`}
        variant={variant}
        size={BUTTON_SIZE.COMPACT}
        onClick={onPress}
      >
        {speedText(speed)}
      </Button>
    </Tooltip>
  );
}
