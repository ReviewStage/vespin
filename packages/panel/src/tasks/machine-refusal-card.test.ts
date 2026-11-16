// @vitest-environment jsdom

import assert from "node:assert/strict";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import { AGENT_STATUS } from "@repo/features/agent-wire";
import { MACHINE_UNREACHED } from "@repo/features/machine-command-wire";
import { AGENT_ACT_KIND } from "@repo/host/contract";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { appBridge } from "../app-bridge.js";
import { fakeActPort } from "../testing/app-bridge.js";
import { handState } from "../testing/app-state.js";
import { withQueryClient, writeAppState } from "../testing/copy-feedback.js";
import { TranscriptAgent } from "./line-cards.js";
import { MachineRefusalCard } from "./machine-refusal-card.js";

/**
 * machine-refusal-card.test.ts -- a press on a machine a refused call offers makes it the agent's default, then tells the agent to try again there.
 * Synthetic ids and names.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

const AGENT_ID = "5b2d7e1a-9c4f-4a3b-8e6d-0f1a2b3c4d5e";
const STUDIO = "0c9e8d7f-6a5b-4c3d-9e2f-1a0b9c8d7e6f";
const LAPTOP = "8f7e6d5c-4b3a-4291-8e0f-a1b2c3d4e5f6";
const ANA = { userId: "user-ana", name: "Ana" };

/** Lets the presses' answers and their redraws land. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 20; tick += 1) await new Promise((done) => setTimeout(done, 0));
  });
}

test("a press on a machine a refused call offers makes it the agent's default, then tells the agent to try again there by its id", async () => {
  const sent: unknown[] = [];

  fakeActPort({
    [AGENT_ACT_KIND.AGENTS_SET_DEFAULT_MACHINE]: (payload) => {
      sent.push({ kind: AGENT_ACT_KIND.AGENTS_SET_DEFAULT_MACHINE, payload });

      return Promise.resolve({});
    },
    [AGENT_ACT_KIND.AGENTS_MESSAGE]: (payload) => {
      sent.push({ kind: AGENT_ACT_KIND.AGENTS_MESSAGE, text: payload.text });

      return Promise.resolve({
        agent: {
          id: AGENT_ID,
          taskId: "task-1",
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          title: null,
          createdAt: 1,
          status: AGENT_STATUS.RUNNING,
          turnId: null,
        },
      });
    },
  });
  handState({});
  writeAppState(await appBridge().requestAppState());

  const output = {
    status: "not-run",
    reason: "Not run: Studio is offline.",
    why: MACHINE_UNREACHED.OFFLINE,
    machine: { id: STUDIO, name: "Studio", owner: ANA },
    others: [{ id: LAPTOP, name: "Laptop", owner: ANA }],
  };

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      withQueryClient(
        createElement(
          TranscriptAgent,
          { value: AGENT_ID },
          createElement(MachineRefusalCard, { tool: AGENT_TOOL.RUN_ON_MAC, output }),
        ),
      ),
    ),
  );
  await settle();

  const use = [...document.querySelectorAll("button")].find((button) =>
    button.textContent?.endsWith("Laptop"),
  );

  act(() => use?.click());
  await settle();

  assert.deepEqual(sent, [
    {
      kind: AGENT_ACT_KIND.AGENTS_SET_DEFAULT_MACHINE,
      payload: { agentId: AGENT_ID, machineId: LAPTOP },
    },
    {
      kind: AGENT_ACT_KIND.AGENTS_MESSAGE,
      text: `Try again on Laptop, now your default machine (id "${LAPTOP}").`,
    },
  ]);
});
