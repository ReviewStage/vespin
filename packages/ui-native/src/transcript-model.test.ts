import { agentParts, WHOLE_PART } from "@repo/features/agent-parts";
import { CHECK_SUMMARY, PART_CUT_FIELD, PULL_REQUEST_STATE } from "@repo/features/agent-wire";
import { MANAGER_CHAT_AUTHOR, type ManagerChatLiveMessage } from "@repo/features/manager-chat-live";
import { PULL_REQUEST_MARK_QUEUED } from "@repo/features/pull-request-model";
import { MESSAGE_AUTHOR, MESSAGE_CHANNEL, MESSAGE_ROLE, START_LINE_BRIEF } from "@repo/wire";
import { describe, expect, it } from "vitest";
import {
  drawnCallIds,
  managerChatItems,
  NO_TOGGLES,
  openCuts,
  rowsNear,
  SHOWN_MEDIA,
  shownFiles,
  shownMediaIds,
  TRANSCRIPT_ITEM,
  toggledAt,
  transcriptItems,
  transcriptOriginOf,
  withWaitingLine,
} from "./transcript-model.js";

const PICTURE = { id: "picture-1", mediaType: "image/png", width: 320, height: 180, byteCount: 10 };
const SHOT = "data:image/png;base64,iVBORw0KGgo=";
const CLIP = { id: "clip-1", mediaType: "audio/mpeg", width: 0, height: 0, byteCount: 10 };

describe("transcriptItems", () => {
  it("leaves the agent's thinking out and draws what it showed under the turn, a sound clip played rather than drawn", () => {
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
              input: {
                images: [
                  { path: "/shots/dialog.png", caption: "The dialog" },
                  { path: "/sounds/chime.mp3", caption: "The chime" },
                ],
              },
              output: { status: "accepted", pictures: [PICTURE, CLIP] },
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
      media: [
        { id: "picture-1", caption: "The dialog", label: "The dialog", kind: SHOWN_MEDIA.PICTURE },
        { id: "clip-1", caption: "The chime", label: "The chime", kind: SHOWN_MEDIA.AUDIO },
      ],
    });
  });

  it("stands a computer call's window in its body once opened, never under its row, and reads it only then", () => {
    const work = {
      id: "work",
      role: MESSAGE_ROLE.ASSISTANT,
      parts: [
        {
          type: "tool-computer",
          toolCallId: "read",
          state: "output-available",
          input: { action: "get_app_state", app: "Mail" },
          output: { status: "ran", app: { name: "Mail" }, kept: { picture: PICTURE } },
        },
      ],
      finishedAt: 1,
    };

    const reading = { writing: false, readerId: undefined, now: 2, pullRequests: [] };
    const closed = transcriptItems([work], { ...reading, toggles: NO_TOGGLES });

    const opened = transcriptItems([work], {
      ...reading,
      toggles: { ...NO_TOGGLES, calls: new Set(["read"]) },
    });

    expect(closed.map((item) => item.kind)).toEqual([TRANSCRIPT_ITEM.CALL]);
    expect(shownMediaIds(closed)).toEqual([]);
    expect(opened.map((item) => item.kind)).toEqual([TRANSCRIPT_ITEM.CALL]);
    expect(opened[0]).toMatchObject({
      answered: [{ id: "picture-1", label: "Mail", kind: SHOWN_MEDIA.PICTURE }],
    });
    expect(shownMediaIds(opened)).toEqual(["picture-1"]);
  });

  it("leads a computer call's row with its app's icon, lent from an earlier call on the app where it kept none, and reads it", () => {
    const icon = { ...PICTURE, id: "mail-icon", width: 64, height: 64 };

    const items = transcriptItems(
      [
        {
          id: "work",
          role: MESSAGE_ROLE.ASSISTANT,
          parts: [
            {
              type: "tool-computer",
              toolCallId: "read",
              state: "output-available",
              input: { action: "get_app_state", app: "Mail" },
              output: { status: "ran", app: { name: "Mail", icon: { picture: icon } } },
            },
            {
              type: "tool-computer",
              toolCallId: "click",
              state: "input-available",
              input: { action: "click", app: "Mail", target: { element_index: 2 } },
            },
          ],
        },
      ],
      { writing: true, readerId: undefined, toggles: NO_TOGGLES, now: 2, pullRequests: [] },
    );

    const calls = items.filter((item) => item.kind === TRANSCRIPT_ITEM.CALL);

    expect(calls.map((call) => [call.callId, call.appIcon])).toEqual([
      ["read", "mail-icon"],
      ["click", "mail-icon"],
    ]);
    expect(shownMediaIds(items)).toContain("mail-icon");
  });

  it("draws the pictures a line carried over its words, one its words name where they name it, one kept apart read by its id, and its other files as chips under them", () => {
    const shot = "data:image/png;base64,iVBORw0KGgo=";

    const items = transcriptItems(
      [
        {
          id: "sent",
          role: MESSAGE_ROLE.USER,
          parts: [
            { type: "text", text: "The button is cut off in [Picture 1]." },
            { type: "file", mediaType: "image/png", filename: "bug.png", url: shot },
            {
              type: "file",
              mediaType: "text/markdown",
              filename: "notes.md",
              url: "data:text/markdown;base64,YQpiCg==",
            },
            { type: "file", mediaType: "application/pdf", filename: "plan.pdf", url: "" },
            {
              type: "file",
              mediaType: "text/plain",
              filename: "broken.txt",
              url: "data:text/plain;base64,%%%",
            },
            {
              type: "file",
              mediaType: "image/png",
              filename: "Picture 1",
              url: "data:image/png;base64,",
              providerMetadata: { app: { attachmentId: "picture-9" } },
            },
          ],
        },
      ],
      { writing: false, readerId: undefined, toggles: NO_TOGGLES, now: 2, pullRequests: [] },
    );

    expect(items[0]).toMatchObject({
      kind: TRANSCRIPT_ITEM.SAID,
      words: "The button is cut off in [Picture 1].",
      pictures: [{ name: "bug.png", url: shot, pictureId: undefined }],
      wordPictures: new Map([
        ["Picture 1", { key: "4", name: "Picture 1", url: undefined, pictureId: "picture-9" }],
      ]),
      files: [
        { name: "notes.md", base64: "YQpiCg==", size: "2 lines" },
        { name: "plan.pdf", base64: undefined, size: undefined },
        { name: "broken.txt", base64: "%%%" },
      ],
    });
    expect(shownMediaIds(items)).toEqual(["picture-9"]);
  });

  it("keeps each line's files apart where two lines reach one turn while it runs", () => {
    const note = (id: string, name: string) => ({
      id,
      role: MESSAGE_ROLE.USER,
      parts: [
        { type: "text" as const, text: id },
        {
          type: "file" as const,
          mediaType: "text/plain",
          filename: name,
          url: "data:text/plain;base64,YQ==",
        },
      ],
      arrivedIn: { journalId: "turn", afterStep: 1 },
    });

    const items = transcriptItems(
      [
        { id: "ask", role: MESSAGE_ROLE.USER, parts: [{ type: "text", text: "Go." }] },
        note("first", "a.txt"),
        note("second", "b.txt"),
        {
          id: "turn",
          role: MESSAGE_ROLE.ASSISTANT,
          parts: [{ type: "step-start" }, { type: "text", text: "Working." }],
        },
      ],
      { writing: false, readerId: undefined, toggles: NO_TOGGLES, now: 2, pullRequests: [] },
    );

    expect(shownFiles(items).map(({ message, file }) => [message, file.name])).toEqual([
      ["first", "a.txt"],
      ["second", "b.txt"],
    ]);
  });

  it("opens an automation's transcript on its run's prompt, from the automation and its pull request, with the pictures and files it carried, leaving later lines as sent", () => {
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
          parts: [
            { type: "text", text: "Triage the new issues.\n\nFired by pull request #42." },
            { type: "file", mediaType: "image/png", filename: "crash.png", url: SHOT },
            {
              type: "file",
              mediaType: "text/plain",
              filename: "crash.log",
              url: "data:text/plain;base64,YQ==",
            },
          ],
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
        pictures: [{ name: "crash.png", url: SHOT, pictureId: undefined }],
        files: [{ name: "crash.log", base64: "YQ==" }],
      },
      { kind: TRANSCRIPT_ITEM.SAID, words: "Thanks.", sender: undefined },
    ]);
  });

  it("stands one sender's lines sent close together in a run, and the day and time only over talk that picks up again, never joining the reader to an app, and stands every line but the reader's own received", () => {
    const minute = 60 * 1000;
    const ada = { name: "Ada", userId: "u1" };
    const grace = { name: "Grace", userId: "u2" };

    const line = (
      id: string,
      minutes: number,
      sentBy: { readonly name: string; readonly userId?: string } = ada,
    ) => ({
      id,
      role: MESSAGE_ROLE.USER,
      parts: [{ type: "text" as const, text: id }],
      sentAt: minutes * minute,
      sentBy,
    });

    const items = transcriptItems(
      [
        line("a", 0),
        line("b", 1),
        line("c", 2, grace),
        line("d", 3, grace),
        line("e", 40),
        line("f", 41, { name: "Morning triage" }),
        {
          id: "g",
          role: MESSAGE_ROLE.USER,
          parts: [
            {
              type: "text" as const,
              text: 'Message · Triage to you:\n\nShip it.\n\nReply with message_agent({ agentId: "0a09f5a6-cff0-4615-aff3-a54d80f101dc", text }).',
            },
          ],
          metadata: { channel: MESSAGE_CHANNEL.AGENT_MESSAGE },
          sentAt: 42 * minute,
          sentBy: { name: "Triage", agent: true },
        },
      ],
      { writing: false, readerId: "u1", toggles: NO_TOGGLES, now: 41 * minute, pullRequests: [] },
    );

    expect(
      items.map((item) =>
        item.kind === TRANSCRIPT_ITEM.SAID
          ? [
              item.words,
              item.joinsAbove,
              item.joinsBelow,
              item.sender,
              item.stamp !== undefined,
              item.received,
            ]
          : item.kind,
      ),
    ).toEqual([
      ["a", false, true, undefined, true, false],
      ["b", true, false, undefined, false, false],
      ["c", false, true, "Grace", false, true],
      ["d", true, false, "Grace", false, true],
      ["e", false, false, undefined, true, false],
      ["f", false, false, "Morning triage", false, true],
      ["Ship it.", false, false, "Triage", false, true],
    ]);
  });

  it("names an app's line while the reader is not yet known", () => {
    const items = transcriptItems(
      [
        {
          id: "fired",
          role: MESSAGE_ROLE.USER,
          parts: [{ type: "text", text: "Triage the new issues." }],
          sentAt: 0,
          sentBy: { name: "Morning triage" },
        },
      ],
      { writing: false, readerId: undefined, toggles: NO_TOGGLES, now: 1, pullRequests: [] },
    );

    expect(items).toMatchObject([{ kind: TRANSCRIPT_ITEM.SAID, sender: "Morning triage" }]);
  });

  it("draws a review GitHub sent as its card, closed under its head rather than the prompt the agent read, until the reader opens it", () => {
    const review = {
      id: "review",
      role: MESSAGE_ROLE.USER,
      parts: [
        {
          type: "text",
          text: "@grace requested changes on #7.\n\n<github-review>…</github-review>",
        },
      ],
      metadata: {
        channel: MESSAGE_CHANNEL.GITHUB,
        event: "review",
        repository: "ada/relay",
        number: 7,
        url: "https://github.com/ada/relay/pull/7#pullrequestreview-1",
        by: "grace",
        verdict: "changes_requested",
        words: "Skip pending members.",
        comments: [
          {
            path: "src/members/list.ts",
            line: 12,
            url: "https://github.com/ada/relay/pull/7#discussion_r1",
            body: "Filter here.",
          },
        ],
      },
      sentBy: { name: "grace" },
    } as const;

    const reading = {
      writing: false,
      readerId: "u1",
      toggles: NO_TOGGLES,
      now: 1,
      pullRequests: [],
    };

    const [closed] = transcriptItems([review], reading);

    expect(closed).toMatchObject({
      kind: TRANSCRIPT_ITEM.GITHUB,
      open: false,
      fold: {
        by: "grace",
        does: "requested changes on",
        target: "#7",
        heard: "grace requested changes on #7, 1 comment",
        folds: true,
      },
    });

    const toggles = closed === undefined ? NO_TOGGLES : toggledAt(NO_TOGGLES, closed);

    expect(transcriptItems([review], { ...reading, toggles })).toMatchObject([
      { kind: TRANSCRIPT_ITEM.GITHUB, open: true },
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
    "draws a pull request a call opened as the task list holds it, or as it was opened where the list holds none, in the call's place ($card.state)",
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
      expect(items.some((item) => item.kind === TRANSCRIPT_ITEM.CALL)).toBe(false);
    },
  );
  it("keeps the turn a call handed the agent open while the agent still writes it, though the voice's line stands after it, and folds its words once it ends", () => {
    const call = (author: string) => ({
      author,
      channel: MESSAGE_CHANNEL.VOICE,
      voice_session_id: "call-1",
    });

    const transcript = (finished: boolean) =>
      transcriptItems(
        [
          {
            id: "ask",
            role: MESSAGE_ROLE.USER,
            parts: [{ type: "text", text: "Run the tests." }],
            metadata: { ...call(MESSAGE_AUTHOR.DEVELOPER), delegation_id: "delegation-1" },
          },
          {
            id: "work",
            role: MESSAGE_ROLE.ASSISTANT,
            parts: [{ type: "text", text: "Two tests failed." }],
            startedAt: 0,
            ...(finished ? { finishedAt: 1 } : undefined),
          },
          {
            id: "ack",
            role: MESSAGE_ROLE.ASSISTANT,
            parts: [{ type: "text", text: "On it." }],
            metadata: call(MESSAGE_AUTHOR.VOICE_MODEL),
          },
        ],
        { writing: !finished, readerId: undefined, toggles: NO_TOGGLES, now: 2, pullRequests: [] },
      );

    const turn = (finished: boolean) =>
      transcript(finished).flatMap((item) =>
        item.place.message !== "work"
          ? []
          : [item.kind === TRANSCRIPT_ITEM.FOLD ? item.summary : item.kind],
      );

    expect(turn(false)).toEqual([TRANSCRIPT_ITEM.WORDS]);
    expect(turn(true)).toEqual(["Written reply", TRANSCRIPT_ITEM.FOOT]);
  });
  it.each([
    {
      name: "each stretch of its words and none of its calls",
      before: [],
      parts: [
        { type: "text", text: "Running the tests." },
        {
          type: "tool-bash",
          toolCallId: "run",
          state: "output-available",
          input: { command: "pnpm test" },
          output: { stdout: "ok" },
        },
        { type: "text", text: "They pass." },
      ],
      copy: "Running the tests.\n\nThey pass.",
    },
    {
      name: "its words folded closed, as a call's delegated turn folds them",
      before: [
        {
          id: "ask",
          role: MESSAGE_ROLE.USER,
          parts: [{ type: "text", text: "Run the tests." }],
          metadata: {
            author: MESSAGE_AUTHOR.DEVELOPER,
            channel: MESSAGE_CHANNEL.VOICE,
            voice_session_id: "call-1",
            delegation_id: "delegation-1",
          },
        },
      ],
      parts: [{ type: "text", text: "Two tests failed." }],
      copy: "Two tests failed.",
    },
  ])("hands a finished turn's foot the turn's words to copy: $name", ({ before, parts, copy }) => {
    const items = transcriptItems(
      [...before, { id: "work", role: MESSAGE_ROLE.ASSISTANT, parts, startedAt: 0, finishedAt: 1 }],
      { writing: false, readerId: undefined, toggles: NO_TOGGLES, now: 2, pullRequests: [] },
    );

    const foot = items.find((item) => item.kind === TRANSCRIPT_ITEM.FOOT);

    expect(foot?.kind === TRANSCRIPT_ITEM.FOOT ? foot.copy : undefined).toBe(copy);
  });
});

describe("withWaitingLine", () => {
  it("stops a fold's spinner while the agent waits on the reader", () => {
    const done = (id: string) => ({
      type: "tool-bash",
      toolCallId: id,
      state: "output-available",
      input: { command: `pnpm test ${id}` },
      output: { stdout: "ok" },
    });

    const items = transcriptItems(
      [
        {
          id: "work",
          role: MESSAGE_ROLE.ASSISTANT,
          parts: [
            done("a"),
            done("b"),
            {
              type: "tool-bash",
              toolCallId: "c",
              state: "input-available",
              input: { command: "pnpm test c" },
            },
          ],
        },
      ],
      { writing: true, readerId: undefined, toggles: NO_TOGGLES, now: 2, pullRequests: [] },
    );

    const folds = (shown: readonly (typeof items)[number][]) =>
      shown.flatMap((item) => (item.kind === TRANSCRIPT_ITEM.FOLD ? [item.running] : []));

    expect(folds(items)).toEqual([true]);
    expect(folds(withWaitingLine(items, "Waiting on you · 1 approval"))).toEqual([false]);
  });
});

describe("a call the agent holds for the reader's answer", () => {
  it("keeps the fold that holds it open once a line the reader sent lands after it, so its row and its answers stay drawn", () => {
    const done = (id: string) => ({
      type: "tool-bash",
      toolCallId: id,
      state: "output-available",
      input: { command: `pnpm test ${id}` },
      output: { stdout: "ok" },
    });

    const items = transcriptItems(
      [
        {
          id: "work",
          role: MESSAGE_ROLE.ASSISTANT,
          parts: [
            { type: "step-start" },
            done("a"),
            done("b"),
            {
              type: "tool-bash",
              toolCallId: "held",
              state: "input-available",
              input: { command: "pnpm test held" },
            },
          ],
        },
        {
          id: "steer",
          role: MESSAGE_ROLE.USER,
          parts: [{ type: "text", text: "Also cover the expired invite." }],
          arrivedIn: { journalId: "work", afterStep: 1 },
        },
      ],
      {
        writing: true,
        readerId: undefined,
        toggles: NO_TOGGLES,
        now: 2,
        pullRequests: [],
        waitingCalls: new Set(["held"]),
      },
    );

    expect(drawnCallIds(items).has("held")).toBe(true);
  });
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

describe("rowsNear", () => {
  it("reads the pictures of the rows on screen and of the few on each side of them", () => {
    const shown = (index: number) => ({
      id: `work-${index}`,
      role: MESSAGE_ROLE.ASSISTANT,
      parts: [
        {
          type: "tool-show_image",
          toolCallId: `shots-${index}`,
          state: "output-available",
          input: { images: [{ path: `/shots/${index}.png`, caption: `Shot ${index}` }] },
          output: { status: "accepted", pictures: [{ ...PICTURE, id: `picture-${index}` }] },
        },
      ],
      finishedAt: 1,
    });

    const items = transcriptItems([0, 1, 2, 3, 4, 5, 6].map(shown), {
      writing: false,
      readerId: undefined,
      toggles: NO_TOGGLES,
      now: 2,
      pullRequests: [],
    });

    const onScreen = items.filter((item) => item.kind === TRANSCRIPT_ITEM.MEDIA).slice(3, 4);

    expect(shownMediaIds(rowsNear(items, onScreen, 1))).toEqual([
      "picture-2",
      "picture-3",
      "picture-4",
    ]);
    expect(shownMediaIds(rowsNear(items, [], 1))).toEqual([]);
  });
});

describe("managerChatItems", () => {
  const minute = 60 * 1000;

  /** One message of a Manager's chat as its row delivers it. */
  const row = (
    id: string,
    seq: number,
    said: Partial<ManagerChatLiveMessage> & Pick<ManagerChatLiveMessage, "authorKind" | "text">,
  ): ManagerChatLiveMessage => ({
    id,
    seq,
    authorUserId: null,
    authorName: "Pat",
    attachments: [],
    threadRoot: null,
    broadcast: false,
    turnId: null,
    lineId: null,
    createdAt: seq * minute,
    editedAt: null,
    ...said,
  });

  const run = (opens: boolean, closes: boolean) => ({ opens, closes });

  it("draws the chat's rows as bubbles: its greeting first, the reader's own trailing and a teammate's named with the picture it kept and the file it carried, the Manager's received in the runs placed, a set it showed as its pictures, a message on its way joining the reader's run, and its working line a bubble", () => {
    const lines = [
      {
        message: row("a1", 1, {
          authorKind: MANAGER_CHAT_AUTHOR.PERSON,
          authorUserId: "u1",
          text: "Fix the login.",
        }),
        place: run(true, true),
      },
      {
        message: row("m1", 2, { authorKind: MANAGER_CHAT_AUTHOR.AGENT, text: "On it." }),
        place: run(true, false),
      },
      {
        message: row("m2", 3, {
          authorKind: MANAGER_CHAT_AUTHOR.AGENT,
          text: "",
          attachments: [{ id: "shot", mediaType: "image/png" }],
        }),
        place: run(false, true),
      },
      {
        message: row("g1", 4, {
          authorKind: MANAGER_CHAT_AUTHOR.PERSON,
          authorUserId: "u2",
          authorName: "Grace",
          text: "And the signup.",
          attachments: [
            { id: "kept-shot", mediaType: "image/png", name: "signup.png" },
            { name: "notes.txt", mediaType: "text/plain", url: "data:text/plain;base64,YQpi" },
          ],
        }),
        place: run(true, true),
      },
      {
        message: row("a2", 5, {
          authorKind: MANAGER_CHAT_AUTHOR.PERSON,
          authorUserId: "u1",
          text: "Thanks!",
        }),
        place: run(true, true),
      },
    ];

    const items = managerChatItems(
      {
        messages: lines,
        top: lines,
        threads: new Map(),
        work: new Map(),
        live: [],
      },
      [],
      {
        writing: true,
        readerId: "u1",
        toggles: NO_TOGGLES,
        now: 6 * minute,
        pullRequests: [],
        greeting: "Hi, I'm Pat.",
        sending: [{ clientKey: "k1", text: "One more thing.", sentAt: 6 * minute }],
      },
    );

    expect(
      items.map((item) =>
        item.kind === TRANSCRIPT_ITEM.SAID
          ? [item.words, item.sender, item.received, item.joinsAbove]
          : item.kind === TRANSCRIPT_ITEM.MEDIA
            ? [item.kind, item.media.map((media) => [media.id, media.label])]
            : [item.kind, item.kind === TRANSCRIPT_ITEM.WORKING && item.chat],
      ),
    ).toEqual([
      ["Hi, I'm Pat.", undefined, true, false],
      ["Fix the login.", undefined, false, false],
      ["On it.", undefined, true, false],
      [TRANSCRIPT_ITEM.MEDIA, [["shot", "Picture"]]],
      ["And the signup.", "Grace", true, false],
      ["Thanks!", undefined, false, false],
      ["One more thing.", undefined, false, true],
      [TRANSCRIPT_ITEM.WORKING, true],
    ]);
    expect(items[4]).toMatchObject({
      pictures: [{ name: "signup.png", pictureId: "kept-shot", url: undefined }],
      files: [{ name: "notes.txt", base64: "YQpi", size: "2 lines" }],
    });
  });

  it("folds a finished turn's work over the Manager's message that opens it, saying how long it worked, and opens it on the work", () => {
    const said = row("m1", 1, {
      authorKind: MANAGER_CHAT_AUTHOR.AGENT,
      text: "Nothing open.",
      turnId: "turn",
    });

    const turn = {
      id: "turn",
      role: MESSAGE_ROLE.ASSISTANT,
      parts: [
        {
          type: "tool-list_tasks",
          toolCallId: "look",
          state: "output-available",
          input: {},
          output: { tasks: [] },
        },
      ],
      startedAt: 0,
      finishedAt: 78_000,
    };

    const read = (toggles: typeof NO_TOGGLES) =>
      managerChatItems(
        {
          messages: [{ message: said, place: run(true, true), work: "turn" }],
          top: [{ message: said, place: run(true, true), work: "turn" }],
          threads: new Map(),
          work: new Map([["turn", agentParts(turn)]]),
          live: [],
        },
        [turn],
        { writing: false, readerId: "u1", toggles, now: 2 * minute, pullRequests: [] },
      );

    const closed = read(NO_TOGGLES);
    const fold = closed[0];

    expect(closed.map((item) => [item.kind, item.depth])).toEqual([
      [TRANSCRIPT_ITEM.FOLD, 0],
      [TRANSCRIPT_ITEM.SAID, 0],
    ]);
    expect(fold).toMatchObject({ summary: "Worked for 1m 18s", open: false });

    const opened = read(fold === undefined ? NO_TOGGLES : toggledAt(NO_TOGGLES, fold));

    expect(opened.map((item) => [item.kind, item.depth])).toEqual([
      [TRANSCRIPT_ITEM.FOLD, 0],
      [TRANSCRIPT_ITEM.CALL, 1],
      [TRANSCRIPT_ITEM.SAID, 0],
    ]);
  });
});
