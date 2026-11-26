import type { ReactNode } from "react";
import { ICON_BUTTON_SIZE, IconButton } from "../button/button.js";

/**
 * icon-picker-colors.tsx -- a choice's colors in the icon picker: the choice drawn in each color it is asked in, the one it starts on pressed, which a choice's flyout (`IconPickerChoice`'s `flyout`) floats from it.
 *
 * A choice that is picked in a color, as a section's glyph is, floats its
 * colors rather than being chosen at once. The flyout is the frame: it
 * floats from the choice, lays its cells out five to a row, focuses the
 * pressed one as it opens, walks them with the arrows, and puts itself
 * away on Escape or a press away. These are its cells: the choice drawn in
 * each color (`face`), each named by its color, a press handing that color
 * on. What each color draws is its owner's, so the cells are the same
 * whatever is colored.
 */

/** One color a choice is asked in: what it is, and what a reader hears it as. */
export interface IconPickerColor<Color> {
  readonly value: Color;
  readonly label: string;
}

/** The colors a choice is asked in, as a flyout's content: the choice drawn in each, the one it `starts` on pressed, a press handing the color to `onColor`. */
export function IconPickerColors<Color>({
  colors,
  starts,
  face,
  onColor,
}: {
  /** Every color it is asked in, in order, five to a row. */
  colors: readonly IconPickerColor<Color>[];
  starts: Color;
  /** The choice drawn in a color. */
  face: (color: Color) => ReactNode;
  onColor: (color: Color) => void;
}): React.JSX.Element {
  return (
    <>
      {colors.map((color) => (
        <IconButton
          key={color.label}
          size={ICON_BUTTON_SIZE.PICKER}
          icon={face(color.value)}
          label={color.label}
          pressed={color.value === starts}
          roving
          onClick={() => onColor(color.value)}
        />
      ))}
    </>
  );
}
