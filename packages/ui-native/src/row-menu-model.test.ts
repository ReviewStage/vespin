import { MANAGER_FACE_CHARACTER, MANAGER_FACE_COLOR } from "@repo/features/manager-face";
import { MODEL_PROVIDER } from "@repo/features/models-wire";
import { TASK_STATUS } from "@repo/features/task-wire";
import { describe, expect, it } from "vitest";
import { GLYPH, glyphImage } from "./glyph.js";
import {
  CHOICE_MARK,
  type LongPressGroup,
  MENU_ICON,
  MENU_NODE,
  type MenuInks,
  markLook,
  menuPhotoFile,
  menuPressAt,
  menuTree,
  ROW_ACTION_TONE,
  type RowAction,
} from "./row-menu-model.js";
import { MARK_SIZE } from "./tokens/space.js";

// Note that the inks are a fixture's, which the tree hands on as given.
const INKS: MenuInks = {
  act: "#4d4d4d",
  tone: (tone) => `ink:${tone}`,
  section: (color) => `section:${color}`,
};

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
              mark: { kind: CHOICE_MARK.STATUS, status: TASK_STATUS.BACKLOG },
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
        {
          label: "Move to",
          symbol: GLYPH.STATUS,
          choices: [
            {
              label: "Garden",
              mark: { kind: CHOICE_MARK.EMOJI, emoji: "🌱" },
              detail: "3 tasks",
              on: false,
              onPress: () => pressed.push("Garden"),
            },
            {
              label: "Rockets",
              mark: { kind: CHOICE_MARK.SECTION_GLYPH, glyph: GLYPH.FOLDER, color: "red" },
              on: false,
              onPress: () => pressed.push("Rockets"),
            },
          ],
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
          kind: MENU_NODE.MENU,
          label: "Move to",
          icon: glyph(glyphImage(GLYPH.STATUS)),
          tint: "#4d4d4d",
          nodes: [
            {
              kind: MENU_NODE.CHOICE,
              label: "Garden",
              icon: { kind: MENU_ICON.EMOJI, emoji: "🌱", size: MARK_SIZE.MENU_PHOTO },
              on: false,
              heard: "Move to: Garden",
            },
            {
              kind: MENU_NODE.CHOICE,
              label: "Rockets",
              icon: { ...glyph(glyphImage(GLYPH.FOLDER)), color: "section:red" },
              on: false,
              heard: "Move to: Rockets",
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
      [1, 1, 0],
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
      "Garden",
      "Permanently delete",
    ]);
  });
});

describe("markLook", () => {
  // Note that a repository's owner stands on a tile's rounded square, a quarter of its side, as the panel draws it, never a person's circle, a harness's mark is fit to a glyph's square, and a Manager stands as its face at rest, or its emoji on its color's disc.
  it.each([
    {
      mark: {
        kind: CHOICE_MARK.REPOSITORY,
        repository: "acme/web",
        picture: menuPhotoFile("file:///acme.png"),
      } as const,
      look: {
        kind: MENU_ICON.PHOTO,
        photo: "file:///acme.png",
        corner: 0.25,
        fallback: GLYPH.REPOSITORY,
      },
    },
    {
      mark: { kind: CHOICE_MARK.HARNESS, provider: MODEL_PROVIDER.ANTHROPIC } as const,
      look: { kind: MENU_ICON.MARK, asset: "ClaudeMark", sized: true },
    },
    {
      mark: {
        kind: CHOICE_MARK.MANAGER,
        face: { character: MANAGER_FACE_CHARACTER.PLANET, color: MANAGER_FACE_COLOR.BLUE },
      } as const,
      look: { kind: MENU_ICON.MARK, asset: "ManagerFaces/planet-rest-blue", sized: false },
    },
    {
      mark: {
        kind: CHOICE_MARK.MANAGER,
        face: {
          character: MANAGER_FACE_CHARACTER.PLANET,
          color: MANAGER_FACE_COLOR.BLUE,
          emoji: "🦊",
        },
      } as const,
      look: {
        kind: MENU_ICON.EMOJI,
        emoji: "🦊",
        disc: { light: expect.any(String), dark: expect.any(String), edge: expect.any(String) },
      },
    },
  ])("draws a $mark.kind as its rows do", ({ mark, look }) => {
    expect(markLook(mark)).toStrictEqual(look);
  });
});

describe("menuPhotoFile", () => {
  // Note that a system menu reads a photo only from a file on this device, so a picture's web address drew no icon at all.
  it.each([
    { address: "file:///caches/menu-photo-1a2b", photo: "file:///caches/menu-photo-1a2b" },
    { address: "https://avatars.githubusercontent.com/u/1?s=60", photo: undefined },
  ])("takes $address as $photo", ({ address, photo }) => {
    expect(menuPhotoFile(address)).toBe(photo);
  });
});
