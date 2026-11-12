/**
 * settings-row-end-guard.ts -- what the `settings-row-end` rule reads: the
 * presses a glyph wide that a settings row stands in its `end`, and the rows
 * whose controls drop below their words where they leave the words too
 * little room. The rule started clean, so it takes no baseline.
 */
export const SETTINGS_ROW_END_GUARD_RULE = "vespin/settings-row-end";

/** The `@repo/ui` presses a glyph wide, and the room of one, which stand in a row's end rather than among its controls. */
export const END_PRESSES: ReadonlySet<string> = new Set([
  "IconButton",
  "MoreButton",
  "SettingsRowActSlot",
]);

/** The row a page draws, whose `children` are its controls. */
export const SETTINGS_ROW = "SettingsRow";

/** The panel's row with acts, whose `row` prop's `control` and `describedControl` are its controls. */
export const MENU_ROW = "MenuRow";

/** The `row` properties of a `MenuRow` that hold its controls. */
export const MENU_ROW_CONTROLS: ReadonlySet<string> = new Set(["control", "describedControl"]);
