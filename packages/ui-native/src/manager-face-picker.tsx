// manager-face-picker.tsx -- where a Manager's face is picked on iOS: the app's one icon picker (`IconPickerSheet`) over Characters and Emoji, as the panel picks a face, the face picked shown large over the row of its colors until Done keeps it.

import { type EmojiGroup, emojiGroups } from "@repo/features/emoji-model";
import {
  MANAGER_FACE_COLOR_NAME,
  type ManagerFace,
  type ManagerFaceColor,
  managerFaceName,
  sameManagerFace,
} from "@repo/features/manager-face";
import { useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";
import { ICON_PICKER_LOOK, IconPickerSheet } from "./icon-picker.js";
import { managerFaceAsset, managerFaceFill } from "./manager-face-look.js";
import {
  FACE_COLORS,
  FACE_PICKER_WORDS,
  FACE_TAB,
  type FaceCell,
  type FaceTab,
  faceGroups,
  OPENING_COLOR,
  openingTab,
} from "./manager-face-picker-model.js";
import { MANAGER_FACE_SEAT, ManagerFace as ManagerFaceMark } from "./marks.js";
import { PictureRow } from "./settings-form.js";

/** The picker's words, the panel's own (`@repo/ui`'s `ManagerFacePicker`). */
const WORDS = {
  TITLE: "Manager face",
  SEARCH: "Search faces",
  TABS: "Faces",
  COLORS: "Color",
  NONE: "No faces match.",
  LOADING: "Loading emoji…",
} as const;

/** Every emoji by category, read once, the first time a picker asks. */
let emojiRead: Promise<readonly EmojiGroup[]> | undefined;

/**
 * Every emoji by category, `unicode-emoji-json`'s, read the first time a
 * picker shows its Emoji tab or a search is typed. Note that the data is
 * imported only then, because it is some 400 KB of JSON that would otherwise
 * be evaluated in every launch before the first frame; a read that fails is
 * forgotten, so the next one tries again.
 */
function readEmoji(): Promise<readonly EmojiGroup[]> {
  if (emojiRead !== undefined) return emojiRead;

  const read = import("unicode-emoji-json/data-by-group.json").then((module) =>
    emojiGroups(module.default),
  );

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

/** A face as the icon picker draws it: its character's picture, or its emoji, on its disc in the theme's shade where `disc`. */
function faceLook(face: ManagerFace, disc: boolean, dark: boolean) {
  return face.emoji === undefined
    ? { kind: ICON_PICKER_LOOK.PICTURE, asset: managerFaceAsset(face, false) }
    : {
        kind: ICON_PICKER_LOOK.EMOJI,
        emoji: face.emoji,
        disc: disc ? managerFaceFill(face, dark) : undefined,
      };
}

/** A face's cell as the icon picker draws it, heard by its whole name where it is the face picked and by its character or its emoji otherwise. */
function faceChoice(cell: FaceCell, dark: boolean) {
  return {
    key: cell.key,
    label: cell.picked ? managerFaceName(cell.face) : cell.label,
    look: faceLook(cell.face, cell.disc, dark),
    picked: cell.picked,
  };
}

/** The color row's colors, gray first, each by its name in its fill in the theme's shade. */
function colorRow(dark: boolean) {
  return FACE_COLORS.map((color) => ({
    key: color,
    label: MANAGER_FACE_COLOR_NAME[color],
    fill: managerFaceFill({ color }, dark),
  }));
}

/**
 * A Manager's face as the panel picks it, in the app's one icon picker, as
 * Messages picks a contact's photo: the face picked large at the top, the
 * nine colors under it as the system's palette, gray first, then
 * Characters and Emoji as the system's segmented control, and a search that
 * finds both, each under its kind (`manager-face-picker-model.ts`). Each
 * tab opens on Recent, the faces this phone picked last in the colors they
 * were picked in; Characters then offers the six characters and Emoji every
 * emoji by category, read the first time it is shown, each in the row's
 * color. A face's press shows it in the preview, a recent one bringing its
 * color to the row, and a color chosen recolors it; Done hands the face on
 * where it changed from the one the sheet opened on and Cancel, or a swipe down, drops it. The caller keeps
 * Recent (`recent`).
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
  const [opened, setOpened] = useState(face);
  const [draft, setDraft] = useState(face);
  const [color, setColor] = useState<ManagerFaceColor>(face?.color ?? OPENING_COLOR);
  const [shown, setShown] = useState(presented);

  // Note that a sheet a screen keeps for its rows opens over one Manager after another, so each opening starts on the face it wears and its tab, as React keeps what an earlier render saw.
  if (presented !== shown) {
    setShown(presented);

    if (presented) {
      setTab(openingTab(face));
      setOpened(face);
      setDraft(face);
      setColor(face?.color ?? OPENING_COLOR);
    }
  }

  const searching = query.trim() !== "";
  const emoji = useEmoji(presented && (searching || tab === FACE_TAB.EMOJI));

  const groups = useMemo(
    () => faceGroups({ tab, query, recent, standing: draft, color, emoji }),
    [tab, query, recent, draft, color, emoji],
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

  const colors = useMemo(() => colorRow(dark), [dark]);

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

  const choose = (key: string) => {
    const chosen = FACE_COLORS.find((each) => each === key);

    if (chosen === undefined) return;
    setColor(chosen);
    setDraft((before) => (before === undefined ? undefined : { ...before, color: chosen }));
  };

  return (
    <IconPickerSheet
      title={WORDS.TITLE}
      searchPrompt={WORDS.SEARCH}
      empty={waiting && groups.length === 0 ? WORDS.LOADING : WORDS.NONE}
      presented={presented}
      preview={
        draft === undefined
          ? undefined
          : { look: faceLook(draft, true, dark), heard: managerFaceName(draft) }
      }
      colors={{ label: WORDS.COLORS, options: colors, chosen: color, onChoose: choose }}
      onCancel={dismiss}
      onDone={() => {
        // Note that Done keeps what was picked here, so it measures the draft against the face the sheet opened on, never the live one another client may have changed since.
        if (draft !== undefined && !sameManagerFace(draft, opened)) onPick(draft);
        dismiss();
      }}
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
      onPick={(group, key) => {
        const picked = groups
          .find((each) => each.key === group)
          ?.cells.find((each) => each.key === key)?.face;

        if (picked === undefined) return;
        setDraft(picked);
        setColor(picked.color);
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
