/**
 * list-row-hint.ts -- the hint a row's press hangs, as `ListRow` takes it and the app's tooltip draws it, kept apart so the tooltip does not import the row.
 */

import type {
  ComponentType,
  FocusEventHandler,
  PointerEventHandler,
  ReactElement,
  RefObject,
} from "react";

/** What a hint hands the press it wraps: when to show and go, and what it says of the press. */
interface ListRowHintProps {
  "aria-describedby"?: string | undefined;
  "aria-keyshortcuts"?: string | undefined;
  onPointerEnter?: PointerEventHandler<HTMLElement> | undefined;
  onPointerLeave?: PointerEventHandler<HTMLElement> | undefined;
  onPointerDown?: PointerEventHandler<HTMLElement> | undefined;
  onFocus?: FocusEventHandler<HTMLElement> | undefined;
  onBlur?: FocusEventHandler<HTMLElement> | undefined;
}

/** The app's hint a row's press hangs: its words, the row the press stands in, and the press it wraps. */
export type ListRowHint = ComponentType<{
  label: string | undefined;
  row: RefObject<HTMLElement | null>;
  children: ReactElement<ListRowHintProps>;
}>;
