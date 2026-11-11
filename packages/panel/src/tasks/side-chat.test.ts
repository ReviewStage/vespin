import assert from "node:assert/strict";
import { MESSAGE_ROLE } from "@repo/wire";
import { test } from "vitest";
import { sideChatFork } from "./side-chat.js";

/**
 * side-chat.test.ts -- where a side chat (`/btw`) forks the agent's
 * transcript: its newest settled reply, never the words a running turn is
 * still writing, which stay out of the aside.
 */

const SOURCE = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

const step = { type: "step-start" } as const;
const words = (text: string) => ({ type: "text", text }) as const;

const ASKED = { id: "u1", role: MESSAGE_ROLE.USER, parts: [words("Fix the invite email.")] };
const SETTLED = { id: "a1", role: MESSAGE_ROLE.ASSISTANT, parts: [step, words("Done.")] };
const NEXT = { id: "u2", role: MESSAGE_ROLE.USER, parts: [words("Now add a retry.")] };
const WRITING = {
  id: "a2",
  role: MESSAGE_ROLE.ASSISTANT,
  parts: [step, words("Reading the queue."), step, words("Adding")],
};

test("a side chat forks at the newest settled reply, leaving out the one a running turn still writes, and keeping the last turn's while the new one has written none; with none settled, it cuts that one where it stands; with no reply begun, it offers none", () => {
  assert.deepEqual(sideChatFork(SOURCE, [ASKED, SETTLED, NEXT, WRITING], true), {
    agentId: SOURCE,
    messageId: "a1",
    opening: "",
  });
  // A turn that has written nothing yet leaves the last turn's reply settled, so the fork keeps it.
  assert.deepEqual(sideChatFork(SOURCE, [ASKED, SETTLED, NEXT], true), {
    agentId: SOURCE,
    messageId: "a1",
    opening: "",
  });
  assert.deepEqual(sideChatFork(SOURCE, [ASKED, SETTLED, NEXT, WRITING], false), {
    agentId: SOURCE,
    messageId: "a2",
    opening: "",
  });
  assert.deepEqual(sideChatFork(SOURCE, [ASKED, WRITING], true), {
    agentId: SOURCE,
    messageId: "a2",
    opening: "",
    messageSteps: 2,
    messageStepParts: 1,
  });
  assert.equal(sideChatFork(SOURCE, [ASKED], true), undefined);
});
