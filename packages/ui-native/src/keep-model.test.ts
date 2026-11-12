import { describe, expect, it } from "vitest";
import { KEEP_ACT, KEPT_KIND, type Kept, keepActs } from "./keep-model.js";

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const SVG = "data:image/svg+xml;base64,PHN2Zy8+";

describe("keepActs", () => {
  it.each<[string, Kept, readonly string[]]>([
    [
      "a held picture is copied, saved, and shared",
      { kind: KEPT_KIND.PICTURE, source: PNG, name: "Plan" },
      [KEEP_ACT.COPY, KEEP_ACT.SAVE_TO_PHOTOS, KEEP_ACT.SHARE],
    ],
    [
      "an SVG, which the system does not decode, is only shared",
      { kind: KEPT_KIND.PICTURE, source: SVG, name: "Diagram" },
      [KEEP_ACT.SHARE],
    ],
    [
      "a picture drawn from an address offers nothing, as the panel's does",
      { kind: KEPT_KIND.PICTURE, source: "https://example.com/a.png", name: "A" },
      [],
    ],
    [
      "an MP4 is saved to Photos and shared",
      { kind: KEPT_KIND.VIDEO, source: "file:///caches/inbox-1.mp4", name: "flow.mp4" },
      [KEEP_ACT.SAVE_TO_PHOTOS, KEEP_ACT.SHARE],
    ],
    [
      "a WebM, which Photos refuses, is only shared",
      { kind: KEPT_KIND.VIDEO, source: "file:///caches/inbox-2.webm", name: "flow.webm" },
      [KEEP_ACT.SHARE],
    ],
    [
      "a text file's words are copied, and it is shared",
      {
        kind: KEPT_KIND.FILE,
        source: "file:///caches/a/notes.md",
        name: "notes.md",
        mediaType: "text/markdown",
      },
      [KEEP_ACT.COPY, KEEP_ACT.SHARE],
    ],
    [
      "a PDF is only shared",
      {
        kind: KEPT_KIND.FILE,
        source: "file:///caches/b/plan.pdf",
        name: "plan.pdf",
        mediaType: "application/pdf",
      },
      [KEEP_ACT.SHARE],
    ],
  ])("%s", (_case, kept, acts) => {
    expect(keepActs(kept)).toEqual(acts);
  });
});
