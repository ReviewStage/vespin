import type { KeyboardEvent, Ref } from "react";
import { isComposingKey } from "../../composing-key.js";
import { ShadcnTextarea } from "../../shadcn/textarea.js";

/**
 * caption-field.tsx -- a picture's caption typed where it is drawn: muted words under the picture, with no box, as a document editor writes an image's caption.
 *
 * The field stands in the caption's own type and ink, bare, wrapping and
 * growing with its words as the caption it stands for does, so the words
 * being typed sit where they are read. Its placeholder shows only while
 * it holds the caret and is empty: a caption left empty draws nothing.
 * A caption is one paragraph, so a line break typed or pasted is a space.
 *
 * The field is the way out of itself, as a line of the text around it is:
 * Return starts a new line after the picture (`onLeave` with
 * `CAPTION_LEAVE.NEW_LINE`), ↓ from its last line goes on to the line that
 * follows (`CAPTION_LEAVE.DOWN`), and ↑ from its first line goes back to the
 * picture above it (`CAPTION_LEAVE.UP`). Note that a field of one line is on
 * its first and last line at once, and that a longer one counts the caret at
 * its start as its first line and at its end as its last, because a
 * textarea does not say which line the caret stands on. Escape leaves it
 * for the picture too (`onEscape`), marked taken so the page behind it stays.
 * None of those keys answer while an input method is composing.
 *
 * Drawn by shadcn/ui's textarea (`../../shadcn/textarea.tsx`), its well
 * replaced whole by the caption's type, in Tailwind utilities over the theme.
 */

/** Which way the caret leaves a caption: back to the picture above it, on to the line that follows, or to a new line it starts. */
export const CAPTION_LEAVE = {
  UP: "up",
  DOWN: "down",
  NEW_LINE: "new-line",
} as const;

export type CaptionLeave = (typeof CAPTION_LEAVE)[keyof typeof CAPTION_LEAVE];

/**
 * The caption's own look in place of the well's: bare, in the caption's
 * type and the secondary ink, growing with its words; the placeholder
 * hidden until the field holds the caret; 16px words under a finger, or
 * iOS zooms into it.
 */
const CAPTION_FIELD =
  "ui-caption-field m-0 block h-auto min-h-0 w-full resize-none overflow-hidden rounded-none border-0 bg-transparent p-0 text-picture-caption text-muted-foreground outline-none field-sizing-content focus:bg-transparent placeholder:opacity-0 focus:placeholder:opacity-100 pointer-coarse:text-touch";

/** Whether the field's words wrap to more than one line, as laid out; a field not laid out counts as one. */
function wraps(field: HTMLTextAreaElement): boolean {
  const line = Number.parseFloat(getComputedStyle(field).lineHeight);

  return Number.isFinite(line) && field.scrollHeight > line * 1.5;
}

/** Which way a key leaves the field, if it leaves at all. */
function leavingBy(event: KeyboardEvent<HTMLTextAreaElement>): CaptionLeave | undefined {
  const field = event.currentTarget;
  const { selectionStart, selectionEnd, value } = field;
  const caret = selectionStart === selectionEnd;

  if (event.key === "Enter") return CAPTION_LEAVE.NEW_LINE;

  if (!caret || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return undefined;

  if (event.key === "ArrowUp" && (selectionStart === 0 || !wraps(field))) return CAPTION_LEAVE.UP;

  if (event.key === "ArrowDown" && (selectionEnd === value.length || !wraps(field))) {
    return CAPTION_LEAVE.DOWN;
  }

  return undefined;
}

/** A picture's caption typed in place, its words the caller holds, leaving by the keys a line of text leaves by. */
export function CaptionField({
  value,
  onChange,
  label,
  placeholder,
  onLeave,
  onEscape,
  onBlur,
  ref,
}: {
  value: string;
  /** Each change, a line break as a space. */
  onChange: (value: string) => void;
  /** What the field is called for a reader: "Caption". */
  label: string;
  /** What the empty field says while it holds the caret. */
  placeholder?: string | undefined;
  /** The caret leaving by a key, the way it goes. */
  onLeave: (way: CaptionLeave) => void;
  /** What an Escape does, pressed while no input method is composing. */
  onEscape?: (() => void) | undefined;
  /** What the caret going elsewhere does. */
  onBlur?: (() => void) | undefined;
  ref?: Ref<HTMLTextAreaElement> | undefined;
}): React.JSX.Element {
  return (
    <ShadcnTextarea
      ref={ref}
      className={CAPTION_FIELD}
      rows={1}
      aria-label={label}
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value.replace(/\r?\n/gu, " "))}
      onBlur={onBlur}
      onKeyDown={(event) => {
        if (isComposingKey(event)) return;

        if (event.key === "Escape" && onEscape !== undefined) {
          event.preventDefault();
          onEscape();

          return;
        }

        const way = leavingBy(event);

        if (way === undefined) return;
        event.preventDefault();
        onLeave(way);
      }}
    />
  );
}
