// manager-face-picker.tsx -- where a Manager's face is picked on iOS: its color, then its character, each a row of faces in a form's section, as Reminders picks a list's color and then its glyph.

import { Button, HStack, Image, Spacer, VStack, ZStack } from "@expo/ui/swift-ui";
import {
  accessibilityAddTraits,
  accessibilityLabel,
  buttonStyle,
  frame,
  resizable,
  strokeBorder,
} from "@expo/ui/swift-ui/modifiers";
import {
  MANAGER_FACE_CHARACTER,
  MANAGER_FACE_COLOR,
  type ManagerFace,
  managerFaceName,
} from "@repo/features/manager-face";
import { Fragment } from "react";
import { useScaledSize } from "./accessibility.js";
import { managerFaceAsset } from "./manager-face-look.js";
import { useColors } from "./tokens/colors.js";
import { SPACE } from "./tokens/space.js";

/** A face's side in the picker, in points, at the default text size: a little larger than a row's lead, so a finger finds each. */
const CHOICE_SIDE = 32;

/** The room between a face and the ring the picked one wears, and the ring's width, in points. */
const RING_GAP = 3;
const RING_WIDTH = 2;

/** Every color and every character, in the order the desktop's picker lists them. */
const COLORS = Object.values(MANAGER_FACE_COLOR);
const CHARACTERS = Object.values(MANAGER_FACE_CHARACTER);

/** Whether two faces are one. */
function sameFace(one: ManagerFace | undefined, other: ManagerFace): boolean {
  return one?.character === other.character && one.color === other.color;
}

/** One face to press: itself, ringed in copper while it stands picked, heard as its name ("Purple cat"). */
function FaceChoice({
  face,
  picked,
  onPick,
}: {
  readonly face: ManagerFace;
  readonly picked: boolean;
  readonly onPick: (face: ManagerFace) => void;
}) {
  const colors = useColors();
  const side = useScaledSize(CHOICE_SIDE);
  const ringed = side + 2 * (RING_GAP + RING_WIDTH);

  return (
    <Button
      onPress={() => onPick(face)}
      modifiers={[
        buttonStyle("plain"),
        accessibilityLabel(managerFaceName(face)),
        ...(picked ? [accessibilityAddTraits(["isSelected"])] : []),
      ]}
    >
      <ZStack
        modifiers={[
          frame({ width: ringed, height: ringed }),
          // Note that every face wears its ring's room, clear where it is not picked, so a pick never shifts the row.
          strokeBorder({
            content: picked ? colors.ACCENT : "#00000000",
            // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- @expo/ui names this parameter `shape`.
            shape: "circle",
            style: { lineWidth: RING_WIDTH },
          }),
        ]}
      >
        <Image
          assetName={managerFaceAsset(face, false)}
          modifiers={[resizable(), frame({ width: side, height: side })]}
        />
      </ZStack>
    </Button>
  );
}

/** A row of faces spread across the section's width, evenly apart, each kept by what sets it apart from the others in its row (`keyOf`). */
function FaceRow({
  faces,
  keyOf,
  picked,
  onPick,
}: {
  readonly faces: readonly ManagerFace[];
  readonly keyOf: (face: ManagerFace) => string;
  readonly picked: ManagerFace | undefined;
  readonly onPick: (face: ManagerFace) => void;
}) {
  return (
    <HStack spacing={0}>
      {faces.map((face, at) => (
        <Fragment key={keyOf(face)}>
          {at === 0 ? null : <Spacer />}
          <FaceChoice face={face} picked={sameFace(picked, face)} onPick={onPick} />
        </Fragment>
      ))}
    </HStack>
  );
}

/**
 * A Manager's face as a form picks it, the desktop's same thirty-six faces
 * (`@repo/features/manager-face`) in the iOS way Reminders picks a list's
 * look: a row of the six colors, each the face's character in that color,
 * then a row of the six characters, each in the face's color, the face
 * standing ringed in copper, as a picked option is. A press picks the face
 * it shows and hands it on; with none standing yet, as at New Manager
 * before a pick, where the service picks one, the rows draw the first
 * character and the first color and no face is ringed. Each face is heard
 * by its name ("Purple cat") and as selected where it stands. It holds no
 * section of its own, so its caller names it and says what a pick does.
 */
export function ManagerFacePicker({
  face,
  onPick,
}: {
  /** The face standing; none until a pick at New Manager. */
  readonly face: ManagerFace | undefined;
  readonly onPick: (face: ManagerFace) => void;
}) {
  const character = face?.character ?? MANAGER_FACE_CHARACTER.GHOST;
  const color = face?.color ?? MANAGER_FACE_COLOR.YELLOW;

  return (
    <VStack spacing={SPACE.ROW}>
      <FaceRow
        faces={COLORS.map((each) => ({ character, color: each }))}
        keyOf={(each) => each.color}
        picked={face}
        onPick={onPick}
      />
      <FaceRow
        faces={CHARACTERS.map((each) => ({ character: each, color }))}
        keyOf={(each) => each.character}
        picked={face}
        onPick={onPick}
      />
    </VStack>
  );
}
