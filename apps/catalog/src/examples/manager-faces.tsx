import {
  MANAGER_FACE_CHARACTER,
  MANAGER_FACE_COLOR,
  type ManagerFace as ManagerFaceValue,
} from "@repo/features/manager-face";
import { GAP, Inline, Stack, TEXT_ELEMENT, TEXT_VARIANT, Text } from "@repo/ui";
import { MANAGER_FACE_SIZE, ManagerFace, type ManagerFaceSize } from "@repo/ui/manager-face";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * manager-faces.tsx -- every character in every color at a row's and a
 * message's size, at rest and working, a row of each character so the
 * colors line up; and a few faces beside the Managers' names, as the sidebar
 * and the chat will draw them.
 */

/** The faces beside their names, each a character in a different color, two of them at work. */
const MANAGERS = [
  {
    name: "Release train",
    face: { character: MANAGER_FACE_CHARACTER.GHOST, color: MANAGER_FACE_COLOR.PINK },
    working: true,
  },
  {
    name: "Docs gardener",
    face: { character: MANAGER_FACE_CHARACTER.PLANET, color: MANAGER_FACE_COLOR.BLUE },
    working: false,
  },
  {
    name: "Inbox triage",
    face: { character: MANAGER_FACE_CHARACTER.CAT, color: MANAGER_FACE_COLOR.YELLOW },
    working: true,
  },
  {
    name: "Billing",
    face: { character: MANAGER_FACE_CHARACTER.MUG, color: MANAGER_FACE_COLOR.GREEN },
    working: false,
  },
] as const satisfies readonly {
  name: string;
  face: ManagerFaceValue;
  working: boolean;
}[];

/** Every character in every color at `size`, a row to each character. */
function FaceGrid({
  size,
  working,
}: {
  size: ManagerFaceSize;
  working: boolean;
}): React.JSX.Element {
  return (
    <Stack gap={GAP.CONTROL}>
      {Object.values(MANAGER_FACE_CHARACTER).map((character) => (
        <Inline key={character} gap={GAP.CONTROL}>
          {Object.values(MANAGER_FACE_COLOR).map((color) => (
            <ManagerFace key={color} face={{ character, color }} size={size} working={working} />
          ))}
        </Inline>
      ))}
    </Stack>
  );
}

function ManagerFaces(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="manager-face-row-resting" title="Row, at rest">
        <FaceGrid size={MANAGER_FACE_SIZE.ROW} working={false} />
      </CatalogSection>
      <CatalogSection id="manager-face-row-working" title="Row, working">
        <FaceGrid size={MANAGER_FACE_SIZE.ROW} working />
      </CatalogSection>
      <CatalogSection id="manager-face-message-resting" title="Message, at rest">
        <FaceGrid size={MANAGER_FACE_SIZE.MESSAGE} working={false} />
      </CatalogSection>
      <CatalogSection id="manager-face-message-working" title="Message, working">
        <FaceGrid size={MANAGER_FACE_SIZE.MESSAGE} working />
      </CatalogSection>
      <CatalogSection id="manager-face-names" title="Beside their names">
        <Stack gap={GAP.CONTROL}>
          {MANAGERS.map(({ name, face, working }) => (
            <Inline key={name} gap={GAP.ICON} wrap={false}>
              <ManagerFace face={face} size={MANAGER_FACE_SIZE.ROW} working={working} />
              <Text variant={TEXT_VARIANT.LABEL} as={TEXT_ELEMENT.SPAN}>
                {name}
              </Text>
            </Inline>
          ))}
        </Stack>
      </CatalogSection>
    </>
  );
}

export const MANAGER_FACES_EXAMPLE: Example = {
  id: "manager-faces",
  title: "Manager faces",
  Render: ManagerFaces,
};
