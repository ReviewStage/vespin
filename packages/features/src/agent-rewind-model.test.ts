import assert from "node:assert/strict";
import { MESSAGE_CHANNEL, MESSAGE_ROLE } from "@repo/wire";
import { test } from "vitest";
import { editsInPlace } from "./agent-rewind-model.js";
import type { AgentTranscriptMessage } from "./agent-wire.js";

/**
 * agent-rewind-model.test.ts -- which of a person's lines offer Edit by what
 * they are, as the panel's tab and the iOS app's agent page both read it.
 */

/** A line of the member's, its words its id, carrying the metadata given. */
function line(
  words: string,
  metadata?: AgentTranscriptMessage["metadata"],
): AgentTranscriptMessage {
  return {
    id: words,
    role: MESSAGE_ROLE.USER,
    parts: [{ type: "text", text: words }],
    ...(metadata === undefined ? undefined : { metadata }),
  };
}

test("Edit is offered on a typed line, never on a comment's, a Slack message's, a spoken one, or files alone", () => {
  assert.equal(editsInPlace(line("Use the queue."), "Use the queue."), true);
  assert.equal(
    editsInPlace(
      line("comment", { channel: MESSAGE_CHANNEL.COMMENT, thread_id: "thread-1", words: "Why?" }),
      "Why?",
    ),
    false,
  );
  assert.equal(
    editsInPlace(line("slack", { channel: MESSAGE_CHANNEL.SLACK, words: "Ship it" }), "Ship it"),
    false,
  );
  assert.equal(
    editsInPlace(
      line("spoken", { channel: MESSAGE_CHANNEL.VOICE, voice_session_id: "call-1" }),
      "spoken",
    ),
    false,
  );
  assert.equal(editsInPlace(line("files"), ""), false);
});
