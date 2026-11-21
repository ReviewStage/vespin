// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { CHAT_RUN, CHAT_SIDE, ChatBubble } from "./chat-bubble.js";

/**
 * chat-bubble.test.ts -- a bubble that answers another message opens on the
 * words it answers, which a reader presses, by the press's name, to bring
 * that message into view; words it cannot bring into view are no press.
 */

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

function mount(element: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));

  return container;
}

function bubble(onPress: (() => void) | undefined): React.ReactElement {
  return createElement(ChatBubble, {
    side: CHAT_SIDE.SENT,
    run: CHAT_RUN.ALONE,
    quote: { words: "Ship it?", label: "Show the message this answers", onPress },
    children: "Yes",
  });
}

test("a reply's bubble opens on the words it answers, a press that brings them into view only where it can", () => {
  const pressed: string[] = [];
  const container = mount(bubble(() => pressed.push("shown")));

  const press = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Show the message this answers"]',
  );

  assert.equal(container.textContent, "Ship it?Yes");
  act(() => press?.click());
  assert.deepEqual(pressed, ["shown"]);

  assert.equal(mount(bubble(undefined)).querySelector("button"), null);
});
