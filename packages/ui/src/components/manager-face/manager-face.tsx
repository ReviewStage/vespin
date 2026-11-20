import {
  MANAGER_FACE_CHARACTER,
  MANAGER_FACE_COLOR,
  type ManagerFaceCharacter,
  type ManagerFaceColor,
  type ManagerFace as ManagerFaceValue,
} from "@repo/features/manager-face";
import { useId } from "react";
import { Backpack, Cat, Ghost, type KawaiiProps, Mug, Planet, SpeechBubble } from "react-kawaii";
import { WorkingMark } from "../working-mark/working-mark.js";

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

/** Each color's fill, which the character's body reads as `currentColor`. */
const FILL_CLASS = {
  [MANAGER_FACE_COLOR.YELLOW]: "text-manager-face-yellow",
  [MANAGER_FACE_COLOR.GREEN]: "text-manager-face-green",
  [MANAGER_FACE_COLOR.BLUE]: "text-manager-face-blue",
  [MANAGER_FACE_COLOR.PINK]: "text-manager-face-pink",
  [MANAGER_FACE_COLOR.PURPLE]: "text-manager-face-purple",
  [MANAGER_FACE_COLOR.PEACH]: "text-manager-face-peach",
} as const satisfies Record<ManagerFaceColor, string>;

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

/** A Manager's face in its seat, livelier and wearing the working mark while `working`. */
export function ManagerFace({
  face,
  size,
  working = false,
}: {
  /** The character and the color, as the service stores them. */
  face: ManagerFaceValue;
  /** The seat: a sidebar row's, a chat message's, or a glyph's among words. */
  size: ManagerFaceSize;
  /** Whether the Manager is at work. */
  working?: boolean | undefined;
}): React.JSX.Element {
  // Note that Kawaii names its face's mask by this, so many faces on one page never share a mask; it keeps only an id's safe characters.
  const maskId = useId().replace(/[^\w-]/g, "");
  const { Drawing, viewBox } = CHARACTER[face.character];
  const badge = BADGE_CLASS[size];

  return (
    <span
      className={`ui-manager-face relative inline-flex flex-none ${SEAT_CLASS[size]}`}
      data-working={working ? "true" : undefined}
      aria-hidden="true"
    >
      <Drawing
        className={`ui-manager-face-body block size-full ${FILL_CLASS[face.color]}`}
        mood={working ? MOOD.WORKING : MOOD.RESTING}
        color="currentColor"
        size="100%"
        viewBox={viewBox}
        uniqueId={maskId}
        focusable="false"
      />
      {working && badge !== undefined ? (
        <span
          className={`pointer-events-none absolute -right-ui-2 -bottom-ui-2 inline-grid place-items-center rounded-disc bg-ground text-muted-foreground ${badge}`}
        >
          <WorkingMark />
        </span>
      ) : null}
    </span>
  );
}
