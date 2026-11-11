/**
 * turn-files.test.ts -- the files a turn changed, read from its edits: a patch's lines counted per file, a written file counted as added, a file edited twice summed once, a moved file named where it went, and a patch of another checkout naming none.
 */

import assert from "node:assert/strict";
import { test } from "vitest";
import { AGENT_PART, type AgentPart } from "./agent-parts.js";
import { AGENT_TOOL } from "./agent-tools.js";
import { TOOL_STATE } from "./tool-call-block.js";
import { turnFiles } from "./turn-files.js";

function call(tool: string, input: Record<string, string>): AgentPart {
  return {
    kind: AGENT_PART.TOOL,
    tool,
    callId: `call-${tool}-${Object.values(input).join("").length}`,
    state: TOOL_STATE.OUTPUT_AVAILABLE,
    input,
    output: "ok",
    errorText: undefined,
  };
}

const EDIT = [
  "*** Update File: src/members/invite.ts",
  "@@",
  "-const ttl = 7;",
  "+const ttl = 14;",
  "+const resend = true;",
].join("\n");

const CODEX = [
  "*** Add File: src/members/resend.ts",
  "+export const resend = 1;",
  "+export const again = 2;",
  "*** Update File: src/members/old.ts",
  "*** Move to: src/members/invite.ts",
  "@@ -1,2 +1,1 @@",
  "-gone",
  " kept",
].join("\n");

test("a turn's files are each path its patches and writes name, with the lines added and removed summed per file, in the order first named", () => {
  const files = turnFiles([
    { kind: AGENT_PART.TEXT, text: "On it." },
    call(AGENT_TOOL.APPLY_PATCH, { patchText: EDIT }),
    call(AGENT_TOOL.WRITE_FILE, { filePath: "src/members/invite.test.ts", content: "a\nb\nc\n" }),
    call(AGENT_TOOL.APPLY_PATCH, { patchText: CODEX }),
    call(AGENT_TOOL.READ_FILE, { filePath: "src/db/schema.ts" }),
  ]);
  assert.deepEqual(files, {
    files: [
      { path: "src/members/invite.ts", added: 2, removed: 2 },
      { path: "src/members/invite.test.ts", added: 3, removed: 0 },
      { path: "src/members/resend.ts", added: 2, removed: 0 },
    ],
    added: 7,
    removed: 2,
  });
});

test("a turn with no edit, or whose patch names another checkout's files, changed no file", () => {
  assert.equal(turnFiles([call(AGENT_TOOL.READ_FILE, { filePath: "a.ts" })]), undefined);
  assert.equal(
    turnFiles([call(AGENT_TOOL.APPLY_PATCH, { patchText: EDIT, root: "/elsewhere" })]),
    undefined,
  );
});
