import {
  MANAGER_FACE_CHARACTER,
  MANAGER_FACE_COLOR,
  type ManagerFaceCharacter,
  type ManagerFaceColor,
  type ManagerFace as ManagerFaceValue,
} from "@repo/features/manager-face";
import { useId } from "react";
import { Backpack, Cat, Ghost, type KawaiiProps, Mug, Planet, SpeechBubble } from "react-kawaii";

/**
 * manager-face.tsx -- the friendly face a Manager wears: a React Kawaii character, or an emoji on a disc, in a soft color, with a typing bubble at its corner while it works.
 *
 * A face is what `@repo/features/manager-face` declares, a character and a
 * color, and maybe an emoji in the character's place, drawn in one of three
 * seats: a row's, the sidebar's 20px, or a message's, the chat's 32px, the
 * avatar's own row and card sizes, so a face lines up with the discs beside
 * it; or among words, a chip's or a line's, as tall as their em, where a
 * glyph of the words' size stands. Each character is drawn in its own
 * square cut of Kawaii's 240 box, measured to its body in every mood, since
 * Kawaii leaves a wide margin that would shrink the face to half its seat.
 * Its body takes the color's fill from the theme (`text-manager-face-*`
 * through `currentColor`), and its own features stay Kawaii's near black,
 * which each fill is light enough to hold. An emoji stands centered on a
 * disc of that fill, sized to its seat (`manager-face.css`). In the light
 * theme the body's edge and the disc's wear a hairline, since the soft fills
 * nearly vanish on white.
 *
 * At rest a character smiles (`happy`). While the Manager works the same
 * character turns `excited`, and in a row's or a message's seat a small
 * speech bubble at its top end corner lights three dots in turn, so working
 * changes how the face looks and never which face it is; the face itself
 * never moves. Among words, too small to hold the bubble, the mood says it
 * alone. The dots are an endless loop held by `--ui-loop-motion`, so
 * reduced motion and a capture run hold them on a frame with the first dot
 * lit. The face is a picture its caller's words beside it name, so it is
 * hidden from a reader.
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

/** Each color's fill, which the character's body and an emoji's disc read as `currentColor`. */
const FILL_CLASS = {
  [MANAGER_FACE_COLOR.YELLOW]: "text-manager-face-yellow",
  [MANAGER_FACE_COLOR.GREEN]: "text-manager-face-green",
  [MANAGER_FACE_COLOR.BLUE]: "text-manager-face-blue",
  [MANAGER_FACE_COLOR.PINK]: "text-manager-face-pink",
  [MANAGER_FACE_COLOR.PURPLE]: "text-manager-face-purple",
  [MANAGER_FACE_COLOR.PEACH]: "text-manager-face-peach",
  [MANAGER_FACE_COLOR.RED]: "text-manager-face-red",
  [MANAGER_FACE_COLOR.ORANGE]: "text-manager-face-orange",
  [MANAGER_FACE_COLOR.TEAL]: "text-manager-face-teal",
  [MANAGER_FACE_COLOR.GRAY]: "text-manager-face-gray",
} as const satisfies Record<ManagerFaceColor, string>;

/** Each seat's box. */
const SEAT_CLASS = {
  [MANAGER_FACE_SIZE.ROW]: "size-manager-face-row",
  [MANAGER_FACE_SIZE.MESSAGE]: "size-manager-face-message",
  [MANAGER_FACE_SIZE.WORDS]: "size-words-glyph",
} as const satisfies Record<ManagerFaceSize, string>;

/** The seats with room for the typing bubble at the face's corner while it works; among words there is none. */
const TYPING_SEATS: ReadonlySet<ManagerFaceSize> = new Set([
  MANAGER_FACE_SIZE.ROW,
  MANAGER_FACE_SIZE.MESSAGE,
]);

/** The typing bubble's three dots, which light in turn. */
const TYPING_DOTS = ["first", "second", "third"] as const;

/** A Manager's face in its seat, its emoji on a disc where it wears one, excited and typing while `working`. */
export function ManagerFace({
  face,
  size,
  working = false,
}: {
  /** The character, the color, and the emoji if any, as the service stores them. */
  face: ManagerFaceValue;
  /** The seat: a sidebar row's, a chat message's, or a glyph's among words. */
  size: ManagerFaceSize;
  /** Whether the Manager is at work. */
  working?: boolean | undefined;
}): React.JSX.Element {
  // Note that Kawaii names its face's mask by this, so many faces on one page never share a mask; it keeps only an id's safe characters.
  const maskId = useId().replace(/[^\w-]/g, "");
  const { Drawing, viewBox } = CHARACTER[face.character];
  const fill = FILL_CLASS[face.color];

  return (
    <span
      className={`ui-manager-face relative inline-flex flex-none ${SEAT_CLASS[size]}`}
      data-size={size}
      aria-hidden="true"
    >
      {face.emoji === undefined ? (
        <Drawing
          className={`ui-manager-face-body block size-full ${fill}`}
          mood={working ? MOOD.WORKING : MOOD.RESTING}
          color="currentColor"
          size="100%"
          viewBox={viewBox}
          uniqueId={maskId}
          focusable="false"
        />
      ) : (
        <span
          className={`ui-manager-face-disc flex size-full items-center justify-center rounded-disc bg-current ${fill}`}
        >
          <span className="ui-manager-face-emoji">{face.emoji}</span>
        </span>
      )}
      {working && TYPING_SEATS.has(size) ? (
        <span className="ui-manager-face-typing">
          {TYPING_DOTS.map((dot) => (
            <span key={dot} />
          ))}
        </span>
      ) : null}
    </span>
  );
}
