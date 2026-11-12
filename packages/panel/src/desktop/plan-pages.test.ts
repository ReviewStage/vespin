// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { PageLine } from "@repo/features/page-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { LinkWorkspaceProvider } from "../copy-link-item.js";
import { copyingInto, fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { withQueryClient } from "../testing/copy-feedback.js";
import { PlanPages } from "./plan-pages.js";

/**
 * plan-pages.test.ts -- a task's pages stand as rows of their own list in
 * its Overview: a row's ⋯ offers the page's Copy link, and the pages are
 * chosen together by their boxes, a row chosen among several opening every
 * chosen page in a tab of its own where the window opens tabs, and copying
 * every chosen page's link, a line each, both in the order the group lists
 * them.
 * Synthetic pages throughout.
 */

const TASK = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";

/** A page of the task, by its newest version. */
function page(id: string, title: string): PageLine {
  return { id, title, version: 1, at: 1 };
}

const FUNNEL = page("3c1d2e4f-5a6b-4c7d-8e9f-0a1b2c3d4e51", "Invite funnel");
const MOCKUP = page("3c1d2e4f-5a6b-4c7d-8e9f-0a1b2c3d4e52", "Invite email mockup");

let root: Root | undefined;

/** What the window handed main's clipboard. */
let copied: string[] = [];

/** The links the window opened in tabs of their own, as a browser's does. */
let tabbed: string[] = [];

beforeEach(() => {
  copied = [];
  tabbed = [];
  fakeAppPlatform({
    ...QUIET_PANEL,
    ...copyingInto(copied),
    openInTab: (link: string) => tabbed.push(link),
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

type MountResult = { host: HTMLElement; opened: string[] };

/** The task's Pages group over `pages`, its links written under a workspace, every page opened recorded. */
function mount(pages: readonly PageLine[]): MountResult {
  const opened: string[] = [];
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root?.render(
      withQueryClient(
        createElement(
          LinkWorkspaceProvider,
          { value: "acme" },
          createElement(PlanPages, {
            pages,
            place: { taskId: TASK },
            shown: true,
            onOpenPage: (pageId) => opened.push(pageId),
          }),
        ),
      ),
    ),
  );

  return { host, opened };
}

/** The menu standing open, its items' words. */
function menuItems(): HTMLElement[] {
  const menu = document.querySelector('[role="menu"]:not([data-leaving])');

  return [...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
}

test("a page's ⋯ offers Copy link, and pages chosen together open in tabs of their own and copy every link chosen, in the group's order", async () => {
  const { host, opened } = mount([FUNNEL, MOCKUP]);
  const rows = [...host.querySelectorAll('[aria-label="Pages"] li')];

  const rowOf = (title: string) =>
    rows.find((row) => row.textContent?.includes(title)) ?? assert.fail(`${title} is listed`);

  const moreOf = (title: string) =>
    rowOf(title).querySelector<HTMLButtonElement>('button[aria-label="Page actions"]') ??
    assert.fail(`${title} draws a ⋯`);

  act(() => moreOf(FUNNEL.title).click());
  const one = menuItems().find((item) => item.textContent === "Copy link");
  await act(async () => (one ?? assert.fail("the ⋯ offers Copy link")).click());
  assert.equal(copied.length, 1);
  assert.match(copied[0] ?? "", new RegExp(FUNNEL.id, "u"));

  // Note that the later page is chosen first, so the order is the group's and not the choosing's.
  const chooseBoth = () => {
    for (const title of [MOCKUP.title, FUNNEL.title]) {
      const box = rowOf(title).querySelector<HTMLElement>('[role="checkbox"]');
      act(() => (box ?? assert.fail(`${title} draws its box`)).click());
    }

    act(() => moreOf(MOCKUP.title).click());
  };

  chooseBoth();
  assert.deepEqual(opened, [], "choosing opens nothing");
  const menu = document.querySelector('[role="menu"]:not([data-leaving])');
  assert.match(menu?.textContent ?? "", /2 pages/u);
  assert.deepEqual(
    menuItems().map((item) => item.textContent),
    ["Open in new tabs", "Copy links"],
  );
  await act(async () => menuItems()[0]?.click());
  assert.equal(tabbed.length, 2);
  assert.match(tabbed[0] ?? "", new RegExp(FUNNEL.id, "u"));
  assert.match(tabbed[1] ?? "", new RegExp(MOCKUP.id, "u"));

  chooseBoth();
  await act(async () => menuItems()[1]?.click());
  const links = (copied[1] ?? "").split("\n");
  assert.equal(links.length, 2);
  assert.match(links[0] ?? "", new RegExp(FUNNEL.id, "u"));
  assert.match(links[1] ?? "", new RegExp(MOCKUP.id, "u"));
});
