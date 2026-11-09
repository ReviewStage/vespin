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
  type SubscriptionKeySummary,
} from "@repo/features/provider-key-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppHostRead, AppProviderKeyList } from "@repo/host/app-state";
import type { PortActKind, PortActResult } from "@repo/host/contract";
import type { HostCapability } from "@repo/settings";
import { SETTINGS_SEARCH_ANCHOR_ATTRIBUTE } from "@repo/settings/settings-anchors";
import { SETTINGS_SECTION } from "@repo/settings/settings-views";
import { SETTINGS_ROW_STATE } from "@repo/ui";
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
 * would: each harness's plan and key as one radio list, each saying how it
 * stands, the radio sending what new agents use as the plan's `forAgents`,
 * and each credential set up, replaced, and removed under its own row.
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
};

const CLAUDE_PLAN: SubscriptionKeySummary = {
  provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
  kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
  hint: "sk-ant-oat01…fake",
  status: PROVIDER_KEY_STATUS.UNVERIFIED,
  addedAt: AT,
  statusAt: AT,
  forAgents: true,
};

const CHATGPT_PLAN: SubscriptionKeySummary = {
  provider: PROVIDER_KEY_PROVIDER.OPENAI,
  kind: PROVIDER_KEY_KIND.CHATGPT_OAUTH,
  hint: "ChatGPT",
  status: PROVIDER_KEY_STATUS.UNVERIFIED,
  addedAt: AT,
  statusAt: AT,
  forAgents: true,
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

function answer(request: AnyAct): Promise<FakeActAnswer> {
  sent.push(request);
  const subscriptions = held.subscriptions ?? [];
  switch (request.kind) {
    case ACT_KIND.WEB_OPEN:
      return Promise.resolve(done(undefined));
    case ACT_KIND.PROVIDER_KEYS_SAVE:
      if (refusal !== undefined) return Promise.resolve(done({ ...held, rejected: refusal }));
      held =
        request.payload.kind === PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN
          ? { ...held, subscriptions: [...subscriptions, CLAUDE_PLAN] }
          : {
              ...held,
              keys: [...held.keys, { ...ANTHROPIC_KEY, provider: request.payload.provider }],
            };
      return written(held);
    case ACT_KIND.PROVIDER_KEYS_REMOVE: {
      const kind = request.payload.kind;
      held =
        kind === undefined || kind === PROVIDER_KEY_KIND.API_KEY
          ? { ...held, keys: held.keys.filter((one) => one.provider !== request.payload.provider) }
          : { ...held, subscriptions: subscriptions.filter((one) => one.kind !== kind) };
      return written(held);
    }
    case ACT_KIND.PROVIDER_KEYS_FOR_AGENTS:
      held = {
        ...held,
        subscriptions: subscriptions.map((one) =>
          one.kind === request.payload.kind
            ? { ...one, forAgents: request.payload.forAgents }
            : one,
        ),
      };
      return written(held);
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
  act(() => root.render(withQueryClient(createElement(AgentsPage, { signedIn: true }))));
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

/** Whether the harnesses' lists stand, which they do once the signed-in account's keys are read. */
function harnessRowsStand(page: HTMLElement): boolean {
  return page.querySelector('[role="radiogroup"][aria-label="New Claude agents use"]') !== null;
}

/** A credential's row, by the label its radio reads. */
const credential = (page: Element, label: string) =>
  [...page.querySelectorAll<HTMLElement>(".ui-choice-card")].find(
    (each) => each.querySelector(".ui-choice-label")?.textContent === label,
  ) ?? assert.fail(`no ${label} row`);

/** A credential row's radio. */
const radio = (row: Element) =>
  row.querySelector<HTMLButtonElement>('[role="radio"]') ?? assert.fail("no radio");

/** What a credential's row says of it under its name, and in which tint, or nothing where it says nothing. */
const lineOf = (within: Element) => {
  const line = within.querySelector<HTMLElement>(".ui-settings-row-state");
  return line === null ? undefined : { words: line.textContent, state: line.dataset.state };
};

const connectedLine = { words: "Connected", state: SETTINGS_ROW_STATE.CONNECTED };
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

/** Chooses `item` from a credential's ⋯, named for the credential. */
async function choose(row: Element, thing: string, item: string): Promise<void> {
  await press(row, `${thing} actions`);
  const entry =
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (each) => each.textContent === item,
    ) ?? assert.fail(`no ${item} item`);
  act(() => entry.click());
  await settle();
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

test("each credential says how it stands under its name, the radio on what new agents use; one not set up can't be picked and ends in its own Connect or Add key", async () => {
  const empty = await mount();
  for (const [label, setUp] of [
    ["Claude plan", "Connect Claude plan"],
    ["Anthropic API key", "Add Anthropic API key"],
    ["ChatGPT plan", "Connect ChatGPT plan"],
    ["OpenAI API key", "Add OpenAI API key"],
  ] as const) {
    const row = credential(empty, label);
    assert.equal(radio(row).disabled, true, `${label} can't be picked`);
    assert.equal(lineOf(row), undefined);
    assert.ok(button(row, setUp));
  }
  leave();

  held = {
    keys: [{ ...ANTHROPIC_KEY, provider: PROVIDER_KEY_PROVIDER.OPENAI }],
    subscriptions: [CLAUDE_PLAN],
  };
  // Note that one client holds the test's worlds, so each later world waits for its own keys to replace the last one's.
  const connected = await mount();
  await vi.waitFor(() =>
    assert.deepEqual(lineOf(credential(connected, "Claude plan")), connectedLine),
  );
  assert.equal(radio(credential(connected, "Claude plan")).getAttribute("aria-checked"), "true");
  assert.deepEqual(lineOf(credential(connected, "OpenAI API key")), connectedLine);
  assert.equal(radio(credential(connected, "OpenAI API key")).getAttribute("aria-checked"), "true");
  leave();

  // A plan set aside for a key leaves the key picked, whatever the plan's state; each lapse offers its fix.
  held = {
    keys: [ANTHROPIC_KEY],
    subscriptions: [
      { ...CLAUDE_PLAN, forAgents: false, status: PROVIDER_KEY_STATUS.INVALID },
      { ...CHATGPT_PLAN, status: PROVIDER_KEY_STATUS.INVALID },
    ],
  };
  const attention = await mount();
  const claudePlan = () => credential(attention, "Claude plan");
  await vi.waitFor(() =>
    assert.deepEqual(
      lineOf(claudePlan()),
      needsHand("Anthropic rejected this token. Paste a new one."),
    ),
  );
  assert.equal(radio(claudePlan()).getAttribute("aria-checked"), "false");
  assert.equal(
    radio(credential(attention, "Anthropic API key")).getAttribute("aria-checked"),
    "true",
  );
  assert.ok(button(claudePlan(), "Replace token"));
  assert.deepEqual(
    lineOf(credential(attention, "ChatGPT plan")),
    needsHand("Signed out of ChatGPT."),
  );
  assert.ok(button(credential(attention, "ChatGPT plan"), "Sign in again"));
  leave();

  // A plan at its limit says so; only ChatGPT's offers Manage usage, which opens ChatGPT's usage settings.
  held = {
    keys: [],
    subscriptions: [
      { ...CLAUDE_PLAN, status: PROVIDER_KEY_STATUS.LIMIT_REACHED },
      { ...CHATGPT_PLAN, status: PROVIDER_KEY_STATUS.LIMIT_REACHED },
    ],
  };
  const limited = await mount();
  await vi.waitFor(() =>
    assert.deepEqual(lineOf(credential(limited, "Claude plan")), needsHand("Usage limit reached")),
  );
  const usage =
    credential(limited, "ChatGPT plan").querySelector<HTMLAnchorElement>("a") ??
    assert.fail("no Manage usage");
  assert.equal(usage.textContent, "Manage usage");
  act(() => usage.click());
  await settle();
  assert.deepEqual(sentOf(ACT_KIND.WEB_OPEN), [{ url: "https://chatgpt.com/settings/usage" }]);
});

test("each harness's list stands where a link to its section lands", async () => {
  const page = await mount();
  const landed = (section: string) =>
    page.querySelector(`[${SETTINGS_SEARCH_ANCHOR_ATTRIBUTE}="${section}"]`) ??
    assert.fail(`nothing stands at ${section}`);
  assert.ok(landed(SETTINGS_SECTION.CLAUDE).contains(credential(page, "Claude plan")));
  assert.ok(landed(SETTINGS_SECTION.CODEX).contains(credential(page, "ChatGPT plan")));
});

test("the radio picks the plan or the key for new agents, sent as the plan's forAgents", async () => {
  held = { keys: [ANTHROPIC_KEY], subscriptions: [CLAUDE_PLAN] };
  const page = await mount();
  const key = () => radio(credential(page, "Anthropic API key"));
  const plan = () => radio(credential(page, "Claude plan"));
  assert.equal(plan().getAttribute("aria-checked"), "true");
  act(() => key().click());
  await settle();
  assert.deepEqual(sentOf(ACT_KIND.PROVIDER_KEYS_FOR_AGENTS), [
    {
      provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
      kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
      forAgents: false,
    },
  ]);
  // Note that what the host lays after each act reaches the keys' query a notify later, so the pick is waited on.
  await vi.waitFor(() => assert.equal(key().getAttribute("aria-checked"), "true"));
  assert.equal(plan().getAttribute("aria-checked"), "false");

  act(() => plan().click());
  await settle();
  assert.deepEqual(sentOf(ACT_KIND.PROVIDER_KEYS_FOR_AGENTS).at(-1), {
    provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
    kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
    forAgents: true,
  });
  await vi.waitFor(() => assert.equal(plan().getAttribute("aria-checked"), "true"));
});

test("an API key's Add key opens a masked field under its row, sent once, said as Connected, the field going and the focus back on the row's press; Remove asks first", async () => {
  const logged = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn")];
  const page = await mount();
  const row = () => credential(page, "Anthropic API key");
  await press(row(), "Add Anthropic API key");
  const field = labeled(row(), "Paste the key");
  assert.ok(document.activeElement === field, "the field has focus");
  assert.equal(field.type, "password");
  assert.equal(field.autocomplete, "off");
  type(field, KEY);
  await press(row(), "Show");
  assert.equal(field.type, "text", "Show reveals what is being pasted");
  await press(row(), "Hide");
  assert.equal(field.type, "password", "Hide masks it again");
  assert.ok(row().querySelector('a[href="https://console.anthropic.com/settings/keys"]'));

  await paste(field, `  ${KEY}  `);
  assert.deepEqual(sentOf(ACT_KIND.PROVIDER_KEYS_SAVE), [
    { provider: PROVIDER_KEY_PROVIDER.ANTHROPIC, key: KEY },
  ]);
  await vi.waitFor(() => assert.deepEqual(lineOf(row()), connectedLine));
  assert.equal(row().querySelector("form") === null, true, "the field goes");
  await vi.waitFor(() =>
    assert.ok(document.activeElement === button(row(), "Anthropic API key actions")),
  );
  assert.ok(!document.body.innerHTML.includes(KEY), "the key stands nowhere once kept");
  for (const spy of logged) {
    assert.ok(spy.mock.calls.every((call) => !JSON.stringify(call).includes(KEY)));
  }

  await choose(row(), "Anthropic API key", "Remove key");
  assert.deepEqual(sentOf(ACT_KIND.PROVIDER_KEYS_REMOVE), []);
  assert.match(question().textContent ?? "", /Remove your Anthropic API key\?/u);
  assert.equal(actLook("Remove key"), "danger");
  await press(question(), "Remove key");
  assert.deepEqual(sentOf(ACT_KIND.PROVIDER_KEYS_REMOVE), [
    { provider: PROVIDER_KEY_PROVIDER.ANTHROPIC },
  ]);
  await vi.waitFor(() => assert.ok(button(row(), "Add Anthropic API key")));
});

test("a saved key's row is drawn from the keys the host holds, the window asking for none of its own", async () => {
  held = { keys: [ANTHROPIC_KEY], subscriptions: [] };
  const page = await mount();
  assert.deepEqual(lineOf(credential(page, "Anthropic API key")), connectedLine);
  assert.deepEqual(
    sent.map((each) => each.kind).filter((kind) => kind.startsWith("providerKeys.")),
    [ACT_KIND.PROVIDER_KEYS_FOLLOW],
  );
});

test("Replace key opens its field showing Saved where the key would be, and Cancel puts it away, dropping the paste and handing the focus back", async () => {
  held = { keys: [ANTHROPIC_KEY], subscriptions: [] };
  const page = await mount();
  const row = () => credential(page, "Anthropic API key");
  await choose(row(), "Anthropic API key", "Replace key");
  const field = labeled(row(), "Paste the key");
  assert.equal(field.placeholder, "Saved");
  assert.equal(field.value, "");
  type(field, KEY);
  await press(row(), "Cancel");
  assert.equal(row().querySelector("form") === null, true, "Cancel puts the field away");
  assert.ok(!document.body.innerHTML.includes(KEY), "and drops what was pasted");
  assert.ok(document.activeElement === button(row(), "Anthropic API key actions"));
});

test("removing a key its harness's plan was set aside for turns the plan back on", async () => {
  held = { keys: [ANTHROPIC_KEY], subscriptions: [{ ...CLAUDE_PLAN, forAgents: false }] };
  const page = await mount();
  await choose(credential(page, "Anthropic API key"), "Anthropic API key", "Remove key");
  await press(question(), "Remove key");
  assert.deepEqual(sentOf(ACT_KIND.PROVIDER_KEYS_FOR_AGENTS), [
    {
      provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
      kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
      forAgents: true,
    },
  ]);
  await vi.waitFor(() =>
    assert.equal(radio(credential(page, "Claude plan")).getAttribute("aria-checked"), "true"),
  );
});

test("a Claude setup-token is saved by its kind, refused with why, and disconnected after asking", async () => {
  refusal = PROVIDER_KEY_REJECTION.INVALID;
  const page = await mount();
  const row = () => credential(page, "Claude plan");
  await press(row(), "Connect Claude plan");
  const field = labeled(row(), "Paste the token it prints");
  assert.equal(field.placeholder, "sk-ant-oat01-…");
  await press(row(), "Copy command");
  assert.deepEqual(
    copied,
    ["claude setup-token"],
    "the command that prints a token is a press away",
  );
  await paste(field, TOKEN);
  assert.match(row().textContent ?? "", /That isn't a Claude setup-token\./u);
  assert.equal(field.value, TOKEN, "a refused paste stands as pasted");

  refusal = undefined;
  act(() => field.form?.requestSubmit());
  await settle();
  assert.deepEqual(sentOf(ACT_KIND.PROVIDER_KEYS_SAVE).at(-1), {
    provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
    kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
    key: TOKEN,
  });
  await vi.waitFor(() => assert.deepEqual(lineOf(row()), connectedLine));
  assert.ok(!document.body.innerHTML.includes(TOKEN));

  await choose(row(), "Claude plan", "Disconnect");
  assert.match(question().textContent ?? "", /Disconnect your Claude plan\?/u);
  assert.equal(actLook("Disconnect Claude plan"), "danger", "a deleted token is past undoing");
  await press(question(), "Disconnect Claude plan");
  assert.deepEqual(sentOf(ACT_KIND.PROVIDER_KEYS_REMOVE), [
    { provider: PROVIDER_KEY_PROVIDER.ANTHROPIC, kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN },
  ]);
  await vi.waitFor(() => assert.ok(button(row(), "Connect Claude plan")));
});

test("a paste too short to be a setup-token says it isn't one, and is sent nowhere", async () => {
  const page = await mount();
  await press(credential(page, "Claude plan"), "Connect Claude plan");
  await paste(
    labeled(credential(page, "Claude plan"), "Paste the token it prints"),
    "not-a-real-token",
  );
  assert.match(page.textContent ?? "", /That isn't a Claude setup-token\./u);
  assert.deepEqual(sentOf(ACT_KIND.PROVIDER_KEYS_SAVE), []);
});

test("a Claude token Anthropic rejected offers Replace token, which opens its field showing Saved", async () => {
  held = { keys: [], subscriptions: [{ ...CLAUDE_PLAN, status: PROVIDER_KEY_STATUS.INVALID }] };
  const page = await mount();
  await press(credential(page, "Claude plan"), "Replace token");
  const field = labeled(credential(page, "Claude plan"), "Paste the token it prints");
  assert.equal(field.placeholder, "Saved", "a saved token is said, not shown");
  assert.ok(document.activeElement === field);
});

test("the ChatGPT plan connects in place through Codex's code, which goes once connected, and disconnects after asking", async () => {
  waitOpen = Promise.withResolvers();
  const page = await mount();
  const row = () => credential(page, "ChatGPT plan");
  await press(row(), "Connect ChatGPT plan");
  assert.equal(document.querySelector('[role="dialog"]'), null, "it opens in place");
  assert.equal(sentOf(ACT_KIND.CHATGPT_DEVICE_START).length, 1);
  assert.match(row().textContent ?? "", /225Q-1343X/u);
  assert.match(row().textContent ?? "", /Waiting for Codex/u);
  assert.deepEqual(sentOf(ACT_KIND.CHATGPT_DEVICE_WAIT), [
    { loginId: DEVICE_LOGIN.loginId, intervalSeconds: DEVICE_LOGIN.intervalSeconds },
  ]);

  held = { ...held, subscriptions: [CHATGPT_PLAN] };
  deliverKeys({ rows: held });
  act(() => waitOpen?.resolve(done({ outcome: CHATGPT_DEVICE_LOGIN.CONNECTED, keys: held })));
  waitOpen = undefined;
  await settle();
  await vi.waitFor(() => assert.deepEqual(lineOf(row()), connectedLine));
  assert.doesNotMatch(row().textContent ?? "", /225Q-1343X/u, "the code goes");
  assert.deepEqual(sentOf(ACT_KIND.CHATGPT_DEVICE_CANCEL), []);

  await choose(row(), "ChatGPT plan", "Disconnect");
  assert.equal(actLook("Disconnect ChatGPT plan"), "danger", "an ended sign-in is past undoing");
  await press(question(), "Disconnect ChatGPT plan");
  assert.deepEqual(sentOf(ACT_KIND.PROVIDER_KEYS_REMOVE), [
    { provider: PROVIDER_KEY_PROVIDER.OPENAI, kind: PROVIDER_KEY_KIND.CHATGPT_OAUTH },
  ]);
  await vi.waitFor(() => assert.ok(button(row(), "Connect ChatGPT plan")));
});

test("a ChatGPT plan OpenAI signed out offers Sign in again, which asks for a code in place", async () => {
  waitOpen = Promise.withResolvers();
  held = { keys: [], subscriptions: [{ ...CHATGPT_PLAN, status: PROVIDER_KEY_STATUS.INVALID }] };
  const page = await mount();
  await press(credential(page, "ChatGPT plan"), "Sign in again");
  assert.equal(sentOf(ACT_KIND.CHATGPT_DEVICE_START).length, 1);
  assert.match(credential(page, "ChatGPT plan").textContent ?? "", /225Q-1343X/u);
});

test("Cancel withdraws a ChatGPT login still waiting", async () => {
  waitOpen = Promise.withResolvers();
  const page = await mount();
  await press(credential(page, "ChatGPT plan"), "Connect ChatGPT plan");
  await press(credential(page, "ChatGPT plan"), "Cancel");
  assert.deepEqual(sentOf(ACT_KIND.CHATGPT_DEVICE_CANCEL), [{ loginId: DEVICE_LOGIN.loginId }]);
  assert.ok(document.activeElement === button(page, "Connect ChatGPT plan"));
});

test("a login that expires says so with Try again, which asks for a new code", async () => {
  waitOpen = Promise.withResolvers();
  const page = await mount();
  const row = () => credential(page, "ChatGPT plan");
  await press(row(), "Connect ChatGPT plan");
  const expired = CHATGPT_DEVICE_FAILURE_MESSAGE[CHATGPT_DEVICE_LOGIN.EXPIRED];
  const waiting = waitOpen;
  waitOpen = Promise.withResolvers();
  act(() => waiting.resolve(done({ outcome: CHATGPT_DEVICE_LOGIN.EXPIRED, message: expired })));
  await settle();
  assert.ok(row().textContent?.includes(expired));
  await press(row(), "Try again");
  assert.equal(sentOf(ACT_KIND.CHATGPT_DEVICE_START).length, 2);
  assert.match(row().textContent ?? "", /225Q-1343X/u);
});

test("setup's lists open one credential's steps at a time and hear whether either harness can start an agent", async () => {
  const { page, connected } = await mountSetup();
  assert.equal(connected.at(-1), false);
  await press(credential(page, "Claude plan"), "Connect Claude plan");
  await press(credential(page, "OpenAI API key"), "Add OpenAI API key");
  assert.equal(
    credential(page, "Claude plan").querySelector("form") === null,
    true,
    "one credential's steps stand open",
  );
  await press(credential(page, "Claude plan"), "Connect Claude plan");
  await paste(labeled(credential(page, "Claude plan"), "Paste the token it prints"), TOKEN);
  await vi.waitFor(() => assert.equal(connected.at(-1), true, "setup hears an agent can start"));
});
