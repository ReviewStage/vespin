import type { ReactNode } from "react";
import { useLayoutEffect, useRef } from "react";
import { isComposingKey } from "../../composing-key.js";
import { ShadcnInput } from "../../shadcn/input.js";

/**
 * inline-edit.tsx -- words edited where they are drawn: shown as they stand, and, while the caller says, a field over them in their place.
 *
 * The caller holds whether it is editing, as a list holds which row it is
 * renaming, and draws the words itself (`children`) where it shows them in
 * more than plain text. The field opens with all of them selected. Return
 * or the focus leaving keeps what was typed, and Escape keeps the words it
 * opened on; words left empty or unchanged change nothing. The field is
 * uncontrolled, so the caller hears only how the edit ended, once, by
 * whichever of those came first, and whether a key ended it, so it can hand
 * focus back to what it draws while not editing.
 *
 * Text arriving through an input method is composed in place before it is
 * committed, so the Return that commits a composition, and the Escape that
 * dismisses its candidates, are the input method's and end nothing. Note
 * that every Escape goes no further than the field, a composing one too,
 * because the surface behind it would otherwise answer it, leaving the page
 * the field stands on.
 *
 * The field is shadcn/ui's input (`../../shadcn/input.tsx`, on Base UI),
 * each look drawn over the input's own classes by a variant on its
 * `data-look`, which outranks them whatever order the utilities land in, in
 * Tailwind utilities over the theme's field roles; the field's line and
 * weight revert to the layers under the utilities, as no rule set them
 * before. It keeps the
 * `ui-inline-edit` name a container that sizes it finds it by. On a
 * finger's device each look takes at least 16px words, or iOS zooms the page
 * into the field the moment it is focused.
 */

/**
 * How the field is drawn: bare in the words' own type across the line they
 * stood on, as a list's row renames and a name pressed to rename it
 * (`RenamableName`) does, the caret and the selection alone marking it, so
 * the name being typed stands where it is drawn; or bare in the type around
 * it at its own width, where what it stands in is a well, as a tab's is.
 * There is no boxed look: a settings row's name is renamed by pressing it.
 */
export const INLINE_EDIT_LOOK = {
  FIELD: "field",
  WELL: "well",
} as const;

export type InlineEditLook = (typeof INLINE_EDIT_LOOK)[keyof typeof INLINE_EDIT_LOOK];

/**
 * The field's looks, each keyed on its `data-look`. As a field, bare in the
 * type around it, as wide as the line it stands on; in a well, bare in the
 * type around it, wearing no ring, as no field does. How wide a field or a well
 * stands is its container's to say. A group head's editor
 * (`GroupHeaderEditor`) draws its field in the well look too.
 */
export const INLINE_EDIT_FIELD =
  "ui-inline-edit pointer-coarse:data-[look]:text-touch " +
  "data-[look=field]:block data-[look=field]:h-auto data-[look=field]:w-full data-[look=field]:rounded-none data-[look=field]:border-0 data-[look=field]:bg-transparent data-[look=field]:focus:bg-transparent data-[look=field]:p-0 data-[look=field]:text-inherit data-[look=field]:outline-none data-[look=field]:[font:inherit] " +
  "data-[look=well]:inline-block data-[look=well]:h-auto data-[look=well]:w-auto data-[look=well]:rounded-none data-[look=well]:border-0 data-[look=well]:bg-transparent data-[look=well]:focus:bg-transparent data-[look=well]:p-0 data-[look=well]:text-inherit data-[look=well]:outline-none data-[look=well]:[font:inherit]";

/** How an edit ended: the words to keep, if any changed, and whether a key ended it. */
export interface InlineEditEnd {
  readonly value: string | undefined;
  readonly byKey: boolean;
}

/** The field, opened over `value`; it ends once, by Return, Escape, or the focus leaving. */
function InlineEditField({
  value,
  label,
  maxLength,
  look,
  placeholder,
  endsOnBlur,
  onEnd,
}: {
  value: string;
  label: string;
  maxLength: number | undefined;
  look: InlineEditLook;
  placeholder: string | undefined;
  endsOnBlur: boolean;
  onEnd: (end: InlineEditEnd) => void;
}): React.JSX.Element {
  const field = useRef<HTMLInputElement | null>(null);
  const ended = useRef(false);
  useLayoutEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);

  const end = (keep: boolean, byKey: boolean) => {
    if (ended.current) return;
    ended.current = true;
    const typed = field.current?.value.trim() ?? "";
    onEnd({ value: keep && typed !== "" && typed !== value ? typed : undefined, byKey });
  };

  return (
    <ShadcnInput
      ref={field}
      type="text"
      className={INLINE_EDIT_FIELD}
      data-look={look}
      aria-label={label}
      defaultValue={value}
      placeholder={placeholder}
      maxLength={maxLength}
      spellCheck={false}
      onBlur={endsOnBlur ? () => end(true, false) : undefined}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (!isComposingKey(event)) end(false, true);
        }
        if (event.key === "Enter" && !isComposingKey(event)) {
          event.preventDefault();
          end(true, true);
        }
      }}
    />
  );
}

/** `value` shown, or drawn as `children`, until `editing`, and then a field named `label` editing it in place. */
export function InlineEdit({
  value,
  label,
  editing,
  maxLength,
  look = INLINE_EDIT_LOOK.FIELD,
  placeholder,
  endsOnBlur = true,
  onEnd,
  children,
}: {
  value: string;
  /** What the field is called for a reader. */
  label: string;
  editing: boolean;
  maxLength?: number | undefined;
  look?: InlineEditLook | undefined;
  /** What the empty field says, muted, as an empty line on a description says what to write: a new thing's field, which opens empty. */
  placeholder?: string | undefined;
  /** Whether the focus leaving ends the edit; a field beside controls of its own, a new thing's whose chips it leaves for, is ended by its keys and its caller alone. */
  endsOnBlur?: boolean | undefined;
  /** How the edit ended; the caller stops editing here. */
  onEnd: (end: InlineEditEnd) => void;
  /** What stands in the field's place while not editing; `value` in plain text where none is given. */
  children?: ReactNode;
}): React.JSX.Element {
  if (!editing) return <>{children ?? value}</>;
  return (
    <InlineEditField
      value={value}
      label={label}
      maxLength={maxLength}
      look={look}
      placeholder={placeholder}
      endsOnBlur={endsOnBlur}
      onEnd={onEnd}
    />
  );
}
