// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { ManagerWorkingLine } from "@repo/features/manager-chat-view";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { announcedPolitely, mountAnnouncer } from "../testing/announcer.js";
import { ManagerWorkingDock } from "./manager-working-dock.js";

/**
 * manager-working-dock.test.ts -- the line over a Manager's box is said
 * aloud as it comes, since it stands outside the chat's live log, where the
 * row it replaced was heard landing; a page opened on a Manager already at
 * work says nothing, as a log says nothing of what it opened on.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

const WORKING: ManagerWorkingLine = { words: "Iris is working…", waiting: false, work: false };

const TOGGLE = { shown: false, onToggle: () => undefined, onShow: () => undefined };

/** The dock drawn over `line`, and a way to draw it again over another. */
function draw(
  line: ManagerWorkingLine | undefined,
): (next: ManagerWorkingLine | undefined) => void {
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);

  const render = (shown: ManagerWorkingLine | undefined) =>
    act(() =>
      root.render(
        createElement(ManagerWorkingDock, { line: shown, face: undefined, toggle: TOGGLE }),
      ),
    );

  render(line);

  return render;
}

test("the working line is said as a turn starts, and not as the page opens on one under way", async () => {
  mountAnnouncer();
  draw(WORKING);
  assert.equal(announcedPolitely(), "");

  const redraw = draw(undefined);
  redraw(WORKING);
  await vi.waitFor(() => assert.equal(announcedPolitely(), "Iris is working…"));
});
