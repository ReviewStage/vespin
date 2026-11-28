import { TASK_SECTION_ICON_KIND } from "@repo/features/task-section-wire";
import { describe, expect, it } from "vitest";
import { GLYPH, glyphIcon, sectionGlyph } from "./glyph.js";

describe("sectionGlyph", () => {
  // A section wears any Lucide glyph the panel's picker offers, by the asset
  // name Lucide gives it; a name the catalog holds no glyph of, and an emoji,
  // lead with the folder.
  it.each([
    { worn: "a suggested glyph", glyph: "rocket", drawn: "Rocket" },
    { worn: "a suggested glyph stored by its old name", glyph: "flask", drawn: "FlaskConical" },
    { worn: "a glyph the picker offers past its suggestions", glyph: "users", drawn: "Users" },
    {
      worn: "a glyph whose name runs digits together",
      glyph: "arrow-down01",
      drawn: "ArrowDown01",
    },
    { worn: "a name no Lucide glyph has", glyph: "not-a-lucide-glyph", drawn: GLYPH.FOLDER },
  ])("draws $worn", ({ glyph, drawn }) => {
    expect(sectionGlyph({ kind: TASK_SECTION_ICON_KIND.GLYPH, glyph })).toBe(drawn);
  });

  it("leads an emoji's section with the folder, which the emoji stands in place of", () => {
    expect(sectionGlyph({ kind: TASK_SECTION_ICON_KIND.EMOJI, emoji: "🚀" })).toBe(GLYPH.FOLDER);
  });
});

describe("glyphIcon", () => {
  // A bar draws an asset in its own artwork's colors unless told to tint it,
  // which drew Resolve's Lucide check black on the dark Select bar beside
  // the system's symbols, which a bar always tints.
  it("tints a glyph of the asset catalog as the bar's ink", () => {
    expect(glyphIcon(GLYPH.RESOLVED)).toEqual({
      xcasset: "CircleCheck",
      renderingMode: "template",
    });
  });
});
