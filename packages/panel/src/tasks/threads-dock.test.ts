// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_MESSAGE_AUTHOR,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "@repo/features/inbox-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { ThreadsDock } from "./threads-dock.js";

/**
 * threads-dock.test.ts -- the line over an agent's box counts the threads
 * waiting on the developer, and opens the next one, the oldest posted; once
 * none waits it stays, quiet, counting every thread, and opens the latest
 * changed. Synthetic items.
 */

const AGENT = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

/** A thread the agent posted that waits on the developer. */
function waiting(n: number, title: string): InboxItem {
  return {
    id: `6c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4${n}`,
    agentId: AGENT,
    key: `000${n}`,
    revision: 1,
    version: INBOX_WIRE_VERSION,
    title,
    needsReply: true,
    status: INBOX_STATUS.OPEN,
    postedAt: n,
    updatedAt: n,
  };
}

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** The dock drawn over the threads given, those waiting and every one posted, the latest changed first; its words, and what its press opened. */
function dock(threads: readonly InboxItem[], posted: readonly InboxItem[] = threads) {
  const opened: string[] = [];
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(ThreadsDock, {
        threads: { waiting: threads, posted, onOpen: (item) => opened.push(item.title) },
      }),
    ),
  );
  const row = container.querySelector<HTMLElement>('[role="button"], button');

  const press = () => {
    assert.ok(row, "the dock presses");
    act(() => row.click());
  };

  return { words: container.textContent, press, opened };
}

test("the dock counts the threads waiting, and opens the oldest", () => {
  const one = dock([waiting(1, "Expire after 7 days?")]);
  assert.equal(one.words, "Inbox1 needs you");

  const older = waiting(1, "Expire after 7 days?");
  const newer = waiting(2, "Who can withdraw?");
  const many = dock([older, newer], [newer, older]);
  assert.equal(many.words, "Inbox2 need you");
  many.press();
  assert.deepEqual(many.opened, ["Expire after 7 days?"]);

  assert.equal(dock([]).words, "", "the agent posted nothing, so nothing is docked");
});

test("once none waits, the dock stays quiet, counting every thread the agent posted, and opens the latest changed", () => {
  const settled = dock([], [waiting(2, "Who can withdraw?"), waiting(1, "Expire after 7 days?")]);
  assert.equal(settled.words, "2 threads");
  settled.press();
  assert.deepEqual(settled.opened, ["Who can withdraw?"]);
});

test("with Done and follow-ups on, the bar says Needs you, lists each ask waiting, and answers a decide of two short options from its row", () => {
  const decide: InboxItem = {
    ...waiting(1, "Expire an invitation after a week?"),
    thread: [
      {
        id: "7d1e2f3a-4b5c-4d6e-8f7a-9b0c1d2e3f41",
        author: INBOX_MESSAGE_AUTHOR.AGENT,
        text: "A link past its week could read as no longer valid.",
        ask: {
          type: INBOX_ASK.DECIDE,
          options: [{ label: "Yes, a week" }, { label: "Never" }],
          status: INBOX_ASK_STATUS.OPEN,
        },
        createdAt: 1,
      },
    ],
  };

  const other = waiting(2, "Add RESEND_API_KEY to the workspace");
  const chosen: string[] = [];
  const opened: string[] = [];
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);

  const draw = (sending: ReadonlySet<string>) =>
    act(() =>
      root.render(
        createElement(ThreadsDock, {
          threads: {
            waiting: [decide, other],
            posted: [other, decide],
            onOpen: (item) => opened.push(item.title),
            turnEnd: true,
            onChoose: (item, label) => chosen.push(`${item.title}: ${label}`),
            sending,
          },
        }),
      ),
    );

  const never = () =>
    [...container.querySelectorAll("button")].find((each) => each.textContent === "Never");

  draw(new Set());

  const text = container.textContent ?? "";
  assert.ok(text.startsWith("Needs you2 need you"), text);
  assert.ok(text.includes("Expire an invitation after a week?"), text);
  assert.ok(text.includes("Add RESEND_API_KEY to the workspace"), text);
  const button = never();
  assert.ok(button, "the decide's options are its buttons");
  act(() => button.click());
  assert.deepEqual(chosen, ["Expire an invitation after a week?: Never"]);
  assert.deepEqual(opened, []);

  // While that answer is on its way, a second press sends nothing.
  draw(new Set([decide.id]));
  const waitingButton = never();
  assert.ok(waitingButton, "the buttons stay while the answer is on its way");
  act(() => waitingButton.click());
  assert.deepEqual(chosen, ["Expire an invitation after a week?: Never"]);
});

test("with Done and follow-ups on, a done agent's bar offers Archive and opens another agent of the task that waits on the developer", () => {
  const pressed: string[] = [];
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(ThreadsDock, {
        threads: {
          waiting: [],
          posted: [],
          onOpen: () => undefined,
          turnEnd: true,
          others: [{ agentId: "review", name: "Review the invite flow", waiting: 1 }],
          onOpenAgent: (agentId) => pressed.push(`open ${agentId}`),
          done: {
            followUps: [],
            ticked: [],
            onTick: () => undefined,
            archive: { onSelect: () => pressed.push("archive"), busy: false },
          },
        },
      }),
    ),
  );

  const buttons = [...container.querySelectorAll("button")];
  const archive = buttons.find((each) => each.textContent === "Archive agent");
  const other = buttons.find((each) => each.textContent?.startsWith("Review the invite flow"));
  assert.ok(archive && other, container.textContent ?? "");
  act(() => archive.click());
  act(() => other.click());
  assert.deepEqual(pressed, ["archive", "open review"]);
});
