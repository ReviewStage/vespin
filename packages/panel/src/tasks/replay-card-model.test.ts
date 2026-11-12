import assert from "node:assert/strict";
import { messageWords } from "@repo/features/agent-parts";
import {
  firstMessageText,
  REPLAY_STEP_KIND,
  type Replay,
  START_NOTE_HEADING,
} from "@repo/features/agent-replay";
import type { AgentTranscriptMessage } from "@repo/features/agent-wire";
import { replayOpening } from "@repo/features/replay-card-model";
import { MESSAGE_ROLE } from "@repo/wire";
import { test } from "vitest";
import { messageFileChips } from "./attached-file-chips.js";

/**
 * replay-card-model.test.ts -- the files an agent started from another
 * draws under its opening's brief and its note, as the transcript's chips
 * read them (`attached-file-chips.tsx`). Synthetic throughout.
 */

const SOURCE_ID = "4f1e2d3c-5b6a-4978-8a1b-2c3d4e5f6a7b";

const STEPS: Replay["steps"] = [
  { kind: REPLAY_STEP_KIND.LINE, summary: "Vespin: Use seven days.", words: "Use seven days." },
  {
    kind: REPLAY_STEP_KIND.TOOL,
    summary: "Read: invite.ts",
    words: "read_file(invite.ts)\n→ 42 lines",
  },
  { kind: REPLAY_STEP_KIND.SAID, summary: "Said: Done: for now.", words: "Done: for now." },
];

function replay(overrides: Partial<Replay> = {}): Replay {
  return { agentId: SOURCE_ID, preamble: "Carry on.", steps: STEPS, totalSteps: 3, ...overrides };
}

const FILE = { type: "file", mediaType: "image/png", filename: "flow.png", url: "data:," };

function first(text: string): AgentTranscriptMessage {
  return { id: "first", role: MESSAGE_ROLE.USER, parts: [FILE, { type: "text", text }] };
}

test("a first message holding a replay opens on its brief with its files, the replay, and the note as a line of its own with none", () => {
  const text = firstMessageText("# Invite flow", replay(), "Try five days instead.");
  const opening = replayOpening(first(text));
  assert.ok(opening !== undefined);
  assert.equal(messageWords(opening.brief), "# Invite flow");
  assert.deepEqual(
    messageFileChips(opening.brief).map((file) => file.name),
    ["flow.png"],
  );
  assert.deepEqual(opening.replay.steps, STEPS);
  assert.ok(opening.note !== undefined);
  assert.equal(messageWords(opening.note), "Try five days instead.");
  assert.deepEqual(messageFileChips(opening.note), []);
  // The note is drawn under an id of its own, so no Copy link under it names the brief's message.
  assert.notEqual(opening.note.id, "first");
});

test("the note's own files go with the note and the brief's stay with the brief, by the counts its marker names", () => {
  const file = (name: string, mediaType: string) => ({
    type: "file",
    mediaType,
    filename: name,
    url: "data:,",
  });

  const text = firstMessageText(
    "Fix it.",
    replay(),
    "Use this design.",
    START_NOTE_HEADING.DEVELOPER,
    {
      text: 1,
      other: 1,
    },
  );

  const message: AgentTranscriptMessage = {
    id: "first",
    role: MESSAGE_ROLE.USER,
    parts: [
      { type: "text", text },
      file("brief.txt", "text/plain"),
      file("notes.txt", "text/plain"),
      file("diagram.png", "image/png"),
      file("new-design.png", "image/png"),
    ],
  };

  const opening = replayOpening(message);
  assert.ok(opening?.note !== undefined);
  assert.deepEqual(
    messageFileChips(opening.brief).map((each) => each.name),
    ["brief.txt", "diagram.png"],
  );
  assert.deepEqual(
    messageFileChips(opening.note).map((each) => each.name),
    ["notes.txt", "new-design.png"],
  );
});
