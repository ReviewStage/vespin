// section-ink.ts -- the ink a sidebar section's glyph wears in the color its member chose, as the panel's section icon picker inks it from the file tree's palette.

import {
  TASK_SECTION_ICON_COLOR,
  TASK_SECTION_ICON_KIND,
  type TaskSectionIcon,
  type TaskSectionIconColor,
} from "@repo/features/task-section-wire";
import { FILE_ICON_INK } from "./tokens/file-icon-inks.js";

/** The file tree's ink each chosen color names, as the panel's picker inks it (`section-icon-picker.tsx`'s `text-file-icon-*`). */
const FILE_ICON_OF = {
  [TASK_SECTION_ICON_COLOR.RED]: "RED",
  [TASK_SECTION_ICON_COLOR.ORANGE]: "ORANGE",
  [TASK_SECTION_ICON_COLOR.YELLOW]: "YELLOW",
  [TASK_SECTION_ICON_COLOR.GREEN]: "GREEN",
  [TASK_SECTION_ICON_COLOR.TEAL]: "TEAL",
  [TASK_SECTION_ICON_COLOR.BLUE]: "BLUE",
  [TASK_SECTION_ICON_COLOR.PURPLE]: "PURPLE",
  [TASK_SECTION_ICON_COLOR.PINK]: "PINK",
} as const satisfies Record<TaskSectionIconColor, keyof typeof FILE_ICON_INK.LIGHT>;

/** The ink a section's glyph wears in `color`, in the window's light theme or its dark. */
export function sectionInk(color: TaskSectionIconColor, dark: boolean): string {
  return (dark ? FILE_ICON_INK.DARK : FILE_ICON_INK.LIGHT)[FILE_ICON_OF[color]];
}

/** The color a section's glyph wears, as its member chose it in the panel's picker; none for an emoji, no icon, or a glyph in the text's own ink. */
export function sectionGlyphColor(
  icon: TaskSectionIcon | undefined,
): TaskSectionIconColor | undefined {
  return icon?.kind === TASK_SECTION_ICON_KIND.GLYPH ? icon.color : undefined;
}
