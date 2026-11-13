import { WHOLE_PART } from "@repo/features/agent-parts";
import { CHECK_SUMMARY, PART_CUT_FIELD, PULL_REQUEST_STATE } from "@repo/features/agent-wire";
import { PULL_REQUEST_MARK_QUEUED } from "@repo/features/pull-request-model";
import { MESSAGE_CHANNEL, MESSAGE_ROLE, START_LINE_BRIEF } from "@repo/wire";
import { describe, expect, it } from "vitest";
import {
  NO_TOGGLES,
  openCuts,
  TRANSCRIPT_ITEM,
  transcriptItems,
  transcriptOriginOf,
} from "./transcript-model.js";

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

  it("opens an automation's transcript on its run's prompt, from the automation and its pull request, leaving later lines as sent", () => {
    const origin = transcriptOriginOf({
      automationId: undefined,
      automationName: "Morning triage",
      automationAddress: "https://vespin.dev/acme/automation/a1",
      run: {
        prompt: "Triage the new issues.",
        subject: {
          number: 42,
          title: "Crash on launch",
          url: "https://github.com/ada/relay/pull/42",
        },
        body: '{"event":"opened"}',
      },
    });

    const items = transcriptItems(
      [
        {
          id: "fired",
          role: MESSAGE_ROLE.USER,
          parts: [{ type: "text", text: "Triage the new issues.\n\nFired by pull request #42." }],
        },
        { id: "later", role: MESSAGE_ROLE.USER, parts: [{ type: "text", text: "Thanks." }] },
      ],
      {
        writing: false,
        readerId: undefined,
        toggles: NO_TOGGLES,
        now: 2,
        pullRequests: [],
        origin,
      },
    );

    expect(items).toMatchObject([
      {
        kind: TRANSCRIPT_ITEM.SAID,
        words: "Triage the new issues.",
        from: [
          { words: "Morning triage (deleted)", address: undefined },
          { words: "#42 Crash on launch", address: "https://github.com/ada/relay/pull/42" },
        ],
        body: '{"event":"opened"}',
      },
      { kind: TRANSCRIPT_ITEM.SAID, words: "Thanks.", sender: undefined },
    ]);
  });

  it("stands one sender's lines sent close together in a run, and the day and time only over talk that picks up again", () => {
    const minute = 60 * 1000;
    const ada = { name: "Ada", userId: "u1" };
    const grace = { name: "Grace", userId: "u2" };

    const line = (id: string, minutes: number, sentBy = ada) => ({
      id,
      role: MESSAGE_ROLE.USER,
      parts: [{ type: "text" as const, text: id }],
      sentAt: minutes * minute,
      sentBy,
    });

    const items = transcriptItems(
      [line("a", 0), line("b", 1), line("c", 2, grace), line("d", 3, grace), line("e", 40)],
      { writing: false, readerId: "u1", toggles: NO_TOGGLES, now: 41 * minute, pullRequests: [] },
    );

    expect(
      items.map((item) =>
        item.kind === TRANSCRIPT_ITEM.SAID
          ? [item.words, item.joinsAbove, item.joinsBelow, item.sender, item.stamp !== undefined]
          : item.kind,
      ),
    ).toEqual([
      ["a", false, true, undefined, true],
      ["b", true, false, undefined, false],
      ["c", false, true, "Grace", false],
      ["d", true, false, "Grace", false],
      ["e", false, false, undefined, true],
    ]);
  });

  it("heads a line sent from a suggestion by the agent that suggested it", () => {
    const suggestedBy = { agent_id: "a1", name: "Triage", button_id: "b1" };
    const lead = "Suggested by [@Triage](https://vespin.dev/acme/agent/a1):\n\n";

    const lines = [
      {
        id: "start",
        role: MESSAGE_ROLE.USER,
        parts: [{ type: "text", text: `${lead}Fix the crash.` }],
        metadata: {
          channel: MESSAGE_CHANNEL.START,
          brief: START_LINE_BRIEF.PROMPT,
          suggested_by: suggestedBy,
        },
        sentBy: { name: "Ada", userId: "u1" },
      },
      {
        id: "sent",
        role: MESSAGE_ROLE.USER,
        parts: [{ type: "text", text: `${lead}Ship it.` }],
        metadata: { channel: MESSAGE_CHANNEL.SUGGESTION, suggested_by: suggestedBy },
        sentBy: { name: "Grace", userId: "u2" },
      },
    ] as const;

    const reading = {
      writing: false,
      readerId: "u1",
      toggles: NO_TOGGLES,
      now: 2,
      pullRequests: [],
    };

    expect(
      transcriptItems(lines, {
        ...reading,
        suggestionAddress: (agentId) => `https://vespin.dev/acme/agent/${agentId}`,
      }),
    ).toMatchObject([
      {
        words: "Fix the crash.",
        sender: undefined,
        from: [
          {
            lead: "Suggested by",
            words: "Triage",
            after: ", started by you",
            address: "https://vespin.dev/acme/agent/a1",
          },
        ],
      },
      {
        words: "Ship it.",
        sender: "Grace",
        from: [
          { lead: "Suggested by", words: "Triage", address: "https://vespin.dev/acme/agent/a1" },
        ],
      },
    ]);
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
      held: [{ ...HELD, state: PULL_REQUEST_STATE.OPEN, queued: true as const }],
      card: {
        title: "Invite a teammate by email",
        state: PULL_REQUEST_MARK_QUEUED,
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

describe("a call whose answer its page carried cut", () => {
  const CUT = { messageId: "work", index: 0, bytes: 2048, head: "first lines", tail: "last lines" };

  const WORK = {
    id: "work",
    role: MESSAGE_ROLE.ASSISTANT,
    parts: [
      { type: "tool-lookup", toolCallId: "look", state: "output-available", input: { q: "x" } },
    ],
    cutParts: [{ ...CUT, field: PART_CUT_FIELD.OUTPUT }],
    finishedAt: 1,
  } as const;

  // Note that the whole answer runs past the 40 lines an ordinary call's card draws, which a whole read draws all of.
  const EVERY_LINE = Array.from({ length: 45 }, (_, at) => `line ${at + 1}`).join("\n");

  const WHOLE = {
    type: "tool-lookup",
    toolCallId: "look",
    state: "output-available",
    input: { q: "x" },
    output: EVERY_LINE,
  };

  it.each([
    { read: undefined, output: "Reading the whole output…", asks: true },
    { read: { state: WHOLE_PART.READING }, output: "Reading the whole output…", asks: true },
    { read: { state: WHOLE_PART.WHOLE, part: WHOLE }, output: EVERY_LINE, asks: false },
    {
      read: { state: WHOLE_PART.FAILED },
      output:
        "first lines\n\n… 2.0 kB in all; only its start and end could be read …\n\nlast lines",
      asks: false,
    },
  ] as const)(
    "opened, draws its answer as its whole read stands ($read.state)",
    ({ read, output, asks }) => {
      const items = transcriptItems([WORK], {
        writing: false,
        readerId: undefined,
        toggles: { ...NO_TOGGLES, calls: new Set(["look"]) },
        now: 2,
        pullRequests: [],
        wholePart: (cut) => (cut.messageId === "work" && cut.index === 0 ? read : undefined),
      });

      const call = items.find((item) => item.kind === TRANSCRIPT_ITEM.CALL);

      expect(call).toMatchObject({
        body: expect.arrayContaining([{ title: "Output", text: output }]),
      });
      expect(openCuts(items)).toEqual(asks ? [CUT] : []);
    },
  );
});
