import {
  MANAGER_FACE_CHARACTER,
  MANAGER_FACE_COLOR,
  type ManagerFace,
} from "@repo/features/manager-face";
import { BUTTON_SIZE, FormField } from "@repo/ui";
import {
  ManagerFacePicker,
  type ManagerFaceRecent,
  ManagerFaceWell,
} from "@repo/ui/manager-face-picker";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * manager-face-picker.tsx -- a Manager's face picked in the app's icon
 * picker (`IconPicker`), as a section's icon is: Recent and the characters,
 * every emoji, a search over both, and a face's colors popped up from the
 * face pressed; the well a Manager's card hangs it from, wearing the face
 * or, with none picked, the add-icon glyph, compact in an editor; and the
 * well held while its form saves. The emoji load on a Query client of the
 * example's own, as a window's root provides one.
 */

const START: ManagerFace = {
  character: MANAGER_FACE_CHARACTER.CAT,
  color: MANAGER_FACE_COLOR.BLUE,
};

/** The faces picked last, kept for the page's life, as the window keeps them in its storage. */
function pageRecent(): ManagerFaceRecent {
  let faces: readonly ManagerFace[] = [
    { character: MANAGER_FACE_CHARACTER.GHOST, color: MANAGER_FACE_COLOR.PURPLE },
    { character: MANAGER_FACE_CHARACTER.CAT, color: MANAGER_FACE_COLOR.ORANGE, emoji: "🦊" },
  ];

  return {
    read: () => faces,
    write: (next) => {
      faces = next;
    },
  };
}

const RECENT = pageRecent();

const QUERIES = new QueryClient();

function ManagerFacePickers(): React.JSX.Element {
  const [face, setFace] = useState<ManagerFace>(START);
  const [picked, setPicked] = useState<ManagerFace | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [openNone, setOpenNone] = useState(false);
  const [openCompact, setOpenCompact] = useState(false);

  return (
    <QueryClientProvider client={QUERIES}>
      <CatalogSection id="manager-face-picker" title="Picker">
        <ManagerFacePicker face={face} recent={RECENT} onChange={setFace} />
      </CatalogSection>
      <CatalogSection id="manager-face-well" title="In a card's Face field">
        <FormField label="Face">
          {() => (
            <ManagerFaceWell
              face={face}
              recent={RECENT}
              open={open}
              onOpenChange={setOpen}
              onChange={setFace}
            />
          )}
        </FormField>
      </CatalogSection>
      <CatalogSection id="manager-face-well-compact" title="In an editor">
        <ManagerFaceWell
          face={face}
          recent={RECENT}
          open={openCompact}
          onOpenChange={setOpenCompact}
          onChange={setFace}
          size={BUTTON_SIZE.COMPACT}
        />
      </CatalogSection>
      <CatalogSection id="manager-face-well-none" title="None picked yet">
        <FormField label="Face">
          {() => (
            <ManagerFaceWell
              face={picked}
              recent={RECENT}
              open={openNone}
              onOpenChange={setOpenNone}
              onChange={setPicked}
            />
          )}
        </FormField>
      </CatalogSection>
      <CatalogSection id="manager-face-well-disabled" title="While saving">
        <FormField label="Face">
          {() => (
            <ManagerFaceWell
              face={START}
              recent={RECENT}
              open={false}
              onOpenChange={() => {}}
              onChange={() => {}}
              disabled
            />
          )}
        </FormField>
      </CatalogSection>
    </QueryClientProvider>
  );
}

export const MANAGER_FACE_PICKER_EXAMPLE: Example = {
  id: "manager-face-picker",
  title: "Manager face picker",
  Render: ManagerFacePickers,
};
