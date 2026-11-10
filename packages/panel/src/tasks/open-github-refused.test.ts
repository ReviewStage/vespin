// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CHECK_SUMMARY, PULL_REQUEST_STATE } from "@repo/features/agent-wire";
import { ACT_KIND } from "@repo/host/acts";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { appPlatform } from "../app-platform.js";
import { fakeActPort, refusedOnPort } from "../testing/app-bridge.js";
import { DESKTOP_LINKS, fakeAppPlatform } from "../testing/app-platform.js";
import { withQueryClient } from "../testing/copy-feedback.js";
import { ToastHost } from "../toast.js";
import { type PublishedDoors, PublishedRow } from "./agent-published.js";

/**
 * open-github-refused.test.ts -- a person who presses a pull request's row
 * where it opens on GitHub is told in a toast when the host refuses the
 * open, in the host's own words, rather than the press doing nothing.
 * Synthetic repository.
 */

const PULL_REQUEST = {
  number: 42,
  title: "Expire invitations",
  url: "https://github.com/acme/relay/pull/42",
  state: PULL_REQUEST_STATE.OPEN,
  checks: CHECK_SUMMARY.PASSING,
  additions: 3,
  deletions: 1,
  changedFiles: 2,
};

const REFUSAL = "That address is not one Vespin opens.";

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** The pull request's row over the doors the desktop's window hands it where no panel takes its tab, beside the window's toasts. */
async function mountRow(): Promise<HTMLElement> {
  fakeAppPlatform(DESKTOP_LINKS);
  const doors: PublishedDoors = {
    openGitHub: (url) => appPlatform().openGitHub(url),
    copy: () => undefined,
  };
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  await act(async () =>
    root.render(
      createElement(
        Fragment,
        null,
        withQueryClient(
          createElement(PublishedRow, {
            pullRequest: PULL_REQUEST,
            branch: "luke/expiry-job",
            doors,
          }),
        ),
        withQueryClient(createElement(ToastHost)),
      ),
    ),
  );
  return (
    container.querySelector<HTMLElement>("a, button") ??
    assert.fail("the pull request's row stands as a press")
  );
}

/** What each toast standing says, oldest first. */
function toasts(): string[] {
  return [...document.querySelectorAll(".ui-toast:not([data-leaving]) .ui-toast-words")].map(
    (words) => words.textContent ?? "",
  );
}

test("a refused Open on GitHub raises a toast saying why", async () => {
  fakeActPort({ [ACT_KIND.GITHUB_OPEN]: () => Promise.reject(refusedOnPort(REFUSAL)) });
  const row = await mountRow();

  await act(async () => row.click());

  assert.ok(toasts().includes(REFUSAL), `toasts stood: ${toasts().join(" | ")}`);
});

test("an Open on GitHub the host takes raises no toast", async () => {
  const opened: string[] = [];
  fakeActPort({
    [ACT_KIND.GITHUB_OPEN]: ({ url }) => {
      opened.push(url);
      return Promise.resolve();
    },
  });
  const row = await mountRow();
  // The window's toasts outlive a test, so a toast a test before left standing is not this press's.
  const before = toasts();

  await act(async () => row.click());

  assert.deepEqual(opened, [PULL_REQUEST.url]);
  assert.deepEqual(toasts(), before);
});
