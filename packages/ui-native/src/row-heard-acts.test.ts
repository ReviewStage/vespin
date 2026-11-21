import { describe, expect, it } from "vitest";
import { GLYPH } from "./glyph.js";
import type { LongPressGroup, RowAction } from "./list-row.js";
import { heardActs } from "./row-heard-acts.js";

// Note that the acts' tone is a fixture's, which `heardActs` never reads; `ROW_ACTION_TONE` stands beside the SwiftUI rows, which vitest cannot load.
const NEUTRAL: RowAction["tone"] = "neutral";

const pressed: string[] = [];

function act(label: string, more: Partial<RowAction> = {}): RowAction {
  return { label, tone: NEUTRAL, onPress: () => pressed.push(label), ...more };
}

describe("heardActs", () => {
  it("lists each act of the menu once, a submenu's items under its name or their own words, and no dimmed act", () => {
    const unread = act("Mark as unread");

    // Note that the swipe's Mark as unread stands in the menu's first group and again in a later one, as a row's swipe and menu both offer it.
    const groups: readonly LongPressGroup[] = [
      [act("Open")],
      [
        unread,
        {
          label: "Remind me",
          symbol: GLYPH.TIME,
          choices: [],
          actions: [act("Tomorrow", { heard: "Remind me tomorrow" }), act("Pick a date and time…")],
        },
        {
          label: "Status",
          symbol: GLYPH.STATUS,
          choices: [{ label: "Backlog", on: false, onPress: () => pressed.push("Backlog") }],
          submenus: [
            {
              label: "More",
              symbol: GLYPH.STATUS,
              choices: [{ label: "Canceled", on: true, onPress: () => pressed.push("Canceled") }],
            },
          ],
        },
      ],
      [unread, act("Unfollow", { disabled: true }), act("Delete")],
    ];

    const acts = heardActs(groups);

    for (const each of acts) each.onPress();

    expect(acts.map((each) => each.name)).toEqual([
      "Open",
      "Mark as unread",
      "Remind me tomorrow",
      "Remind me: Pick a date and time…",
      "Status: Backlog",
      "Status: More: Canceled",
      "Delete",
    ]);
    expect(pressed).toEqual([
      "Open",
      "Mark as unread",
      "Tomorrow",
      "Pick a date and time…",
      "Backlog",
      "Canceled",
      "Delete",
    ]);
  });
});
