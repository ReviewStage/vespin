import {
  MANAGER_FACE_CHARACTER,
  MANAGER_FACE_CHARACTER_NAME,
  MANAGER_FACE_PICK_COLORS,
  MANAGER_FACES,
  type ManagerFace as ManagerFaceValue,
  managerFaceName,
  managerFacesFound,
} from "@repo/features/manager-face";
import { type RefObject, useRef, useState } from "react";
import { SmilePlusIcon } from "../../icons/icons.js";
import { ReplayUnmask } from "../../session-replay-marks.js";
import { BUTTON_SIZE } from "../button/button.js";
import { IconPicker, IconPickerChoice, IconPickerGroup } from "../icon-picker/icon-picker.js";
import { NOTE_LINE_LOOK, NoteLine } from "../note-line/note-line.js";
import { PopoverIconButton } from "../popover-icon-button/popover-icon-button.js";
import { MANAGER_FACE_SIZE, ManagerFace } from "./manager-face.js";

/**
 * manager-face-picker.tsx -- where a Manager's face is picked: the app's one icon picker (`IconPicker`), as a section's icon is picked, listing every face, one group to each character in each of the colors.
 *
 * A face is a character and a color, so the picker lists all thirty-six,
 * under each character's name, each drawn as itself and named by its color
 * and character ("Purple cat"), since a face says nothing to a reader who
 * cannot see it. A search finds the faces whose name holds every word typed
 * ("purple", "cat", "purple cat"), and Enter picks the first found. The face
 * standing is pressed, and the grid's tab stop; with none standing, as at
 * New Manager before a pick, where the service picks one, the first face is.
 *
 * It stands where a section's picker does, hung from a well wearing the face
 * (`ManagerFaceWell`), as a Manager's card offers it, or beside a menu's
 * item on the menu's surface (`ManagerFaceMenuPanel`), as a Manager's Change
 * face › opens it; a pick hands the face on and puts the picker away.
 *
 * It sits on a subpath of its own (`@repo/ui/manager-face-picker`), out of
 * the barrel, as the face does, so Kawaii reaches only the bundles that
 * draw a Manager.
 */

const CHARACTERS = Object.values(MANAGER_FACE_CHARACTER);
const COLORS = MANAGER_FACE_PICK_COLORS;

/** What the search asks for. */
const SEARCH_FACES = "Search faces";

/** What the faces a search found are listed under. */
const FOUND_FACES = "Faces";

/** What the picker says where a search found no face. */
const NO_FACE_MATCHES = "No faces match.";

/** What the picker's popover is called. */
const MANAGER_FACE = "Manager face";

/** The picker as a menu's panel: on the menu's surface, which the panel beside a menu's item leaves to what it holds. */
const MENU_PANEL =
  "ui-manager-face-menu-panel rounded-menu border border-border-strong bg-popover text-popover-foreground shadow-menu animate-menu-in";

/** Whether two faces are one. */
function sameFace(one: ManagerFaceValue | undefined, other: ManagerFaceValue): boolean {
  return one?.character === other.character && one.color === other.color;
}

/** The picker; see the module's head. A pick hands the face to `onChange`. */
export function ManagerFacePicker({
  face,
  search,
  onChange,
}: {
  /** The face standing, pressed; none before a pick where the service picks one. */
  face: ManagerFaceValue | undefined;
  /** The search's field, which a popover opening the picker focuses first. */
  search?: RefObject<HTMLInputElement | null> | undefined;
  onChange: (next: ManagerFaceValue) => void;
}): React.JSX.Element {
  const [query, setQuery] = useState("");
  const searching = query.trim() !== "";
  const found = searching ? managerFacesFound(query) : MANAGER_FACES;
  const stop = found.find((one) => sameFace(face, one)) ?? found[0];

  const choice = (one: ManagerFaceValue) => (
    <IconPickerChoice
      key={`${one.character}:${one.color}`}
      label={managerFaceName(one)}
      pressed={sameFace(face, one)}
      stop={stop !== undefined && sameFace(stop, one)}
      face={<ManagerFace face={one} size={MANAGER_FACE_SIZE.ROW} />}
      onPress={() => onChange(one)}
    />
  );

  return (
    <ReplayUnmask>
      <IconPicker
        searchLabel={SEARCH_FACES}
        search={search}
        query={query}
        onQuery={setQuery}
        legend={FOUND_FACES}
      >
        {searching ? (
          found.length === 0 ? (
            <NoteLine look={NOTE_LINE_LOOK.LIST}>{NO_FACE_MATCHES}</NoteLine>
          ) : (
            <IconPickerGroup name={FOUND_FACES}>{found.map(choice)}</IconPickerGroup>
          )
        ) : (
          CHARACTERS.map((character) => (
            <IconPickerGroup key={character} name={MANAGER_FACE_CHARACTER_NAME[character]}>
              {COLORS.map((color) => choice({ character, color }))}
            </IconPickerGroup>
          ))
        )}
      </IconPicker>
    </ReplayUnmask>
  );
}

/**
 * A Manager's face well: a button wearing the face, or the add-icon glyph
 * where none is picked yet, hanging the picker while `open`, as a section's
 * icon well hangs its own. A pick hands the face on and puts the picker away.
 */
export function ManagerFaceWell({
  face,
  open,
  onOpenChange,
  onChange,
  disabled,
}: {
  face: ManagerFaceValue | undefined;
  open: boolean;
  /** Hears the picker stand or go. */
  onOpenChange: (open: boolean) => void;
  onChange: (next: ManagerFaceValue) => void;
  disabled?: boolean | undefined;
}): React.JSX.Element {
  const search = useRef<HTMLInputElement | null>(null);

  return (
    <PopoverIconButton
      icon={
        face === undefined ? (
          <SmilePlusIcon className="text-muted-foreground" />
        ) : (
          <ManagerFace face={face} size={MANAGER_FACE_SIZE.ROW} />
        )
      }
      label={face === undefined ? "Pick face" : `Change face, ${managerFaceName(face)}`}
      title={MANAGER_FACE}
      open={open}
      onOpenChange={(next) => onOpenChange(next)}
      size={BUTTON_SIZE.CONTROL}
      disabled={disabled}
      initialFocus={search}
    >
      <ManagerFacePicker
        face={face}
        search={search}
        onChange={(next) => {
          onChange(next);
          onOpenChange(false);
        }}
      />
    </PopoverIconButton>
  );
}

/** The picker as a menu's panel beside its item (`MenuPanel`'s `panel`), on the menu's surface, as a Manager's Change face › opens it: a pick hands the face on, and its owner closes the menu. */
export function ManagerFaceMenuPanel({
  face,
  onChange,
}: {
  /** The face standing, pressed. */
  face: ManagerFaceValue | undefined;
  onChange: (next: ManagerFaceValue) => void;
}): React.JSX.Element {
  return (
    <div className={MENU_PANEL}>
      <ManagerFacePicker face={face} onChange={onChange} />
    </div>
  );
}
