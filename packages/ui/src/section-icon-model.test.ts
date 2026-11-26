import assert from "node:assert/strict";
import { TASK_SECTION_GLYPH } from "@repo/features/task-section-wire";
import { describe, it } from "vitest";
import { findGlyphs, glyphChoices, glyphKey, glyphName } from "./section-icon-model.js";

/**
 * What the section icon picker offers and finds, over a synthetic slice of
 * Lucide's icons: a glyph found by
 * the words of its name, drawn again from
 * the name it is stored under, and the suggested glyphs first.
 */

/** Keys of Lucide's `icons`, a few of them. */
const ICONS = ["ArrowDownWideNarrow", "Grid2x2", "Rocket", "FlaskConical", "Accessibility"];

describe("glyph names", () => {
  it("draws every glyph again from the name it is stored under", () => {
    for (const key of ICONS) assert.equal(glyphKey(glyphName(key)), key);
    assert.equal(glyphName("Grid2x2"), "grid2x2");
  });

  it("draws the flask a section wore before as Lucide's flask-conical", () => {
    assert.equal(glyphKey(TASK_SECTION_GLYPH.FLASK), "FlaskConical");
  });
});

describe("glyphChoices", () => {
  const choices = glyphChoices(ICONS);

  it("offers the suggested glyphs first, in their order, then the rest alphabetically", () => {
    assert.deepEqual(
      choices.map((choice) => choice.glyph),
      ["rocket", "flask-conical", "accessibility", "arrow-down-wide-narrow", "grid2x2"],
    );
  });

  it("finds a glyph by every word of its name, and every one for a blank search", () => {
    assert.deepEqual(
      findGlyphs(choices, "Narrow arrow").map((choice) => choice.label),
      ["Arrow down wide narrow"],
    );
    assert.equal(findGlyphs(choices, "  ").length, choices.length);
    assert.deepEqual(findGlyphs(choices, "zebra"), []);
  });
});
