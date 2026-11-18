// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_PROVIDER, ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import {
  GITHUB_TOKEN_REJECTION,
  GITHUB_TOKEN_STATUS,
  type GitHubTokenRejection,
  type GitHubTokenSummary,
} from "@repo/features/github-token-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { PortActKind } from "@repo/host/contract";
import type { SettingsLink } from "@repo/settings/settings-views";
import { showsInReplay } from "@repo/ui/session-replay-marks";
import { holdExits } from "@repo/ui/testing/held-exits";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { OpenSettingsProvider } from "../open-settings.js";
import { fakeActPort, fakeActPortCalls } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { handState, holdGitHubToken } from "../testing/app-state.js";
import { withQueryClient } from "../testing/copy-feedback.js";
import { holdMotion, releaseMotion } from "../testing/motion-held.js";
import { chooseMenuItem } from "../testing/phone-head.js";
import { AccountSection } from "./account-section.js";

/**
 * Settings › Profile's GitHub personal access token row and its dialog, over
 * a bridge answering as the host would, the token held on app state and each
 * write's answer laid there: the row offers Add with no token and
 * a ⋯ with one, whose row says whose token it is, its end, and its expiry; a
 * pasted token is sent once from a password field; Disconnect, in the ⋯, asks first; a refused
 * save says why in a short label. Synthetic tokens.
 */

const PASTED = "synthetic-classic-token-0000000000wxyz";

/** The account signed in, whose token the host holds. */
const ADA = {
  status: ACCOUNT_STATUS.SIGNED_IN,
  id: "user-ada",
  email: "ada@example.com",
  name: "Ada",
  provider: ACCOUNT_PROVIDER.GOOGLE,
} as const;

const KEPT: GitHubTokenSummary = {
  login: "octo-member",
  hint: "ghp_…wxyz",
  status: GITHUB_TOKEN_STATUS.VERIFIED,
  statusAt: Date.UTC(2026, 9, 19, 12),
  addedAt: Date.UTC(2026, 9, 19, 12),
  expiresAt: Date.UTC(2026, 11, 18, 12),
};

/** The token the test's service holds. */
let stored: GitHubTokenSummary | null = null;

/** Every act the dialog sent, in order. */
let sent: { kind: PortActKind; payload: unknown }[] = [];

/** Why the service keeps nothing of the next save, where it refuses one. */
let refuseSave: GitHubTokenRejection | undefined;

/** How many of the next reads go unanswered. */
let unansweredReads = 0;

/** Whether the host holds no read of the token at all, as after a sign-out. */
let cleared = false;

/** Lays the token on the window's document, as the host lays its read and each write's answer. */
let layToken: () => void = () => undefined;

/** Every place in Settings the window was asked to open, in order. */
let opened: SettingsLink[] = [];

const roots: Root[] = [];

beforeEach(() => {
  fakeAppPlatform(QUIET_PANEL);
  stored = null;
  sent = [];
  refuseSave = undefined;
  unansweredReads = 0;
  cleared = false;
  opened = [];
  handState({}, { account: ADA });
  // Note that the token is laid as the host holds it, and a write's answer is laid before it answers.
  layToken = holdGitHubToken(() => {
    if (cleared) return undefined;

    if (unansweredReads === 0) return { rows: { token: stored } };
    unansweredReads -= 1;

    return { failed: true };
  }).lay;
  fakeActPort({
    ...fakeActPortCalls(),
    [ACT_KIND.GITHUB_TOKEN_SAVE]: (payload) => {
      sent.push({ kind: ACT_KIND.GITHUB_TOKEN_SAVE, payload });

      if (refuseSave !== undefined) return Promise.resolve({ token: stored, rejected: refuseSave });
      stored = KEPT;
      layToken();

      return Promise.resolve({ token: stored });
    },
    [ACT_KIND.GITHUB_TOKEN_REMOVE]: (payload) => {
      sent.push({ kind: ACT_KIND.GITHUB_TOKEN_REMOVE, payload });
      stored = null;
      layToken();

      return Promise.resolve({ token: null });
    },
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  releaseMotion();
  vi.useRealTimers();
  Reflect.deleteProperty(Element.prototype, "getAnimations");
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** Profile's account section, its token row read, with the dialog opened by the row's one button. */
async function mountAndOpen(open = true): Promise<void> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      withQueryClient(
        createElement(
          OpenSettingsProvider,
          { value: (link: SettingsLink) => opened.push(link) },
          createElement(AccountSection, {
            account: ADA,
            onSignOut: () => Promise.resolve(),
          }),
        ),
      ),
    ),
  );
  await settle();
  // Note that the row draws its press, or its Retry, once the token the host holds reaches its query.
  await vi.waitFor(() =>
    assert.equal(
      [...document.querySelectorAll("button")].some((each) =>
        ["Add", "Retry"].includes(each.textContent ?? ""),
      ) || document.querySelector(MORE) !== null,
      true,
    ),
  );

  if (!open) return;

  if (stored === null) act(() => button("Add").click());
  await settle();
}

const MORE = '[aria-label="GitHub personal access token actions"]';

/** The row's ⋯, opened. */
function openMore(): void {
  const more = document.querySelector<HTMLButtonElement>(MORE) ?? assert.fail("no ⋯ on the row");
  act(() => more.click());
}

const dialog = () => document.querySelector('[role="dialog"]') ?? assert.fail("no dialog");

/** The field its visible label names, as a reader finds it. */
const tokenField = () => {
  const label = [...document.querySelectorAll("label")].find(
    (each) => each.textContent === "Paste the token",
  );

  return label?.control instanceof HTMLInputElement ? label.control : null;
};

const drawn = (words: string) =>
  [...document.querySelectorAll("button")].some((each) => each.textContent === words);

const button = (words: string, within: ParentNode = document) =>
  [...within.querySelectorAll<HTMLButtonElement>("button")].find(
    (each) => each.textContent === words,
  ) ?? assert.fail(`no ${words} button`);

async function paste(token: string): Promise<void> {
  const input = tokenField() ?? assert.fail("no token field");
  act(() => {
    // Note that the value goes through the element's own setter, as typing does, so React hears it.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, token);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => input.form?.requestSubmit());
  await settle();
}

test("with no token the row offers Add, and a token pasted into the field is sent once and drawn as the service's facts on the row", async () => {
  await mountAndOpen();
  assert.equal(dialog().querySelector("h2")?.textContent, "Personal access token");
  assert.match(dialog().textContent ?? "", /Create a classic token with repo tickedOpen GitHub/u);

  const input = tokenField() ?? assert.fail("no token field");
  assert.equal(input.type, "password");
  await paste(PASTED);

  assert.deepEqual(
    sent.filter((each) => each.kind === ACT_KIND.GITHUB_TOKEN_SAVE).map((each) => each.payload),
    [{ token: PASTED }],
  );
  // Note that the form gives way once the token the host lays after the save reaches its query.
  await vi.waitFor(() => assert.equal(tokenField() === null, true, "the field closes"));
  assert.match(
    document.body.textContent ?? "",
    /octo-member's token ending ghp_…wxyz, expires [A-Z][a-z]{2} \d{1,2}, \d{4}/u,
  );
  assert.ok(document.querySelector(MORE), "the saved token has a ⋯");
  assert.equal(document.querySelector('[role="dialog"]'), null, "the dialog closes once kept");
  assert.ok(!document.body.innerHTML.includes(PASTED), "the page holds the token nowhere");
});

test("a saved token's row tells its facts masked and with no dot, and its ⋯ holds Disconnect, which asks first, then takes it away", async () => {
  stored = KEPT;
  await mountAndOpen(false);
  assert.equal(drawn("Manage"), false, "no Manage button stands on the row");
  assert.equal(drawn("Disconnect"), false, "Disconnect is not beside the row");

  const facts = [...document.querySelectorAll("*")].findLast((node) =>
    node.textContent?.startsWith("octo-member's token ending"),
  );

  assert.ok(facts, "the row tells the token's facts");
  assert.ok(!(facts.textContent ?? "").includes("·"), "no dot divides them");
  assert.equal(showsInReplay(facts), false, "the facts are masked");

  openMore();
  chooseMenuItem("Disconnect");
  await settle();
  assert.equal(sent.filter((each) => each.kind === ACT_KIND.GITHUB_TOKEN_REMOVE).length, 0);
  const question = document.querySelector('[role="alertdialog"]') ?? assert.fail("no question");
  assert.match(question.textContent ?? "", /Disconnect your GitHub token\?/u);
  assert.match(question.textContent ?? "", /Vespin deletes the token it holds/u);

  act(() => button("Cancel", question).click());
  await settle();
  assert.equal(sent.filter((each) => each.kind === ACT_KIND.GITHUB_TOKEN_REMOVE).length, 0);

  openMore();
  chooseMenuItem("Disconnect");
  await settle();
  act(() =>
    button(
      "Disconnect token",
      document.querySelector('[role="alertdialog"]') ?? assert.fail("no question"),
    ).click(),
  );
  await settle();
  assert.equal(sent.filter((each) => each.kind === ACT_KIND.GITHUB_TOKEN_REMOVE).length, 1);
  await vi.waitFor(() => button("Add"));
  assert.equal(document.querySelector('[role="dialog"]'), null, "Add's dialog stays shut");
});

test("a Disconnect question closes when the token it was asked about is replaced elsewhere", async () => {
  stored = KEPT;
  await mountAndOpen(false);
  openMore();
  chooseMenuItem("Disconnect");
  await settle();
  assert.equal(document.querySelector('[role="alertdialog"]') !== null, true);

  stored = { ...KEPT, hint: "ghp_…abcd", addedAt: KEPT.addedAt + 1000 };
  act(() => layToken());
  await settle();
  await vi.waitFor(() =>
    assert.equal(document.querySelector('[role="alertdialog"]') === null, true),
  );
  assert.equal(sent.filter((each) => each.kind === ACT_KIND.GITHUB_TOKEN_REMOVE).length, 0);
});

test("each refused save says why and what to do next, and keeps the field", async () => {
  await mountAndOpen();
  const said = new Map<string, string | undefined>();

  for (const rejection of Object.values(GITHUB_TOKEN_REJECTION)) {
    refuseSave = rejection;
    await paste(PASTED);
    said.set(
      rejection,
      document.getElementById(tokenField()?.getAttribute("aria-describedby") ?? "")?.textContent ??
        undefined,
    );
    assert.ok(tokenField(), "the field stands as pasted");
  }

  assert.deepEqual(Object.fromEntries(said), {
    fine_grained: "This isn't a classic token. Create a classic token and paste that.",
    invalid: "GitHub rejected this token. Check that you copied all of it, or create a new one.",
    no_repo_scope: "This token is missing the repo scope. Create a new token with repo ticked.",
    unreachable: "GitHub could not be reached. Try again.",
    too_many_tries: "Too many tokens tried in the last hour. Try again later.",
  });
});

test("a paste too short to be a token says GitHub's invalid words, and is sent nowhere", async () => {
  await mountAndOpen();
  await paste("ghp_bad");
  assert.match(dialog().textContent ?? "", /GitHub rejected this token\./u);
  assert.deepEqual(sent, []);
});

test("a saved token GitHub rejected says to disconnect it and add a new one", async () => {
  stored = { ...KEPT, status: GITHUB_TOKEN_STATUS.INVALID };
  await mountAndOpen();

  assert.match(
    document.body.textContent ?? "",
    /GitHub rejected this token\. Disconnect it and add a new one\./u,
  );
});

test("a saved token Vespin can no longer read says to disconnect it and add it again", async () => {
  stored = { ...KEPT, status: GITHUB_TOKEN_STATUS.UNREADABLE };
  await mountAndOpen();

  assert.match(
    document.body.textContent ?? "",
    /Can no longer be read\. Disconnect it and add it again\./u,
  );
});

test("a read that went unanswered says so as an alert with Retry in place of Add, which reads the token again", async () => {
  unansweredReads = 1;
  await mountAndOpen(false);
  assert.equal(
    [...document.querySelectorAll("button")].some((each) => each.textContent === "Add"),
    false,
  );
  assert.equal(
    document.querySelector('[role="alert"]')?.textContent,
    "The token could not be read.Retry",
  );

  act(() => button("Retry").click());
  await settle();
  // Note that Add stands once the token read again reaches its query.
  await vi.waitFor(() => button("Add"));
});

test("a token the host clears, as a sign-out does, is drawn no more", async () => {
  stored = KEPT;
  await mountAndOpen(false);
  assert.ok(document.querySelector(MORE));

  cleared = true;
  act(() => layToken());
  await settle();
  await vi.waitFor(() => assert.equal(document.querySelector(MORE) === null, true));
  assert.ok(!(document.body.textContent ?? "").includes("octo-member"), "the token is gone");
});

test("the row draws no other account's token when Profile is drawn for another account", async () => {
  stored = KEPT;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);

  const draw = (id: string) =>
    act(() =>
      root.render(
        withQueryClient(
          createElement(AccountSection, {
            account: {
              status: ACCOUNT_STATUS.SIGNED_IN,
              id,
              email: `${id}@example.com`,
              name: id,
              provider: ACCOUNT_PROVIDER.GOOGLE,
            },
            onSignOut: () => Promise.resolve(),
          }),
        ),
      ),
    );

  draw(ADA.id);
  await settle();
  await vi.waitFor(() => assert.ok(document.querySelector(MORE)));

  draw("user-bea");
  await settle();
  assert.equal(container.querySelector(MORE) === null, true);
  assert.ok(!(container.textContent ?? "").includes("octo-member"), "Ada's token is gone");
});

/** The token dialog opened from the row's Add, which held focus as it was pressed, and then put away by its Done. */
async function openedThenDone(): Promise<HTMLButtonElement> {
  await mountAndOpen(false);
  const opener = button("Add");
  opener.focus();
  act(() => opener.click());
  await settle();
  act(() => button("Done").click());

  return opener;
}

test("Done fades the token dialog out, still drawn and in its ending state, then takes it away with focus back on its button", async () => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
  const exits = holdExits();
  const opener = await openedThenDone();
  const fading = document.querySelector('[role="dialog"]');
  act(() => vi.advanceTimersToNextFrame());
  const stillDrawn = document.querySelector('[role="dialog"]') !== null;
  await act(async () => exits.finish());

  assert.ok(fading, "the dialog stands while it fades");
  assert.equal(stillDrawn, true, "it stays until its fade has run");
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.equal(document.activeElement, opener, "focus is back on the button that opened it");
});

test("Done takes the token dialog away at once where motion is held", async () => {
  holdExits();
  holdMotion();
  const opener = await openedThenDone();

  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.equal(document.activeElement, opener);
});
