// manager-face-picker.tsx -- where a Manager's face is picked on iOS: the app's one icon picker (`IconPickerSheet`) over Characters and Emoji, as the panel picks a face, each face's press opening the system's menu of its colors.

import { type EmojiGroup, emojiGroups } from "@repo/features/emoji-model";
import { type ManagerFace, managerFaceName } from "@repo/features/manager-face";
import { useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";
import { ICON_PICKER_LOOK, IconPickerSheet } from "./icon-picker.js";
import { managerFaceAsset, managerFaceEdge, managerFaceFill } from "./manager-face-look.js";
import {
  FACE_PICKER_WORDS,
  FACE_TAB,
  type FaceCell,
  type FaceTab,
  faceGroups,
  openingTab,
} from "./manager-face-picker-model.js";
import { MANAGER_FACE_SEAT, ManagerFace as ManagerFaceMark } from "./marks.js";
import { PictureRow } from "./settings-form.js";

/** The picker's words, the panel's own (`@repo/ui`'s `ManagerFacePicker`). */
const WORDS = {
  TITLE: "Manager face",
  SEARCH: "Search faces",
  TABS: "Faces",
  NONE: "No faces match.",
  LOADING: "Loading emoji…",
} as const;

/** Every emoji by category, read once, the first time a picker asks. */
let emojiRead: Promise<readonly EmojiGroup[]> | undefined;

/**
 * Every emoji by category, `@repo/features/emoji-data`'s, read the first time a
 * picker shows its Emoji tab or a search is typed. Note that the data is
 * imported only then, because it is some 220 KB of data that would otherwise
 * be evaluated in every launch before the first frame; a read that fails is
 * forgotten, so the next one tries again.
 */
function readEmoji(): Promise<readonly EmojiGroup[]> {
  if (emojiRead !== undefined) return emojiRead;

  const read = import("@repo/features/emoji-data").then((module) => emojiGroups(module.EMOJI_DATA));

  read.catch(() => {
    emojiRead = undefined;
  });
  emojiRead = read;

  return read;
}

/** Every emoji by category once `wanted` and read; none before. */
function useEmoji(wanted: boolean): readonly EmojiGroup[] | undefined {
  const [emoji, setEmoji] = useState<readonly EmojiGroup[] | undefined>(undefined);

  useEffect(() => {
    if (!wanted || emoji !== undefined) return;
    let standing = true;

    readEmoji().then(
      (read) => {
        if (standing) setEmoji(read);
      },
      () => undefined,
    );

    return () => {
      standing = false;
    };
  }, [wanted, emoji]);

  return emoji;
}

/** A face's cell as the icon picker draws it, heard by its whole name where it is the face standing and by its character or its emoji otherwise: its character's picture, or its emoji, on its disc in the theme's shade where it stands on one; and its colors, each led by the face in it. */
function faceChoice(cell: FaceCell, dark: boolean) {
  const face = cell.face;

  return {
    key: cell.key,
    label: cell.picked ? managerFaceName(face) : cell.label,
    look:
      face.emoji === undefined
        ? { kind: ICON_PICKER_LOOK.PICTURE, asset: managerFaceAsset(face, false) }
        : {
            kind: ICON_PICKER_LOOK.EMOJI,
            emoji: face.emoji,
            disc: cell.disc ? managerFaceFill(face, dark) : undefined,
            edge: cell.disc ? managerFaceEdge(dark) : undefined,
          },
    picked: cell.picked,
    options: cell.colors,
  };
}

/**
 * A Manager's face as the panel picks it, in the app's one icon picker:
 * Characters and Emoji as the system's segmented control, and a search that
 * finds both, each under its kind (`manager-face-picker-model.ts`).
 * Characters offers Recent, the faces this phone picked last in the colors
 * they were picked in, then the six characters, the one standing in its
 * color and the rest gray; Emoji offers every emoji by category, read the
 * first time it is shown. A face's press opens the system's menu of its
 * colors, gray first, each led by the face in it and the face standing
 * checked; a color chosen hands the face on and puts the sheet away, as the
 * panel's pick puts its picker away. The caller keeps Recent (`recent`).
 */
export function ManagerFaceSheet({
  face,
  recent,
  presented,
  onDismiss,
  onPick,
}: {
  /** The face standing; none before a pick at New Manager, where the service picks one. */
  readonly face: ManagerFace | undefined;
  /** The faces this phone picked last, newest first. */
  readonly recent: readonly ManagerFace[];
  readonly presented: boolean;
  readonly onDismiss: () => void;
  readonly onPick: (face: ManagerFace) => void;
}) {
  const dark = useColorScheme() === "dark";
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<FaceTab>(() => openingTab(face));
  const [shown, setShown] = useState(presented);

  // Note that a sheet a screen keeps for its rows opens over one Manager after another, so each opening starts on the tab its face wears, as React keeps what an earlier render saw.
  if (presented !== shown) {
    setShown(presented);

    if (presented) setTab(openingTab(face));
  }

  const searching = query.trim() !== "";
  const emoji = useEmoji(presented && (searching || tab === FACE_TAB.EMOJI));

  const groups = useMemo(
    () => faceGroups({ tab, query, recent, standing: face, emoji }),
    [tab, query, recent, face, emoji],
  );

  const choices = useMemo(
    () =>
      groups.map((group) => ({
        key: group.key,
        name: group.name,
        choices: group.cells.map((cell) => faceChoice(cell, dark)),
      })),
    [groups, dark],
  );

  const tabs = [
    { tab: FACE_TAB.CHARACTERS, label: FACE_PICKER_WORDS.CHARACTERS },
    { tab: FACE_TAB.EMOJI, label: FACE_PICKER_WORDS.EMOJI },
  ];

  const waiting = emoji === undefined && (searching || tab === FACE_TAB.EMOJI);

  // Note that the search's words go with the sheet, as its field does, so it opens again on every face.
  const dismiss = () => {
    setQuery("");
    onDismiss();
  };

  return (
    <IconPickerSheet
      title={WORDS.TITLE}
      searchPrompt={WORDS.SEARCH}
      empty={waiting && groups.length === 0 ? WORDS.LOADING : WORDS.NONE}
      presented={presented}
      onDismiss={dismiss}
      onQuery={setQuery}
      scopes={
        searching
          ? undefined
          : {
              label: WORDS.TABS,
              scopes: tabs.map((each) => ({
                label: each.label,
                selected: each.tab === tab,
                onPress: () => setTab(each.tab),
              })),
            }
      }
      groups={choices}
      onPick={(key, option) => {
        const cell = groups.flatMap((group) => group.cells).find((each) => each.key === key);
        const picked = option === undefined ? undefined : cell?.colors[option]?.face;

        if (picked === undefined) return;
        onPick(picked);
        dismiss();
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
      picture={
        face === undefined
          ? undefined
          : (side) => <ManagerFaceMark face={face} size={side} seat={MANAGER_FACE_SEAT.WORDS} />
      }
      heard={face === undefined ? undefined : managerFaceName(face)}
      detail={unpicked}
      onPress={onPress}
      testId={testId}
    />
  );
}
