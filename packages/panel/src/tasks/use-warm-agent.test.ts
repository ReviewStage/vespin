// @vitest-environment jsdom

import assert from "node:assert/strict";
import { AGENT_CHAT, AGENT_STATUS, type AgentSummary } from "@repo/features/agent-wire";
import { ACT_KIND } from "@repo/host/acts";
import { STILL_CLOCK, serveEffectsOn } from "@repo/ui/testing/effect-services";
import { Clock, Context } from "effect";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { fakeActPort } from "../testing/app-bridge.js";
import { useWarmAgent } from "./use-warm-agent.js";

/**
 * A chat's shown and hidden as the window says them: a hidden the service
 * answers late holds back the shown after it, so it can never arrive after
 * that shown and let go of the hold the shown beat.
 */

const AGENT: AgentSummary = {
  id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  taskId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  model: "openai/gpt-5.6-sol",
  effort: "high",
  title: "Invite flow",
  createdAt: 1,
  status: AGENT_STATUS.RUNNING,
  turnId: null,
};

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** The page said visible or hidden, as a window shown or hidden does. */
function pageShown(visible: boolean): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (visible ? "visible" : "hidden"),
  });
  act(() => void document.dispatchEvent(new Event("visibilitychange")));
}

function Warm() {
  useWarmAgent(AGENT);

  return null;
}

test("a hidden answered late holds back the shown after it", async () => {
  serveEffectsOn(Context.make(Clock.Clock, STILL_CLOCK));
  const said: string[] = [];
  let answerHidden: () => void = () => undefined;

  fakeActPort({
    [ACT_KIND.AGENTS_WARM]: ({ chat }) => {
      said.push(chat ?? "bare");

      return chat === AGENT_CHAT.HIDDEN
        ? new Promise((done) => {
            answerHidden = () => done({ warm: true });
          })
        : Promise.resolve({ warm: true });
    },
    [ACT_KIND.MAC_SHELL_MIRROR]: () => Promise.resolve({ folder: "" }),
  });
  pageShown(true);
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(createElement(Warm)));
  await act(async () => undefined);

  pageShown(false);
  await act(async () => undefined);
  pageShown(true);
  await act(async () => undefined);
  const beforeAnswer = [...said];
  answerHidden();
  await act(async () => undefined);

  assert.deepEqual(beforeAnswer, [AGENT_CHAT.SHOWN, AGENT_CHAT.HIDDEN]);
  assert.deepEqual(said, [AGENT_CHAT.SHOWN, AGENT_CHAT.HIDDEN, AGENT_CHAT.SHOWN]);
});
