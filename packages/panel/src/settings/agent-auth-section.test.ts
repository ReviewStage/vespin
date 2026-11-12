// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CHATGPT_DEVICE_FAILURE_MESSAGE,
  CHATGPT_DEVICE_LOGIN,
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_REJECTION,
  PROVIDER_KEY_STATUS,
  type ProviderKeySummary,
  type ProviderKeysAnswer,
  RESET_CREDIT_OUTCOME,
  type SubscriptionKeySummary,
} from "@repo/features/provider-key-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppHostRead, AppProviderKeyList } from "@repo/host/app-state";
import type { PortActKind, PortActResult } from "@repo/host/contract";
import type { HostCapability } from "@repo/settings";
import { SETTINGS_SEARCH_ANCHOR_ATTRIBUTE } from "@repo/settings/settings-anchors";
import { SETTINGS_SECTION } from "@repo/settings/settings-views";
import { SETTINGS_ROW_STATE } from "@repo/ui";
import { ReplayUnmask, showsInReplay } from "@repo/ui/session-replay-marks";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { type AnyAct, FAKE_ANSWER, type FakeActAnswer, fakeActs } from "../testing/app-bridge.js";
import {
  copyingInto,
  DESKTOP_LINKS,
  fakeAppPlatform,
  QUIET_PANEL,
} from "../testing/app-platform.js";
import { DESKTOP_CAPABILITIES, handHostReads, handState, stateWith } from "../testing/app-state.js";
import { withQueryClient } from "../testing/copy-feedback.js";
import { AgentConnectSection } from "./agent-auth-section.js";
import { AgentsPage } from "./agents-page.js";

/**
 * Settings › Agents' credentials over a bridge answering as the service
 * would: each harness's card opening on its header and its Add, its plans
 * and its key in the account's one order, each saying how it stands and how
 * much of its window a plan has used, the plans and the key added from Add,
 * renamed, and reordered, and each credential replaced and removed under
 * its own row.
 * Nothing pasted stands on the page once kept or reaches a log. Setup's
 * Connect an agent draws the same lists. Synthetic credentials throughout.
 */

/** Low-entropy fakes shaped as a pasted key and token are, built at run time. */
const KEY = ["sk", "ant", "api03", "synthetic".repeat(4)].join("-");
const TOKEN = ["sk", "ant", "oat01", "fake".repeat(8)].join("-");

const AT = Date.UTC(2026, 9, 20, 12);

const ANTHROPIC_KEY: ProviderKeySummary = {
  provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
  hint: "sk-ant-…wxyz",
  status: PROVIDER_KEY_STATUS.VERIFIED,
  addedAt: AT,
  statusAt: AT,
  id: "key-anthropic",
  position: 1,
};

const CLAUDE_PLAN: SubscriptionKeySummary = {
  provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
  kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
  hint: "sk-ant-oat01…fake",
  status: PROVIDER_KEY_STATUS.UNVERIFIED,
  addedAt: AT,
  statusAt: AT,
  forAgents: true,
  id: "claude-1",
  position: 0,
};

const CHATGPT_PLAN: SubscriptionKeySummary = {
  provider: PROVIDER_KEY_PROVIDER.OPENAI,
  kind: PROVIDER_KEY_KIND.CHATGPT_OAUTH,
  hint: "ChatGPT",
  status: PROVIDER_KEY_STATUS.UNVERIFIED,
  addedAt: AT,
  statusAt: AT,
  forAgents: true,
  id: "chatgpt-1",
  position: 0,
  email: "ana@work.test",
};

/** The code a Connect Codex start hands out. */
const DEVICE_LOGIN = {
  loginId: "login-1",
  userCode: "225Q-1343X",
  verificationUrl: "https://auth.openai.com/codex/device",
  intervalSeconds: 5,
  expiresAt: AT + 15 * 60 * 1000,
};

/** What the test's service holds for the account. */
let held: ProviderKeysAnswer = { keys: [] };

/** Why the next save is refused, or nothing where it is kept. */
let refusal: (typeof PROVIDER_KEY_REJECTION)[keyof typeof PROVIDER_KEY_REJECTION] | undefined;

/** Every act the page sent, in order. */
let sent: AnyAct[] = [];

/** Connect Codex's wait while it is held open, as a login waits on its code being entered; none answers it connected at once. */
let waitOpen: PromiseWithResolvers<FakeActAnswer> | undefined;

/** How the keys the host holds are delivered to the window again, as each write's own answer lays them. */
let deliverKeys: (next: AppHostRead<AppProviderKeyList>) => void = () => undefined;

/** Every copy the page made, in order. */
let copied: string[] = [];

/** A write's answer of the keys, laid where the host holds them before it answers, as the host lays it. */
function written(value: ProviderKeysAnswer): Promise<FakeActAnswer> {
  deliverKeys({ rows: value });

  return Promise.resolve(done(value));
}

const done = (value: PortActResult<PortActKind>): FakeActAnswer => ({
  status: FAKE_ANSWER.DONE,
  value,
});

/** The position past the bottom of a provider's order, plans and key alike, where the service adds. */
function bottomOf(provider: ProviderKeySummary["provider"]): number {
  const places = [...held.keys, ...(held.subscriptions ?? [])].flatMap((one) =>
    one.provider === provider ? [one.position ?? 0] : [],
  );

  return Math.max(-1, ...places) + 1;
}

function answer(request: AnyAct): Promise<FakeActAnswer> {
  sent.push(request);
  const subscriptions = held.subscriptions ?? [];

  switch (request.kind) {
    case ACT_KIND.WEB_OPEN:
      return Promise.resolve(done(undefined));
    case ACT_KIND.PROVIDER_KEYS_SAVE: {
      if (refusal !== undefined) return Promise.resolve(done({ ...held, rejected: refusal }));
      const { kind, subscriptionId } = request.payload;
      const { provider } = request.payload;

      if (kind !== PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN) {
        if (subscriptionId !== undefined) return written(held);

        const key = {
          ...ANTHROPIC_KEY,
          provider,
          id: `key-${provider}-${held.keys.length + 1}`,
          hint: `sk-ant-…key${held.keys.length + 1}`,
          position: bottomOf(provider),
        };

        held = { ...held, keys: [...held.keys, key] };

        return written(held);
      }

      const added = {
        ...CLAUDE_PLAN,
        id: `claude-${subscriptions.length + 1}`,
        position: bottomOf(provider),
        addedAt: AT + subscriptions.length,
      };

      held = {
        ...held,
        subscriptions:
          subscriptionId === undefined
            ? [...subscriptions, added]
            : subscriptions.map((one) =>
                one.id === subscriptionId
                  ? { ...one, status: PROVIDER_KEY_STATUS.UNVERIFIED }
                  : one,
              ),
      };

      return written(held);
    }

    case ACT_KIND.PROVIDER_KEYS_REMOVE: {
      const { kind, subscriptionId } = request.payload;
      held =
        kind === undefined || kind === PROVIDER_KEY_KIND.API_KEY
          ? { ...held, keys: held.keys.filter((one) => one.id !== subscriptionId) }
          : { ...held, subscriptions: subscriptions.filter((one) => one.id !== subscriptionId) };

      return written(held);
    }

    case ACT_KIND.SUBSCRIPTION_RENAME: {
      const { subscriptionId, label } = request.payload;

      const named = <One extends { readonly id?: string }>(one: One) =>
        one.id === subscriptionId ? { ...one, ...(label !== null && { label }) } : one;

      held = { ...held, keys: held.keys.map(named), subscriptions: subscriptions.map(named) };

      return written(held);
    }

    case ACT_KIND.SUBSCRIPTIONS_REORDER: {
      const order = request.payload.subscriptionIds;

      const placed = <One extends { readonly id?: string; readonly position?: number }>(
        one: One,
      ) => ({
        ...one,
        position:
          one.id !== undefined && order.includes(one.id) ? order.indexOf(one.id) : one.position,
      });

      held = { ...held, keys: held.keys.map(placed), subscriptions: subscriptions.map(placed) };

      return written(held);
    }

    case ACT_KIND.CHATGPT_DEVICE_START:
      return Promise.resolve(done(DEVICE_LOGIN));
    case ACT_KIND.CHATGPT_DEVICE_CANCEL: {
      // Ending a login answers its wait as canceled, as the service does.
      const canceled = { outcome: CHATGPT_DEVICE_LOGIN.CANCELED };
      waitOpen?.resolve(done(canceled));
      waitOpen = undefined;

      return Promise.resolve(done(canceled));
    }

    case ACT_KIND.CHATGPT_DEVICE_WAIT:
      if (waitOpen !== undefined) return waitOpen.promise;
      held = { ...held, subscriptions: [...subscriptions, CHATGPT_PLAN] };
      deliverKeys({ rows: held });

      return Promise.resolve(done({ outcome: CHATGPT_DEVICE_LOGIN.CONNECTED, keys: held }));
    case ACT_KIND.PROVIDER_KEYS_USE_RESET_CREDIT:
      return Promise.resolve(done({ ...held, resetCredit: RESET_CREDIT_OUTCOME.RESET }));
    default:
      return Promise.resolve({ status: FAKE_ANSWER.UNKNOWN_ACT });
  }
}

const roots: Root[] = [];

beforeEach(() => {
  held = { keys: [] };
  refusal = undefined;
  sent = [];
  waitOpen = undefined;
  deliverKeys = () => undefined;
  copied = [];
  window.localStorage.clear();
  fakeAppPlatform({ ...QUIET_PANEL, ...DESKTOP_LINKS, ...copyingInto(copied) });
  fakeActs({ act: answer });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** The Agents page for an ordinary account, on a platform offering `capabilities`. */
async function mount(
  capabilities: readonly HostCapability[] = DESKTOP_CAPABILITIES,
): Promise<HTMLElement> {
  const base = stateWith({}, {});
  handState({}, { access: { admin: false }, run: { ...base.run, capabilities } });
  deliverKeys = handHostReads({ keys: { rows: held } }).deliverKeys;
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  // Note that the page stands under the unmask mark Settings draws every page under.
  act(() =>
    root.render(
      withQueryClient(
        createElement(ReplayUnmask, null, createElement(AgentsPage, { signedIn: true })),
      ),
    ),
  );
  await settle();
  await vi.waitFor(() => assert.equal(harnessRowsStand(container), true));

  return container;
}

/** Setup's Connect an agent, and whether either harness stood connected after each answer. */
async function mountSetup(): Promise<{ page: HTMLElement; connected: boolean[] }> {
  const base = stateWith({}, {});
  handState(
    {},
    { access: { admin: false }, run: { ...base.run, capabilities: DESKTOP_CAPABILITIES } },
  );
  deliverKeys = handHostReads({ keys: { rows: held } }).deliverKeys;
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  const connected: boolean[] = [];
  act(() =>
    root.render(
      withQueryClient(
        createElement(AgentConnectSection, { onConnected: (now) => connected.push(now) }),
      ),
    ),
  );
  await settle();
  await vi.waitFor(() => assert.equal(harnessRowsStand(container), true));

  return { page: container, connected };
}

/** Whether the harnesses' cards stand, which they do once the signed-in account's keys are read. */
function harnessRowsStand(page: HTMLElement): boolean {
  return labels(page).includes("Claude") && labels(page).includes("Codex");
}

/** Every row's name, in the order the page draws them. */
const labels = (page: Element) =>
  [...page.querySelectorAll<HTMLElement>(".ui-settings-row-label")].map(
    (each) => each.textContent ?? "",
  );

/** A credential's row, or a harness's header, by its name. */
const credential = (page: Element, label: string) =>
  [...page.querySelectorAll<HTMLElement>(".ui-settings-row")].find(
    (each) => each.querySelector(".ui-settings-row-label")?.textContent === label,
  ) ?? assert.fail(`no ${label} row`);

/** What a credential's row says of it under its name, and in which tint, or nothing where it says nothing. */
const lineOf = (within: Element) => {
  const line = within.querySelector<HTMLElement>(".ui-settings-row-state");

  return line === null ? undefined : { words: line.textContent, state: line.dataset.state };
};

/** How full a plan's usage bar stands, or nothing where it draws none. */
const meterOf = (within: Element) =>
  within.querySelector('[data-slot="progress"]')?.getAttribute("data-tone") ?? undefined;

/** A plan's usage meters, each window's row as a reader hears its words, the copies that size its columns left out. */
const metersOf = (within: Element) =>
  [...within.querySelectorAll("[data-window]")].map((row) =>
    [...row.querySelectorAll("span")]
      .flatMap((span) =>
        span.children.length === 0 && span.closest("[aria-hidden]") === null
          ? [span.textContent]
          : [],
      )
      .join(""),
  );

const plain = (words: string) => ({ words, state: SETTINGS_ROW_STATE.PLAIN });
const readyLine = plain("Ready");

/** The name a key with none of its own is shown by. */
const KEY_NAME = "API key · sk-ant-…wxyz";
const needsHand = (words: string) => ({ words, state: SETTINGS_ROW_STATE.ATTENTION });

const button = (within: Element | Document, words: string) =>
  [...within.querySelectorAll<HTMLButtonElement>("button")].find(
    (each) =>
      (each.textContent === words || each.getAttribute("aria-label") === words) &&
      each.closest("[inert]") === null,
  ) ?? assert.fail(`no ${words} button`);

async function press(within: Element | Document, words: string): Promise<void> {
  act(() => button(within, words).click());
  await settle();
}

/** The items of the menu standing open, in order. */
const menuItems = () =>
  [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].map(
    (each) => each.textContent ?? "",
  );

/** Chooses `item` from the menu standing open. */
async function pick(item: string): Promise<void> {
  const entry =
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (each) => each.textContent === item,
    ) ?? assert.fail(`no ${item} item`);

  act(() => entry.click());
  await settle();
}

/** Chooses `item` from a credential's ⋯, named for the credential. */
async function choose(row: Element, thing: string, item: string): Promise<void> {
  await press(row, `${thing} actions`);
  await pick(item);
}

/** Chooses `item` from a harness's Add, on its header. */
async function add(page: Element, harness: string, item: string): Promise<void> {
  await press(credential(page, harness), `Add to ${harness}`);
  await pick(item);
}

/** The field a visible label names, as a reader finds it. */
function labeled(within: Element, words: string): HTMLInputElement {
  const label = [...within.querySelectorAll("label")].find((each) => each.textContent === words);
  const control = label?.control;
  assert.ok(control instanceof HTMLInputElement, `no field labeled ${words}`);

  return control;
}

/** Puts `value` in a field as typing does. */
function type(field: HTMLInputElement, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Puts `value` in a field as a paste does, which saves it, and waits on the save. */
async function paste(field: HTMLInputElement, value: string): Promise<void> {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, value);
    field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste" }));
  });
  await settle();
}

/** The question asked over the window. */
function question(): HTMLElement {
  return (
    document.querySelector<HTMLElement>('[role="alertdialog"], [role="dialog"]') ??
    assert.fail("no question asks")
  );
}

/** The act a question asks, as its look says what it costs. */
const actLook = (words: string) => button(question(), words).getAttribute("data-variant");

/** The payloads of every act of `kind` the page sent, in order. */
const sentOf = (kind: AnyAct["kind"]) =>
  sent.filter((each) => each.kind === kind).map((each) => each.payload);

/** Unmounts the page, so the next world draws its own. */
function leave(): void {
  for (const root of roots.splice(0)) act(() => root.unmount());
}

test("each card opens on its harness and its Add; each credential says how it stands under its name, a plan with room how much of each window it has used, in meters alone", async () => {
  const empty = await mount();
  assert.deepEqual(
    labels(empty).filter((label) => label !== ""),
    ["Claude", "Codex"],
    "nothing connected is the headers alone",
  );
  await press(credential(empty, "Claude"), "Add to Claude");
  assert.deepEqual(menuItems(), ["Claude plan", "API key"]);
  leave();

  held = {
    keys: [{ ...ANTHROPIC_KEY, provider: PROVIDER_KEY_PROVIDER.OPENAI, position: 0 }],
    subscriptions: [
      {
        ...CLAUDE_PLAN,
        usage: { usedPercent: 42.4, windowMins: 300 },
        usageWindows: [
          { usedPercent: 42.4, windowMins: 300 },
          { usedPercent: 18, windowMins: 10_080 },
        ],
      },
    ],
  };
  // Note that one client holds the test's worlds, so each later world waits for its own keys to replace the last one's.
  const connected = await mount();
  const claudePlan = () => credential(connected, "Claude plan");
  await vi.waitFor(() => assert.deepEqual(metersOf(claudePlan()), ["5-hour42%", "Weekly18%"]));
  assert.equal(lineOf(claudePlan()), undefined, "no Ready line stands over the meters");
  assert.equal(meterOf(claudePlan()), "working");
  assert.deepEqual(lineOf(credential(connected, KEY_NAME)), readyLine);
  assert.equal(meterOf(credential(connected, KEY_NAME)), undefined, "a key draws no bar");
  assert.doesNotMatch(connected.textContent ?? "", /In use/u);
  leave();

  // Each lapse offers its fix.
  held = {
    keys: [],
    subscriptions: [
      { ...CLAUDE_PLAN, status: PROVIDER_KEY_STATUS.INVALID },
      { ...CHATGPT_PLAN, status: PROVIDER_KEY_STATUS.INVALID },
    ],
  };
  const attention = await mount();
  await vi.waitFor(() =>
    assert.deepEqual(
      lineOf(credential(attention, "Claude plan")),
      needsHand("Anthropic rejected this token. Paste a new one."),
    ),
  );
  assert.ok(button(credential(attention, "Claude plan"), "Replace token"));
  assert.deepEqual(lineOf(credential(attention, "ana@work.test")), needsHand("Sign-in expired"));
  assert.ok(button(credential(attention, "ana@work.test"), "Reconnect"));
  leave();

  // A plan at its limit says until when, its bar full in the attention ink; only Codex's ⋯ offers Manage usage in ChatGPT, which opens ChatGPT's usage settings.
  held = {
    keys: [],
    subscriptions: [
      { ...CLAUDE_PLAN, status: PROVIDER_KEY_STATUS.LIMIT_REACHED },
      {
        ...CHATGPT_PLAN,
        status: PROVIDER_KEY_STATUS.LIMIT_REACHED,
        limitResetsAt: Date.UTC(2026, 9, 20, 15, 40),
      },
    ],
  };
  const limited = await mount();
  await vi.waitFor(() =>
    assert.deepEqual(lineOf(credential(limited, "Claude plan")), needsHand("At its limit")),
  );
  assert.equal(meterOf(credential(limited, "Claude plan")), "attention");
  assert.match(
    lineOf(credential(limited, "ana@work.test"))?.words ?? "",
    /^At its limit, back at /u,
  );

  await choose(credential(limited, "ana@work.test"), "ana@work.test", "Manage usage in ChatGPT");
  assert.deepEqual(sentOf(ACT_KIND.WEB_OPEN), [{ url: "https://chatgpt.com/settings/usage" }]);
});

test("a Codex plan with room offers its resets as one press, whose question lists when each expires before it spends one", async () => {
  held = {
    keys: [],
    subscriptions: [
      {
        ...CHATGPT_PLAN,
        status: PROVIDER_KEY_STATUS.VERIFIED,
        resetCredits: 2,
        resetCreditExpiries: [Date.UTC(2026, 10, 30, 12), null],
      },
    ],
  };
  const page = await mount();
  const plan = () => credential(page, "ana@work.test");

  await vi.waitFor(() => button(plan(), "Use 1 of 2 resets on ana@work.test"));
  await press(plan(), "Use 1 of 2 resets on ana@work.test");

  const asked = question().textContent ?? "";
  assert.match(asked, /Use 1 of 2 resets\?/u);
  assert.match(asked, /Expires Nov 30/u);
  assert.match(asked, /Used next/u);
  assert.match(asked, /Doesn't expire/u);
  assert.deepEqual(sentOf(ACT_KIND.PROVIDER_KEYS_USE_RESET_CREDIT), []);

  await press(question(), "Use reset");
  assert.match(
    JSON.stringify(sentOf(ACT_KIND.PROVIDER_KEYS_USE_RESET_CREDIT)),
    /^\[\{"subscriptionId":"chatgpt-1"/u,
  );
});

test("each harness's card stands where a link to its section lands", async () => {
  const page = await mount();

  const landed = (section: string) =>
    page.querySelector(`[${SETTINGS_SEARCH_ANCHOR_ATTRIBUTE}="${section}"]`) ??
    assert.fail(`nothing stands at ${section}`);

  assert.ok(landed(SETTINGS_SECTION.CLAUDE).contains(credential(page, "Claude")));
  assert.ok(landed(SETTINGS_SECTION.CODEX).contains(credential(page, "Codex")));
});

test("another Claude plan joins the bottom, numbered by when it was added, renamed in place, and reordered from its menu", async () => {
  held = {
    keys: [],
    subscriptions: [{ ...CLAUDE_PLAN, status: PROVIDER_KEY_STATUS.LIMIT_REACHED }],
  };
  const page = await mount();
  await add(page, "Claude", "Claude plan");
  await paste(labeled(credential(page, "Claude"), "Paste the token it prints"), TOKEN);
  assert.deepEqual(sentOf(ACT_KIND.PROVIDER_KEYS_SAVE), [
    {
      provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
      kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
      key: TOKEN,
      add: true,
    },
  ]);
  await vi.waitFor(() => assert.ok(labels(page).includes("Claude plan 2")));
  assert.deepEqual(labels(page).slice(0, 3), ["Claude", "Claude plan 1", "Claude plan 2"]);

  await choose(credential(page, "Claude plan 2"), "Claude plan 2", "Rename");
  const field = page.querySelector<HTMLInputElement>('input[aria-label="Plan name"]');
  assert.ok(field !== null, "the name opens in place");
  type(field, "Personal Max");
  act(() => field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  await settle();
  assert.deepEqual(sentOf(ACT_KIND.SUBSCRIPTION_RENAME), [
    {
      provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
      kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
      subscriptionId: "claude-2",
      label: "Personal Max",
    },
  ]);
  await vi.waitFor(() => assert.ok(labels(page).includes("Personal Max")));

  await choose(credential(page, "Personal Max"), "Personal Max", "Move up");
  assert.deepEqual(sentOf(ACT_KIND.SUBSCRIPTIONS_REORDER), [
    {
      provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
      kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
      subscriptionIds: ["claude-2", "claude-1"],
    },
  ]);
  await vi.waitFor(() =>
    assert.deepEqual(labels(page).slice(1, 3), ["Personal Max", "Claude plan 1"]),
  );
});

test("API keys stand in their plans' order, Add offering another, which joins the bottom, and each is renamed in place and moved from its ⋯ as a plan is", async () => {
  held = { keys: [ANTHROPIC_KEY], subscriptions: [CLAUDE_PLAN] };
  const page = await mount();
  await vi.waitFor(() =>
    assert.deepEqual(labels(page).slice(0, 3), ["Claude", "Claude plan", KEY_NAME]),
  );
  await add(page, "Claude", "API key");
  await paste(labeled(credential(page, "Claude"), "Paste the key"), KEY);
  await vi.waitFor(() =>
    assert.deepEqual(labels(page).slice(0, 4), [
      "Claude",
      "Claude plan",
      KEY_NAME,
      "API key · sk-ant-…key2",
    ]),
  );

  await choose(credential(page, KEY_NAME), KEY_NAME, "Rename");
  const field = page.querySelector<HTMLInputElement>('input[aria-label="Key name"]');
  assert.ok(field !== null, "the name opens in place");
  type(field, "Team credits");
  act(() => field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  await settle();
  assert.deepEqual(sentOf(ACT_KIND.SUBSCRIPTION_RENAME), [
    {
      provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
      kind: PROVIDER_KEY_KIND.API_KEY,
      subscriptionId: "key-anthropic",
      label: "Team credits",
    },
  ]);
  await vi.waitFor(() => assert.ok(labels(page).includes("Team credits")));
  assert.deepEqual(lineOf(credential(page, "Team credits")), plain(`API key · sk-ant-…wxyz`));

  await choose(credential(page, "Team credits"), "Team credits", "Move up");
  assert.deepEqual(sentOf(ACT_KIND.SUBSCRIPTIONS_REORDER), [
    {
      provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
      kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
      subscriptionIds: ["key-anthropic", "claude-1", "key-anthropic-2"],
    },
  ]);
  await vi.waitFor(() =>
    assert.deepEqual(labels(page).slice(0, 3), ["Claude", "Team credits", "Claude plan"]),
  );
});

test("an API key added from Add opens a masked field under the header, sent once, joining the order, the field going and the focus back on Add; Remove asks first and removes that key", async () => {
  const logged = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn")];
  const page = await mount();
  const header = () => credential(page, "Claude");
  await add(page, "Claude", "API key");
  const field = labeled(header(), "Paste the key");
  assert.ok(document.activeElement === field, "the field has focus");
  assert.equal(field.type, "password");
  assert.equal(field.autocomplete, "off");
  type(field, KEY);
  await press(header(), "Show");
  assert.equal(field.type, "text", "Show reveals what is being pasted");
  await press(header(), "Hide");
  assert.equal(field.type, "password", "Hide masks it again");
  assert.ok(header().querySelector('a[href="https://console.anthropic.com/settings/keys"]'));

  await paste(field, `  ${KEY}  `);
  assert.deepEqual(sentOf(ACT_KIND.PROVIDER_KEYS_SAVE), [
    { provider: PROVIDER_KEY_PROVIDER.ANTHROPIC, key: KEY },
  ]);
  const name = "API key · sk-ant-…key1";
  const row = () => credential(page, name);
  await vi.waitFor(() => assert.deepEqual(lineOf(row()), readyLine));
  assert.equal(header().querySelector("form") === null, true, "the field goes");
  await vi.waitFor(() => assert.ok(document.activeElement === button(header(), "Add to Claude")));
  assert.ok(!document.body.innerHTML.includes(KEY), "the key stands nowhere once kept");

  for (const spy of logged) {
    assert.ok(spy.mock.calls.every((call) => !JSON.stringify(call).includes(KEY)));
  }

  await choose(row(), name, "Remove key");
  assert.deepEqual(sentOf(ACT_KIND.PROVIDER_KEYS_REMOVE), []);
  assert.match(question().textContent ?? "", /Remove your Anthropic API key\?/u);
  assert.equal(actLook("Remove key"), "danger");
  await press(question(), "Remove key");
  assert.deepEqual(sentOf(ACT_KIND.PROVIDER_KEYS_REMOVE), [
    { provider: PROVIDER_KEY_PROVIDER.ANTHROPIC, subscriptionId: "key-anthropic-1" },
  ]);
  await vi.waitFor(() => assert.ok(!labels(page).includes(name)));
});

test("a saved key's row is drawn from the keys the host holds, the window asking for none of its own", async () => {
  held = { keys: [ANTHROPIC_KEY], subscriptions: [] };
  const page = await mount();
  await vi.waitFor(() => assert.deepEqual(lineOf(credential(page, KEY_NAME)), readyLine));
  assert.equal(
    showsInReplay(credential(page, KEY_NAME)),
    false,
    "a saved key's row is masked in a screen recording",
  );
  assert.deepEqual(
    sent.map((each) => each.kind).filter((kind) => kind.startsWith("providerKeys.")),
    [ACT_KIND.PROVIDER_KEYS_FOLLOW],
  );
});

test("Replace key opens its field showing Saved where the key would be, sending the key it replaces, and Cancel puts it away, dropping the paste and handing the focus back", async () => {
  held = { keys: [ANTHROPIC_KEY], subscriptions: [] };
  const page = await mount();
  const row = () => credential(page, KEY_NAME);
  await vi.waitFor(() => assert.ok(row()));
  await choose(row(), KEY_NAME, "Replace key");
  const field = labeled(row(), "Paste the key");
  assert.equal(field.placeholder, "Saved");
  assert.equal(field.value, "");
  type(field, KEY);
  await press(row(), "Cancel");
  assert.equal(row().querySelector("form") === null, true, "Cancel puts the field away");
  assert.ok(!document.body.innerHTML.includes(KEY), "and drops what was pasted");
  await vi.waitFor(() =>
    assert.ok(document.activeElement === button(row(), `${KEY_NAME} actions`)),
  );

  await choose(row(), KEY_NAME, "Replace key");
  await paste(labeled(row(), "Paste the key"), KEY);
  assert.deepEqual(sentOf(ACT_KIND.PROVIDER_KEYS_SAVE), [
    { provider: PROVIDER_KEY_PROVIDER.ANTHROPIC, key: KEY, subscriptionId: "key-anthropic" },
  ]);
});

test("a Claude setup-token is saved by its kind, refused with why, and disconnected after asking", async () => {
  refusal = PROVIDER_KEY_REJECTION.INVALID;
  const page = await mount();
  const header = () => credential(page, "Claude");
  await add(page, "Claude", "Claude plan");
  const field = labeled(header(), "Paste the token it prints");
  assert.equal(field.placeholder, "sk-ant-oat01-…");
  await press(header(), "Copy command");
  assert.deepEqual(
    copied,
    ["claude setup-token"],
    "the command that prints a token is a press away",
  );
  await paste(field, TOKEN);
  assert.match(header().textContent ?? "", /That isn't a Claude setup-token\./u);
  assert.equal(field.value, TOKEN, "a refused paste stands as pasted");

  refusal = undefined;
  act(() => field.form?.requestSubmit());
  await settle();
  assert.deepEqual(sentOf(ACT_KIND.PROVIDER_KEYS_SAVE).at(-1), {
    provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
    kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
    key: TOKEN,
    add: true,
  });
  const row = () => credential(page, "Claude plan");
  await vi.waitFor(() => assert.deepEqual(lineOf(row()), readyLine));
  assert.equal(meterOf(row()), undefined, "a plan no turn has measured draws no bar");
  assert.ok(!document.body.innerHTML.includes(TOKEN));

  await choose(row(), "Claude plan", "Disconnect");
  assert.match(question().textContent ?? "", /Disconnect your Claude plan\?/u);
  assert.equal(actLook("Disconnect Claude plan"), "danger", "a deleted token is past undoing");
  await press(question(), "Disconnect Claude plan");
  assert.deepEqual(sentOf(ACT_KIND.PROVIDER_KEYS_REMOVE), [
    {
      provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
      kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
      subscriptionId: "claude-1",
    },
  ]);
  await vi.waitFor(() => assert.ok(!labels(page).includes("Claude plan")));
});

test("a paste too short to be a setup-token says it isn't one, and is sent nowhere", async () => {
  const page = await mount();
  await add(page, "Claude", "Claude plan");
  await paste(labeled(credential(page, "Claude"), "Paste the token it prints"), "not-a-real-token");
  assert.match(page.textContent ?? "", /That isn't a Claude setup-token\./u);
  assert.deepEqual(sentOf(ACT_KIND.PROVIDER_KEYS_SAVE), []);
});

test("a Claude token Anthropic rejected offers Replace token, which opens its field showing Saved", async () => {
  held = { keys: [], subscriptions: [{ ...CLAUDE_PLAN, status: PROVIDER_KEY_STATUS.INVALID }] };
  const page = await mount();
  await vi.waitFor(() => assert.ok(credential(page, "Claude plan")));
  await press(credential(page, "Claude plan"), "Replace token");
  const field = labeled(credential(page, "Claude plan"), "Paste the token it prints");
  assert.equal(field.placeholder, "Saved", "a saved token is said, not shown");
  assert.ok(document.activeElement === field);
});

test("a Codex plan connects in place through Codex's code, which goes once connected, and disconnects after asking", async () => {
  waitOpen = Promise.withResolvers();
  const page = await mount();
  const header = () => credential(page, "Codex");
  await add(page, "Codex", "Codex plan");
  assert.equal(document.querySelector('[role="dialog"]'), null, "it opens in place");
  assert.deepEqual(sentOf(ACT_KIND.CHATGPT_DEVICE_START), [{ add: true }]);
  assert.match(header().textContent ?? "", /225Q-1343X/u);
  assert.match(header().textContent ?? "", /Waiting for Codex/u);
  assert.deepEqual(sentOf(ACT_KIND.CHATGPT_DEVICE_WAIT), [
    { loginId: DEVICE_LOGIN.loginId, intervalSeconds: DEVICE_LOGIN.intervalSeconds },
  ]);

  held = { ...held, subscriptions: [CHATGPT_PLAN] };
  deliverKeys({ rows: held });
  act(() => waitOpen?.resolve(done({ outcome: CHATGPT_DEVICE_LOGIN.CONNECTED, keys: held })));
  waitOpen = undefined;
  await settle();
  const plan = () => credential(page, "ana@work.test");
  await vi.waitFor(() => assert.deepEqual(lineOf(plan()), readyLine));
  assert.doesNotMatch(page.textContent ?? "", /225Q-1343X/u, "the code goes");
  assert.deepEqual(sentOf(ACT_KIND.CHATGPT_DEVICE_CANCEL), []);

  await choose(plan(), "ana@work.test", "Disconnect");
  assert.equal(actLook("Disconnect Codex plan"), "danger", "an ended sign-in is past undoing");
  await press(question(), "Disconnect Codex plan");
  assert.deepEqual(sentOf(ACT_KIND.PROVIDER_KEYS_REMOVE), [
    {
      provider: PROVIDER_KEY_PROVIDER.OPENAI,
      kind: PROVIDER_KEY_KIND.CHATGPT_OAUTH,
      subscriptionId: "chatgpt-1",
    },
  ]);
  await vi.waitFor(() => assert.ok(!labels(page).includes("ana@work.test")));
});

test("a Codex plan whose sign-in expired offers Reconnect, which asks for a code in place", async () => {
  waitOpen = Promise.withResolvers();
  held = { keys: [], subscriptions: [{ ...CHATGPT_PLAN, status: PROVIDER_KEY_STATUS.INVALID }] };
  const page = await mount();
  await vi.waitFor(() => assert.ok(credential(page, "ana@work.test")));
  await press(credential(page, "ana@work.test"), "Reconnect");
  assert.equal(sentOf(ACT_KIND.CHATGPT_DEVICE_START).length, 1);
  assert.match(page.textContent ?? "", /225Q-1343X/u);
});

test("Cancel withdraws a Codex login still waiting, handing the focus back to Add", async () => {
  waitOpen = Promise.withResolvers();
  const page = await mount();
  await add(page, "Codex", "Codex plan");
  await press(credential(page, "Codex"), "Cancel");
  assert.deepEqual(sentOf(ACT_KIND.CHATGPT_DEVICE_CANCEL), [{ loginId: DEVICE_LOGIN.loginId }]);
  assert.ok(document.activeElement === button(page, "Add to Codex"));
});

test("a login that expires says so with Retry, which asks for a new code", async () => {
  waitOpen = Promise.withResolvers();
  const page = await mount();
  const header = () => credential(page, "Codex");
  await add(page, "Codex", "Codex plan");
  const expired = CHATGPT_DEVICE_FAILURE_MESSAGE[CHATGPT_DEVICE_LOGIN.EXPIRED];
  const waiting = waitOpen;
  waitOpen = Promise.withResolvers();
  act(() => waiting.resolve(done({ outcome: CHATGPT_DEVICE_LOGIN.EXPIRED, message: expired })));
  await settle();
  assert.ok(header().textContent?.includes(expired));
  await press(header(), "Retry");
  assert.equal(sentOf(ACT_KIND.CHATGPT_DEVICE_START).length, 2);
  assert.match(header().textContent ?? "", /225Q-1343X/u);
});

test("setup's lists open one credential's steps at a time and hear whether either harness can start an agent", async () => {
  const { page, connected } = await mountSetup();
  assert.equal(connected.at(-1), false);
  await add(page, "Claude", "Claude plan");
  await add(page, "Codex", "API key");
  assert.equal(
    credential(page, "Claude").querySelector("form") === null,
    true,
    "one credential's steps stand open",
  );
  await add(page, "Claude", "Claude plan");
  await paste(labeled(credential(page, "Claude"), "Paste the token it prints"), TOKEN);
  await vi.waitFor(() => assert.equal(connected.at(-1), true, "setup hears an agent can start"));
});
