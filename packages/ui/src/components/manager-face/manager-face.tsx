import {
  MANAGER_FACE_CHARACTER,
  MANAGER_FACE_COLOR,
  type ManagerFaceCharacter,
  type ManagerFaceColor,
  type ManagerFace as ManagerFaceValue,
} from "@repo/features/manager-face";
import { useEffect, useId, useState } from "react";
import { Backpack, Cat, Ghost, type KawaiiProps, Mug, Planet, SpeechBubble } from "react-kawaii";
import { WorkingMark } from "../working-mark/working-mark.js";
import { FACE_DIRECTION, useFaceDirection, usePickedFace } from "./prototype-face-direction.js";

export {
  FACE_DIRECTION,
  FACE_DIRECTION_NAME,
  type FaceDirection,
  setFaceDirection,
  setFacesWorking,
  useFaceDirection,
} from "./prototype-face-direction.js";

/**
 * manager-face.tsx -- the friendly face a Manager wears: a React Kawaii character in a soft color, livelier and wearing the working mark while it works.
 *
 * A face is the pair `@repo/features/manager-face` declares, a character and
 * a color, drawn in one of three seats: a row's, the sidebar's 20px, or a
 * message's, the chat's 32px, the avatar's own row and card sizes, so a face
 * lines up with the discs beside it; or among words, a chip's or a line's,
 * as tall as their em, where a glyph of the words' size stands. Each character is drawn in its own
 * square cut of Kawaii's 240 box, measured to its body in every mood, since
 * Kawaii leaves a wide margin that would shrink the face to half its seat.
 * Its body takes the color's fill from the theme (`text-manager-face-*`
 * through `currentColor`), and its own features stay Kawaii's near black,
 * which each fill is light enough to hold.
 *
 * At rest it smiles (`happy`). While the Manager works the same character
 * turns `excited`, bobs gently, and wears the shared working mark on a disc
 * of the ground at its end corner, so working changes how the face looks and
 * never which face it is; among words, too small to hold the disc, its mood
 * and its bob say it alone. The bob is an endless loop held by
 * `--ui-loop-motion`, so reduced motion and a capture run hold it at rest,
 * as the working mark holds its own chase. The face is a picture its
 * caller's words beside it name, so it is hidden from a reader.
 *
 * It sits on a subpath of its own (`@repo/ui/manager-face`), out of the
 * barrel, so Kawaii reaches only the bundles that draw a Manager.
 */

/** Which seat the face is drawn in: a sidebar row's, a chat message's, or a glyph's among words, a chip's or a line's. */
export const MANAGER_FACE_SIZE = {
  ROW: "row",
  MESSAGE: "message",
  WORDS: "words",
} as const;

export type ManagerFaceSize = (typeof MANAGER_FACE_SIZE)[keyof typeof MANAGER_FACE_SIZE];

/** What Kawaii calls the mood a face wears at rest and while it works. */
const MOOD = {
  RESTING: "happy",
  WORKING: "excited",
} as const satisfies Record<string, NonNullable<KawaiiProps["mood"]>>;

/** Each character's drawing, and the square of Kawaii's 240 box its body fills in every mood. */
const CHARACTER = {
  [MANAGER_FACE_CHARACTER.GHOST]: { Drawing: Ghost, viewBox: "39 39 162 162" },
  [MANAGER_FACE_CHARACTER.PLANET]: { Drawing: Planet, viewBox: "51 51 138 138" },
  [MANAGER_FACE_CHARACTER.CAT]: { Drawing: Cat, viewBox: "32 32 176 176" },
  [MANAGER_FACE_CHARACTER.BACKPACK]: { Drawing: Backpack, viewBox: "34 34 171 171" },
  [MANAGER_FACE_CHARACTER.MUG]: { Drawing: Mug, viewBox: "33 48 145 145" },
  [MANAGER_FACE_CHARACTER.SPEECH_BUBBLE]: { Drawing: SpeechBubble, viewBox: "38 48 164 164" },
} as const satisfies Record<
  ManagerFaceCharacter,
  { Drawing: React.FunctionComponent<KawaiiProps>; viewBox: string }
>;

/** PROTOTYPE: each color's fill in light and dark, which the character's body reads as `currentColor` and an emoji's disc as its ground. */
export const FACE_FILL = {
  [MANAGER_FACE_COLOR.CORAL]: "light-dark(#ff8a80, #ffa49c)",
  [MANAGER_FACE_COLOR.PEACH]: "light-dark(#ff9a6c, #ffb08a)",
  [MANAGER_FACE_COLOR.TANGERINE]: "light-dark(#ffb347, #ffc46e)",
  [MANAGER_FACE_COLOR.YELLOW]: "light-dark(#f9c74f, #ffd882)",
  [MANAGER_FACE_COLOR.LEMON]: "light-dark(#fbe36b, #fff09a)",
  [MANAGER_FACE_COLOR.LIME]: "light-dark(#c3e36a, #d4ef8a)",
  [MANAGER_FACE_COLOR.GREEN]: "light-dark(#8fd47a, #a6e191)",
  [MANAGER_FACE_COLOR.MINT]: "light-dark(#7edcc0, #99e9d1)",
  [MANAGER_FACE_COLOR.TEAL]: "light-dark(#5cc6c6, #7ad6d6)",
  [MANAGER_FACE_COLOR.BLUE]: "light-dark(#6cc4f5, #83d1fb)",
  [MANAGER_FACE_COLOR.PERIWINKLE]: "light-dark(#8fa6ff, #a9bcff)",
  [MANAGER_FACE_COLOR.PURPLE]: "light-dark(#b08cff, #c5a6ff)",
  [MANAGER_FACE_COLOR.LAVENDER]: "light-dark(#d3b8ff, #dfcaff)",
  [MANAGER_FACE_COLOR.PINK]: "light-dark(#f78fcb, #fda7dc)",
  [MANAGER_FACE_COLOR.ROSE]: "light-dark(#ff7aa2, #ff97b8)",
  [MANAGER_FACE_COLOR.SAND]: "light-dark(#e6c798, #f0d6ae)",
  [MANAGER_FACE_COLOR.COCOA]: "light-dark(#c39a7a, #d4ae91)",
  [MANAGER_FACE_COLOR.CLOUD]: "light-dark(#c9ced6, #d6dae0)",
} as const satisfies Record<ManagerFaceColor, string>;

/** PROTOTYPE: the colors in the order a picker offers them, round the wheel and then the quiet ones. */
export const FACE_COLORS: readonly ManagerFaceColor[] = Object.keys(
  FACE_FILL,
) as ManagerFaceColor[];

/** PROTOTYPE: the emoji each character stands for where a face has none of its own and the direction draws emoji. */
export const CHARACTER_EMOJI = {
  [MANAGER_FACE_CHARACTER.GHOST]: "👻",
  [MANAGER_FACE_CHARACTER.PLANET]: "🪐",
  [MANAGER_FACE_CHARACTER.CAT]: "🐱",
  [MANAGER_FACE_CHARACTER.BACKPACK]: "🎒",
  [MANAGER_FACE_CHARACTER.MUG]: "☕",
  [MANAGER_FACE_CHARACTER.SPEECH_BUBBLE]: "💬",
} as const satisfies Record<ManagerFaceCharacter, string>;

/** Each seat's box. */
const SEAT_CLASS = {
  [MANAGER_FACE_SIZE.ROW]: "size-manager-face-row",
  [MANAGER_FACE_SIZE.MESSAGE]: "size-manager-face-message",
  [MANAGER_FACE_SIZE.WORDS]: "size-words-glyph",
} as const satisfies Record<ManagerFaceSize, string>;

/** Each seat's working disc, and the working mark inside it a step smaller, so a sliver of the ground rings it; none among words, too small to hold one. */
const BADGE_CLASS = {
  [MANAGER_FACE_SIZE.ROW]:
    "size-manager-face-badge-row [--ui-working-mark-size:var(--spacing-ui-8)]",
  [MANAGER_FACE_SIZE.MESSAGE]:
    "size-manager-face-badge-message [--ui-working-mark-size:var(--spacing-ui-12)]",
  [MANAGER_FACE_SIZE.WORDS]: undefined,
} as const satisfies Record<ManagerFaceSize, string | undefined>;

/** PROTOTYPE: a Kawaii mood the Lively direction's face wears now: a blink now and then at rest, hearts while hovered. */
function useLivelyMood(
  lively: boolean,
  working: boolean,
): {
  mood: NonNullable<KawaiiProps["mood"]>;
  onHover: (hovered: boolean) => void;
} {
  const [blink, setBlink] = useState(false);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    if (!lively) return undefined;
    let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      timer = setTimeout(
        () => {
          setBlink(true);
          timer = setTimeout(() => {
            setBlink(false);
            next();
          }, 170);
        },
        2200 + Math.random() * 3800,
      );
    };
    next();

    return () => clearTimeout(timer);
  }, [lively]);

  const mood = !lively
    ? working
      ? MOOD.WORKING
      : MOOD.RESTING
    : hovered
      ? "lovestruck"
      : blink
        ? "blissful"
        : working
          ? MOOD.WORKING
          : MOOD.RESTING;

  return { mood, onHover: setHovered };
}

/** A Manager's face in its seat, livelier and wearing the working mark while `working`; PROTOTYPE: drawn in the direction the switcher names. */
export function ManagerFace({
  face: stored,
  size,
  working = false,
  raw = false,
}: {
  /** PROTOTYPE: draws the face as given, never the one picked over it, as a picker's choices are. */
  raw?: boolean | undefined;
  /** The character and the color, as the service stores them. */
  face: ManagerFaceValue;
  /** The seat: a sidebar row's, a chat message's, or a glyph's among words. */
  size: ManagerFaceSize;
  /** Whether the Manager is at work. */
  working?: boolean | undefined;
}): React.JSX.Element {
  // Note that Kawaii names its face's mask by this, so many faces on one page never share a mask; it keeps only an id's safe characters.
  const maskId = useId().replace(/[^\w-]/g, "");
  const picked = usePickedFace(stored) ?? stored;
  const face = raw ? stored : picked;
  const { direction, working: everyWorking } = useFaceDirection();
  const atWork = working || everyWorking;
  const lively = direction === FACE_DIRECTION.LIVELY;
  const { mood, onHover } = useLivelyMood(lively, atWork);
  const { Drawing, viewBox } = CHARACTER[face.character];
  const fill = FACE_FILL[face.color] ?? FACE_FILL[MANAGER_FACE_COLOR.YELLOW];
  const emoji =
    direction === FACE_DIRECTION.EMOJI
      ? (face.emoji ?? CHARACTER_EMOJI[face.character])
      : direction === FACE_DIRECTION.MIXED
        ? face.emoji
        : undefined;
  // Note that the Emoji and Mixed directions say work by their ring and halo, so only Palette and Lively wear the corner mark.
  const badge = direction === FACE_DIRECTION.PALETTE ? BADGE_CLASS[size] : undefined;

  return (
    <span
      className={`ui-manager-face relative inline-flex flex-none ${SEAT_CLASS[size]}`}
      data-working={atWork ? "true" : undefined}
      data-direction={direction}
      data-emoji={emoji === undefined ? undefined : "true"}
      style={{ "--ui-manager-face-fill": fill } as React.CSSProperties}
      onMouseEnter={lively ? () => onHover(true) : undefined}
      onMouseLeave={lively ? () => onHover(false) : undefined}
      aria-hidden="true"
    >
      {emoji === undefined ? (
        <Drawing
          className="ui-manager-face-body block size-full"
          mood={mood}
          color="currentColor"
          size="100%"
          viewBox={viewBox}
          uniqueId={maskId}
          focusable="false"
          style={{ color: fill }}
        />
      ) : (
        <span className="ui-manager-face-disc">
          <span className="ui-manager-face-body ui-manager-face-emoji">{emoji}</span>
        </span>
      )}
      {atWork && badge !== undefined ? (
        <span
          className={`pointer-events-none absolute -right-ui-2 -bottom-ui-2 inline-grid place-items-center rounded-disc bg-ground text-muted-foreground ${badge}`}
        >
          <WorkingMark />
        </span>
      ) : null}
      {atWork && lively && size !== MANAGER_FACE_SIZE.WORDS ? (
        <span className="ui-manager-face-typing" data-size={size}>
          <span />
          <span />
          <span />
        </span>
      ) : null}
    </span>
  );
}

export { FaceDirectionSwitcher } from "./prototype-face-switcher.js";
