// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  REPLY_BUTTON_ACTION,
  type ReplyButtonView,
  replyButtonLinkOf,
} from "@repo/features/reply-button-wire";
import { WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import { EXPERIMENT } from "@repo/settings";
import { Effect } from "effect";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { DESKTOP_LINKS, fakeAppPlatform } from "../testing/app-platform.js";
import { writeListedTasks } from "../testing/app-state.js";
import { withQueryClient } from "../testing/copy-feedback.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { TranscriptWords } from "./transcript-blocks.js";

/**
 * reply-button-link.test.ts -- a button an agent wrote into its reply is
 * drawn as the button its label names where its workspace has Reply buttons
 * on, and as a plain link to the agent where the workspace has it off, with
 * no button drawn and nothing asked of the service. Synthetic workspace,
 * agent, and brief.
 */

const WORKSPACE_ID = "workspace-acme";
const AGENT_ID = "3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b";
const BUTTON_ID = "92f3b536-7e0a-4bc8-a3e0-fa0b1c2d3e4f";
const LABEL = "Wire up the invite email";

const VIEW: ReplyButtonView = {
  id: BUTTON_ID,
  agentId: AGENT_ID,
  label: LABEL,
  action: { kind: REPLY_BUTTON_ACTION.START, prompt: "Send the invite email." },
  repository: "acme/relay",
  sendTo: null,
  pressed: null,
};

const WORDS = `The invite email is never sent. [${LABEL}](${replyButtonLinkOf({
  workspace: "acme",
  agentId: AGENT_ID,
  buttonId: BUTTON_ID,
})})`;

// A reply is drawn once the parser has landed, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

const roots: Root[] = [];
const asked: string[] = [];

beforeEach(() => {
  asked.length = 0;
  fakeAppPlatform(DESKTOP_LINKS);
  fakeAppBridge({});
  fakeActPort({
    [ACT_KIND.AGENTS_REPLY_BUTTON]: () => {
      asked.push(BUTTON_ID);
      return Promise.resolve(VIEW);
    },
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** The reply drawn in a workspace with Reply buttons on or off. */
async function drawn(on: boolean): Promise<HTMLElement> {
  writeListedTasks({
    workspaces: [
      {
        id: WORKSPACE_ID,
        name: "Acme",
        slug: "acme",
        role: WORKSPACE_ROLE.ADMIN,
        experiments: [{ experiment: EXPERIMENT.REPLY_BUTTONS, on, changedBy: null, changedAt: 1 }],
      },
    ],
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(withQueryClient(createElement(TranscriptWords, { text: WORDS })));
  });
  return container;
}

test("with Reply buttons on the link is its button; off, a plain link to its agent, asking nothing", async () => {
  const on = await drawn(true);
  await vi.waitFor(() => assert.ok(on.querySelector("button")));
  assert.deepEqual(
    [...on.querySelectorAll("button")].map((button) => button.textContent),
    [LABEL],
  );
  for (const root of roots.splice(0)) act(() => root.unmount());

  asked.length = 0;
  const off = await drawn(false);
  assert.equal(off.querySelector("button"), null);
  const link = off.querySelector("a");
  assert.equal(link?.textContent, LABEL);
  assert.ok(link?.getAttribute("href")?.endsWith(`/agent/${AGENT_ID}`));
  assert.deepEqual(asked, []);
});
