// diagram-page.test.ts -- the answers the sealed diagram page is read by.

import { describe, expect, it } from "vitest";
import { DIAGRAM_ANSWER, diagramAnswerOf } from "./diagram-page.js";

describe("diagramAnswerOf", () => {
  // A message the page did not send as an answer, or one missing what a picture needs, must never stand as a drawn diagram.
  it("reads a drawn fence's picture, and no answer from a message that is none", () => {
    const drawn = {
      kind: DIAGRAM_ANSWER.DRAWN,
      id: 2,
      picture: "data:image/png;base64,AA",
      width: 120,
      height: 40,
    };

    expect(diagramAnswerOf(JSON.stringify(drawn))).toEqual(drawn);
    expect(diagramAnswerOf('{"kind":"drawn","id":"2"}')).toBeUndefined();
    expect(diagramAnswerOf("not json")).toBeUndefined();
  });
});
