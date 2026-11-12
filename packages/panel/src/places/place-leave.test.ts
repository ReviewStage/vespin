// @vitest-environment jsdom

/**
 * place-leave.test.ts -- the window's leave guard as a page and the shell hold it: a navigation asks while a page stands its ask, Stay keeps the window, Leave goes, a move within one draft asks nothing, a move that stays keeps the ask, and the browser's own Back and the shell's ways out ask too.
 */

import assert from "node:assert/strict";
import {
  createBrowserHistory,
  createMemoryHistory,
  type RouterHistory,
} from "@tanstack/react-router";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { settleQueries, withQueryClient } from "../testing/copy-feedback.js";
import { windowRouter } from "../testing/window-router.js";
import { type PlaceLeave, type ShellLeaveAsk, usePlaceLeave } from "./place-leave.js";
import { type AdminDoor, useAdminDoor } from "./routed-doors.js";
import { useRoutedExits } from "./routed-exits.js";

const AUTOMATION = "/acme/automation/5d1e7a9c-3b2f-4c6d-8e0a-9f1b2c3d4e5a";
const LIST = "/acme/automations";
const ADMIN = "/acme/admin";

/** A door's landing that does nothing. */
const NOTHING = (): void => undefined;

const roots: Root[] = [];

beforeEach(() => fakeAppPlatform(QUIET_PANEL));

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  window.history.replaceState(null, "", "/");
});

/** Each ask the page was asked, with its two answers. */
interface Asked {
  readonly leave: () => void;
  readonly stay: () => void;
}

/** The window's leave guard under a router over `history`, the page standing an ask that records each time it is asked, and what the shell heard last. */
function mount(history: RouterHistory) {
  const held = windowRouter(history);
  const asked: Asked[] = [];
  const shell: { heard: ShellLeaveAsk | undefined } = { heard: undefined };
  let leave: PlaceLeave | undefined;

  function Probe() {
    leave = usePlaceLeave((ask) => {
      shell.heard = ask;
    });

    return null;
  }

  const root = createRoot(document.createElement("div"));
  roots.push(root);
  act(() => root.render(held.provide(withQueryClient(createElement(Probe)))));
  const place = () => leave ?? assert.fail("the leave guard is made");
  let down: () => void = () => undefined;
  act(() => {
    down = place().stand((go, stay) => void asked.push({ leave: go, stay }));
  });

  return { history, asked, shell, place, down: () => act(() => down()) };
}

/** A memory history standing at `at`. */
function memoryAt(at: string): RouterHistory {
  return createMemoryHistory({ initialEntries: [at] });
}

test("a navigation while a page stands its ask waits on it, and Stay keeps the window where it stands", async () => {
  const window = mount(memoryAt(AUTOMATION));

  act(() => window.history.push(LIST));
  await settleQueries();
  assert.equal(window.asked.length, 1, "the move asks");
  assert.equal(window.history.location.pathname, AUTOMATION, "and waits on the answer");

  act(() => window.asked[0]?.stay());
  await settleQueries();
  assert.equal(window.history.location.pathname, AUTOMATION);
});

test("Leave at the ask makes the move, and a move after it asks no second time", async () => {
  const window = mount(memoryAt(AUTOMATION));

  act(() => window.history.push(LIST));
  await settleQueries();
  act(() => window.asked[0]?.leave());
  await settleQueries();
  assert.equal(window.history.location.pathname, LIST);

  act(() => window.history.push("/acme/tasks"));
  await settleQueries();
  assert.equal(window.asked.length, 1, "the ask Leave answered is let go of");
  assert.equal(window.history.location.pathname, "/acme/tasks");
});

test("a move within one automation's draft, from its setup to its runs, asks nothing", async () => {
  const window = mount(memoryAt(AUTOMATION));

  act(() => window.history.push(`${AUTOMATION}/runs`));
  await settleQueries();

  assert.equal(window.asked.length, 0);
  assert.equal(window.history.location.pathname, `${AUTOMATION}/runs`);
});

test("a page's own way out passes the ask, as a new automation saved stands its own page", async () => {
  const window = mount(memoryAt("/acme/automations/new"));

  act(() => window.place().pass(() => window.history.push(AUTOMATION)));
  await settleQueries();

  assert.equal(window.asked.length, 0);
  assert.equal(window.history.location.pathname, AUTOMATION);
});

test("the browser's own Back asks while a page stands its ask, and Stay keeps the address", async () => {
  globalThis.window.history.replaceState(null, "", LIST);
  const browser = createBrowserHistory();
  browser.push(AUTOMATION);
  browser.flush();
  const window = mount(browser);

  // Note that the browser's Back lands as a `popstate` a task later, which the blocker holds while it asks.
  await act(async () => {
    globalThis.window.history.back();
    await new Promise((landed) =>
      globalThis.window.addEventListener("popstate", landed, { once: true }),
    );
  });
  await settleQueries();
  assert.equal(window.asked.length, 1, "Back asks");

  await act(async () => {
    window.asked[0]?.stay();
    await new Promise((landed) =>
      globalThis.window.addEventListener("popstate", landed, { once: true }),
    );
  });
  await settleQueries();
  assert.equal(window.history.location.pathname, AUTOMATION, "Stay stands the address back");
});

test("the window's own Back over an automation being edited asks on the desktop's memory history, whose move along it asks no blocker, and Stay keeps it", async () => {
  const window = mount(createMemoryHistory({ initialEntries: [LIST, AUTOMATION] }));

  act(() => window.place().along(-1, LIST));
  await settleQueries();
  assert.equal(window.asked.length, 1, "Back asks");
  assert.equal(window.history.location.pathname, AUTOMATION, "and waits on the answer");

  act(() => window.asked[0]?.stay());
  assert.equal(window.history.location.pathname, AUTOMATION);
  act(() => window.place().along(-1, LIST));
  act(() => window.asked[1]?.leave());
  assert.equal(window.history.location.pathname, LIST, "Leave takes the step");
});

test("the shell hears the ask while a page stands it, which asks the page, and nothing once it is down", () => {
  const window = mount(memoryAt(AUTOMATION));
  const left: string[] = [];

  act(() => window.shell.heard?.(() => left.push("closed")));
  assert.equal(window.asked.length, 1, "closing the window asks the page");
  act(() => window.asked[0]?.leave());
  assert.deepEqual(left, ["closed"]);

  window.down();
  assert.equal(window.shell.heard, undefined);
});

test("what a door does once its held move lands is dropped where the page takes its ask down unanswered, even where the window later moves there", async () => {
  const window = mount(memoryAt(AUTOMATION));
  const landed: string[] = [];

  act(() =>
    window.place().arrive(
      () => window.history.push(LIST),
      () => landed.push(LIST),
    ),
  );
  await settleQueries();
  window.down();
  await settleQueries();
  // A later move of its own to the same address is not the held move landing.
  act(() => window.history.push(LIST));
  await settleQueries();

  assert.equal(window.asked.length, 1, "the move asked");
  assert.deepEqual(landed, []);
});

test.each<[string, (window: ReturnType<typeof mount>) => void]>([
  // As an automation's Save landing while its ask is out, which takes the page's ask down while its dialog still asks.
  ["the page takes its ask down while it is still asked", (window) => window.down()],
  // As a new automation's Create landing in place, a write the history makes past the blocker.
  [
    "the window's own address is written in place",
    (window) => act(() => window.history.replace(AUTOMATION, {}, { ignoreBlocker: true })),
  ],
])(
  "what a door does once its held move lands runs on Leave where %s before Leave is pressed",
  async (_meanwhile, meanwhile) => {
    const window = mount(memoryAt(AUTOMATION));
    const landed: string[] = [];

    act(() =>
      window.place().arrive(
        () => window.history.push(LIST),
        () => landed.push(LIST),
      ),
    );
    await settleQueries();
    meanwhile(window);
    await settleQueries();
    act(() => window.asked[0]?.leave());
    await settleQueries();

    assert.equal(window.asked.length, 1, "the move asked once");
    assert.equal(window.history.location.pathname, LIST);
    assert.deepEqual(landed, [LIST]);
  },
);

test("Leave on a door's move to the place already standing keeps the page's ask, so the window's next move asks again", async () => {
  const window = mount(memoryAt(AUTOMATION));

  act(() => window.place().arrive(() => window.place().stays(), NOTHING));
  await settleQueries();
  act(() => window.asked[0]?.leave());
  await settleQueries();
  assert.notEqual(window.shell.heard, undefined, "the shell still hears the ask");

  act(() => window.history.push(LIST));
  await settleQueries();
  assert.equal(window.asked.length, 2, "the next move asks again");
  assert.equal(window.history.location.pathname, AUTOMATION);
});

test("Leave on Admin's open of the view already standing keeps the page's ask, so the window's next move asks again", async () => {
  const held = windowRouter(memoryAt(ADMIN));
  const asked: Asked[] = [];
  let leave: PlaceLeave | undefined;
  let admin: AdminDoor | undefined;

  function Probe() {
    const place = usePlaceLeave();
    leave = place;
    // As the window's root fills it, a door asking for the place standing tells the leave guard its move stays.
    useRoutedExits().stay = place.stays;
    admin = useAdminDoor({ placeLeave: place, workspace: undefined });

    return null;
  }

  const root = createRoot(document.createElement("div"));
  roots.push(root);
  act(() => root.render(held.provide(withQueryClient(createElement(Probe)))));
  act(() => {
    leave?.stand((go, stay) => void asked.push({ leave: go, stay }));
  });

  act(() => admin?.open());
  await settleQueries();
  act(() => asked[0]?.leave());
  await settleQueries();
  act(() => held.history.push(LIST));
  await settleQueries();

  assert.equal(asked.length, 2, "the next move asks again");
  assert.equal(held.history.location.pathname, ADMIN);
});

test("Leave on a door's move held while an earlier held move to the same place waited lands only the move let go", async () => {
  const window = mount(memoryAt(AUTOMATION));
  const landed: string[] = [];

  act(() =>
    window.place().arrive(
      () => window.history.push(ADMIN),
      () => landed.push("first"),
    ),
  );
  await settleQueries();
  act(() =>
    window.place().arrive(
      () => window.history.push(ADMIN),
      () => landed.push("second"),
    ),
  );
  await settleQueries();
  act(() => window.asked.at(-1)?.leave());
  await settleQueries();

  assert.equal(window.history.location.pathname, ADMIN);
  assert.deepEqual(landed, ["second"]);
});
