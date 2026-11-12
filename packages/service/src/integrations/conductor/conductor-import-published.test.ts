import assert from "node:assert/strict";
import type { WireValue } from "@repo/wire";
import { describe, it } from "vitest";
import type { ConductorMessage } from "./conductor-client.js";
import { publishedCandidates } from "./conductor-import-published.js";

/**
 * The branch and pull request a chat's transcript names, read from
 * hand-written harness events as a coding chat stores them: a tool's input
 * and the tool's result. Synthetic repository and names throughout.
 */

const REPOSITORY = "acme/widgets";

/** A Bash call as the harness emits it. */
const bashCall = (command: string): WireValue => ({
  type: "assistant",
  message: { content: [{ type: "tool_use", name: "Bash", input: { command } }] },
});

/** A tool's result as the harness emits it. */
const toolResult = (content: string): WireValue => ({
  type: "user",
  message: { content: [{ type: "tool_result", tool_use_id: "toolu-1", content }] },
});

/** The payloads as a transcript, a second apart, oldest first. */
const transcriptOf = (payloads: readonly WireValue[]): ConductorMessage[] =>
  payloads.map((rawPayload, index) => ({
    id: `m-${index}`,
    type: "agent",
    receivedAt: new Date(Date.UTC(2026, 9, 1, 9, 0, index)).toISOString(),
    content: { rawPayload },
  }));

describe("publishedCandidates", () => {
  it.each([
    {
      name: "a push names its branch, the newest push winning",
      payloads: [
        bashCall("git push -u origin fix/old-try 2>&1"),
        bashCall(
          "git add -A && git commit -m wip && git push --set-upstream origin fix/flaky-check",
        ),
      ],
      branch: "fix/flaky-check",
      pullRequest: undefined,
    },
    {
      name: "gh pr create answers the pull request's link",
      payloads: [
        bashCall('gh pr create --title "Fix the flaky check" --body "..."'),
        toolResult("https://github.com/Acme/Widgets/pull/42\n"),
      ],
      branch: undefined,
      pullRequest: 42,
    },
    {
      name: "a link to another repository's pull request is not the workspace's",
      payloads: [toolResult("See https://github.com/other/widgets/pull/7 for the fix upstream.")],
      branch: undefined,
      pullRequest: undefined,
    },
    {
      name: "a transcript that pushed nothing names nothing",
      payloads: [bashCall("git push origin HEAD"), toolResult("Everything up-to-date")],
      branch: undefined,
      pullRequest: undefined,
    },
  ])("$name", ({ payloads, branch, pullRequest }) => {
    const found = publishedCandidates(REPOSITORY, transcriptOf(payloads));

    assert.equal(found.branch?.value, branch);
    assert.equal(found.pullRequest?.value, pullRequest);
  });
});
