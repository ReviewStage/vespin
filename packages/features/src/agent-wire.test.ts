import assert from "node:assert/strict";
import { MESSAGE_ROLE } from "@repo/wire";
import { Schema } from "effect";
import { test } from "vitest";
import {
  AGENT_CURSOR_START,
  AGENT_FAILURE,
  AGENT_STATUS,
  type AgentTranscriptMessage,
  agentAttachmentsSchema,
  agentMessagesAnswerSchema,
  applyMessagesPage,
  DEVICE_STANDING,
  deviceStanding,
} from "./agent-wire.js";

function message(id: string, text: string): AgentTranscriptMessage {
  return { id, role: MESSAGE_ROLE.ASSISTANT, parts: [{ type: "text", text }] };
}

test("a page joins the messages held: one heard again is replaced in place, a new one joins at the end", () => {
  const held = [message("a", "first"), message("b", "second")];

  const joined = applyMessagesPage(held, [message("a", "first, amended"), message("c", "third")]);

  assert.deepEqual(
    joined.map((each) => [each.id, each.parts]),
    [
      ["a", [{ type: "text", text: "first, amended" }]],
      ["b", [{ type: "text", text: "second" }]],
      ["c", [{ type: "text", text: "third" }]],
    ],
  );
  assert.equal(applyMessagesPage(held, []), held);
});

test("a page saying again what is held keeps the messages held, so only one that changed is drawn again", () => {
  const held = [message("a", "first"), message("b", "second")];

  assert.equal(
    applyMessagesPage(held, [message("a", "first"), message("b", "second")]),
    held,
    "a transcript heard again whole, as it was, is the one held",
  );
  const amended = applyMessagesPage(held, [message("a", "first"), message("b", "second, amended")]);
  assert.equal(amended[0], held[0], "a message heard again as it was is the one held");
  assert.deepEqual(amended[1]?.parts, [{ type: "text", text: "second, amended" }]);
});

test("a page naming a failure this build does not know decodes, the failure read as one it has no words for", () => {
  const page = Schema.decodeUnknownSync(agentMessagesAnswerSchema)({
    messages: [],
    cursor: AGENT_CURSOR_START,
    status: AGENT_STATUS.FAILED,
    title: null,
    failureReason: "a_failure_from_a_later_service",
  });

  assert.equal(page.failureReason, AGENT_FAILURE.OTHER);
});

test("a device reads as there until it has missed four beats, as offline only once a read that landed lately found it so, and as unknown where the read failed or is late", () => {
  assert.deepEqual(
    [
      deviceStanding({ sinceBeatMs: 50_000, sinceReadMs: 5_000 }, false),
      deviceStanding({ sinceBeatMs: 66_000, sinceReadMs: 5_000 }, false),
      deviceStanding({ sinceBeatMs: 66_000, sinceReadMs: 5_000 }, true),
      // The read found the beat 50 seconds old, and the window has heard nothing since: a read late or slow, not a device gone.
      deviceStanding({ sinceBeatMs: 50_000 + 31_000, sinceReadMs: 31_000 }, false),
      deviceStanding({ sinceBeatMs: 50_000 + 600_000, sinceReadMs: 600_000 }, false),
      // A read that found the beat already 66 seconds old, but too long ago to stand.
      deviceStanding({ sinceBeatMs: 66_000 + 40_000, sinceReadMs: 40_000 }, false),
    ],
    [
      DEVICE_STANDING.ONLINE,
      DEVICE_STANDING.OFFLINE,
      DEVICE_STANDING.UNKNOWN,
      DEVICE_STANDING.UNKNOWN,
      DEVICE_STANDING.UNKNOWN,
      DEVICE_STANDING.UNKNOWN,
    ],
  );
});

/** A 1×1 GIF89a's parts, laid out by hand from the GIF spec: its header and screen with a two-color table, one frame with its control extension, and its trailer. */
const GIF_HEAD = [
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00,
  0xff, 0xff, 0xff,
];

const GIF_FRAME = [
  0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01,
  0x00, 0x00, 0x02, 0x01, 0x44, 0x00,
];

const GIF_TRAILER = [0x3b];

function gifAttachment(frames: number) {
  const bytes = [
    ...GIF_HEAD,
    ...Array.from({ length: frames }, () => GIF_FRAME).flat(),
    ...GIF_TRAILER,
  ];

  return { name: "loop.gif", mediaType: "image/gif", data: btoa(String.fromCharCode(...bytes)) };
}

test("a message carries a still GIF and refuses an animated one, which no model takes as an image", () => {
  const decode = Schema.decodeUnknownOption(agentAttachmentsSchema);

  assert.equal(decode([gifAttachment(1)])._tag, "Some");
  assert.equal(decode([gifAttachment(2)])._tag, "None");
});
