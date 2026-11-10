import type { FocusEvent, FormEvent, KeyboardEvent, RefObject } from "react";
import { isComposingKey } from "../../composing-key.js";

/**
 * editable-heading.tsx -- a heading's words edited where they are drawn, in the look of the heading they stand in, which wrap as a heading's do where a field could not.
 *
 * It is plain text a `span` holds, to stand in a heading (a page's `h1`,
 * which holds phrasing content alone) and take its type from it, its caret
 * in the accent and no box around it, so editing it moves no word. It takes
 * the focus only when its owner puts it there, as a press into its words or
 * a document's keys do, and is no Tab stop of its own. Esc leaves it back onto what holds it, and
 * Return or ↓ leaves it on into what follows; either is its owner's to
 * carry out, `onLeave` hearing which, after the key's default is held back.
 * Where it is given a bound, its words are held to it as they are typed, as
 * a field's `maxLength` holds its own, so no word stands past what is kept.
 */

/** Which way a key left the heading: back onto what holds it, or on into what follows it. */
export const EDITABLE_HEADING_LEAVE = {
  BACK: "back",
  ON: "on",
} as const;

export type EditableHeadingLeave =
  (typeof EDITABLE_HEADING_LEAVE)[keyof typeof EDITABLE_HEADING_LEAVE];

/** The way out a key asks for, or none for a key that types. */
function leaveOf(key: string): EditableHeadingLeave | undefined {
  if (key === "Escape") return EDITABLE_HEADING_LEAVE.BACK;
  if (key === "Enter" || key === "ArrowDown") return EDITABLE_HEADING_LEAVE.ON;
  return undefined;
}

/** The caret at the end of a heading's words, the heading focused. */
export function headingCaretAtEnd(element: HTMLElement): void {
  element.focus();
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
}

/** The words cut back to `maxLength` where they ran past it, the caret at their end. */
function bound(element: HTMLElement, maxLength: number | undefined): void {
  const words = element.textContent;
  if (maxLength === undefined || words.length <= maxLength) return;
  element.textContent = words.slice(0, maxLength);
  headingCaretAtEnd(element);
}

/** A heading edited in place; `onInput`, `onFocus`, and `onBlur` hear its typing and its focus. */
export function EditableHeading({
  label,
  ref,
  maxLength,
  onInput,
  onFocus,
  onBlur,
  onLeave,
}: {
  label: string;
  ref?: RefObject<HTMLElement | null> | undefined;
  /** How many characters its words may run to. */
  maxLength?: number | undefined;
  onInput?: ((event: FormEvent<HTMLElement>) => void) | undefined;
  onFocus?: ((event: FocusEvent<HTMLElement>) => void) | undefined;
  onBlur?: ((event: FocusEvent<HTMLElement>) => void) | undefined;
  onLeave: (way: EditableHeadingLeave, heading: HTMLElement) => void;
}): React.JSX.Element {
  const keyed = (event: KeyboardEvent<HTMLElement>) => {
    // Note that a key an input method took is left alone entirely, even
    // its default, because its Enter confirms a composition rather than
    // leaving the heading, and its Escape cancels one.
    if (isComposingKey(event)) return;
    const way = leaveOf(event.key);
    if (way === undefined) return;
    event.preventDefault();
    onLeave(way, event.currentTarget);
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: the words are edited in the heading's own look, which wraps as a heading does; an input cannot.
    <span
      ref={ref}
      className="ui-editable-heading"
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      role="textbox"
      aria-label={label}
      tabIndex={-1}
      spellCheck
      onFocus={onFocus}
      onInput={(event) => {
        bound(event.currentTarget, maxLength);
        onInput?.(event);
      }}
      onBlur={onBlur}
      onKeyDown={keyed}
    />
  );
}
