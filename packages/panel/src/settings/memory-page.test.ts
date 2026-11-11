// @vitest-environment jsdom

import assert from "node:assert/strict";
import { AGENT_CALL_FAILURE, MEMORY_SAVE_FAILURE } from "@repo/features/agent-view";
import { LIVE_READ } from "@repo/features/live-wire";
import { MEMORY_SAVED, type MemorySummary } from "@repo/features/memory-wire";
import { WORKSPACE_ROLE, type Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import {
  type AppHostRead,
  type AppMemories,
  type AppStateDelivery,
  NO_KEYS_HELD,
} from "@repo/host/app-state";
import type { PortActKind, PortActResult } from "@repo/host/contract";
import { ReplayUnmask, showsInReplay } from "@repo/ui/session-replay-marks";
import { Effect } from "effect";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { type AnyAct, FAKE_ANSWER, type FakeActAnswer, fakeActs } from "../testing/app-bridge.js";
import { stateWith } from "../testing/app-state.js";
import {
  composerEditor,
  editorBundleLanded,
  installEditorLayout,
  writeInComposer,
} from "../testing/composer.js";
import { withQueryClient } from "../testing/copy-feedback.js";
import { chooseMenuItem, menuItems } from "../testing/phone-head.js";
import { MemorySection } from "./memory-page.js";

/**
 * Settings › Memory over a bridge answering as the host would: the memories
 * of the workspace Settings shows are held for that workspace and drawn as
 * the host lays them on the document, a row each with their words whole;
 * Delete is offered from a
 * memory's ⋯, unavailable on one the reader may not forget, asks first in
 * the confirm dialog, and the memory leaves the list as the host draws it
 * gone; several chosen are forgotten one after another on one question; a
 * forget that fails says so in the dialog and keeps the memory listed;
 * another workspace is held for its own memories; and a read that fails
 * offers to try again. The memories agents recall most stand first, one no
 * agent was handed in the window says so, and Edit saves a memory's words
 * from the field it opens in their place, which goes with a memory deleted
 * while it saves; Add memory saves a new one from a draft row, which stands
 * under a refusal. Synthetic workspaces, members, and memories.
 */

const READER = "user-reader";

const ACME: Workspace = {
  id: "workspace-acme",
  name: "Acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
};

const GLOBEX: Workspace = { ...ACME, id: "workspace-globex", name: "Globex" };

const DEPLOYS: MemorySummary = {
  id: "8a1f2c3d-4e5f-4a6b-9c7d-8e9f0a1b2c3d",
  text: "Deployments go out from the release branch through Vercel.",
  keptBy: { userId: READER, name: "Rita Reader" },
  forgettable: true,
  createdAt: Date.UTC(2026, 9, 10, 12),
  updatedAt: Date.UTC(2026, 9, 12, 12),
  source: null,
  recalls30d: 0,
  lastRecalledAt: null,
};

const TESTS: MemorySummary = {
  id: "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e",
  text: "The web server's store tests run on PGlite through test:store.",
  keptBy: { userId: "user-dean", name: "Dean" },
  forgettable: false,
  createdAt: Date.UTC(2026, 9, 9, 12),
  updatedAt: Date.UTC(2026, 9, 9, 12),
  source: null,
  recalls30d: 0,
  lastRecalledAt: null,
};

/** The memories the test's service holds, by the workspace, held and forgotten by the page. */
let stored: Readonly<Record<string, readonly MemorySummary[]>> = {};
/** Every act the page sent, in order. */
let sent: AnyAct[] = [];
/** Whether the host's read of the memories failed before it ever answered. */
let readFails = false;
/** Whether a forget is answered with a failure rather than the memories. */
let refuseForget = false;
/** What the test's service answers a save with, by the save. */
let saveAnswer: (save: {
  readonly workspaceId: string;
  readonly text: string;
  readonly replaces?: string;
}) => PortActResult<typeof ACT_KIND.MEMORIES_SAVE> = () => ({
  failure: AGENT_CALL_FAILURE.UNANSWERED,
});
/** What a save waits on before the test's service answers it; nothing from the start. */
let saveHeld: Promise<void> = Promise.resolve();
/** Whether the host has read nothing yet, so it lays no memories. */
let readsNothing = false;
/** Each workspace's memories as the test's host lays them on the document, under the version it last delivered. */
let laid: AppMemories = NO_KEYS_HELD;
let version = 1;
/** The window's listeners to the document's deliveries. */
const listeners = new Set<(delivery: AppStateDelivery) => void>();

const done = (value: PortActResult<PortActKind>): FakeActAnswer => ({
  status: FAKE_ANSWER.DONE,
  value,
});

const unanswered = { failure: AGENT_CALL_FAILURE.UNANSWERED } as const;

/** Lays one workspace's read on the document and delivers it, as the host does as a read moves. */
function lay(workspaceId: string, read: AppHostRead<readonly MemorySummary[]>): void {
  laid = { ...laid, [workspaceId]: read };
  version += 1;
  for (const listener of [...listeners]) {
    listener({ version, entries: { [LIVE_READ.MEMORIES]: laid } });
  }
}

/** Lays a workspace's memories as the test's host reads them now; nothing while it reads nothing. */
function layRead(workspaceId: string): void {
  if (readsNothing) return;
  lay(workspaceId, readFails ? { failed: true } : { rows: stored[workspaceId] ?? [] });
}

/** The bridge, answering the page's acts the way the host would. */
function answer(request: AnyAct): Promise<FakeActAnswer> {
  sent.push(request);
  switch (request.kind) {
    case ACT_KIND.MEMORIES_FOLLOW: {
      const { workspaceId } = request.payload;
      // Note that the host lays what it read once the hold is taken, never inside it, and holds it quietly.
      void Promise.resolve().then(() => layRead(workspaceId));
      return Promise.resolve({ status: FAKE_ANSWER.UNKNOWN_ACT });
    }
    case ACT_KIND.MEMORIES_RETRY:
      layRead(request.payload.workspaceId);
      return Promise.resolve(done(undefined));
    case ACT_KIND.MEMORIES_FORGET: {
      const { workspaceId, id } = request.payload;
      const before = stored[workspaceId] ?? [];
      const after = before.filter((memory) => memory.id !== id);
      // The host draws the memory gone the moment it is asked, and puts it back where the service refused it.
      lay(workspaceId, { rows: after });
      if (refuseForget) {
        lay(workspaceId, { rows: before });
        return Promise.resolve(done(unanswered));
      }
      stored = { ...stored, [workspaceId]: after };
      return Promise.resolve(done({ memories: after }));
    }
    case ACT_KIND.MEMORIES_SAVE: {
      const { payload } = request;
      return saveHeld.then(() => done(saveAnswer(payload)));
    }
    default:
      return Promise.resolve({ status: FAKE_ANSWER.UNKNOWN_ACT });
  }
}

const roots: Root[] = [];

beforeEach(() => {
  stored = { [ACME.id]: [DEPLOYS, TESTS] };
  sent = [];
  readFails = false;
  refuseForget = false;
  saveAnswer = () => ({ failure: AGENT_CALL_FAILURE.UNANSWERED });
  saveHeld = Promise.resolve();
  readsNothing = false;
  laid = NO_KEYS_HELD;
  version = 1;
  listeners.clear();
  fakeActs({
    act: answer,
    requestAppState: () => Promise.resolve(stateWith({}, { version, [LIVE_READ.MEMORIES]: laid })),
    onAppState: (listener: (delivery: AppStateDelivery) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 6; tick += 1) await Promise.resolve();
  });
}

/** How the workspaces' own read stands, which the page is handed beside the workspace it shows. */
interface WorkspacesRead {
  readonly failed: boolean;
  readonly retry: () => void;
}

const WORKSPACES_READ: WorkspacesRead = { failed: false, retry: () => undefined };

async function mount(
  signedIn = true,
  workspace: Workspace | null = ACME,
  workspaces: WorkspacesRead = WORKSPACES_READ,
): Promise<{
  readonly page: HTMLElement;
  readonly show: (next: Workspace, readerId?: string) => Promise<void>;
}> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const draw = (shown: Workspace | null, readerId: string | undefined) =>
    act(() =>
      root.render(
        // Note that the page stands under the unmask mark Settings draws every page under.
        withQueryClient(
          createElement(
            ReplayUnmask,
            null,
            createElement(MemorySection, {
              signedIn,
              workspace: shown ?? undefined,
              readerId,
              workspacesFailed: workspaces.failed,
              onRetryWorkspaces: workspaces.retry,
            }),
          ),
        ),
      ),
    );
  // Note that the page stands read once the memories the host holds reach their query, unless the test holds the read out.
  const read = () =>
    readsNothing
      ? Promise.resolve()
      : vi.waitFor(() =>
          assert.equal(container.textContent?.includes("Reading Vespin's memory"), false),
        );
  draw(workspace, signedIn ? READER : undefined);
  await settle();
  await read();
  return {
    page: container,
    show: async (next, readerId = READER) => {
      draw(next, readerId);
      await settle();
      await read();
    },
  };
}

beforeAll(() => {
  installEditorLayout();
  return Effect.runPromise(editorBundleLanded);
});

const rows = (page: HTMLElement) => [...page.querySelectorAll<HTMLElement>("tbody tr[data-index]")];

const words = (page: HTMLElement) =>
  rows(page).map((row) => row.querySelector(".memory-text")?.textContent);

const rowOf = (page: HTMLElement, memory: MemorySummary) =>
  rows(page).find((row) => row.querySelector(".memory-text")?.textContent === memory.text) ??
  assert.fail(`no row for ${memory.id}`);

const button = (within: Element, label: string) =>
  [...within.querySelectorAll<HTMLButtonElement>("button")].find(
    (each) => each.textContent === label && each.closest("[inert]") === null,
  ) ?? assert.fail(`no ${label} button`);

const dialog = () =>
  document.querySelector<HTMLElement>('[role="alertdialog"]') ?? assert.fail("no question");

/** A memory row's box, which chooses it. */
const boxOf = (page: HTMLElement, memory: MemorySummary) =>
  rowOf(page, memory).querySelector<HTMLElement>('[role="checkbox"]') ??
  assert.fail("no box on the row");

/** The field a memory's words are written in, where one stands. */
const field = (page: HTMLElement) => page.querySelector<HTMLElement>(".memory-field");

/** Waits for the field's editor to run, then writes `words` over what it holds. */
async function writeInField(page: HTMLElement, words: string): Promise<void> {
  const box = () => field(page) ?? assert.fail("no field");
  // Note that the editor lands from its own bundle, which a render inside `act` lays in.
  await vi.waitFor(async () => {
    await settle();
    assert.ok(composerEditor(box()).editor !== undefined, "the editor runs");
  });
  writeInComposer(box(), words);
}

/** Presses the field's own `label`, its Cancel or its Save. */
function pressInField(page: HTMLElement, label: string): void {
  const press =
    [...page.querySelectorAll<HTMLButtonElement>(".memory-field button")].find(
      (each) => (each.getAttribute("aria-label") ?? each.textContent) === label,
    ) ?? assert.fail(`no ${label} in the field`);
  act(() => press.click());
}

/** Opens a memory's ⋯. */
function openMenu(page: HTMLElement, memory: MemorySummary): void {
  const more =
    rowOf(page, memory).querySelector<HTMLButtonElement>('button[aria-label="Memory actions"]') ??
    assert.fail("no ⋯ on the row");
  act(() => more.click());
}

/** Chooses Delete from a memory's ⋯, which puts its question up. */
function askForget(page: HTMLElement, memory: MemorySummary): void {
  openMenu(page, memory);
  chooseMenuItem("Delete");
}

/** Asks Forget, then presses the dialog's own Forget; answers whether it asked before forgetting. */
async function forget(page: HTMLElement, memory: MemorySummary): Promise<boolean> {
  askForget(page, memory);
  const askedFirst = !sent.some((request) => request.kind === ACT_KIND.MEMORIES_FORGET);
  act(() => button(dialog(), "Delete memory").click());
  await settle();
  return askedFirst;
}

/** Types `query` over whatever the search holds, as the developer would. */
async function searchFor(page: HTMLElement, query: string): Promise<void> {
  const field =
    page.querySelector<HTMLInputElement>('input[aria-label="Search memories"]') ??
    assert.fail("no search");
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, query);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}

test("what Vespin kept in the workspace is held for it and drawn a row each, its words whole and masked", async () => {
  const { page } = await mount();

  assert.deepEqual(
    sent
      .filter((request) => request.kind === ACT_KIND.MEMORIES_FOLLOW)
      .map((request) => request.payload),
    [{ workspaceId: ACME.id }],
  );
  assert.deepEqual(words(page), [DEPLOYS.text, TESTS.text]);
  assert.equal(
    showsInReplay(rowOf(page, DEPLOYS).querySelector(".memory-text")),
    false,
    "a memory's words are masked in a screen recording",
  );
});

test("a memory's code in backticks is drawn as inline code, never as the backticks themselves", async () => {
  const written = { ...TESTS, text: "Run `pnpm db:generate` after changing a schema." };
  stored = { [ACME.id]: [written] };
  const { page } = await mount();

  const code = [
    ...rowOf(page, {
      ...written,
      text: "Run pnpm db:generate after changing a schema.",
    }).querySelectorAll("code"),
  ];
  assert.deepEqual(
    code.map((each) => each.textContent),
    ["pnpm db:generate"],
  );
  assert.doesNotMatch(page.textContent ?? "", /`/u);
});

test("Delete asks first, then deletes the memory for good and lists what the host then holds", async () => {
  const { page } = await mount();

  const askedFirst = await forget(page, DEPLOYS);

  assert.equal(askedFirst, true);
  assert.deepEqual(
    sent
      .filter((request) => request.kind === ACT_KIND.MEMORIES_FORGET)
      .map((request) => request.payload),
    [{ workspaceId: ACME.id, id: DEPLOYS.id }],
  );
  await vi.waitFor(() => expect(words(page)).toEqual([TESTS.text]));
  assert.equal(document.querySelector('[role="alertdialog"]'), null);
});

test("a memory a search hid comes back unchosen, so a later act on what is chosen leaves it be", async () => {
  const { page } = await mount();
  act(() => boxOf(page, DEPLOYS).click());

  await searchFor(page, "store");
  await searchFor(page, "");

  // Note that the element is checked as a yes or no, because a failure's diff of an element would print the whole document.
  assert.ok(page.querySelector('[role="toolbar"]') === null, "nothing stands chosen");
  assert.equal(boxOf(page, DEPLOYS).getAttribute("aria-checked"), "false");
});

test("a forget that fails says so in the dialog and keeps the memory listed", async () => {
  refuseForget = true;
  const { page } = await mount();

  await forget(page, DEPLOYS);

  assert.deepEqual(words(page), [DEPLOYS.text, TESTS.text]);
  assert.equal(
    dialog().querySelector('[data-slot="field-error"]:not(:empty)')?.textContent,
    "The memory could not be deleted. Try again.",
  );
});

test("the search keeps the memories whose words or keeper hold it", async () => {
  const { page } = await mount();

  await searchFor(page, "vercel");

  assert.deepEqual(words(page), [DEPLOYS.text]);
  await searchFor(page, "dean");
  assert.deepEqual(words(page), [TESTS.text]);
});

test("a memory the reader may not delete offers Delete unavailable, saying who may", async () => {
  const { page } = await mount();

  openMenu(page, TESTS);

  assert.deepEqual(
    menuItems().find((item) => item.label === "Delete"),
    { label: "Delete", disabled: true },
  );
  assert.match(
    document.querySelector('[role="menu"]')?.textContent ?? "",
    /Only Dean, or an owner or admin/u,
  );
});

test("several memories chosen are forgotten on one question, one after another, those the reader may not forget left and said so", async () => {
  const pricing: MemorySummary = {
    ...DEPLOYS,
    id: "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f",
    text: "Pricing lives in the billing service.",
  };
  stored = { [ACME.id]: [DEPLOYS, pricing, TESTS] };
  const { page } = await mount();

  for (const memory of [DEPLOYS, pricing, TESTS]) act(() => boxOf(page, memory).click());
  act(() => button(page.querySelector('[role="toolbar"]') ?? page, "Delete").click());
  assert.match(
    dialog().textContent ?? "",
    /Delete 3 memories\?.*1 memory you may not delete stays\./u,
  );
  act(() => button(dialog(), "Delete memories").click());
  await settle();

  assert.deepEqual(
    sent
      .filter((request) => request.kind === ACT_KIND.MEMORIES_FORGET)
      .map((request) => request.payload),
    [
      { workspaceId: ACME.id, id: DEPLOYS.id },
      { workspaceId: ACME.id, id: pricing.id },
    ],
  );
  await vi.waitFor(() => expect(words(page)).toEqual([TESTS.text]));
});

test("showing another workspace holds that workspace's memories in place of the first's", async () => {
  stored = { ...stored, [GLOBEX.id]: [] };
  const { page, show } = await mount();

  await show(GLOBEX);

  assert.deepEqual(
    sent
      .filter((request) => request.kind === ACT_KIND.MEMORIES_FOLLOW)
      .map((request) => request.payload),
    [{ workspaceId: ACME.id }, { workspaceId: GLOBEX.id }],
  );
  assert.deepEqual(words(page), []);
  assert.match(page.textContent ?? "", /hasn't remembered anything yet/u);
});

test("a workspace Vespin has remembered nothing in says so", async () => {
  stored = { [ACME.id]: [] };
  const { page } = await mount();

  assert.deepEqual(words(page), []);
  assert.match(page.textContent ?? "", /Vespin hasn't remembered anything yet\./u);
});

test("a read that fails offers to try again, and no account holds nothing", async () => {
  readFails = true;
  // Note that the signed-out page is drawn first, since a second page's subscription would follow the first page's read again.
  const { page: signedOut } = await mount(false);
  assert.equal(signedOut.textContent, "Sign in to use this page.");
  assert.deepEqual(
    sent.filter((request) => request.kind === ACT_KIND.MEMORIES_FOLLOW),
    [],
    "the signed-out page holds nothing",
  );
  const { page: failed } = await mount();

  assert.match(failed.textContent ?? "", /Vespin's memory could not be read\./u);
  readFails = false;
  act(() => button(failed, "Retry").click());
  await settle();
  await vi.waitFor(() => assert.deepEqual(words(failed), [DEPLOYS.text, TESTS.text]));
});

test("while the memories are read the page says Reading, which is neither its failure nor its empty line", async () => {
  readsNothing = true;
  const { page } = await mount();

  const status = page.querySelector('[role="status"]') ?? assert.fail("no reading region");
  // Note that the skeleton draws the table's own headings, hidden from a reader, after the words a reader hears.
  assert.match(status.textContent ?? "", /^Reading Vespin's memory/u);
  assert.doesNotMatch(page.textContent ?? "", /could not be read|hasn't remembered/u);
});

test("before the workspaces are read the page says Reading, and does not say none is open", async () => {
  const { page } = await mount(true, null);

  const status = page.querySelector('[role="status"]') ?? assert.fail("no reading region");
  assert.match(status.textContent ?? "", /^Reading your workspaces/u);
  assert.doesNotMatch(page.textContent ?? "", /none is open/u);
  assert.equal(sent.length, 0, "no workspace is a memory read of none");
});

test("workspaces that could not be read say so with Retry, which asks for them again", async () => {
  let retried = 0;
  const { page } = await mount(true, null, { failed: true, retry: () => (retried += 1) });

  assert.match(page.textContent ?? "", /Your workspaces could not be read\./u);
  act(() => button(page, "Retry").click());
  assert.equal(retried, 1);
});

test("the memories agents recalled most in the last 30 days stand first, then the most recently kept", async () => {
  const pricing: MemorySummary = {
    ...TESTS,
    id: "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f",
    text: "Pricing lives in the billing service.",
    updatedAt: Date.UTC(2026, 9, 8, 12),
    recalls30d: 4,
    lastRecalledAt: Date.UTC(2026, 9, 20, 12),
  };
  const flags: MemorySummary = {
    ...TESTS,
    id: "3d4e5f6a-7b8c-4d9e-8f0a-2b3c4d5e6f7a",
    text: "Feature flags live in src/flags.ts.",
    updatedAt: Date.UTC(2026, 9, 7, 12),
    recalls30d: 9,
    lastRecalledAt: Date.UTC(2026, 9, 21, 12),
  };
  stored = { [ACME.id]: [DEPLOYS, TESTS, pricing, flags] };
  const { page } = await mount();

  assert.deepEqual(words(page), [flags.text, pricing.text, DEPLOYS.text, TESTS.text]);
});

test("a memory older than the recall window that no agent was handed in it reads Unused, no recalls, and Never", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: Date.UTC(2026, 10, 20, 12) });
  const { page } = await mount();

  const cells = [...rowOf(page, DEPLOYS).querySelectorAll("td")].map((cell) => cell.textContent);
  assert.match(cells.join(" | "), /Unused/u);
  assert.deepEqual(cells.slice(2, 4), ["—", "Never"]);
});

test("Edit opens the memory's words in their place and saves the new words in place of the memory it edits", async () => {
  const corrected = "Deployments go out from main through Vercel.";
  saveAnswer = (save) => ({
    outcome: MEMORY_SAVED.CORRECTED,
    memory: { ...DEPLOYS, text: save.text, updatedAt: Date.UTC(2026, 9, 13, 12) },
  });
  const { page } = await mount();

  openMenu(page, DEPLOYS);
  chooseMenuItem("Edit");
  await writeInField(page, corrected);
  assert.ok(document.querySelector('[role="dialog"]') === null, "no dialog opens");
  pressInField(page, "Save");
  await settle();

  assert.deepEqual(
    sent
      .filter((request) => request.kind === ACT_KIND.MEMORIES_SAVE)
      .map((request) => request.payload),
    [{ workspaceId: ACME.id, text: corrected, replaces: DEPLOYS.id }],
  );
  await vi.waitFor(() =>
    assert.ok(field(page) === null, "the field goes once the words are taken"),
  );
});

test("an edit whose memory is deleted while it saves goes with it, and its answer opens no field again", async () => {
  const answering = Promise.withResolvers<void>();
  saveHeld = answering.promise;
  saveAnswer = () => ({ failure: MEMORY_SAVE_FAILURE.NOT_FOUND });
  const { page } = await mount();
  openMenu(page, DEPLOYS);
  chooseMenuItem("Edit");
  await writeInField(page, "Deployments go out from main.");
  pressInField(page, "Save");
  await settle();

  // Another member deletes the memory while the save is out.
  act(() => lay(ACME.id, { rows: [TESTS] }));
  // Note that the field is checked as a yes or no, because a failure's diff of an element would print the whole document.
  await vi.waitFor(() => assert.ok(field(page) === null, "put away"));
  answering.resolve();
  await settle();

  assert.ok(field(page) === null, "no field stands");
});

test("Add memory writes a new one in a draft row atop the table, saves it replacing nothing, and keeps the draft under a refusal", async () => {
  saveAnswer = () => ({ failure: MEMORY_SAVE_FAILURE.MEMORY_CREDENTIAL });
  const { page } = await mount();

  act(() => button(page, "Add memory").click());
  await writeInField(page, "Release notes are written before the tag is pushed.");
  assert.ok(rows(page)[0]?.querySelector(".memory-field") !== null, "the draft stands first");
  pressInField(page, "Save");
  await settle();

  assert.deepEqual(
    sent
      .filter((request) => request.kind === ACT_KIND.MEMORIES_SAVE)
      .map((request) => request.payload),
    [{ workspaceId: ACME.id, text: "Release notes are written before the tag is pushed." }],
  );
  await vi.waitFor(() =>
    assert.match(field(page)?.textContent ?? "", /looks like it holds a credential/u),
  );
});
