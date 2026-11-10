// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { ApprovalAnswerRequest } from "@repo/features/agent-approval-wire";
import {
  AGENT_BRIEF,
  AGENT_RUNTIME,
  AGENT_STATUS,
  type AgentSummary,
  type AgentTranscriptMessage,
} from "@repo/features/agent-wire";
import { MESSAGE_ROLE } from "@repo/wire";
import { Effect } from "effect";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { editorBundleLanded, installEditorLayout } from "../testing/composer.js";
import { settleQueries, withQueryClient } from "../testing/copy-feedback.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { agentsControl, pushedTranscripts } from "../testing/tasks-control.js";
import { ToastHost } from "../toast.js";
import { AgentTab } from "./agent-tab.js";

/**
 * agent-approvals.test.ts -- a tool call a Claude Code agent holds says so on
 * its own row, and Allow sends the answer and the row says it was allowed;
 * a Claude Code agent's model chip names its mode off Full access, where a
 * Codex agent's names none.
 */

const TASK = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const AGENT = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const APPROVAL = "0b1c4a39-3b5e-4f7c-9a52-8d4f0e7c2a11";
const CALL = "toolu_01ResendTest";

const CLAUDE_AGENT: AgentSummary = {
  id: AGENT,
  planId: TASK,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Resend invitations",
  createdAt: 1_000,
  status: AGENT_STATUS.RUNNING,
  turnId: "turn-1",
  brief: AGENT_BRIEF.DESCRIPTION,
  runtime: AGENT_RUNTIME.CLAUDE_CODE,
  permissionMode: "ask",
  pendingApprovals: [
    {
      id: APPROVAL,
      toolUseId: CALL,
      toolName: "Bash",
      title: "Claude wants to run a command",
      input: { command: "pnpm test src/members" },
      askedAt: 3_000,
    },
  ],
};

const MESSAGES: readonly AgentTranscriptMessage[] = [
  { id: "plan", role: MESSAGE_ROLE.USER, parts: [{ type: "text", text: "# Resend invitations" }] },
  {
    id: "turn-1",
    role: MESSAGE_ROLE.ASSISTANT,
    parts: [
      { type: "step-start" },
      {
        type: "tool-Bash",
        toolCallId: CALL,
        state: "input-available",
        input: { command: "pnpm test src/members" },
      },
    ],
    startedAt: 2_000,
  },
];

const roots: Root[] = [];

beforeAll(() => Effect.runPromise(editorBundleLanded));

beforeEach(() => {
  installScrollIntoView();
  installEditorLayout();
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  window.localStorage.clear();
  vi.restoreAllMocks();
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  await settleQueries();
}

/** The agent's tab over its transcript, its answers heard as `answered` and answered with the status the answer names. */
async function drawnTab(agent: AgentSummary) {
  fakeAppBridge({});
  pushedTranscripts(() => [
    { messages: [...MESSAGES], cursor: "2:0", status: agent.status, title: null },
  ]);
  const answered: ApprovalAnswerRequest[] = [];
  const control = agentsControl({
    agents: [agent],
    onAnswerApproval: (_agentId, approvalId, request) => {
      answered.push(request);
      return Promise.resolve({ approval: { id: approvalId, status: "allowed" } });
    },
  });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  await act(async () =>
    root.render(
      withQueryClient(
        createElement(
          "div",
          null,
          createElement(AgentTab, {
            agent,
            control,
            shown: true,
            onOpenSubagent: () => undefined,
            onOpenTarget: () => undefined,
            onHeld: () => undefined,
          }),
          createElement(ToastHost),
        ),
      ),
    ),
  );
  await settle();
  return { container, answered };
}

/** The button reading `words` in `container`, or none. */
function buttonReading(container: HTMLElement, words: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find((each) => each.textContent === words);
}

/** What the composer's model chip is called for a reader. */
function modelChipLabel(container: HTMLElement): string {
  const chip =
    container.querySelector<HTMLButtonElement>(".agent-model-chip button") ??
    assert.fail("the model chip");
  return chip.getAttribute("aria-label") ?? "";
}

test("Allow on a held call's row sends the answer, and the row says it was allowed", async () => {
  const { container, answered } = await drawnTab(CLAUDE_AGENT);
  const call = container.querySelector(`[data-call-id="${CALL}"]`) ?? assert.fail("the call");
  assert.ok(call.textContent?.includes("Waiting for approval"));
  // Note that the row stands open while it waits, so the command stands above its answers.
  assert.equal(call.closest("details")?.open, true);

  const allow = buttonReading(container, "Allow") ?? assert.fail("Allow");
  await act(async () => allow.click());
  await settle();

  assert.deepEqual(answered, [{ answer: "allow" }]);
  assert.equal(buttonReading(container, "Allow"), undefined);
  assert.ok(call.textContent?.includes("Allowed"));
});

test("a Claude Code agent's model chip names its mode off Full access, where a Codex agent's names none", async () => {
  const claude = await drawnTab(CLAUDE_AGENT);
  assert.ok(modelChipLabel(claude.container).endsWith("Ask for approval"));
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";

  // Note that the Codex agent's row names a mode that asks too, so only the harness gate keeps the chip from naming it.
  const { pendingApprovals: _asks, ...plain } = CLAUDE_AGENT;
  const codex = await drawnTab({
    ...plain,
    model: "openai/gpt-5.5",
    runtime: AGENT_RUNTIME.CODEX,
  });
  assert.ok(!modelChipLabel(codex.container).includes("Ask for approval"));
});
