import { MESSAGE_ROLE } from "@repo/wire";
import { describe, expect, it } from "vitest";
import { NO_TOGGLES, TRANSCRIPT_ITEM, transcriptItems } from "./transcript-model.js";

const PICTURE = { id: "picture-1", mediaType: "image/png", width: 320, height: 180, byteCount: 10 };

describe("transcriptItems", () => {
  it("leaves the agent's thinking out and draws the pictures it showed under the turn", () => {
    const items = transcriptItems(
      [
        {
          id: "ask",
          role: MESSAGE_ROLE.USER,
          parts: [{ type: "text", text: "Show me the dialog." }],
        },
        {
          id: "work",
          role: MESSAGE_ROLE.ASSISTANT,
          parts: [
            { type: "reasoning", text: "A private thought." },
            {
              type: "tool-show_image",
              toolCallId: "shots",
              state: "output-available",
              input: { images: [{ path: "/shots/dialog.png", caption: "The dialog" }] },
              output: { status: "accepted", pictures: [PICTURE] },
            },
            { type: "text", text: "Here it is." },
          ],
          finishedAt: 1,
        },
      ],
      { writing: false, readerId: undefined, toggles: NO_TOGGLES, now: 2 },
    );
    expect(items.map((item) => item.kind)).toEqual([
      TRANSCRIPT_ITEM.SAID,
      TRANSCRIPT_ITEM.MEDIA,
      TRANSCRIPT_ITEM.WORDS,
    ]);
    expect(items[1]).toMatchObject({
      media: [{ id: "picture-1", caption: "The dialog", video: false }],
    });
  });
});
