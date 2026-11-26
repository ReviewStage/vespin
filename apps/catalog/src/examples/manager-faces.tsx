import {
  MANAGER_FACE_CHARACTER,
  MANAGER_FACE_COLOR,
  MANAGER_FACE_PICK_COLORS,
  type ManagerFace as ManagerFaceValue,
} from "@repo/features/manager-face";
import {
  GAP,
  INLINE_REF_LOOK,
  Inline,
  InlineRef,
  Stack,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import { MANAGER_FACE_SIZE, ManagerFace, type ManagerFaceSize } from "@repo/ui/manager-face";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * manager-faces.tsx -- every character, and a few emoji, in every color a
 * face is given in, at a row's and a message's size, at rest and working, a
 * row of each so the colors line up; and a few faces beside the Managers'
 * names, as the sidebar and the chat draw them, and among words, in a
 * mention's chip.
 */

/** A few emoji a face may wear in its character's place, a row of each in the grid. */
const EMOJI = ["🚀", "🦊", "📚", "🧪"] as const;

/** The faces beside their names, each a character or an emoji in a different color, some of them at work. */
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
  {
    name: "Launch",
    face: { character: MANAGER_FACE_CHARACTER.GHOST, color: MANAGER_FACE_COLOR.TEAL, emoji: "🚀" },
    working: true,
  },
  {
    name: "Research",
    face: {
      character: MANAGER_FACE_CHARACTER.GHOST,
      color: MANAGER_FACE_COLOR.ORANGE,
      emoji: "📚",
    },
    working: false,
  },
] as const satisfies readonly {
  name: string;
  face: ManagerFaceValue;
  working: boolean;
}[];

/** Every character and each emoji in every color a face is given in at `size`, a row to each. */
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
          {MANAGER_FACE_PICK_COLORS.map((color) => (
            <ManagerFace key={color} face={{ character, color }} size={size} working={working} />
          ))}
        </Inline>
      ))}
      {EMOJI.map((emoji) => (
        <Inline key={emoji} gap={GAP.CONTROL}>
          {MANAGER_FACE_PICK_COLORS.map((color) => (
            <ManagerFace
              key={color}
              face={{ character: MANAGER_FACE_CHARACTER.GHOST, color, emoji }}
              size={size}
              working={working}
            />
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
      <CatalogSection id="manager-face-words" title="Among words, in a mention's chip">
        <Stack gap={GAP.CONTROL}>
          {MANAGERS.map(({ name, face, working }) => (
            <Text key={name}>
              Ask{" "}
              <InlineRef
                look={INLINE_REF_LOOK.PILL}
                glyph={<ManagerFace face={face} size={MANAGER_FACE_SIZE.WORDS} working={working} />}
                label={name}
              />{" "}
              to take it on.
            </Text>
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
