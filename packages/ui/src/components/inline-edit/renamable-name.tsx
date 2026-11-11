import type { ReactNode } from "react";
import { VisuallyHidden } from "../visually-hidden/visually-hidden.js";
import { INLINE_EDIT_LOOK, InlineEdit, type InlineEditEnd } from "./inline-edit.js";

/**
 * renamable-name.tsx -- a name renamed where it is drawn by pressing it, as a Linear issue's title is: the app's one way to rename a thing whose row a press does nothing else on.
 *
 * Every name a reader can rename whose row has no press of its own (a run
 * action's label, a workspace's name, a subscription's) stands in this, so
 * each renames the same way. At rest it is the name in the row's own type,
 * which washes under the pointer as a byline's name does and takes a text
 * caret there, so it reads as words that can be typed over; a press, or
 * Return or Space with it focused, opens the field in its place, bare in
 * the same type with no box, all of it selected, so the name being typed
 * stands where it was drawn. Return or the focus leaving keeps what was
 * typed, Escape the name it opened on (`InlineEdit`). The caller holds
 * whether it is open, as `useInlineRename` holds it, so the row's ⋯ may
 * open it too, as the keyboard's other way in. A row whose press opens
 * what it names (a task, an agent, a tab) renames from its menu instead,
 * through `InlineEdit` itself, since a press on its name already means
 * open. A name the reader may not rename, or one with nothing to open it,
 * is drawn plain. The press says "Rename" to a reader before the name,
 * in words rather than an attribute, so a screen recording masks the name
 * with the rest of the words.
 */

/** The name at rest: the line's own type and ink, washing under the pointer and the keyboard, a text caret over it. */
const NAME_PRESS =
  "ui-renamable-name inline-flex min-w-0 max-w-full cursor-text items-center rounded-ui-6 border-0 bg-transparent p-0 text-start text-inherit [font:inherit] transition-[background-color,box-shadow] duration-(--ui-duration-hover) ease-motion-exit hover:bg-muted hover:shadow-inline-ref-wash hover:[--ui-inline-ref-wash:var(--ui-color-fill-hover)] focus-visible:bg-muted focus-visible:shadow-inline-ref-wash focus-visible:[--ui-inline-ref-wash:var(--ui-color-fill-hover)]";

/** A name pressed to rename it in place; `onBegin` opens the field, which the caller then holds open through `editing` until `onEnd`. */
export function RenamableName({
  value,
  label,
  editing,
  onBegin,
  onEnd,
  maxLength,
  placeholder,
  children,
}: {
  value: string;
  /** What the name is called for a reader: "Run action name". */
  label: string;
  editing: boolean;
  /** Opens the field; none for a name the reader may not rename, drawn plain. */
  onBegin: (() => void) | undefined;
  /** How the edit ended; the caller stops editing here. */
  onEnd: (end: InlineEditEnd) => void;
  maxLength?: number | undefined;
  /** What the empty field says, muted, as a new thing's does. */
  placeholder?: string | undefined;
  /** What stands for the name at rest; `value` in plain text where none is given. */
  children?: ReactNode;
}): React.JSX.Element {
  if (editing) {
    return (
      <InlineEdit
        value={value}
        label={label}
        editing
        look={INLINE_EDIT_LOOK.FIELD}
        maxLength={maxLength}
        placeholder={placeholder}
        onEnd={onEnd}
      />
    );
  }
  const shown = children ?? value;
  if (onBegin === undefined) return <>{shown}</>;
  return (
    <button type="button" className={NAME_PRESS} onClick={onBegin}>
      <VisuallyHidden>Rename </VisuallyHidden>
      {shown}
    </button>
  );
}
