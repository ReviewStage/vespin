// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { ACCOUNT_DESTINATION, LINK_DESTINATION, type ShownLink } from "@repo/features/link-grammar";
import { IDLE_TASKS_VIEW } from "@repo/features/tasks-view";
import { type AppStateSnapshot, NO_ACCESS, RUN_PROFILE } from "@repo/host/app-state";
import { type AppBridge, bridgeEntries } from "@repo/host/bridge";
import { PUSH_METHOD } from "@repo/host/contract";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { Effect } from "effect";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, vi } from "vitest";
// Note that the places are loaded as the window loads them, on first use
// (the router's lazy routes, and `desktop-shell.tsx`'s Automations), so each module is read here first and its load
// settles within the test's own ticks rather than on a clock a busy machine outruns.
import "./desktop/automations-page.js";
import "./desktop/admin-route.lazy.js";
import "./desktop/settings-route.lazy.js";
import "./desktop/person-route.lazy.js";
import { runAppCommand } from "./app-commands.js";
import { loadTasksFixture } from "./tasks/tasks-fixture-loader.js";
import { fakeActPortAnswering, fakeAppBridge, refusedOnPort } from "./testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "./testing/app-platform.js";
import { stateWith } from "./testing/app-state.js";
import { readAppState, withQueryClient } from "./testing/copy-feedback.js";
import { type TestWindowRouter, windowRouter } from "./testing/window-router.js";

/**
 * app-fixture-places.test.ts -- a fixture run, which main hands signed out
 * with nothing read, opens the window where its Settings, Admin, or
 * Automations profile names, signed in as the fixture's synthetic account,
 * each page drawn from the answers the fixture stages at the act door rather
 * than its signed-out line, and its person profile's account reads its own
 * page as its own; and a fixture run on any other profile still draws the
 * account main holds.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let root: Root | undefined;

/** What the window hears a link the system hands it on, once it listens. */
let showLink: ((link: ShownLink) => void) | undefined;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  fakeAppPlatform({
    ...QUIET_PANEL,
    applySessionReplay: () => undefined,
    adminDashboard: () => ({ href: "https://app.test/admin" }),
  });
  // Every act main would answer is refused, as a fixture run's service reads go empty-handed.
  fakeActPortAnswering(() => Promise.reject(refusedOnPort("Not here.")));
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  showLink = undefined;
  document.body.innerHTML = "";
});

/** Main's document for a fixture run on `profile`: signed out, nothing read, no access. */
function fixtureRun(profile: string): AppStateSnapshot {
  const { run } = stateWith({}, {});

  return stateWith(
    {},
    {
      run: { ...run, fixtureMode: true, profile },
      account: { status: ACCOUNT_STATUS.SIGNED_OUT },
      access: NO_ACCESS,
      tasks: IDLE_TASKS_VIEW,
    },
  );
}

/** Hands the window main's document for a fixture run on `profile`, every other bridge call quiet. */
function handFixtureRun(profile: string): void {
  const snapshot = fixtureRun(profile);

  const quiet = Object.fromEntries([
    ...Object.keys(PUSH_METHOD).map((method) => [method, () => () => undefined]),
    ...bridgeEntries().map(([method, entry]) => [
      method,
      entry.kind === "invoke" ? () => Promise.resolve(undefined) : () => undefined,
    ]),
  ]);

  fakeAppBridge({
    ...quiet,
    requestAppState: () => Promise.resolve(structuredClone(snapshot)),
    onAppState: () => () => undefined,
    onShowLink: (listener: (link: ShownLink) => void) => {
      showLink = listener;

      return () => {
        showLink = undefined;
      };
    },
  } satisfies Partial<AppBridge>);
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 48; tick += 1) await Promise.resolve();
  });
}

/**
 * Draws the window as its root does on a fixture run on `profile`: once
 * main's document is read
 * (`window-root.tsx`) and the synthetic tasks have landed (`App`).
 */
function drawWindow(profile: string): Effect.Effect<TestWindowRouter> {
  return Effect.gen(function* () {
    handFixtureRun(profile);
    // The document is in the client before the window draws, as the root's `ensureQueryData` leaves it.
    yield* Effect.promise(readAppState);
    yield* Effect.promise(loadTasksFixture);
    root = createRoot(document.body.appendChild(document.createElement("div")));
    const router = windowRouter();
    act(() => root?.render(withQueryClient(router.drawn())));
    yield* Effect.promise(settle);

    return router;
  });
}

/** The window's words as drawn. */
function drawn(): string {
  return document.body.textContent ?? "";
}

it.effect("the Settings workspace profile opens Settings on Acme signed in, its members read", () =>
  Effect.gen(function* () {
    yield* drawWindow(RUN_PROFILE.SETTINGS_WORKSPACE);

    assert.ok(document.querySelector(".desktop-settings"), "Settings stands");
    assert.match(drawn(), /Maya Okafor/u);
    assert.match(drawn(), /sam@example\.com/u);
  }),
);

it.effect("the Admin profile opens Admin's Overview for the account, an admin", () =>
  Effect.gen(function* () {
    yield* drawWindow(RUN_PROFILE.ADMIN);

    const chosen = document.querySelector(
      '[role="radiogroup"][aria-label="Admin sections"] [aria-checked="true"]',
    );

    assert.equal(chosen?.textContent, "Overview");
  }),
);

it.effect(
  "the Automations runs profile opens the automation whose run failed, its runs beside it",
  () =>
    Effect.gen(function* () {
      yield* drawWindow(RUN_PROFILE.AUTOMATIONS_RUNS);

      // Note that we wait on the automation's name itself, because its page and its read land after hops a busy runner stretches past any fixed count of ticks.
      yield* Effect.promise(() =>
        vi.waitFor(() =>
          assert.equal(
            document.querySelector<HTMLInputElement>("input[aria-label='Automation name']")?.value,
            "Check each deploy",
          ),
        ),
      );
    }),
);

it.effect(
  "a fixture run on the tasks profile opens the Tasks tab, the account as main holds it",
  () =>
    Effect.gen(function* () {
      yield* drawWindow(RUN_PROFILE.TASKS);

      assert.equal(document.querySelector(".desktop-settings") === null, true);
      assert.doesNotMatch(drawn(), /ada@example\.com/u);
    }),
);

it.effect(
  "a fixture run on the tasks profile lands its open task's column, a task with no agents, while main answers nothing",
  () =>
    Effect.gen(function* () {
      yield* drawWindow(RUN_PROFILE.TASKS);

      const column = document.querySelector(".desktop-task-column");
      assert.ok(column, "the open task's column stands");
      assert.equal(column.querySelector('[class*="skeleton"]') === null, true);
      assert.equal(
        document.querySelector('.task-tabs [role="tab"]')?.getAttribute("aria-selected"),
        "true",
        "the column opens on its first tab, the task's Overview",
      );
    }),
);

it.effect(
  "the person profile's account opens its own profile from its menu and reads it as its own",
  () =>
    Effect.gen(function* () {
      yield* drawWindow(RUN_PROFILE.PERSON);

      // The account's button at the sidebar's foot, named by the account alone where the workspace's switcher says more.
      const account = [...document.querySelectorAll("button")].find(
        (button) => button.textContent?.endsWith("Ada Lovelace") && !button.matches("[aria-label]"),
      );

      assert.ok(account, "the account's button stands");
      act(() => account.click());

      const profile = [...document.querySelectorAll('[role="menuitem"]')].find(
        (item): item is HTMLElement =>
          item instanceof HTMLElement &&
          item.querySelector(".ui-menu-item-label")?.textContent === "Your profile",
      );

      assert.ok(profile, "its menu offers Your profile");
      act(() => profile.click());
      yield* Effect.promise(settle);

      assert.match(drawn(), /Assigned to you/u);
      assert.match(drawn(), /Needs you/u);
      assert.doesNotMatch(drawn(), /Waiting on their answer/u);
    }),
);

/** Types `words` into `input` as a reader does, through the prototype's setter, which React reads a change by. */
function typeInto(input: HTMLInputElement | null, words: string): void {
  assert.ok(input, "the field is drawn");
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(input, words);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it.effect(
  "on the tasks profile, Home pressed in the sidebar leaves the task the fixture binds for good where it stands",
  () =>
    Effect.gen(function* () {
      handFixtureRun(RUN_PROFILE.TASKS);
      yield* Effect.promise(readAppState);
      yield* Effect.promise(loadTasksFixture);
      const router = windowRouter();
      root = createRoot(document.body.appendChild(document.createElement("div")));
      act(() => root?.render(withQueryClient(router.drawn())));
      yield* Effect.promise(settle);
      const standing = [router.history.location.pathname, router.addresses().length];

      const home = [...document.querySelectorAll("aside.desktop-sidebar button")].find(
        (button) => button.textContent?.startsWith("Home") === true,
      );

      assert.ok(home instanceof HTMLElement, "the sidebar's Home stands");

      act(() => home.click());
      yield* Effect.promise(settle);

      assert.deepEqual([router.history.location.pathname, router.addresses().length], standing);
    }),
);

/** The automation's editor the Automations runs profile opens, its name edited, so its page holds unsaved work and asks before it is left. */
function editedAutomation(): Effect.Effect<TestWindowRouter> {
  return Effect.gen(function* () {
    const router = yield* drawWindow(RUN_PROFILE.AUTOMATIONS_RUNS);

    const name = yield* Effect.promise(() =>
      vi.waitFor(
        () =>
          document.querySelector<HTMLInputElement>("input[aria-label='Automation name']") ??
          assert.fail("the automation's name stands"),
      ),
    );

    typeInto(name, "Check each deploy, edited");
    yield* Effect.promise(settle);

    return router;
  });
}

/** The button whose words are `words`, wherever it is drawn. */
function buttonSaying(words: string): HTMLButtonElement {
  return (
    [...document.querySelectorAll("button")].find((button) => button.textContent === words) ??
    assert.fail(`a button saying ${words} stands`)
  );
}

/** Answers the window's ask to leave the edited automation with Leave. */
function leaveAsked(): Effect.Effect<void> {
  return Effect.gen(function* () {
    yield* Effect.promise(() => vi.waitFor(() => buttonSaying("Leave")));
    act(() => buttonSaying("Leave").click());
    yield* Effect.promise(settle);
  });
}

it.effect(
  "Home pressed in the sidebar over an edited automation goes Home in one step once Leave is pressed",
  () =>
    Effect.gen(function* () {
      const router = yield* editedAutomation();
      const before = router.addresses().slice(0, router.at() + 1);

      const home =
        [...document.querySelectorAll<HTMLElement>("aside.desktop-sidebar button")].find((row) =>
          row.textContent?.startsWith("Home"),
        ) ?? assert.fail("the sidebar's Home row stands");

      act(() => home.click());
      yield* leaveAsked();

      assert.deepEqual(router.addresses().slice(0, router.at() + 1), [...before, "/personal"]);
    }),
);

it.effect(
  "a task jumped to with ⌘K over an edited automation opens once Leave is pressed, rather than leaving the window on the automation",
  () =>
    Effect.gen(function* () {
      const router = yield* editedAutomation();
      const automation = router.addresses()[router.at()];
      act(() => runAppCommand(APP_COMMAND.COMMAND_PALETTE));

      const search = yield* Effect.promise(() =>
        vi.waitFor(
          () =>
            document.querySelector<HTMLInputElement>('[role="dialog"] input[role="combobox"]') ??
            assert.fail("the palette's search stands"),
        ),
      );

      typeInto(search, "Billing export");
      yield* Effect.promise(settle);
      act(() => {
        search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      });
      yield* leaveAsked();

      assert.notEqual(router.addresses()[router.at()], automation);
      assert.equal(document.body.textContent?.includes("Unsaved changes"), false);
    }),
);

/** Chooses `words`' first result in ⌘K, as Return does. */
function chooseInPalette(words: string): Effect.Effect<void> {
  return Effect.gen(function* () {
    act(() => {
      runAppCommand(APP_COMMAND.COMMAND_PALETTE);
    });

    const search = yield* Effect.promise(() =>
      vi.waitFor(
        () =>
          document.querySelector<HTMLInputElement>('[role="dialog"] input[role="combobox"]') ??
          assert.fail("the palette's search stands"),
      ),
    );

    typeInto(search, words);
    yield* Effect.promise(settle);
    act(() => {
      search.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });
    yield* Effect.promise(settle);
  });
}

/** Hands the window `link` as the system does. */
function handLink(link: ShownLink): Effect.Effect<void> {
  return Effect.gen(function* () {
    act(() => (showLink ?? assert.fail("the window listens for links"))(link));
    yield* Effect.promise(settle);
  });
}

it.effect.each<[string, Effect.Effect<void>, string, RegExp?]>([
  [
    "⌘, (Settings)",
    Effect.sync(() => act(() => void runAppCommand(APP_COMMAND.SETTINGS))),
    "/personal/settings",
  ],
  ["a Settings page chosen in ⌘K", chooseInPalette("appearance"), "/personal/settings/appearance"],
  [
    "a link to a Settings page",
    handLink({
      workspace: "personal",
      place: { kind: LINK_DESTINATION.SETTINGS, page: "appearance" },
    }),
    "/personal/settings/appearance",
  ],
  [
    "a pairing's link",
    handLink({ place: { kind: ACCOUNT_DESTINATION.CONNECT, code: "ABCDEFGH" } }),
    "/personal/settings/hosts",
    // The code its link hands, which the Hosts page's dialog asks over once the pairing it names is read.
    /ABCD-EFGH/u,
  ],
  [
    "a link to Admin",
    handLink({ workspace: "personal", place: { kind: LINK_DESTINATION.ADMIN, section: "cost" } }),
    "/personal/admin/cost",
  ],
  ["⌘⇧H (Home)", Effect.sync(() => act(() => void runAppCommand(APP_COMMAND.HOME))), "/personal"],
  [
    "⌘⇧I (the Inbox)",
    Effect.sync(() => act(() => void runAppCommand(APP_COMMAND.INBOX))),
    "/personal/inbox",
  ],
  [
    "⌘⇧B (the Board)",
    Effect.sync(() => act(() => void runAppCommand(APP_COMMAND.TASKS))),
    "/personal/tasks",
  ],
  ["a person chosen in ⌘K", chooseInPalette("Priya"), "/personal/person/user-priya"],
])(
  "%s over an edited automation asks, Cancel leaves the automation as it stood, and Leave arrives as the press does",
  ([_door, press, arrived, shows]) =>
    Effect.gen(function* () {
      const router = yield* editedAutomation();
      const standing = router.addresses().slice(0, router.at() + 1);

      yield* press;
      yield* Effect.promise(() => vi.waitFor(() => buttonSaying("Cancel")));
      act(() => buttonSaying("Cancel").click());
      yield* Effect.promise(settle);
      assert.deepEqual(
        router.addresses().slice(0, router.at() + 1),
        standing,
        "Cancel moves nothing",
      );
      assert.equal(
        document.querySelector<HTMLInputElement>("input[aria-label='Automation name']")?.value,
        "Check each deploy, edited",
        "and keeps the edit",
      );

      if (shows !== undefined) assert.doesNotMatch(drawn(), shows, "and hands nothing on");

      yield* press;
      yield* leaveAsked();
      assert.deepEqual(router.addresses().slice(0, router.at() + 1), [...standing, arrived]);

      // Note that we wait on the ask itself, because the pairing's read lands after hops a busy runner stretches past any fixed count of ticks.
      if (shows !== undefined) {
        yield* Effect.promise(() => vi.waitFor(() => assert.match(drawn(), shows)));
      }
    }),
);

it.effect(
  "the automation being edited chosen in ⌘K over its own edit asks, and Leave keeps it standing, edit and all, rather than leaving it for the Tasks tab",
  () =>
    Effect.gen(function* () {
      const router = yield* editedAutomation();
      // Note that its setup is a move within the draft from the run the profile opens on, which asks nothing.
      yield* chooseInPalette("Check each deploy");
      const standing = router.addresses().slice(0, router.at() + 1);

      yield* chooseInPalette("Check each deploy");
      yield* leaveAsked();

      assert.deepEqual(router.addresses().slice(0, router.at() + 1), standing);
      assert.equal(
        document.querySelector<HTMLInputElement>("input[aria-label='Automation name']")?.value,
        "Check each deploy, edited",
      );
    }),
);

it.effect.each<[string, (automationId: string, runId: string) => ShownLink]>([
  [
    "a link to the automation being edited",
    (automationId) => ({
      workspace: "personal",
      place: { kind: LINK_DESTINATION.AUTOMATION, automationId },
    }),
  ],
  [
    "a link to the run of it standing",
    (automationId, runId) => ({
      workspace: "personal",
      place: { kind: LINK_DESTINATION.AUTOMATION_RUN, automationId, runId },
    }),
  ],
])("%s asks nothing and stands it, edit and all, with no step of Home between", ([_link, linkTo]) =>
  Effect.gen(function* () {
    const router = yield* editedAutomation();
    const standing = router.addresses().slice(0, router.at() + 1);
    const [, , , automationId = "", , runId = ""] = router.history.location.pathname.split("/");

    yield* handLink(linkTo(automationId, runId));

    assert.equal(
      [...document.querySelectorAll("button")].some((button) => button.textContent === "Leave"),
      false,
      "nothing asks",
    );
    const since = router.addresses().slice(standing.length - 1, router.at() + 1);
    assert.ok(
      since.every((address) => address.startsWith(`/personal/automation/${automationId}`)),
      `no other page stood between: ${since.join(", ")}`,
    );
    assert.equal(
      document.querySelector<HTMLInputElement>("input[aria-label='Automation name']")?.value,
      "Check each deploy, edited",
    );
  }),
);
