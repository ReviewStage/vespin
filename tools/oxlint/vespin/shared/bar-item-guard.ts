/**
 * bar-item-guard.ts -- what the `bar-item-titled` rule reads: the stack
 * bar's items an iOS screen stands, by the tags expo-router gives them. The
 * rule started clean, so it takes no baseline.
 */
export const BAR_ITEM_GUARD_RULE = "vespin/bar-item-titled";

/** The namespace every stack bar item hangs from: `Stack.Toolbar`. */
export const BAR_NAMESPACE = ["Stack", "Toolbar"] as const;

/** The bar's items that stand a glyph in the bar: a button, and a menu's trigger. */
export const BAR_ITEM = {
  BUTTON: "Button",
  MENU: "Menu",
} as const;

/** The child an item takes its glyph from where it takes none as `icon`. */
export const BAR_ICON_CHILD = "Icon";

/** The child an item takes its title from, the one way a menu takes one without a header. */
export const BAR_LABEL_CHILD = "Label";

/** The prop a glyph is handed in. */
export const ICON_PROP = "icon";

/** The prop a menu's title may be handed in, which heads the menu it opens too. */
export const MENU_TITLE_PROP = "title";
