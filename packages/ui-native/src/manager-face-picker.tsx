// manager-face-picker.tsx -- where a Manager's face is picked on iOS: the app's one icon picker (`IconPickerSheet`) over every face, one group to each character in each of the colors, as the panel picks it.

import {
  MANAGER_FACE_CHARACTER,
  MANAGER_FACE_CHARACTER_NAME,
  MANAGER_FACE_COLOR,
  MANAGER_FACES,
  type ManagerFace,
  managerFaceName,
  managerFacesFound,
} from "@repo/features/manager-face";
import { useState } from "react";
import { IconPickerSheet } from "./icon-picker.js";
import { managerFaceAsset } from "./manager-face-look.js";
import { PictureRow } from "./settings-form.js";

/** The picker's words, the panel's own (`@repo/ui`'s `ManagerFacePicker`). */
const WORDS = {
  TITLE: "Manager face",
  SEARCH: "Search faces",
  FOUND: "Faces",
  NONE: "No faces match.",
} as const;

/** Whether two faces are one. */
function sameFace(one: ManagerFace | undefined, other: ManagerFace): boolean {
  return one?.character === other.character && one.color === other.color;
}

/** What tells a face apart among the picker's choices: its character and its color, in a word. */
function faceKey(face: ManagerFace): string {
  return managerFaceName(face);
}

/** A face as the picker draws it: its picture, its name, and whether it stands. */
function faceChoice(face: ManagerFace, standing: ManagerFace | undefined) {
  return {
    key: faceKey(face),
    label: managerFaceName(face),
    picture: managerFaceAsset(face, false),
    picked: sameFace(standing, face),
  };
}

/**
 * A Manager's face as the panel picks it, in the app's one icon picker: all
 * thirty-six faces under each character's name, each in every color, named
 * by its color and character ("Purple cat"), a search finding the faces
 * whose name holds every word typed (`@repo/features/manager-face`'s
 * `managerFacesFound`), the face standing ringed. A pick hands the face on
 * and puts the sheet away, as the panel's pick puts its picker away.
 */
export function ManagerFaceSheet({
  face,
  presented,
  onDismiss,
  onPick,
}: {
  /** The face standing; none before a pick at New Manager, where the service picks one. */
  readonly face: ManagerFace | undefined;
  readonly presented: boolean;
  readonly onDismiss: () => void;
  readonly onPick: (face: ManagerFace) => void;
}) {
  const [query, setQuery] = useState("");
  const searching = query.trim() !== "";
  const found = searching ? managerFacesFound(query) : MANAGER_FACES;

  const groups = searching
    ? found.length === 0
      ? []
      : [
          {
            key: WORDS.FOUND,
            name: WORDS.FOUND,
            choices: found.map((each) => faceChoice(each, face)),
          },
        ]
    : Object.values(MANAGER_FACE_CHARACTER).map((character) => ({
        key: character,
        name: MANAGER_FACE_CHARACTER_NAME[character],
        choices: Object.values(MANAGER_FACE_COLOR).map((color) =>
          faceChoice({ character, color }, face),
        ),
      }));

  return (
    <IconPickerSheet
      title={WORDS.TITLE}
      searchPrompt={WORDS.SEARCH}
      empty={WORDS.NONE}
      presented={presented}
      onDismiss={onDismiss}
      onQuery={setQuery}
      groups={groups}
      onPick={(key) => {
        const picked = MANAGER_FACES.find((each) => faceKey(each) === key);

        if (picked === undefined) return;
        onPick(picked);
        onDismiss();
      }}
    />
  );
}

/**
 * A form's Face row, the panel's face well: its label, then the face
 * standing at its end, heard by its name, or `unpicked`'s words while none
 * stands, as at New Manager before a pick, and the chevron; a press opens
 * the picker (`ManagerFaceSheet`).
 */
export function ManagerFaceRow({
  label,
  face,
  unpicked,
  onPress,
  testId,
}: {
  readonly label: string;
  readonly face: ManagerFace | undefined;
  readonly unpicked: string;
  readonly onPress: () => void;
  readonly testId?: string | undefined;
}) {
  return (
    <PictureRow
      label={label}
      picture={face === undefined ? undefined : managerFaceAsset(face, false)}
      heard={face === undefined ? undefined : managerFaceName(face)}
      detail={unpicked}
      onPress={onPress}
      testId={testId}
    />
  );
}
