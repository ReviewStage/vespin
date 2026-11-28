import { CloseIcon } from "../../icons/lucide-glyphs.js";
import { BUTTON_SIZE, BUTTON_VARIANT, Button, IconButton } from "../button/button.js";
import { GAP, Inline, JUSTIFY, Stack } from "../layout/layout.js";
import { MenuSurface } from "../menu/menu-surface.js";
import { TEXT_ELEMENT, TEXT_FONT, TEXT_TONE, Text } from "../text/text.js";
import { TEXT_VARIANT } from "../text/text-role.js";
import { TEXT_AREA_SUBMIT, TextArea } from "../text-field/text-field.js";

/**
 * pick-notes.tsx -- notes on elements picked on a page drawn on a remote surface: the outline over the element under the pointer, the card a note is written in, and the tray the notes wait in until they are sent.
 *
 * The outline stands over the surface at the element's box, in the
 * surface's own pixels, with a label naming the element above it, or inside
 * its top where there is no room above; it takes no press, so the surface
 * under it still hears the pointer. The card holds the note's words, Enter
 * adding it and Escape letting it go, and its owner floats it by the
 * element (`RectFloat`). The tray lists the notes in the order they were
 * picked, each by its number, the number its pin wears over the page
 * (`CommentPin`'s note look), a picture of its element, its words, and the
 * element's name, with a press that removes it; under them, how many there
 * are, Clear, and the one press that sends them all. What a note shows is
 * the page's and the member's, so none of it is unmasked for session replay.
 */

/** A box over the surface, in its pixels from its top left corner. */
export interface PickBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One note as the tray lists it. */
export interface PickNote {
  readonly id: string;
  /** Its place among the notes, from one, as its pin wears it. */
  readonly number: number;
  readonly words: string;
  /** The element it is on, by its name or selector. */
  readonly element: string;
  /** A picture of the element, as an address an image loads. */
  readonly picture: string;
}

/** The least room above an element its label stands in; with less, it stands inside the element's top. */
const LABEL_ROOM = 20;

/** The number a note wears, in the tray and on its pin alike. */
export function PickNoteNumber({ number }: { number: number }): React.JSX.Element {
  return (
    <span
      className="ui-pick-note-number inline-flex size-avatar-inline flex-none items-center justify-center rounded-ui-full bg-accent-fill text-caption text-on-accent tabular-nums"
      aria-hidden="true"
    >
      {number}
    </span>
  );
}

/** The outline over the element under the pointer, `label` naming it. */
export function PickOutline({ box, label }: { box: PickBox; label: string }): React.JSX.Element {
  const inside = box.y < LABEL_ROOM;

  return (
    <div
      className="ui-pick-outline pointer-events-none absolute rounded-ui-6 outline-2 outline-offset-2 outline-accent-fill outline-solid"
      style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
    >
      {label === "" ? null : (
        <span
          className="ui-pick-outline-label absolute left-0 max-w-popover-narrow flex rounded-ui-6 bg-accent-fill px-ui-4 font-mono text-caption text-on-accent data-[inside=false]:bottom-full data-[inside=false]:mb-ui-4 data-[inside=true]:top-ui-2"
          data-inside={inside}
        >
          <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.INHERIT} truncate>
            {label}
          </Text>
        </span>
      )}
    </div>
  );
}

/** The card a note on a picked element is written in: Enter or Add note adds it, Escape or Cancel lets it go. */
export function PickNoteCard({
  value,
  onChange,
  onAdd,
  onCancel,
  adds,
}: {
  value: string;
  onChange: (value: string) => void;
  onAdd: () => void;
  onCancel: () => void;
  /** What Add note says: "Add note" for a new one, "Save" for one written again. */
  adds: string;
}): React.JSX.Element {
  const empty = value.trim() === "";

  return (
    <MenuSurface className="ui-pick-note-card w-popover-narrow">
      <Stack gap={GAP.CONTROL}>
        <TextArea
          value={value}
          onChange={onChange}
          rows={2}
          grow
          autoFocus
          placeholder="What should change here?"
          label="Note"
          submitKey={TEXT_AREA_SUBMIT.ENTER}
          onSubmit={() => {
            if (!empty) onAdd();
          }}
          onEscape={onCancel}
        />
        <Inline gap={GAP.CONTROL} justify={JUSTIFY.END}>
          <Button size={BUTTON_SIZE.COMPACT} variant={BUTTON_VARIANT.QUIET} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size={BUTTON_SIZE.COMPACT}
            variant={BUTTON_VARIANT.PRIMARY}
            disabled={empty}
            onClick={onAdd}
          >
            {adds}
          </Button>
        </Inline>
      </Stack>
    </MenuSurface>
  );
}

/** The notes waiting to be sent, each removable, and Clear and `sendLabel` for all of them; nothing while there are none. */
export function PickNoteTray({
  notes,
  sendLabel,
  sending,
  onRemove,
  onClear,
  onSend,
}: {
  notes: readonly PickNote[];
  /** What the send says: Send to the agent, by its name. */
  sendLabel: string;
  /** Whether the notes are on their way, when neither Clear nor the send may be pressed. */
  sending: boolean;
  onRemove: (id: string) => void;
  onClear: () => void;
  onSend: () => void;
}): React.JSX.Element | null {
  if (notes.length === 0) return null;

  return (
    <section
      className="ui-pick-note-tray flex flex-none flex-col gap-tight-gap border-t border-border px-column-inset py-tight-gap"
      aria-label="Notes"
    >
      <ol className="ui-pick-note-list m-0 flex max-h-[40cqh] list-none flex-col gap-tight-gap overflow-y-auto p-0">
        {notes.map((note) => (
          <li key={note.id} className="ui-pick-note flex min-w-0 items-center gap-control-gap">
            <PickNoteNumber number={note.number} />
            <img
              className="ui-pick-note-picture h-control w-control-large flex-none rounded-ui-6 border border-border object-cover"
              src={note.picture}
              alt=""
            />
            <div className="ui-pick-note-words flex min-w-0 flex-1 flex-col">
              <Text variant={TEXT_VARIANT.BODY} truncate>
                {note.words}
              </Text>
              <Text
                variant={TEXT_VARIANT.CAPTION}
                tone={TEXT_TONE.MUTED}
                font={TEXT_FONT.MONO}
                truncate
              >
                {note.element}
              </Text>
            </div>
            <IconButton
              icon={<CloseIcon aria-hidden="true" />}
              label={`Remove note ${String(note.number)}`}
              size={BUTTON_SIZE.COMPACT}
              disabled={sending}
              onClick={() => onRemove(note.id)}
            />
          </li>
        ))}
      </ol>
      <Inline gap={GAP.CONTROL} justify={JUSTIFY.BETWEEN} wrap={false}>
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          {notes.length === 1 ? "1 note" : `${String(notes.length)} notes`}
        </Text>
        <Inline gap={GAP.CONTROL} wrap={false}>
          <Button
            size={BUTTON_SIZE.COMPACT}
            variant={BUTTON_VARIANT.QUIET}
            disabled={sending}
            onClick={onClear}
          >
            Clear
          </Button>
          <Button
            size={BUTTON_SIZE.COMPACT}
            variant={BUTTON_VARIANT.PRIMARY}
            disabled={sending}
            onClick={onSend}
          >
            {sending ? "Sending…" : sendLabel}
          </Button>
        </Inline>
      </Inline>
    </section>
  );
}
