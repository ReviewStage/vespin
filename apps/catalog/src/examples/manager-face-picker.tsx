import {
  MANAGER_FACE_CHARACTER,
  MANAGER_FACE_COLOR,
  type ManagerFace,
} from "@repo/features/manager-face";
import { FormField } from "@repo/ui";
import { ManagerFacePicker, ManagerFaceWell } from "@repo/ui/manager-face-picker";
import { useState } from "react";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * manager-face-picker.tsx -- a Manager's face picked in the app's icon
 * picker (`IconPicker`): every face under its character, searched by color
 * and character; the well a Manager's card hangs it from, wearing the face
 * or, with none picked, the add-icon glyph; and the well held while its form
 * saves.
 */

const START: ManagerFace = {
  character: MANAGER_FACE_CHARACTER.CAT,
  color: MANAGER_FACE_COLOR.BLUE,
};

function ManagerFacePickers(): React.JSX.Element {
  const [face, setFace] = useState<ManagerFace>(START);
  const [picked, setPicked] = useState<ManagerFace | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [openNone, setOpenNone] = useState(false);

  return (
    <>
      <CatalogSection id="manager-face-picker" title="Picker">
        <ManagerFacePicker face={face} onChange={setFace} />
      </CatalogSection>
      <CatalogSection id="manager-face-well" title="In a card's Face field">
        <FormField label="Face">
          {() => (
            <ManagerFaceWell face={face} open={open} onOpenChange={setOpen} onChange={setFace} />
          )}
        </FormField>
      </CatalogSection>
      <CatalogSection id="manager-face-well-none" title="None picked yet">
        <FormField label="Face">
          {() => (
            <ManagerFaceWell
              face={picked}
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
              open={false}
              onOpenChange={() => {}}
              onChange={() => {}}
              disabled
            />
          )}
        </FormField>
      </CatalogSection>
    </>
  );
}

export const MANAGER_FACE_PICKER_EXAMPLE: Example = {
  id: "manager-face-picker",
  title: "Manager face picker",
  Render: ManagerFacePickers,
};
