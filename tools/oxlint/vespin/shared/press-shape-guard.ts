/**
 * press-shape-guard.ts -- the native press shape's guard as data: a SwiftUI
 * button or menu takes a press on its label, so the shape that widens the
 * press stands on the label, never on the control. Read by the
 * `press-shape-on-label` rule and by the suppression check beside it.
 */
export const PRESS_SHAPE_GUARD_RULE = "vespin/press-shape-on-label";

/** The module whose SwiftUI controls the rule reads. */
export const SWIFT_UI_MODULE = "@expo/ui/swift-ui";

/** `@expo/ui`'s pressable controls, each of which takes a press only where its label is hit. */
export const SWIFT_UI_PRESSABLES: ReadonlySet<string> = new Set(["Button", "Menu"]);

/** The modifier that widens a view's hit area, which on the control itself widens nothing. */
export const PRESS_SHAPE_MODIFIER = "contentShape";
