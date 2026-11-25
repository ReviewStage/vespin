// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type { IntegrationStatusesAnswer } from "@repo/features/integration-live";
import { SIGN_IN_WAIT } from "@repo/features/integration-sign-in";
import {
  INTEGRATION_CALL_FAILURE,
  type IntegrationToolsView,
} from "@repo/features/integration-view";
import {
  INTEGRATION_PROVIDER,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_SIGN_IN_FAILURE,
  INTEGRATION_STATUS,
  INTEGRATION_TOOLS_PROBLEM,
  type IntegrationAccount,
  type IntegrationProvider,
  type IntegrationSignInFailure,
  type IntegrationStatus,
} from "@repo/features/integration-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppHostRead, AppStateDelivery } from "@repo/host/app-state";
import type { PortActKind, PortActPayload } from "@repo/host/contract";
import type { SettingsLink } from "@repo/settings/settings-views";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { SettingsPage } from "@repo/ui";
import { serveEffectsOn } from "@repo/ui/testing/effect-services";
import { Clock, Context, Effect } from "effect";
import { TestClock } from "effect/testing";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { runAppCommand } from "../app-commands.js";
import { GitHubConnectProvider } from "../github-connect.js";
import { OpenSettingsProvider } from "../open-settings.js";
import { announcedPolitely, mountAnnouncer } from "../testing/announcer.js";
import { type AnyAct, fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import {
  deliveryOf,
  handHostReads,
  holdIntegrations,
  holdIntegrationTools,
  type IntegrationsHeld,
  signedInAs,
} from "../testing/app-state.js";
import { withQueryClient } from "../testing/copy-feedback.js";
import { IntegrationsSection } from "./integrations-page.js";

/**
 * Settings › Integrations over a bridge answering where every provider
 * stands as the service would: a provider the deployment offers the
 * account has a row, and one it does not, which the service answers as
 * unavailable, has none; an account offered none is told so, and a read
 * that fails still offers to read again. A row's button is for a problem
 * alone: a connection that works stands quiet, keeping Reconnect in its ⋯
 * beside Disconnect, and one expired or refused shows Reconnect on the row.
 * GitHub, which the account's own GitHub grants, says what it is for, is
 * connected in place through the account's GitHub connect, stands among the
 * rows by its name, and once connected keeps the same ⋯ as the rest, its
 * Disconnect the account's own GitHub disconnect. A Connect stands its
 * provider pending at the service until the test settles it, as the browser
 * would, or a Cancel ends it, each reaching the host's read of where they
 * stand, which the test lays again as the service's rows move. A connected
 * provider works once its server lists the tools the bridge holds for it.
 * The page's own search keeps the rows it finds under Connected and Not
 * connected, says when it finds nothing, takes Command-F, and gives way to
 * Escape.
 */

/** The providers the deployment does not offer the account, which the service answers as unavailable; every other one is disconnected. */
let withheld: readonly IntegrationProvider[] = [];

/** Whether the host's read of where they stand fails, never having answered. */
let refuseRead = false;

/** Whether the account's own GitHub is connected, which is where GitHub stands. */
let githubConnected = false;

/** Whether the account's GitHub disconnect is refused, its refusal the window's toast rather than the page's. */
let refuseGitHubDisconnect = false;

/** Whether a rename is refused, its refusal the row's own line. */
let refuseRename = false;

/** Where a provider stands where it is not disconnected, GitHub's own aside. */
const standing = new Map<IntegrationProvider, IntegrationStatus>();

/** What a provider's server answered when asked for its tools, over the tools it lists. */
const toolReads = new Map<
  IntegrationProvider,
  IntegrationToolsView | Promise<IntegrationToolsView>
>();

/** One call the page made on the act port, by its kind, with what it carried. */
type PortCall = {
  [Kind in PortActKind]: { readonly kind: Kind; readonly payload: PortActPayload<Kind> };
}[PortActKind];

/** Every act the page sent on the act port, in order. */
let sent: (AnyAct | PortCall)[] = [];

/** Every Settings link the page's presses followed. */
let links: SettingsLink[] = [];

/** Every provider's page the list's rows opened, in order. */
let opened: (IntegrationProvider | undefined)[] = [];

/** How many times the account's GitHub connect was begun. */
let githubConnects = 0;

/** How many times the account's GitHub disconnect was asked. */
let githubDisconnects = 0;

/** Whether another window begins the sign-in again while the next Cancel is out, so the Cancel finds it pending. */
let reopenedDuringCancel = false;

/** Where the service stands a provider a Connect or a Cancel has touched, over where it would otherwise. */
const touched = new Map<IntegrationProvider, IntegrationStatus>();

/** The tools each provider's server lists; one absent here is never answered. */
const listed = new Map<
  IntegrationProvider,
  readonly { readonly name: string; readonly description: string }[]
>();

/** The sign-in failures the host's next read carries, each named once as the service ends it. */
let signInFailures: IntegrationSignInFailure[] = [];

/** The accounts the host's read names, past a provider's own word. */
let accounts: IntegrationAccount[] = [];

/** The providers the host's read says another account may be added at. */
let addable: IntegrationProvider[] = [];

/** The name the service gives an account added. */
let addedConnection = "notion-3";

/** Whether the host has read nothing of where they stand yet, as while its first read is out. */
let holdReads = false;

/** The account's integrations as the host holds them for the window, laid again as the service's rows move. */
let integrations: IntegrationsHeld;

/** Where a Cancel leaves an account the service holds by connection name, past a provider's own word. */
const canceled = new Map<string, IntegrationStatus>();

const roots: Root[] = [];

const GRANOLA = INTEGRATION_PROVIDER.GRANOLA;

/** Where every provider stands at the service. */
function serviceStatuses(): Record<IntegrationProvider, IntegrationStatus> {
  // SAFETY: the entries are built from INTEGRATION_PROVIDER_LIST, so every provider is a key.
  return Object.fromEntries(
    INTEGRATION_PROVIDER_LIST.map((provider) => [
      provider,
      touched.get(provider) ??
        (withheld.includes(provider)
          ? INTEGRATION_STATUS.UNAVAILABLE
          : provider === INTEGRATION_PROVIDER.GITHUB && githubConnected
            ? INTEGRATION_STATUS.CONNECTED
            : (standing.get(provider) ?? INTEGRATION_STATUS.DISCONNECTED)),
    ]),
  ) as Record<IntegrationProvider, IntegrationStatus>;
}

/** Where every provider and account stands as the host's read holds it now: none while it has read nothing, failed while refused. */
function heldRead(): AppHostRead<IntegrationStatusesAnswer> | undefined {
  if (holdReads) return undefined;

  if (refuseRead) return { failed: true };

  return {
    rows: {
      integrations: serviceStatuses(),
      ...(accounts.length > 0 ? { accounts } : undefined),
      ...(addable.length > 0 ? { addable } : undefined),
      ...(signInFailures.length > 0 ? { signInFailures: signInFailures.splice(0) } : undefined),
    },
  };
}

beforeEach(() => {
  withheld = [];
  refuseRead = false;
  githubConnected = false;
  refuseGitHubDisconnect = false;
  refuseRename = false;
  standing.clear();
  toolReads.clear();
  sent = [];
  links = [];
  opened = [];
  githubConnects = 0;
  githubDisconnects = 0;
  touched.clear();
  listed.clear();
  signInFailures = [];
  addedConnection = "notion-3";
  canceled.clear();
  holdReads = false;
  accounts = [];
  addable = [];
  reopenedDuringCancel = false;
  fakeAppBridge({});
  // What the service answers an act the page sends on the act port; a Connect and a Cancel each answer once the host's read carries them.
  fakeActPort({
    [ACT_KIND.INTEGRATIONS_CONNECT]: (payload) => {
      sent.push({ kind: ACT_KIND.INTEGRATIONS_CONNECT, payload });

      if (payload.add === true) {
        return Promise.resolve({ opened: true, connection: addedConnection });
      }

      touched.set(payload.provider, INTEGRATION_STATUS.PENDING);
      integrations.lay();

      return Promise.resolve({ opened: true });
    },
    // A Cancel ends a sign-in still pending; one that finished first stays connected.
    [ACT_KIND.INTEGRATIONS_CANCEL]: (payload) => {
      sent.push({ kind: ACT_KIND.INTEGRATIONS_CANCEL, payload });
      const { provider } = payload;
      const account = canceled.get(payload.connection ?? provider);

      if (account === undefined) {
        if (touched.get(provider) === INTEGRATION_STATUS.PENDING && !reopenedDuringCancel) {
          touched.set(provider, INTEGRATION_STATUS.DISCONNECTED);
        }
      }

      integrations.lay();

      return Promise.resolve({ status: account ?? serviceStatuses()[provider] });
    },
    // A rename names the account anew, which the host draws over its read on the press.
    [ACT_KIND.INTEGRATIONS_RENAME]: (payload) => {
      sent.push({ kind: ACT_KIND.INTEGRATIONS_RENAME, payload });

      if (refuseRename) return Promise.resolve({ failure: INTEGRATION_CALL_FAILURE.UNANSWERED });
      const { connection, label } = payload;
      accounts = accounts.map((account) =>
        account.connection === connection ? { ...account, label } : account,
      );
      integrations.lay();

      const renamed =
        accounts.find((account) => account.connection === connection) ?? assert.fail("no account");

      return Promise.resolve({ account: renamed });
    },
  });
  // A server whose tools the test holds none of is one the service never answered, as before tools were drawn.
  holdIntegrationTools(handHostReads({}).deliverTools, (server) => {
    const read = toolReads.get(server.provider);

    if (read !== undefined) return read;
    const tools = listed.get(server.provider);

    return tools === undefined ? Promise.reject(new Error("Not in this test.")) : { tools };
  });
  integrations = holdIntegrations(heldRead);
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/** Lets every answer the bridge gave, and the redraws they cause, land. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
  // Note that the reads the host lays reach their queries a tick after they land, so the page is read once none still stands out, bar one the test holds.
  await vi.waitFor(() => {
    const text = document.body.textContent ?? "";
    assert.equal(
      text.includes("Checking…") || (!holdReads && text.includes("Reading the integrations")),
      false,
    );
  });
}

/**
 * The signed-in page once where every provider stands has been read, on the
 * test's Query client as the window's root provides its own, and under its
 * title in a settings page's frame where `framed`: the list, or the page of
 * the provider `sub` names.
 */
async function mount(framed = false, sub?: IntegrationProvider): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);

  const section = createElement(IntegrationsSection, {
    signedIn: true,
    sub,
    onSubChange: (provider: IntegrationProvider | undefined) => opened.push(provider),
  });

  const page = createElement(
    OpenSettingsProvider,
    { value: (link: SettingsLink) => links.push(link) },
    createElement(
      GitHubConnectProvider,
      {
        value: {
          connection: { connected: githubConnected, login: null },
          connect: () => {
            githubConnects += 1;

            return Promise.resolve(true);
          },
          // A disconnect answers once the host has asked GitHub's standing again, which its read then holds.
          disconnect: () => {
            githubDisconnects += 1;

            if (!refuseGitHubDisconnect) githubConnected = false;
            integrations.lay();

            return Promise.resolve(!refuseGitHubDisconnect);
          },
        },
      },
      framed ? createElement(SettingsPage, { title: "Integrations", children: section }) : section,
    ),
  );

  act(() => root.render(withQueryClient(page)));
  await settle();

  // Note that a test holding the read back reads its placeholder, so only a read let through is waited on.
  if (!holdReads) await vi.waitFor(() => assert.equal(readSettled(container), true));

  return container;
}

/** Whether the page has drawn where the providers stand, or that it could not read it, rather than its placeholder. */
function readSettled(page: HTMLElement): boolean {
  return !(page.textContent ?? "").includes("Reading the integrations");
}

/** Granola's row as the page draws it. */
function granolaRowOf(page: HTMLElement): Element {
  return (
    [...page.querySelectorAll(".ui-settings-row")].find(
      (row) => nameOf(row.querySelector('[id$="label"]')) === "Granola",
    ) ?? assert.fail("Granola has a row")
  );
}

/** A row as the developer reads it: its lines, one under another, and the labels of the buttons it offers. */
interface RowRead {
  readonly line: string | undefined;
  readonly buttons: readonly string[];
}

/** Granola's row: its line, and the labels of the buttons it offers. */
/** A row's state lines as a reader reads them, each on its own line; none where it draws none. */
function stateLines(row: Element): string | undefined {
  const lines = [...row.querySelectorAll(".ui-settings-row-state")].map(
    (line) => line.textContent ?? "",
  );

  return lines.length === 0 ? undefined : lines.join("\n");
}

function granolaRow(page: HTMLElement): RowRead {
  const row = granolaRowOf(page);

  return {
    line: stateLines(row),
    buttons: [...row.querySelectorAll("button")].flatMap((button) =>
      button.textContent === "" ? [] : [button.textContent ?? ""],
    ),
  };
}

/** Presses the button on Granola's row that says `label`. */
async function pressOnGranola(page: HTMLElement, label: string): Promise<void> {
  const button =
    [...granolaRowOf(page).querySelectorAll("button")].find((each) => each.textContent === label) ??
    assert.fail(`Granola's row offers ${label}`);

  act(() => button.click());
  await settle();
}

/** The service's rows moved, which the host's read of where every provider stands carries. */
async function readMoves(): Promise<void> {
  act(() => integrations.lay());
  await settle();
}

const WAITING = { line: "Waiting for Granola in your browser…", buttons: ["Reopen", "Cancel"] };

/** A row's name as it reads: its provider's, and the account's words beside it where it draws them. */
function nameOf(label: Element | null): string | undefined {
  const beside = label?.nextElementSibling;
  // Note that an account renamed by pressing its words draws them inside the press.
  const words = beside?.classList.contains("ui-renamable-name") ? beside.firstElementChild : beside;
  const account = words?.classList.contains("ui-account-words") ? words.textContent : undefined;

  return account ? `${label?.textContent} · ${account}` : (label?.textContent ?? undefined);
}

/** The providers the page draws a row for, by name. */
function rowNames(page: HTMLElement): (string | undefined)[] {
  return [...page.querySelectorAll('[id$="label"]')].map(nameOf);
}

/** The words of the buttons standing on a row, its ⋯ and the press of a row that opens a page aside. */
function rowButtons(row: Element): (string | null)[] {
  return [...row.querySelectorAll("button")].flatMap((button) =>
    button.hasAttribute("aria-expanded") || button.textContent === "" ? [] : [button.textContent],
  );
}

/** Presses the button on a row that says `words`, and lets what it asked settle. */
async function press(row: Element, words: string): Promise<void> {
  act(() =>
    (
      [...row.querySelectorAll("button")].find((button) => button.textContent === words) ??
      assert.fail(`no ${words} on the row`)
    ).click(),
  );
  await settle();
}

/** Presses Add account at the head of a provider's accounts, and lets what it asked settle. */
async function addAccount(page: HTMLElement): Promise<void> {
  act(() => addAccountButton(page)?.click());
  await settle();
}

/** The Add account at the head of a provider's accounts, where it stands. */
function addAccountButton(page: HTMLElement): HTMLButtonElement | undefined {
  return [...page.querySelectorAll("button")].find(
    (button) => button.textContent === "Add account",
  );
}

/** What a row says under its name: its description's words, state lines and all. */
function lineOf(row: Element): string | undefined {
  return row.querySelector(`[id$="description"]`)?.textContent ?? undefined;
}

/** What a row's ⋯ offers, and the line it stands under. */
interface MenuRead {
  readonly items: readonly (string | null)[];
  readonly heading: string | undefined;
}

/** A row's ⋯ opened and closed again; nothing where it draws no ⋯. */
function menuOf(row: Element): MenuRead {
  const ellipsis = row.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');

  if (ellipsis === null) return { items: [], heading: undefined } satisfies MenuRead;
  act(() => ellipsis.click());
  const items = [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent);
  const heading = document.querySelector(".ui-menu-heading")?.textContent ?? undefined;
  act(() => ellipsis.click());

  return { items, heading } satisfies MenuRead;
}

/** Chooses `words` in a row's ⋯, and lets what it asked settle. */
async function choose(row: Element, words: string): Promise<void> {
  const ellipsis =
    row.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]') ?? assert.fail("no ⋯");

  act(() => ellipsis.click());
  act(() =>
    (
      [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
        (item) => item.textContent === words,
      ) ?? assert.fail(`no ${words} in the ⋯`)
    ).click(),
  );
  await settle();
}

/** Answers the confirm dialog standing with `verb`, and lets it settle; answers what the dialog then says. */
async function confirm(verb: string): Promise<string | null> {
  const dialog =
    document.querySelector<HTMLElement>('[role="alertdialog"]') ?? assert.fail("no question");

  act(() =>
    (
      [...dialog.querySelectorAll("button")].find((button) => button.textContent === verb) ??
      assert.fail(`no ${verb} in the dialog`)
    ).click(),
  );
  await settle();

  return dialog.textContent;
}

test("a provider the deployment does not offer the account has no row, and its page says it isn't available here, while every one it offers has its Connect", async () => {
  withheld = [INTEGRATION_PROVIDER.SLACK];
  const page = await mount();
  const slack = await mount(false, INTEGRATION_PROVIDER.SLACK);

  assert.equal(lineOf(rowNamed(slack, "Slack")), "Slack isn't available here.");
  assert.deepEqual(rowButtons(rowNamed(slack, "Slack")), []);

  assert.deepEqual(rowNames(page), [
    "Executor",
    "GitHub",
    "Gmail",
    "Google Calendar",
    "Google Drive",
    "Granola",
    "Linear",
    "Mercury",
    "Neon",
    "Notion",
    "PostHog",
    "Resend",
    "Sentry",
    "Stripe",
    "Supabase",
    "Vercel",
    "Y Combinator",
  ]);
  assert.equal(
    [...page.querySelectorAll("button")].filter((button) => button.textContent === "Connect")
      .length,
    17,
  );
});

test("an account offered no provider is told so, with no row", async () => {
  withheld = INTEGRATION_PROVIDER_LIST;
  const page = await mount();

  assert.deepEqual(rowNames(page), []);
  assert.match(page.textContent ?? "", /No integrations available/u);
});

test("a read that never answered says so, and Retry reads it again", async () => {
  withheld = INTEGRATION_PROVIDER_LIST;
  refuseRead = true;
  const page = await mount();

  assert.match(page.textContent ?? "", /Your integrations could not be read\./u);
  refuseRead = false;
  act(() =>
    (
      [...page.querySelectorAll("button")].find((button) => button.textContent === "Retry") ??
      assert.fail("Retry is offered")
    ).click(),
  );
  await settle();
  assert.equal(integrations.retries(), 1);
  await vi.waitFor(() => assert.match(page.textContent ?? "", /No integrations available/u));
});

test("GitHub, granted by the account's own GitHub, offers Connect, which connects it in place and waits on the browser, a disconnected read not failing it, and a Cancel ending it here alone", async () => {
  withheld = INTEGRATION_PROVIDER_LIST.filter(
    (provider) => provider !== INTEGRATION_PROVIDER.GITHUB,
  );
  const page = await mount();

  const buttonNamed = (name: string) =>
    [...page.querySelectorAll("button")].find((button) => button.textContent === name);

  const connect = buttonNamed("Connect") ?? assert.fail("Connect is offered");
  act(() => connect.click());
  await settle();

  assert.equal(githubConnects, 1);
  assert.deepEqual(links, [], "nothing leaves the page");
  assert.match(page.textContent ?? "", /Waiting for GitHub in your browser…/u);
  await readMoves();
  assert.match(page.textContent ?? "", /Waiting for GitHub in your browser…/u, "still waiting");

  const cancel = buttonNamed("Cancel") ?? assert.fail("GitHub's wait offers Cancel");
  act(() => cancel.click());
  await settle();
  assert.equal(
    sent.some((request) => request.kind === ACT_KIND.INTEGRATIONS_CANCEL),
    false,
    "the service holds no GitHub sign-in to end",
  );
  assert.ok(buttonNamed("Connect"), "Connect is offered again");
});

test("GitHub connected is a row that opens its page, where its account keeps Reconnect in its ⋯ under a line saying it uses the GitHub sign-in, and its Disconnect stands last", async () => {
  withheld = INTEGRATION_PROVIDER_LIST.filter(
    (provider) => provider !== INTEGRATION_PROVIDER.GITHUB,
  );
  githubConnected = true;
  listed.set(INTEGRATION_PROVIDER.GITHUB, [{ name: "get_me", description: "Reads the account." }]);
  const list = await mount();
  const row = rowNamed(list, "GitHub");

  assert.deepEqual(rowButtons(row), []);
  assert.deepEqual(menuOf(row).items, []);
  assert.equal(lineOf(row), "Issues, pull requests, and code, as you");
  act(() => row.querySelector<HTMLButtonElement>("button")?.click());
  assert.deepEqual(opened, [INTEGRATION_PROVIDER.GITHUB]);

  const page = await mount(false, INTEGRATION_PROVIDER.GITHUB);
  assert.deepEqual(rowButtons(rowNamed(page, "GitHub")), []);
  assert.deepEqual(menuOf(rowNamed(page, "GitHub")), {
    items: ["Reconnect"],
    heading: "Uses your GitHub sign-in",
  });
  assert.deepEqual(rowButtons(rowNamed(page, "Disconnect GitHub")), ["Disconnect"]);
});

test("GitHub's Disconnect is the account's GitHub disconnect, which asks first and leaves Connect, and a refusal closes the dialog with GitHub still connected", async () => {
  withheld = INTEGRATION_PROVIDER_LIST.filter(
    (provider) => provider !== INTEGRATION_PROVIDER.GITHUB,
  );
  githubConnected = true;
  listed.set(INTEGRATION_PROVIDER.GITHUB, [{ name: "get_me", description: "Reads the account." }]);
  refuseGitHubDisconnect = true;
  const refusedPage = await mount(false, INTEGRATION_PROVIDER.GITHUB);
  await press(rowNamed(refusedPage, "Disconnect GitHub"), "Disconnect");
  await confirm("Disconnect GitHub");
  const refusedDialog = document.querySelector('[role="alertdialog"]');
  const refusedButtons = rowButtons(rowNamed(refusedPage, "GitHub"));
  refuseGitHubDisconnect = false;
  const page = await mount(false, INTEGRATION_PROVIDER.GITHUB);
  await press(rowNamed(page, "Disconnect GitHub"), "Disconnect");
  const askedBeforeConfirm = githubDisconnects;
  await confirm("Disconnect GitHub");

  assert.equal(refusedDialog, null, "the refusal is the window's toast, not the dialog's");
  assert.deepEqual(refusedButtons, [], "GitHub stands connected");
  assert.equal(askedBeforeConfirm, 1, "the second Disconnect asked before it disconnected");
  assert.equal(githubDisconnects, 2);
  await vi.waitFor(() => assert.deepEqual(rowButtons(rowNamed(page, "GitHub")), ["Connect"]));
});

test("GitHub connected but refused by its server shows Reconnect on its row and on its page, which keeps no ⋯ beside it", async () => {
  withheld = INTEGRATION_PROVIDER_LIST.filter(
    (provider) => provider !== INTEGRATION_PROVIDER.GITHUB,
  );
  githubConnected = true;
  toolReads.set(INTEGRATION_PROVIDER.GITHUB, {
    problem: { reason: INTEGRATION_TOOLS_PROBLEM.REFUSED },
  });
  const list = await mount();
  const page = await mount(false, INTEGRATION_PROVIDER.GITHUB);
  const row = rowNamed(page, "GitHub");

  assert.deepEqual(rowButtons(rowNamed(list, "GitHub")), ["Reconnect"]);
  assert.deepEqual(rowButtons(row), ["Reconnect"]);
  assert.deepEqual(menuOf(row).items, []);
});

test("a connection that works says what it gives agents on the list, and on its page stands quiet with Reconnect in its ⋯, which signs in again", async () => {
  withheld = INTEGRATION_PROVIDER_LIST.filter(
    (provider) => provider !== INTEGRATION_PROVIDER.LINEAR,
  );
  standing.set(INTEGRATION_PROVIDER.LINEAR, INTEGRATION_STATUS.CONNECTED);
  listed.set(INTEGRATION_PROVIDER.LINEAR, [{ name: "list_issues", description: "Lists issues." }]);
  const list = await mount();
  const listLine = lineOf(rowNamed(list, "Linear"));
  const page = await mount(false, INTEGRATION_PROVIDER.LINEAR);
  const row = rowNamed(page, "Linear");
  const line = lineOf(row);
  const buttons = rowButtons(row);
  const menu = menuOf(row);

  await choose(row, "Reconnect");

  assert.equal(listLine, "Issues, projects, and cycles");
  assert.equal(line, undefined);
  assert.deepEqual(buttons, []);
  assert.deepEqual(menu, { items: ["Reconnect"], heading: undefined });
  assert.deepEqual(
    sent
      .filter((request) => request.kind === ACT_KIND.INTEGRATIONS_CONNECT)
      .map((request) => request.payload),
    [{ provider: INTEGRATION_PROVIDER.LINEAR }],
  );
});

test("Disconnect on a lone account says what goes before it disconnects", async () => {
  withheld = INTEGRATION_PROVIDER_LIST.filter(
    (provider) => provider !== INTEGRATION_PROVIDER.LINEAR,
  );
  standing.set(INTEGRATION_PROVIDER.LINEAR, INTEGRATION_STATUS.CONNECTED);
  const page = await mount(false, INTEGRATION_PROVIDER.LINEAR);
  await press(rowNamed(page, "Disconnect Linear"), "Disconnect");

  assert.match(
    document.querySelector('[role="alertdialog"]')?.textContent ?? "",
    /Agents lose Linear until you connect it again\./u,
  );
});

test("a sign-in that expired, and a connection its server refused, each show Reconnect on the row, and the expired one's page keeps it beside no ⋯", async () => {
  withheld = INTEGRATION_PROVIDER_LIST.filter(
    (provider) =>
      provider !== INTEGRATION_PROVIDER.NOTION && provider !== INTEGRATION_PROVIDER.SLACK,
  );
  standing.set(INTEGRATION_PROVIDER.NOTION, INTEGRATION_STATUS.EXPIRED);
  standing.set(INTEGRATION_PROVIDER.SLACK, INTEGRATION_STATUS.CONNECTED);
  toolReads.set(INTEGRATION_PROVIDER.SLACK, {
    problem: { reason: INTEGRATION_TOOLS_PROBLEM.REFUSED },
  });
  const list = await mount();
  const expired = rowNamed(list, "Notion");
  const refused = rowNamed(list, "Slack");
  const page = await mount(false, INTEGRATION_PROVIDER.NOTION);
  const account = rowNamed(page, "Notion");

  assert.equal(expired.querySelector(".ui-settings-row-state")?.textContent, "Sign-in expired");
  assert.deepEqual(rowButtons(expired), ["Reconnect"]);
  assert.equal(
    refused.querySelector(".ui-settings-row-state")?.textContent,
    "Slack refused the sign-in.",
  );
  assert.deepEqual(rowButtons(refused), ["Reconnect"]);
  assert.equal(account.querySelector(".ui-settings-row-state")?.textContent, "Sign-in expired");
  assert.deepEqual(rowButtons(account), ["Reconnect"]);
  assert.deepEqual(menuOf(account).items, []);
  assert.deepEqual(rowButtons(rowNamed(page, "Disconnect Notion")), ["Disconnect"]);
});

test("a server's own error stands quoted on a plain line under our sentence, never inside it", async () => {
  withheld = INTEGRATION_PROVIDER_LIST.filter(
    (provider) => provider !== INTEGRATION_PROVIDER.SLACK,
  );
  standing.set(INTEGRATION_PROVIDER.SLACK, INTEGRATION_STATUS.CONNECTED);
  const tools = Promise.withResolvers<IntegrationToolsView>();
  toolReads.set(INTEGRATION_PROVIDER.SLACK, tools.promise);
  const page = await mount();

  tools.resolve({
    problem: {
      reason: INTEGRATION_TOOLS_PROBLEM.REJECTED,
      message: "App is not enabled for Slack MCP server access",
    },
  });

  await vi.waitFor(() => {
    const lines = [...rowNamed(page, "Slack").querySelectorAll(".ui-settings-row-state")].map(
      (line) => [line.textContent, line.getAttribute("data-state")],
    );

    assert.deepEqual(lines, [
      ["Slack could not be reached.", "attention"],
      ["Slack said: “App is not enabled for Slack MCP server access”", "plain"],
    ]);
  });
});

test("a connection whose tools could not be read says so in the attention tint, and Retry reads them again", async () => {
  withheld = INTEGRATION_PROVIDER_LIST.filter(
    (provider) => provider !== INTEGRATION_PROVIDER.LINEAR,
  );
  standing.set(INTEGRATION_PROVIDER.LINEAR, INTEGRATION_STATUS.CONNECTED);
  toolReads.set(INTEGRATION_PROVIDER.LINEAR, { failure: INTEGRATION_CALL_FAILURE.UNANSWERED });
  const page = await mount();
  const row = rowNamed(page, "Linear");
  const state = row.querySelector(".ui-settings-row-state");

  assert.equal(state?.textContent, "The tools could not be read.");
  assert.deepEqual(rowButtons(row), ["Retry"]);

  toolReads.delete(INTEGRATION_PROVIDER.LINEAR);
  listed.set(INTEGRATION_PROVIDER.LINEAR, [{ name: "list_issues", description: "Lists issues." }]);
  const retry = [...row.querySelectorAll("button")].find((each) => each.textContent === "Retry");
  act(() => retry?.click());
  await settle();

  await vi.waitFor(() =>
    assert.equal(lineOf(rowNamed(page, "Linear")), "Issues, projects, and cycles"),
  );
  const mended = rowNamed(page, "Linear");
  assert.deepEqual(rowButtons(mended), []);
});

test("a Connect waits on the browser with Reopen and Cancel, and a Cancel ends the sign-in at the service and leaves Connect", async () => {
  const page = await mount();
  await pressOnGranola(page, "Connect");

  assert.deepEqual(granolaRow(page), WAITING);
  await pressOnGranola(page, "Cancel");
  assert.ok(
    sent.some(
      (request) =>
        request.kind === ACT_KIND.INTEGRATIONS_CANCEL && request.payload.provider === GRANOLA,
    ),
    "the sign-in is ended at the service",
  );
  assert.deepEqual(granolaRow(page), { line: undefined, buttons: ["Connect"] });
  await readMoves();
  assert.deepEqual(granolaRow(page), { line: undefined, buttons: ["Connect"] });
});

test("a sign-in begun on one surface is what every other surface draws at once, and so is its Cancel, with no read between", async () => {
  const settings = await mount();
  const other = await mount();

  await pressOnGranola(settings, "Connect");
  assert.deepEqual(granolaRow(other), WAITING);
  await pressOnGranola(other, "Cancel");
  assert.deepEqual(granolaRow(settings), { line: undefined, buttons: ["Connect"] });
});

test("a sign-out leaves nothing of one account's integrations to the next account signed in", async () => {
  const listeners = new Set<(delivery: AppStateDelivery) => void>();
  fakeAppBridge({
    requestAppState: () =>
      Promise.resolve(signedInAs({ id: "one", email: "one@example.com", name: "One" })),
    onAppState: (listener: (delivery: AppStateDelivery) => void) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
  });
  integrations = holdIntegrations(heldRead);
  const page = await mount();
  await pressOnGranola(page, "Connect");
  assert.deepEqual(granolaRow(page), WAITING);

  touched.clear();

  const next = {
    ...signedInAs({ id: "two", email: "two@example.com", name: "Two" }),
    [LIVE_READ.INTEGRATIONS]: { two: heldRead() ?? assert.fail("the host read the next account") },
  };

  act(() => {
    for (const listener of listeners) listener({ ...deliveryOf(next), version: 2 });
  });
  await settle();
  // Note that the page draws the last account's sign-in until the next account reaches its query.
  await vi.waitFor(() =>
    assert.deepEqual(granolaRow(page), { line: undefined, buttons: ["Connect"] }),
  );
});

test("a Cancel that lands after the sign-in finished leaves the provider connected", async () => {
  listed.set(GRANOLA, [{ name: "list_meetings", description: "Lists meetings." }]);
  const page = await mount();
  await pressOnGranola(page, "Connect");
  touched.set(GRANOLA, INTEGRATION_STATUS.CONNECTED);

  await pressOnGranola(page, "Cancel");
  await vi.waitFor(() => assert.equal(lineOf(granolaRowOf(page)), "Meeting notes and transcripts"));
});

test("a sign-in canceled on Vercel Connect's own page says so plainly, with Retry", async () => {
  const page = await mount();
  await pressOnGranola(page, "Connect");

  touched.set(GRANOLA, INTEGRATION_STATUS.DISCONNECTED);
  signInFailures = [{ provider: GRANOLA, reason: INTEGRATION_SIGN_IN_FAILURE.CANCELED }];
  await readMoves();
  await vi.waitFor(() =>
    assert.deepEqual(granolaRow(page), {
      line: "You canceled connecting Granola.",
      buttons: ["Retry"],
    }),
  );
  // The service names a failure once; the next read leaves the line as it stood.
  await readMoves();
  assert.deepEqual(granolaRow(page), {
    line: "You canceled connecting Granola.",
    buttons: ["Retry"],
  });
});

test("a sign-in Connect refused says so, then Connect's own line quoted under it, with Retry", async () => {
  const page = await mount();
  await pressOnGranola(page, "Connect");

  touched.set(GRANOLA, INTEGRATION_STATUS.DISCONNECTED);
  signInFailures = [
    {
      provider: GRANOLA,
      reason: INTEGRATION_SIGN_IN_FAILURE.ERROR,
      message: "client_assertion aud must be the authorization server issuer",
    },
  ];
  await readMoves();
  await vi.waitFor(() =>
    assert.deepEqual(granolaRow(page), {
      line: "Granola could not be connected.\nGranola's sign-in said: “client_assertion aud must be the authorization server issuer”",
      buttons: ["Retry"],
    }),
  );

  await pressOnGranola(page, "Retry");
  assert.deepEqual(granolaRow(page), WAITING);
});

test("a sign-in the browser came back from without a grant says it could not connect, and why, with Retry", async () => {
  const page = await mount();
  await pressOnGranola(page, "Connect");
  await readMoves();
  assert.deepEqual(granolaRow(page), WAITING, "still pending: still waiting");

  touched.set(GRANOLA, INTEGRATION_STATUS.DISCONNECTED);
  await readMoves();
  await vi.waitFor(() =>
    assert.deepEqual(granolaRow(page), {
      line: "Granola could not be connected: the sign-in came back without access.",
      buttons: ["Retry"],
    }),
  );

  await pressOnGranola(page, "Retry");
  assert.deepEqual(granolaRow(page), WAITING);
});

it.effect(
  "a sign-in still pending once its wait runs out says it did not finish, with Retry, and connects after all if the browser finishes it later",
  () =>
    Effect.gen(function* () {
      listed.set(GRANOLA, [{ name: "list_meetings", description: "Lists meetings." }]);
      serveEffectsOn(Context.make(Clock.Clock, yield* Clock.Clock));
      const page = yield* Effect.promise(() => mount());
      yield* Effect.promise(() => pressOnGranola(page, "Connect"));

      yield* TestClock.adjust(SIGN_IN_WAIT);
      yield* Effect.promise(settle);
      assert.deepEqual(granolaRow(page), {
        line: "Sign-in didn't finish.",
        buttons: ["Retry"],
      });

      touched.set(GRANOLA, INTEGRATION_STATUS.CONNECTED);
      yield* Effect.promise(readMoves);
      yield* Effect.promise(() =>
        vi.waitFor(() => assert.equal(lineOf(granolaRowOf(page)), "Meeting notes and transcripts")),
      );
    }),
);

it.effect(
  "a Cancel that a sign-in begun again elsewhere overtakes keeps waiting on that one, for its own whole wait",
  () =>
    Effect.gen(function* () {
      serveEffectsOn(Context.make(Clock.Clock, yield* Clock.Clock));
      const page = yield* Effect.promise(() => mount());
      yield* Effect.promise(() => pressOnGranola(page, "Connect"));
      yield* TestClock.adjust("2 minutes");

      reopenedDuringCancel = true;
      yield* Effect.promise(() => pressOnGranola(page, "Cancel"));
      yield* TestClock.adjust("2 minutes");
      yield* Effect.promise(settle);
      assert.deepEqual(
        granolaRow(page),
        WAITING,
        "past the first sign-in's deadline, still waiting",
      );

      yield* TestClock.adjust("1 minute");
      yield* Effect.promise(settle);
      assert.equal(granolaRow(page).line, "Sign-in didn't finish.");
    }),
);

it.effect("a sign-in begun later does not put off the deadline of one begun before it", () =>
  Effect.gen(function* () {
    serveEffectsOn(Context.make(Clock.Clock, yield* Clock.Clock));
    const page = yield* Effect.promise(() => mount());
    yield* Effect.promise(() => pressOnGranola(page, "Connect"));
    yield* TestClock.adjust("2 minutes");

    const linear =
      [...page.querySelectorAll(".ui-settings-row")]
        .find((row) => nameOf(row.querySelector('[id$="label"]')) === "Linear")
        ?.querySelector("button") ?? assert.fail("Linear offers Connect");

    act(() => linear.click());
    yield* Effect.promise(settle);

    yield* TestClock.adjust("1 minute");
    yield* Effect.promise(settle);
    assert.deepEqual(granolaRow(page), {
      line: "Sign-in didn't finish.",
      buttons: ["Retry"],
    });
    assert.ok(
      page.textContent?.includes("Waiting for Linear in your browser…"),
      "Linear still waits its own three minutes",
    );
  }),
);

/** Vercel and Linear connected, their servers listing a tool each. */
function connectVercelAndLinear(): void {
  touched.set(INTEGRATION_PROVIDER.VERCEL, INTEGRATION_STATUS.CONNECTED);
  touched.set(INTEGRATION_PROVIDER.LINEAR, INTEGRATION_STATUS.CONNECTED);
  listed.set(INTEGRATION_PROVIDER.VERCEL, [
    { name: "list_projects", description: "Lists projects." },
  ]);
  listed.set(INTEGRATION_PROVIDER.LINEAR, [{ name: "list_issues", description: "Lists issues." }]);
}

/** The row named `name`, as the page draws it. */
function rowNamed(page: HTMLElement, name: string): Element {
  return (
    [...page.querySelectorAll(".ui-settings-row")].find(
      (row) => nameOf(row.querySelector('[id$="label"]')) === name,
    ) ?? assert.fail(`${name} has a row`)
  );
}

/** The page's search field. */
function searchField(page: HTMLElement): HTMLInputElement {
  return (
    page.querySelector<HTMLInputElement>('input[aria-label="Search integrations"]') ??
    assert.fail("the page draws its search field")
  );
}

/** Types `query` over whatever the page's search field holds, as the developer would. */
async function searchFor(page: HTMLElement, query: string): Promise<void> {
  const field = searchField(page);
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, query);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}

/** The sections the page draws, each its heading and the names of its rows. */
function sections(page: HTMLElement) {
  return [...page.querySelectorAll(".ui-settings-section")].map((group) => [
    group.querySelector("h2")?.textContent,
    [...group.querySelectorAll('[id$="label"]')].map(nameOf),
  ]);
}

test("the rows stand under Connected and Not connected, each section in the order of their names", async () => {
  connectVercelAndLinear();

  const offered: readonly IntegrationProvider[] = [
    INTEGRATION_PROVIDER.VERCEL,
    INTEGRATION_PROVIDER.MERCURY,
    INTEGRATION_PROVIDER.LINEAR,
    GRANOLA,
  ];

  withheld = INTEGRATION_PROVIDER_LIST.filter((provider) => !offered.includes(provider));
  const page = await mount();

  assert.deepEqual(sections(page), [
    ["Connected", ["Linear", "Vercel"]],
    ["Not connected", ["Granola", "Mercury"]],
  ]);
});

test("a query keeps only the rows it found, its words marked in their names", async () => {
  connectVercelAndLinear();
  const page = await mount();

  await searchFor(page, "verc");

  assert.deepEqual(sections(page), [["Connected", ["Vercel"]]]);
  assert.equal(rowNamed(page, "Vercel").querySelector("mark")?.textContent, "Verc");
});

test("a query finds an integration by what it is for, keeping its section", async () => {
  connectVercelAndLinear();
  const page = await mount();

  await searchFor(page, "database");

  assert.deepEqual(sections(page), [["Not connected", ["Neon", "Notion", "Supabase"]]]);

  // The line a row says of what it gives agents finds it too.
  await searchFor(page, "invitations");

  assert.deepEqual(sections(page), [["Not connected", ["Google Calendar"]]]);
});

test("a query that finds nothing says so, and clearing it brings every row back", async () => {
  connectVercelAndLinear();
  mountAnnouncer();
  const page = await mount();

  await searchFor(page, "frobnicate");

  assert.deepEqual(sections(page), []);
  assert.equal(page.textContent?.includes("No integrations match “frobnicate”"), true);
  assert.equal(announcedPolitely(), "No integrations match “frobnicate”");

  const clear =
    page.querySelector<HTMLButtonElement>('button[aria-label="Clear search"]') ??
    assert.fail("a query offers to clear it");

  act(() => clear.click());
  await settle();

  assert.equal(rowNames(page).length, INTEGRATION_PROVIDER_LIST.length);
  assert.equal(document.activeElement === searchField(page), true);
  assert.equal(announcedPolitely(), "", "the words go once the rows are back");
});

test("while where the providers stand is read, the search stands usable above placeholder sections, and the rows land in their place", async () => {
  holdReads = true;
  const page = await mount();

  const status = page.querySelector('[role="status"]') ?? assert.fail("no placeholder");
  assert.equal(status.textContent, "Reading the integrations");
  assert.equal(status.querySelectorAll(".ui-settings-section-card").length, 2);
  // Note that the field is checked as a yes or no, because a failure's diff of an element would print the whole document.
  assert.equal(searchField(page).closest('[aria-busy="true"]') === null, true);
  await searchFor(page, "linear");
  assert.equal(searchField(page).value, "linear");

  holdReads = false;
  await readMoves();

  await vi.waitFor(() => assert.equal(readSettled(page), true));
  assert.equal(page.querySelector('[role="status"]') === null, true);
  assert.deepEqual(rowNames(page), ["Linear"]);
});

test("Command-F lands in the page's search, and Escape clears it, then lets go of the caret, never reaching the window", async () => {
  connectVercelAndLinear();
  const page = await mount();
  const reachedWindow: string[] = [];
  const listen = (event: KeyboardEvent) => reachedWindow.push(event.key);
  window.addEventListener("keydown", listen);

  const pressEscape = () =>
    act(() => {
      searchField(page).dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

  let offered = false;
  act(() => {
    offered = runAppCommand(APP_COMMAND.FIND);
  });
  assert.equal(offered, true);
  assert.equal(document.activeElement === searchField(page), true);

  await searchFor(page, "deploy");
  pressEscape();
  await settle();
  assert.equal(searchField(page).value, "");
  assert.equal(document.activeElement === searchField(page), true);
  assert.equal(rowNames(page).length, INTEGRATION_PROVIDER_LIST.length);

  pressEscape();
  assert.equal(document.activeElement !== searchField(page), true);
  window.removeEventListener("keydown", listen);
  assert.deepEqual(reachedWindow, []);
});

test("two accounts at a provider stand as one row naming both, whose page offers each Rename, Reconnect, and Disconnect in its ⋯, and Add account at their head", async () => {
  const notion = INTEGRATION_PROVIDER.NOTION;
  standing.set(notion, INTEGRATION_STATUS.CONNECTED);
  addable = [notion];
  accounts = [
    { provider: notion, connection: "notion", label: "Acme", status: INTEGRATION_STATUS.CONNECTED },
    {
      provider: notion,
      connection: "notion-2",
      label: "Personal",
      status: INTEGRATION_STATUS.CONNECTED,
    },
  ];
  listed.set(notion, [{ name: "search", description: "Searches pages." }]);
  const list = await mount();
  const row = rowNamed(list, "Notion · Acme and Personal");
  const page = await mount(false, notion);

  assert.equal(lineOf(row), "Pages, databases, and comments");
  assert.deepEqual(rowButtons(row), []);

  for (const label of ["Acme", "Personal"]) {
    assert.deepEqual(menuOf(rowNamed(page, label)).items, ["Rename", "Reconnect", "Disconnect"]);
  }

  // Two accounts are two rows, each keeping its Disconnect in its ⋯ rather than a row of its own.
  assert.deepEqual(rowNames(page), ["Acme", "Personal"]);
  await choose(rowNamed(page, "Personal"), "Disconnect");
  assert.match(
    document.querySelector('[role="alertdialog"]')?.textContent ?? "",
    /Agents lose this account\. Your other Notion accounts stay connected\./u,
  );

  await addAccount(page);
  const connects = sent.filter((request) => request.kind === ACT_KIND.INTEGRATIONS_CONNECT);
  assert.deepEqual(
    connects.map((request) => request.payload),
    [{ provider: notion, add: true }],
  );
  // The new account stands pending under the name the service gave it, as a row of its own.
  assert.deepEqual(rowButtons(rowNamed(page, "Account 3")), ["Reopen", "Cancel"]);
});

test("an account alone at its provider is named by its label where it carries one, and by its provider alone where it carries none", async () => {
  const gmail = INTEGRATION_PROVIDER.GMAIL;
  const notion = INTEGRATION_PROVIDER.NOTION;
  standing.set(gmail, INTEGRATION_STATUS.CONNECTED);
  standing.set(notion, INTEGRATION_STATUS.CONNECTED);
  accounts = [
    {
      provider: gmail,
      connection: "gmail",
      label: "dean@example.com",
      status: INTEGRATION_STATUS.CONNECTED,
    },
    { provider: notion, connection: "notion", status: INTEGRATION_STATUS.CONNECTED },
  ];
  const page = await mount();
  const names = [...page.querySelectorAll('[id$="label"]')].map(nameOf);

  assert.ok(names.includes("Gmail · dean@example.com"));
  assert.ok(names.includes("Notion"));
  assert.ok(!names.some((name) => name?.includes("Account 1")));
});

test("an account renamed from its row's ⋯ is named in place: Escape keeps its name, and Return asks for the new one, which the row then says", async () => {
  const notion = INTEGRATION_PROVIDER.NOTION;
  standing.set(notion, INTEGRATION_STATUS.CONNECTED);
  accounts = [
    { provider: notion, connection: "notion", label: "Acme", status: INTEGRATION_STATUS.CONNECTED },
    {
      provider: notion,
      connection: "notion-2",
      label: "Personal",
      status: INTEGRATION_STATUS.CONNECTED,
    },
  ];
  const page = await mount(false, notion);
  const rowOf = (label: string) => rowNamed(page, label);

  const field = () =>
    page.querySelector<HTMLInputElement>('input[aria-label="Notion · Acme account name"]');

  const press = (key: string) =>
    act(() => {
      (field() ?? assert.fail("the name's field is open")).dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
    });

  const renames = () =>
    sent
      .filter((request) => request.kind === ACT_KIND.INTEGRATIONS_RENAME)
      .map((request) => request.payload);

  await choose(rowOf("Acme"), "Rename");
  const opened = field() ?? assert.fail("Rename opens the name's field");
  assert.equal(document.activeElement === opened, true);
  assert.equal(opened.value, "Acme");
  press("Escape");
  await settle();
  assert.equal(field(), null);
  assert.deepEqual(renames(), []);

  await choose(rowOf("Acme"), "Rename");
  const typing = field() ?? assert.fail("Rename opens the name's field again");
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(typing, "Work");
    typing.dispatchEvent(new Event("input", { bubbles: true }));
  });
  press("Enter");
  await settle();
  assert.equal(field(), null);
  assert.deepEqual(renames(), [{ provider: notion, connection: "notion", label: "Work" }]);
  await vi.waitFor(() => rowOf("Work"));
});

test("a refused rename says the account could not be renamed and what to do, in the one failure sentence", async () => {
  const notion = INTEGRATION_PROVIDER.NOTION;
  standing.set(notion, INTEGRATION_STATUS.CONNECTED);
  accounts = [
    { provider: notion, connection: "notion", label: "Acme", status: INTEGRATION_STATUS.CONNECTED },
    {
      provider: notion,
      connection: "notion-2",
      label: "Personal",
      status: INTEGRATION_STATUS.CONNECTED,
    },
  ];
  refuseRename = true;
  const page = await mount(false, notion);
  const row = rowNamed(page, "Acme");

  await choose(row, "Rename");

  const field =
    page.querySelector<HTMLInputElement>('input[aria-label="Notion · Acme account name"]') ??
    assert.fail("no name field");

  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, "Work");
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
  });
  await settle();

  assert.match(page.textContent ?? "", /Notion · Acme could not be renamed\. Try again\./u);
});

test("an added account whose first sign-in Connect refused keeps its row with the reason and Retry, which signs in a new account", async () => {
  const notion = INTEGRATION_PROVIDER.NOTION;
  standing.set(notion, INTEGRATION_STATUS.CONNECTED);
  addable = [notion];
  accounts = [
    {
      provider: notion,
      connection: "notion",
      label: "Acme",

      status: INTEGRATION_STATUS.CONNECTED,
    },
  ];
  const page = await mount(false, notion);
  await addAccount(page);

  // The service ended the refused sign-in and deleted its row, naming the failure once.
  signInFailures = [
    {
      provider: notion,
      connection: "notion-3",
      reason: INTEGRATION_SIGN_IN_FAILURE.ERROR,
      message: "access_denied",
    },
  ];
  await readMoves();

  const addedRow = () =>
    [...page.querySelectorAll(".ui-settings-row")].find(
      (row) => nameOf(row.querySelector('[id$="label"]')) === "Account 3",
    ) ?? assert.fail("the refused account keeps its row");

  await vi.waitFor(() => assert.match(stateLines(addedRow()) ?? "", /access_denied/u));
  const added = addedRow();

  sent = [];
  act(() =>
    (
      [...added.querySelectorAll("button")].find((button) => button.textContent === "Retry") ??
      assert.fail("no Retry")
    ).click(),
  );
  await settle();
  assert.deepEqual(
    sent
      .filter((request) => request.kind === ACT_KIND.INTEGRATIONS_CONNECT)
      .map((request) => request.payload),
    [{ provider: notion, add: true }],
  );
});

test("an account added under the provider's own name, beside one that stands, waits as a row of its own with Reopen and Cancel", async () => {
  const notion = INTEGRATION_PROVIDER.NOTION;
  standing.set(notion, INTEGRATION_STATUS.DISCONNECTED);
  addable = [notion];
  addedConnection = notion;
  accounts = [
    {
      provider: notion,
      connection: "notion-2",
      label: "Personal",
      status: INTEGRATION_STATUS.CONNECTED,
    },
  ];
  const page = await mount(false, notion);
  await addAccount(page);
  const added = rowNamed(page, "Account 1");

  assert.deepEqual(
    [...added.querySelectorAll("button")].flatMap(({ textContent: text }) =>
      text === "Reopen" || text === "Cancel" ? [text] : [],
    ),
    ["Reopen", "Cancel"],
  );
});

test("an added account whose first sign-in is canceled leaves its row, so the next one is added rather than reopened", async () => {
  const notion = INTEGRATION_PROVIDER.NOTION;
  standing.set(notion, INTEGRATION_STATUS.CONNECTED);
  addable = [notion];
  canceled.set("notion-2", INTEGRATION_STATUS.DISCONNECTED);
  accounts = [
    {
      provider: notion,
      connection: "notion",
      label: "Acme",
      status: INTEGRATION_STATUS.CONNECTED,
    },
    {
      provider: notion,
      connection: "notion-2",
      status: INTEGRATION_STATUS.PENDING,
    },
  ];
  const page = await mount(false, notion);
  const pending = rowNamed(page, "Account 2");

  // The service deletes the canceled first sign-in's account, so its next read lists Acme alone.
  accounts = accounts.slice(0, 1);
  act(() =>
    (
      [...pending.querySelectorAll("button")].find((button) => button.textContent === "Cancel") ??
      assert.fail("no Cancel")
    ).click(),
  );
  await settle();

  await vi.waitFor(() =>
    assert.equal(
      [...page.querySelectorAll('[id$="label"]')].some((name) => nameOf(name) === "Account 2"),
      false,
    ),
  );
});

test("a canceled sign-in that held a provider's last place frees it at once, offering Add account again", async () => {
  const notion = INTEGRATION_PROVIDER.NOTION;
  standing.set(notion, INTEGRATION_STATUS.CONNECTED);
  canceled.set("notion-5", INTEGRATION_STATUS.DISCONNECTED);
  accounts = [1, 2, 3, 4, 5].map((place) => ({
    provider: notion,
    connection: place === 1 ? notion : `notion-${place}`,
    label: `Workspace ${place}`,
    status: place === 5 ? INTEGRATION_STATUS.PENDING : INTEGRATION_STATUS.CONNECTED,
  }));
  const page = await mount(false, notion);
  assert.equal(addAccountButton(page), undefined);

  // The service's next read counts four accounts, so the provider is addable again.
  accounts = accounts.slice(0, 4);
  addable = [notion];
  act(() =>
    (
      [...rowNamed(page, "Workspace 5").querySelectorAll("button")].find(
        (button) => button.textContent === "Cancel",
      ) ?? assert.fail("no Cancel")
    ).click(),
  );
  await settle();

  await vi.waitFor(() => assert.notEqual(addAccountButton(page), undefined));
});

test("Reopen on an added account still waiting on its first sign-in reopens that account, never adds another", async () => {
  const notion = INTEGRATION_PROVIDER.NOTION;
  standing.set(notion, INTEGRATION_STATUS.CONNECTED);
  addable = [notion];
  accounts = [
    {
      provider: notion,
      connection: "notion",
      label: "Acme",
      status: INTEGRATION_STATUS.CONNECTED,
    },
  ];
  const page = await mount(false, notion);
  await addAccount(page);

  const added =
    [...page.querySelectorAll(".ui-settings-row")].find(
      (row) => nameOf(row.querySelector('[id$="label"]')) === "Account 3",
    ) ?? assert.fail("the account added has a row");

  sent = [];
  act(() =>
    (
      [...added.querySelectorAll("button")].find((button) => button.textContent === "Reopen") ??
      assert.fail("no Reopen")
    ).click(),
  );
  await settle();
  assert.deepEqual(
    sent
      .filter((request) => request.kind === ACT_KIND.INTEGRATIONS_CONNECT)
      .map((request) => request.payload),
    [{ provider: notion, connection: "notion-3" }],
  );
});
