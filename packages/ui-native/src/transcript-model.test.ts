import { CHECK_SUMMARY, PULL_REQUEST_STATE } from "@repo/features/agent-wire";
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
      { writing: false, readerId: undefined, toggles: NO_TOGGLES, now: 2, pullRequests: [] },
    );

    expect(items.map((item) => item.kind)).toEqual([
      TRANSCRIPT_ITEM.SAID,
      TRANSCRIPT_ITEM.MEDIA,
      TRANSCRIPT_ITEM.WORDS,
    ]);
    expect(items[1]).toMatchObject({
      media: [{ id: "picture-1", caption: "The dialog", label: "The dialog", video: false }],
    });
  });

  const OPENED = {
    id: "work",
    role: MESSAGE_ROLE.ASSISTANT,
    parts: [
      {
        type: "tool-open_pull_request",
        toolCallId: "open",
        state: "output-available",
        input: { head: "agent/invites", title: "Invite by email", body: "", draft: true },
        output: { url: "https://github.com/ada/relay/pull/128", number: 128 },
      },
    ],
    finishedAt: 1,
  } as const;

  const HELD = {
    number: 128,
    title: "Invite a teammate by email",
    url: "https://github.com/ada/relay/pull/128",
    state: PULL_REQUEST_STATE.MERGED,
    checks: CHECK_SUMMARY.PASSING,
    additions: 412,
    deletions: 37,
    changedFiles: 14,
  };

  it.each([
    {
      held: [HELD],
      card: {
        title: "Invite a teammate by email",
        state: PULL_REQUEST_STATE.MERGED,
        additions: 412,
        deletions: 37,
      },
    },
    {
      held: [],
      card: {
        title: "Invite by email",
        state: PULL_REQUEST_STATE.DRAFT,
        additions: undefined,
        deletions: undefined,
      },
    },
  ])(
    "draws a pull request a call opened as the task list holds it, or as it was opened where the list holds none ($card.state)",
    ({ held, card }) => {
      const items = transcriptItems([OPENED], {
        writing: false,
        readerId: undefined,
        toggles: NO_TOGGLES,
        now: 2,
        pullRequests: held,
      });

      expect(items.find((item) => item.kind === TRANSCRIPT_ITEM.PULL_REQUEST)).toMatchObject({
        number: 128,
        url: "https://github.com/ada/relay/pull/128",
        ...card,
      });
    },
  );
});
