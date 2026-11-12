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
import { ForkProvider, type SuggestDoor } from "./fork-action.js";
import { TranscriptWords } from "./transcript-blocks.js";

/**
 * reply-button-link.test.ts -- a suggestion an agent wrote into its reply is
 * drawn as the suggestion its label names where its workspace has
 * Suggestions on, and as a plain link to the agent where it is off, asking
 * nothing. A press opens its draft, filled in, through the tab's door, and
 * sends nothing; once sent it is the agent it reached, saying it started
 * it. Synthetic workspace, agents, and brief.
 */

const WORKSPACE_ID = "workspace-acme";
const AGENT_ID = "3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b";
const BUTTON_ID = "92f3b536-7e0a-4bc8-a3e0-fa0b1c2d3e4f";
const LABEL = "Wire up the invite email";

const STARTED_ID = "b415d758-902c-4dea-85a2-1c2d3e4f5061";

const VIEW: ReplyButtonView = {
  id: BUTTON_ID,
  agentId: AGENT_ID,
  label: LABEL,
  action: {
    kind: REPLY_BUTTON_ACTION.START,
    prompt: "Send the invite email.",
    model: "anthropic/claude-sonnet-5.5",
    effort: "high",
  },
  repository: "acme/relay",
  sendTo: null,
  pressed: null,
};

/** The suggestion once a member's send of it started an agent. */
const SENT: ReplyButtonView = {
  ...VIEW,
  pressed: {
    at: 1,
    by: "Ada Lovelace",
    byReader: true,
    agent: { id: STARTED_ID, taskId: "task-invites", title: LABEL },
  },
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
let answered: ReplyButtonView = VIEW;

beforeEach(() => {
  asked.length = 0;
  answered = VIEW;
  fakeAppPlatform(DESKTOP_LINKS);
  fakeAppBridge({});
  fakeActPort({
    [ACT_KIND.AGENTS_REPLY_BUTTON]: () => {
      asked.push("read");

      return Promise.resolve(answered);
    },
    [ACT_KIND.AGENTS_REPLY_BUTTON_PRESS]: () => {
      asked.push("sent");

      return Promise.resolve(answered);
    },
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** The reply drawn in a workspace with Suggestions on or off, its tab opening drafts through `onSuggest` where one is handed. */
async function drawn(on: boolean, onSuggest?: SuggestDoor): Promise<HTMLElement> {
  writeListedTasks({
    workspaces: [
      {
        id: WORKSPACE_ID,
        name: "Acme",
        slug: "acme",
        role: WORKSPACE_ROLE.ADMIN,
        github: null,
        experiments: [{ experiment: EXPERIMENT.REPLY_BUTTONS, on, changedBy: null, changedAt: 1 }],
      },
    ],
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    const words = createElement(TranscriptWords, { text: WORDS });
    root.render(
      withQueryClient(
        createElement(ForkProvider, {
          value: { onFork: undefined, forkedTo: () => [], onSuggest },
          children: words,
        }),
      ),
    );
  });

  return container;
}

test("with Suggestions on the link is its suggestion; off, a plain link to its agent, asking nothing", async () => {
  const on = await drawn(true);
  await vi.waitFor(() => assert.ok(on.querySelector("button")));
  assert.match(on.querySelector("button")?.textContent ?? "", new RegExp(LABEL, "u"));

  for (const root of roots.splice(0)) act(() => root.unmount());

  asked.length = 0;
  const off = await drawn(false);
  assert.equal(off.querySelector("button"), null);
  const link = off.querySelector("a");
  assert.equal(link?.textContent, LABEL);
  assert.ok(link?.getAttribute("href")?.endsWith(`/agent/${AGENT_ID}`));
  assert.deepEqual(asked, []);
});

test("a press opens the suggestion's draft filled in, on the model it names, and sends nothing", async () => {
  const opened: unknown[] = [];

  const reply = await drawn(true, (suggestion, words, choice) =>
    opened.push({ button: suggestion.buttonId, label: suggestion.label, words, choice }),
  );

  await vi.waitFor(() => assert.ok(reply.querySelector("button")));
  act(() => reply.querySelector("button")?.click());
  assert.deepEqual(opened, [
    {
      button: BUTTON_ID,
      label: LABEL,
      words: "Send the invite email.",
      choice: { model: "anthropic/claude-sonnet-5.5", effort: "high" },
    },
  ]);
  assert.ok(!asked.includes("sent"));
});

test("once sent, the suggestion is the agent it started, saying so", async () => {
  answered = SENT;
  const reply = await drawn(true);
  await vi.waitFor(() => assert.match(reply.textContent ?? "", /Started/u));
  assert.ok(reply.textContent?.includes(LABEL));
});
