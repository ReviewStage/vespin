/**
 * pick-notes.tsx -- notes on elements picked on a remote surface: the outline over the element under the pointer, a numbered pin on each one picked, the card a note is written in, and the tray the notes wait in.
 */

import {
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  COMMENT_PIN_LOOK,
  CommentPin,
  GAP,
  type PickBox,
  type PickNote,
  PickNoteCard,
  PickNoteNumber,
  PickNoteTray,
  PickOutline,
  type RemotePoint,
  RemoteSurface,
  Stack,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import { useState } from "react";
import type { Example } from "../example";
import { CatalogSection } from "../section";

const WIDTH = 320;
const HEIGHT = 180;

/** The stand-in page's elements: a grid of boxes, four across and two down. */
const CELL = { width: WIDTH / 4, height: HEIGHT / 2 } as const;

/** A one-pixel gray GIF, standing in for an element's crop. */
const PICTURE =
  "data:image/gif;base64,R0lGODlhAQABAIAAAMLCwgAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==";

/** The stand-in element under a point: the cell of the grid it falls in, inset a little. */
function cellAt(point: RemotePoint): PickBox {
  const column = Math.min(3, Math.floor(point.x / CELL.width));
  const row = Math.min(1, Math.floor(point.y / CELL.height));

  return {
    x: column * CELL.width + 8,
    y: row * CELL.height + 8,
    width: CELL.width - 16,
    height: CELL.height - 16,
  };
}

function PickNotes(): React.JSX.Element {
  const [picking, setPicking] = useState(false);
  const [hovered, setHovered] = useState<PickBox | undefined>(undefined);
  const [pending, setPending] = useState<PickBox | undefined>(undefined);
  const [words, setWords] = useState("");
  const [notes, setNotes] = useState<readonly (PickNote & { readonly box: PickBox })[]>([]);

  const add = () => {
    if (pending === undefined) return;
    const number = notes.length + 1;

    setNotes([
      ...notes,
      {
        id: crypto.randomUUID(),
        number,
        words,
        element: `div.cell:nth-of-type(${String(number)})`,
        picture: PICTURE,
        box: pending,
      },
    ]);
    setPending(undefined);
    setWords("");
  };

  return (
    <CatalogSection id="pick-notes-picking" title="Picking, then sending">
      <Stack gap={GAP.FIELD}>
        <Button
          size={BUTTON_SIZE.COMPACT}
          variant={picking ? BUTTON_VARIANT.PRIMARY : BUTTON_VARIANT.OUTLINE}
          onClick={() => setPicking((on) => !on)}
        >
          Pick
        </Button>
        <div className="catalog-anchor" style={{ width: WIDTH, height: HEIGHT }}>
          <RemoteSurface
            label="The page"
            width={WIDTH}
            height={HEIGHT}
            driving={false}
            onPointer={() => undefined}
            onWheel={() => undefined}
            onKey={() => false}
            onPaste={() => undefined}
            picking={
              picking
                ? {
                    onInspect: (point) =>
                      setHovered(point === undefined ? undefined : cellAt(point)),
                    onPick: (point) => setPending(cellAt(point)),
                    onEnd: () => {
                      setPicking(false);
                      setHovered(undefined);
                    },
                  }
                : undefined
            }
          />
          {picking && hovered !== undefined ? (
            <PickOutline box={hovered} label={`div.cell · ${String(CELL.width - 16)}×74`} />
          ) : null}
          {notes.map((note) => (
            <div
              key={note.id}
              className="catalog-pick-pin"
              style={{ left: note.box.x - 12, top: note.box.y - 12 }}
            >
              <CommentPin
                look={COMMENT_PIN_LOOK.NOTE}
                number={note.number}
                label={`Note ${String(note.number)}`}
                preview={note.words}
                open={false}
                onPress={() => undefined}
                onHover={() => undefined}
              />
            </div>
          ))}
        </div>
        {pending === undefined ? (
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            {picking ? "Press a box to note it · Escape stops" : "Pick to note the boxes"}
          </Text>
        ) : (
          <PickNoteCard
            value={words}
            onChange={setWords}
            onAdd={add}
            onCancel={() => setPending(undefined)}
            adds="Add note"
          />
        )}
        <PickNoteTray
          notes={notes}
          sendLabel="Send to Invite expiry"
          sending={false}
          onRemove={(id) => setNotes(notes.filter((note) => note.id !== id))}
          onClear={() => setNotes([])}
          onSend={() => setNotes([])}
        />
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          A note waiting wears <PickNoteNumber number={1} /> on its pin and in the tray.
        </Text>
      </Stack>
    </CatalogSection>
  );
}

export const PICK_NOTES_EXAMPLE: Example = {
  id: "pick-notes",
  title: "Pick notes",
  Render: PickNotes,
};
