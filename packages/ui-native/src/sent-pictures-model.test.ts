import { AGENT_ATTACHMENT_TYPE, type AgentAttachment } from "@repo/features/agent-wire";
import { describe, expect, it } from "vitest";
import { sentPictures } from "./sent-pictures-model.js";
import { NO_TOGGLES, TRANSCRIPT_ITEM, transcriptItems, withSending } from "./transcript-model.js";

const PICTURE = { name: "Picture 1", mediaType: AGENT_ATTACHMENT_TYPE.PNG, data: "iVBORw0KGgo=" };

const LINE = {
  id: "line",
  clientKey: "key",
  text: "The button is cut off in [Picture 1].",
  files: [{ name: "Picture 1", mediaType: AGENT_ATTACHMENT_TYPE.PNG }],
  sentAt: 1,
  steers: false,
};

const READING = {
  writing: false,
  readerId: undefined,
  toggles: NO_TOGGLES,
  now: 2,
  pullRequests: [],
};

describe("sentPictures", () => {
  it("keeps a line's picture while the host draws it though its send was answered before the host first drew it, and lets it go once its row replaced the line", () => {
    const sent = sentPictures<readonly AgentAttachment[]>();

    const drawnLine = (lines: readonly (typeof LINE)[]) =>
      transcriptItems(
        withSending([], lines, (id) => sent.get(id) ?? []),
        READING,
      );

    sent.set(LINE.id, [PICTURE]);
    // The page has drawn the agent's lines as they stood before the send, and the answer lands before the host's drawing of the line reaches it.
    sent.drawn("agent", []);
    sent.letGo("agent", LINE.id, []);
    sent.drawn("agent", [LINE]);

    expect(drawnLine([LINE])[0]).toMatchObject({
      kind: TRANSCRIPT_ITEM.SAID,
      wordPictures: new Map([
        [
          "Picture 1",
          {
            key: "0",
            name: "Picture 1",
            url: "data:image/png;base64,iVBORw0KGgo=",
            pictureId: undefined,
          },
        ],
      ]),
    });

    // Its row landed, so the host no longer draws the line.
    sent.drawn("agent", []);

    expect(sent.get(LINE.id)).toBeUndefined();
  });

  it("lets an answered line's picture go once no page of its agent stands, and keeps a refused line's for its Retry", () => {
    const sent = sentPictures<readonly AgentAttachment[]>();

    for (const lineId of ["answered", "late", "refused"]) sent.set(lineId, [PICTURE]);
    // The page leaves after one send was answered but before the host's drawing of its line reached it, another is answered after the page left, and the third was refused, so it stands for its Retry.
    sent.drawn("agent", []);
    sent.letGo("agent", "answered", []);
    sent.left("agent");
    sent.letGo("agent", "late", undefined);

    expect({
      answered: sent.get("answered"),
      late: sent.get("late"),
      refused: sent.get("refused"),
    }).toEqual({ answered: undefined, late: undefined, refused: [PICTURE] });
  });
});
