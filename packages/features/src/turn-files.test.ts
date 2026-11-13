/**
 * turn-files.test.ts -- each reply named by the developer's line that opened its turn, which its Changes tab reads the turn's diff by.
 */

import assert from "node:assert/strict";
import { MESSAGE_ROLE } from "@repo/wire";
import { test } from "vitest";
import type { AgentTranscriptMessage } from "./agent-wire.js";
import { turnLinesOf } from "./turn-files.js";

test("each reply names the developer's line that opened its turn, a line that arrived inside a turn opening none", () => {
  const line = (
    id: string,
    arrivedIn?: { journalId: string; afterStep: number },
  ): AgentTranscriptMessage => ({
    id,
    role: MESSAGE_ROLE.USER,
    parts: [],
    clientId: id,
    sentAt: 1,
    ...(arrivedIn === undefined ? undefined : { arrivedIn }),
  });

  const reply = (id: string): AgentTranscriptMessage => ({
    id,
    role: MESSAGE_ROLE.ASSISTANT,
    parts: [],
  });

  assert.deepEqual(
    [
      ...turnLinesOf([
        reply("early"),
        line("first"),
        reply("one"),
        line("steer", { journalId: "j", afterStep: 2 }),
        reply("two"),
        line("second"),
        reply("three"),
      ]),
    ],
    [
      ["one", "first"],
      ["two", "first"],
      ["three", "second"],
    ],
  );
});
