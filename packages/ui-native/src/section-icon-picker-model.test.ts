// section-icon-picker-model.test.ts -- the section icon picker offers Recent, Suggested, and every other glyph on Icons, draws every glyph but a recent one in the color row's color, rings the icon shown whatever its stored name, and finds a glyph or an emoji by name.

import { emojiGroups } from "@repo/features/emoji-model";
import { glyphChoices } from "@repo/features/section-icon-model";
import { TASK_SECTION_ICON_KIND, type TaskSectionIcon } from "@repo/features/task-section-wire";
import { describe, expect, it } from "vitest";
import {
  ICON_TAB,
  type IconPickerState,
  iconGroups,
  sameIcon,
} from "./section-icon-picker-model.js";

const EMOJI = emojiGroups([
  {
    name: "Travel & Places",
    emojis: [
      { emoji: "🚀", name: "rocket", version: 0.6, keywords: ["space"], shortcodes: ["rocket"] },
    ],
  },
]);

/** A few of Lucide's keys: two the picker suggests, under Lucide's own names, and two it does not. */
const GLYPHS = glyphChoices(["Users", "Rocket", "FlaskConical", "Anchor"]);

/** A section wearing the flask by the name it was stored under before the picker offered every glyph. */
const FLASK: TaskSectionIcon = { kind: TASK_SECTION_ICON_KIND.GLYPH, glyph: "flask" };

const STATE: IconPickerState = {
  tab: ICON_TAB.ICONS,
  query: "",
  recent: [],
  standing: FLASK,
  color: "teal",
  glyphs: GLYPHS,
  emoji: EMOJI,
};

/** Each group's name and its cells' names, as the grid lists them. */
function listed(state: IconPickerState) {
  return iconGroups(state).map((group) => [group.name, group.cells.map((cell) => cell.label)]);
}

describe("iconGroups", () => {
  // Note that the regression this catches is a grid that loses Recent, draws a recent glyph in the row's color rather than its own, draws a glyph in another color than the row's, rings no glyph for a section stored under an old name, or mixes the suggested glyphs into All icons.
  it("offers Recent in its own colors, then the suggested and the other glyphs in the row's color, the one worn ringed", () => {
    const recent: TaskSectionIcon[] = [
      { kind: TASK_SECTION_ICON_KIND.GLYPH, glyph: "anchor", color: "red" },
      { kind: TASK_SECTION_ICON_KIND.EMOJI, emoji: "🚀" },
    ];

    const groups = iconGroups({ ...STATE, recent });

    expect(groups.map((group) => [group.name, group.cells.map((cell) => cell.label)])).toEqual([
      ["Recent", ["Anchor", "🚀"]],
      ["Suggested", ["Rocket", "Flask conical"]],
      ["All icons", ["Anchor", "Users"]],
    ]);
    expect(groups[0]?.cells[0]?.icon).toEqual(recent[0]);
    expect(groups[1]?.cells.map((cell) => [cell.icon, cell.picked])).toEqual([
      [{ kind: TASK_SECTION_ICON_KIND.GLYPH, glyph: "rocket", color: "teal" }, false],
      [{ kind: TASK_SECTION_ICON_KIND.GLYPH, glyph: "flask-conical", color: "teal" }, true],
    ]);
  });

  it("offers every emoji by category on Emoji", () => {
    expect(listed({ ...STATE, tab: ICON_TAB.EMOJI })).toEqual([["Travel & Places", ["🚀"]]]);
  });

  // Note that the regression this catches is a search that finds no glyph or emoji by its name, or drops a typed emoji.
  it.each([
    {
      query: "rocket",
      found: [
        ["Icons", ["Rocket"]],
        ["Emoji", ["🚀"]],
      ],
    },
    { query: "🦄", found: [["Emoji", ["🦄"]]] },
    { query: "zebra", found: [] },
  ])("finds $query", ({ query, found }) => {
    expect(listed({ ...STATE, query })).toEqual(found);
  });
});

describe("sameIcon", () => {
  // Note that the regression this catches is a Done that writes nothing for a recolored glyph, or writes the icon the section already wears.
  it.each([
    { other: { ...FLASK, color: "teal" }, same: false },
    { other: FLASK, same: true },
    { other: { kind: TASK_SECTION_ICON_KIND.EMOJI, emoji: "🚀" }, same: false },
  ] as const)("tells $other from the flask in the text's ink", ({ other, same }) => {
    expect(sameIcon(FLASK, other)).toBe(same);
  });
});
