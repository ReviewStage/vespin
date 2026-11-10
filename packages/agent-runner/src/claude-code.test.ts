/**
 * claude-code.test.ts -- the Agent SDK's door read back: a stored session's chain, which a rewind or a fork at a message cuts, read from the service's store where no disk holds the session.
 *
 * A sandbox made anew, and an agent forking another's session, hold the
 * CLI's transcript in the store alone, so a chain read from the disk there
 * finds nothing and the cut is never made. The store is the SDK's own
 * in-memory one; the checkout is a temporary directory of the test's own.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemorySessionStore } from "@anthropic-ai/claude-agent-sdk";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { ClaudeCode, claudeCodeLive } from "./claude-code.js";

const SESSION = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const CHAIN = [
  "10000000-0000-4000-8000-000000000001",
  "10000000-0000-4000-8000-000000000002",
  "10000000-0000-4000-8000-000000000003",
];

/** One transcript line as the CLI writes it, the child of the one before it, where one stands. */
function entryOf(cwd: string, uuid: string, parentUuid: string | null, index: number) {
  const type = index % 2 === 0 ? "user" : "assistant";
  return {
    type,
    uuid,
    parentUuid,
    sessionId: SESSION,
    cwd,
    timestamp: "2026-11-09T00:00:00.000Z",
    isSidechain: false,
    userType: "external",
    message:
      type === "user"
        ? { role: type, content: `Line ${index}.` }
        : { role: type, content: [{ type: "text", text: `Answer ${index}.` }] },
  };
}

it.effect("reads a stored session's chain from the store where no disk holds it", () =>
  Effect.gen(function* () {
    const cwd = mkdtempSync(join(tmpdir(), "session-chain-"));
    const store = new InMemorySessionStore();
    // Note that the SDK keys a checkout's project by its path, each character but a letter or digit a dash.
    const projectKey = cwd.replace(/[^a-zA-Z0-9]/gu, "-");
    yield* Effect.promise(() =>
      store.append(
        { projectKey, sessionId: SESSION },
        CHAIN.map((uuid, index) => entryOf(cwd, uuid, CHAIN[index - 1] ?? null, index)),
      ),
    );
    const claudeCode = yield* ClaudeCode;

    const chain = yield* Effect.promise(() => claudeCode.sessionChain(SESSION, cwd, store));

    rmSync(cwd, { recursive: true, force: true });
    assert.deepEqual(chain, CHAIN);
  }).pipe(Effect.provide(claudeCodeLive)),
);
