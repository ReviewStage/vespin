/**
 * icon-picker-frame.ts -- the picker's own frame as what it holds reads it: the band under its head where a category bar stands, and the box its grid scrolls in.
 *
 * `IconPicker` provides it and nothing else does, so no app ever has to: a
 * grid that offers its groups by category (`IconPickerEmoji`) stands its bar
 * in the band, outside the grid and its one tab stop, and jumps the box to a
 * group or hears it scroll to underline the group in view. Either is none
 * until the picker has drawn it, and outside a picker.
 */

import { createContext, useContext } from "react";

/** The picker's band for a category bar, and the box its grid scrolls in. */
interface IconPickerFrame {
  readonly band: HTMLElement | null;
  readonly scroller: HTMLElement | null;
}

/** Outside a picker, neither stands. */
const NO_FRAME: IconPickerFrame = { band: null, scroller: null };

/** The picker's frame, which `IconPicker` provides. */
export const IconPickerFrameContext = createContext<IconPickerFrame>(NO_FRAME);

/** The frame of the picker drawing the caller. */
export function useIconPickerFrame(): IconPickerFrame {
  return useContext(IconPickerFrameContext);
}
