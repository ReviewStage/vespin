// pill-look.test.ts -- a pill draws what its chip draws once the words are sent, and a file's marker the file it names.

import { filePill, mentionPill } from "@repo/features/pill-words";
import { describe, expect, it } from "vitest";
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
});
