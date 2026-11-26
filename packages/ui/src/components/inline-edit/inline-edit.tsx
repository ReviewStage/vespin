import type { ReactNode, Ref, RefObject } from "react";
import { useImperativeHandle, useLayoutEffect, useRef } from "react";
import { isComposingKey } from "../../composing-key.js";
import { ShadcnInput } from "../../shadcn/input.js";
import { iconPickerChoiceOf } from "../icon-picker/icon-picker.js";

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
 * A field may stand beside controls of the edit's own, as a Manager's face
 * well stands beside its name: the focus going into one of the boxes the
 * caller names (`within`), or into a flyout an icon picker's choice floats
 * that traces back into one (`iconPickerChoiceOf`), ends nothing, and
 * neither does the focus going anywhere while a layer one of them hung
 * stands (`holding`), a picker drawn in a portal outside them, as a group
 * head's editor has it (`GroupHeaderEditor`). A press away that puts the
 * layer away after the focus left says no blur again, so its owner calls
 * `leave` (`ref`), which ends the edit unless the focus stands in it.
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

/** No boxes beside the field, kept as one so a field given none redraws nothing. */
const NOTHING_WITHIN: readonly RefObject<HTMLElement | null>[] = [];

/** How an edit ended: the words to keep, if any changed, and whether a key ended it. */
export interface InlineEditEnd {
  readonly value: string | undefined;
  readonly byKey: boolean;
}

/** What an edit answers its owner: `leave` ends it as the focus leaving would, unless the focus stands in it, and `field` is its field, where the owner may hand the focus back. */
export interface InlineEditHandle {
  leave: () => void;
  field: () => HTMLInputElement | null;
}

/** Whether `target` stands in `field` or one of `within`'s boxes, traced back from a flyout an icon picker's choice floats, flyout by flyout. */
function inEdit(
  target: EventTarget | null,
  field: HTMLInputElement | null,
  within: readonly RefObject<HTMLElement | null>[],
): boolean {
  const seen = new Set<Node>();
  let on: Node | undefined = target instanceof Node ? target : undefined;

  while (on !== undefined && !seen.has(on)) {
    seen.add(on);
    const node = on;

    if (field?.contains(node) === true) return true;

    if (within.some((box) => box.current?.contains(node) === true)) return true;
    on = iconPickerChoiceOf(node);
  }

  return false;
}

/** The field, opened over `value`; it ends once, by Return, Escape, or the focus leaving it and what `within` names while nothing is `holding`. */
function InlineEditField({
  value,
  label,
  maxLength,
  look,
  placeholder,
  endsOnBlur,
  holding,
  within,
  onEnd,
  ref,
}: {
  value: string;
  label: string;
  maxLength: number | undefined;
  look: InlineEditLook;
  placeholder: string | undefined;
  endsOnBlur: boolean;
  holding: boolean;
  within: readonly RefObject<HTMLElement | null>[];
  onEnd: (end: InlineEditEnd) => void;
  ref: Ref<InlineEditHandle> | undefined;
}): React.JSX.Element {
  const field = useRef<HTMLInputElement | null>(null);
  const ended = useRef(false);
  // Note that whether a layer stands is read as the focus leaves, from the render last drawn.
  const held = useRef(holding);
  held.current = holding;
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

  useImperativeHandle(ref, () => ({
    leave: () => {
      if (!inEdit(document.activeElement, field.current, within)) end(true, false);
    },
    field: () => field.current,
  }));

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
      onBlur={
        endsOnBlur
          ? (event) => {
              if (held.current || inEdit(event.relatedTarget, field.current, within)) return;
              end(true, false);
            }
          : undefined
      }
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
  holding = false,
  within = NOTHING_WITHIN,
  onEnd,
  ref,
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
  /** Whether a layer a control of the edit's own hung stands, a picker in a portal, which the focus may go into and out of without ending the edit. */
  holding?: boolean | undefined;
  /** The boxes beside the field that are the edit's own, as a face well beside a name, which the focus may go into without ending the edit. */
  within?: readonly RefObject<HTMLElement | null>[] | undefined;
  /** How the edit ended; the caller stops editing here. */
  onEnd: (end: InlineEditEnd) => void;
  /** Ends the edit from its owner (`leave`), and hands it the field. */
  ref?: Ref<InlineEditHandle> | undefined;
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
      holding={holding}
      within={within}
      onEnd={onEnd}
      ref={ref}
    />
  );
}
