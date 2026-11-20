import {
  MANAGER_FACE_CHARACTER,
  MANAGER_FACE_COLOR,
  type ManagerFace,
} from "@repo/features/manager-face";
import { FormField } from "@repo/ui";
import { ManagerFacePicker } from "@repo/ui/manager-face-picker";
import { useState } from "react";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * manager-face-picker.tsx -- the Face field of a Manager's card: its
 * characters in the color chosen and its colors on the character chosen,
 * picking as pressed; and the same field held while its form saves.
 */

const START: ManagerFace = {
  character: MANAGER_FACE_CHARACTER.CAT,
  color: MANAGER_FACE_COLOR.BLUE,
};

function ManagerFacePickers(): React.JSX.Element {
  const [face, setFace] = useState<ManagerFace>(START);

  return (
    <>
      <CatalogSection id="manager-face-picker" title="Picking">
        <FormField label="Face">
          {(control) => (
            <ManagerFacePicker
              face={face}
              describedBy={control["aria-describedby"]}
              onChange={setFace}
            />
          )}
        </FormField>
      </CatalogSection>
      <CatalogSection id="manager-face-picker-disabled" title="While saving">
        <FormField label="Face">
          {() => <ManagerFacePicker face={START} disabled onChange={() => {}} />}
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
