// pill-look.test.ts -- a pill draws what its chip draws once the words are sent, and a file's marker the file it names.

import { ENTITY_KIND } from "@repo/features/entity-kind";
import { MANAGER_FACE_CHARACTER, MANAGER_FACE_COLOR } from "@repo/features/manager-face";
import { filePill, mentionPill } from "@repo/features/pill-words";
import { describe, expect, it } from "vitest";
import { CHIP_MARK, type ChipMarkOf } from "./chip-mark-model.js";
import { GLYPH } from "./glyph.js";
import { pillLook } from "./pill-look.js";

const READING = { repository: "ReviewStage/vespin", now: Date.UTC(2026, 10, 20, 16), zone: "UTC" };

describe("pillLook", () => {
  it.each([
    [
      "an agent",
      mentionPill("Fix the refresh", "https://vespin.dev/stage/agent/a1"),
      "Fix the refresh",
      GLYPH.AGENT,
    ],
    ["a task", mentionPill("iOS app", "https://vespin.dev/stage/task/t1"), "iOS app", GLYPH.TASK],
    ["a picture", filePill("Picture 1"), "Picture 1", GLYPH.IMAGE],
    ["a file", filePill("spec.pdf"), "spec.pdf", GLYPH.FILE],
  ])("draws %s with its kind's glyph and its name", (_, pill, words, glyph) => {
    expect(pillLook(pill, READING)).toMatchObject({ words, glyph });
  });

  // Note that the name is the one the app's config writes into the asset catalog, so a rename on either side leaves the pill blank.
  it("draws a Manager's pill with its face at rest, by its picture's name in the asset catalog", () => {
    const pill = mentionPill("Release manager", "https://vespin.dev/stage/agent/a-manager");

    const markOf: ChipMarkOf = (entity) =>
      entity.kind === ENTITY_KIND.AGENT && entity.agentId === "a-manager"
        ? {
            kind: CHIP_MARK.MANAGER,
            face: { character: MANAGER_FACE_CHARACTER.CAT, color: MANAGER_FACE_COLOR.PINK },
            working: true,
          }
        : undefined;

    expect(pillLook(pill, READING, markOf)).toMatchObject({
      words: "Release manager",
      glyph: "ManagerFaces/cat-rest-pink",
    });
  });
});
