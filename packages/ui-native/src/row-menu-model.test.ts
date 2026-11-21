import { describe, expect, it } from "vitest";
import { GLYPH, glyphImage } from "./glyph.js";
import {
  type LongPressGroup,
  MENU_ICON,
  MENU_NODE,
  type MenuInks,
  menuPressAt,
  menuTree,
  ROW_ACTION_TONE,
  type RowAction,
} from "./row-menu-model.js";

// Note that the inks are a fixture's, which the tree hands on as given.
const INKS: MenuInks = { act: "#4d4d4d", tone: (tone) => `ink:${tone}` };

/** A glyph's icon as the native module reads it, worked out by hand from the asset catalog's name. */
function glyph(name: ReturnType<typeof glyphImage>) {
  return "assetName" in name
    ? { kind: MENU_ICON.GLYPH, asset: name.assetName }
    : { kind: MENU_ICON.GLYPH, system: name.systemName };
}

describe("menuTree", () => {
  it("stands a task row's menu as SwiftUI builds it, each item named as VoiceOver hears it, and finds each press by its place", () => {
    const pressed: string[] = [];

    const act = (label: string, more: Partial<RowAction> = {}): RowAction => ({
      label,
      tone: ROW_ACTION_TONE.NEUTRAL,
      onPress: () => pressed.push(label),
      ...more,
    });

    // Note that the menu holds every kind of item a task row's does: an empty group, which draws nothing, an act with a glyph, a menu of choices with a menu within and an act after them, a dimmed act, and a delete.
    const groups: readonly LongPressGroup[] = [
      [],
      [act("Open", { symbol: GLYPH.OPEN })],
      [
        {
          label: "Status",
          symbol: GLYPH.STATUS,
          choices: [
            {
              label: "Backlog",
              symbol: GLYPH.STATUS_BACKLOG,
              tone: "neutral",
              on: true,
              onPress: () => pressed.push("Backlog"),
              heard: "Set status: Backlog",
            },
          ],
          submenus: [
            {
              label: "More",
              symbol: GLYPH.STATUS,
              choices: [{ label: "Canceled", on: false, onPress: () => pressed.push("Canceled") }],
            },
          ],
          actions: [act("Remove from section")],
        },
        act("Unfollow", { disabled: true, detail: "You're the assignee" }),
      ],
      [act("Permanently delete", { tone: ROW_ACTION_TONE.DESTRUCTIVE })],
    ];

    expect(menuTree(groups, INKS)).toEqual([
      [
        {
          kind: MENU_NODE.ACT,
          label: "Open",
          icon: glyph(glyphImage(GLYPH.OPEN)),
          destructive: false,
          disabled: false,
          tint: "#4d4d4d",
          heard: "Open",
        },
      ],
      [
        {
          kind: MENU_NODE.MENU,
          label: "Status",
          icon: glyph(glyphImage(GLYPH.STATUS)),
          tint: "#4d4d4d",
          nodes: [
            {
              kind: MENU_NODE.CHOICE,
              label: "Backlog",
              icon: { ...glyph(glyphImage(GLYPH.STATUS_BACKLOG)), color: "ink:neutral" },
              on: true,
              heard: "Set status: Backlog",
            },
            {
              kind: MENU_NODE.MENU,
              label: "More",
              icon: glyph(glyphImage(GLYPH.STATUS)),
              tint: "#4d4d4d",
              nodes: [
                {
                  kind: MENU_NODE.CHOICE,
                  label: "Canceled",
                  icon: undefined,
                  on: false,
                  heard: "Status: More: Canceled",
                },
              ],
            },
            {
              kind: MENU_NODE.ACT,
              label: "Remove from section",
              destructive: false,
              disabled: false,
              tint: "#4d4d4d",
              heard: "Status: Remove from section",
            },
          ],
        },
        {
          kind: MENU_NODE.ACT,
          label: "Unfollow",
          detail: "You're the assignee",
          destructive: false,
          disabled: true,
          tint: "#4d4d4d",
          heard: "Unfollow",
        },
      ],
      [
        {
          kind: MENU_NODE.ACT,
          label: "Permanently delete",
          destructive: true,
          disabled: false,
          heard: "Permanently delete",
        },
      ],
    ]);

    // Note that each place counts among the groups that hold something, as the tree stands them, and a menu itself takes no press.
    for (const place of [
      [0, 0],
      [1, 0, 0],
      [1, 0, 1, 0],
      [1, 0, 2],
      [2, 0],
      [1, 0],
      [3, 0],
    ]) {
      menuPressAt(groups, place)?.();
    }

    expect(pressed).toEqual([
      "Open",
      "Backlog",
      "Canceled",
      "Remove from section",
      "Permanently delete",
    ]);
  });
});
