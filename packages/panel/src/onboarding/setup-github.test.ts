// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  GITHUB_ACCESS,
  type GitHubAccess,
  type GitHubRepository,
  type WorkspaceTokenRepository,
} from "@repo/features/github-repositories-wire";
import { GITHUB_TOKEN_STATUS } from "@repo/features/github-token-wire";
import { ACT_KIND } from "@repo/host/acts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { fakeActPort, fakeActPortCalls, fakeAppBridge } from "../testing/app-bridge.js";
import { handHostReads, holdGitHubToken, holdRepositoryLists } from "../testing/app-state.js";
import { settleQueries, withQueryClient } from "../testing/copy-feedback.js";
import { GitHubSetup } from "./setup-github.js";

/**
 * Setup's GitHub step over a workspace the App reaches: GitHub's row
 * counting the repositories, every one listed under it, and its Add
 * repositories going back to GitHub. The token's paste, which refuses what
 * no token could be. And the token's picker, which adds several
 * repositories in one open menu, stands as the row's Add repositories once
 * they are reached, and keeps the token's card through Back; the shared
 * menu's checks and words are New task's tests' to hold. Synthetic
 * throughout.
 */

const WORKSPACE = "workspace-acme";

const roots: Root[] = [];

beforeEach(() => {
  fakeAppBridge({});
  fakeActPort({});
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

/** Lets every promise settled so far run its continuations, and every notification TanStack Query queued reach what it draws. */
async function settle(): Promise<void> {
  const ticks = () =>
    act(async () => {
      for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
    });

  await ticks();
  await settleQueries(ticks);
}

test("a workspace the App reaches draws GitHub's row counting its repositories, each listed under it by whole name with the token's marked, and its Add repositories opens GitHub's install page", async () => {
  holdRepositoryLists(handHostReads({}).deliverRepositoryLists, () => ({
    repositories: {
      installed: true,
      repositories: [
        reached("octo/tools", 2, GITHUB_ACCESS.APP),
        reached("acme/web", 1, GITHUB_ACCESS.TOKEN),
      ],
      installationUrl: "https://github.com/apps/luke/installations/new",
    },
  }));
  const connects: unknown[] = [];
  fakeActPort({
    ...fakeActPortCalls(),
    [ACT_KIND.WORKSPACE_GITHUB_CONNECT]: (payload) => {
      connects.push(payload);

      return Promise.resolve(undefined);
    },
  });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      withQueryClient(
        createElement(GitHubSetup, { workspaceId: WORKSPACE, onReached: () => undefined }),
      ),
    ),
  );

  // Note that the step draws GitHub's row once the repositories it reaches reach their query.
  await vi.waitFor(() =>
    assert.match(container.textContent ?? "", /GitHub.*2 repositories/u, container.textContent),
  );
  assert.equal(container.querySelector('[role="radio"]'), null, "the cards give way");
  assert.deepEqual(
    [...container.querySelectorAll("li")].map((line) => line.textContent),
    ["octo/tools", "acme/webToken"],
  );
  act(() =>
    (
      [...container.querySelectorAll("button")].find(
        (each) => each.textContent === "Add repositories",
      ) ?? assert.fail("no Add repositories")
    ).click(),
  );
  await settle();
  assert.deepEqual(connects, [{ workspaceId: WORKSPACE }]);
});

test("a paste too short to be a token, entered, says GitHub's invalid words on the token's card until it is edited, and is sent nowhere", async () => {
  holdRepositoryLists(handHostReads({}).deliverRepositoryLists, () => ({
    repositories: {
      installed: false,
      repositories: [],
      installationUrl: "https://github.com/apps/luke/installations/new",
    },
  }));
  holdGitHubToken(() => ({ rows: { token: null } }));
  const saved: unknown[] = [];
  fakeActPort({
    ...fakeActPortCalls(),
    [ACT_KIND.GITHUB_TOKEN_SAVE]: (payload) => {
      saved.push(payload);

      return Promise.resolve({ token: null });
    },
  });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      withQueryClient(
        createElement(GitHubSetup, { workspaceId: WORKSPACE, onReached: () => undefined }),
      ),
    ),
  );
  await settle();

  const radio =
    [...container.querySelectorAll<HTMLElement>('[role="radio"]')].find((one) =>
      one.textContent?.includes("Personal access token"),
    ) ?? assert.fail("the step offers the token");

  act(() => radio.click());
  await settle();

  const control = [...container.querySelectorAll("label")].find(
    (each) => each.textContent === "Paste the token",
  )?.control;

  const field = control instanceof HTMLInputElement ? control : assert.fail("no token field");

  const type = (value: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });

  type("ghp_bad");
  act(() => field.form?.requestSubmit());
  await settle();

  assert.match(container.textContent ?? "", /GitHub rejected this token\./u);
  assert.deepEqual(saved, []);

  type("ghp_bad2");
  assert.doesNotMatch(container.textContent ?? "", /GitHub rejected/u, "an edit clears the words");
});

/** A repository as the workspace's listing answers it, reached through `access`. */
function reached(fullName: string, updatedAt: number, access: GitHubAccess): GitHubRepository {
  const [owner = "", name = ""] = fullName.split("/");

  return { owner, name, fullName, defaultBranch: "main", private: true, updatedAt, access };
}

test("the token's picker adds several repositories in one open menu, stands as Add repositories on GitHub's row over the repositories once they are reached, and taking them all back after Back keeps the token's card", async () => {
  const reach = [
    reached("octo/tools", 2, GITHUB_ACCESS.TOKEN),
    reached("octo/notes", 1, GITHUB_ACCESS.TOKEN),
  ];

  let added: WorkspaceTokenRepository[] = [];
  const reads = handHostReads({ tokenRepositories: { [WORKSPACE]: { rows: [] } } });

  const lists = holdRepositoryLists(reads.deliverRepositoryLists, () => ({
    repositories: {
      installed: false,
      repositories: reach.filter((one) => added.some((each) => each.fullName === one.fullName)),
      addable: reach.filter((one) => !added.some((each) => each.fullName === one.fullName)),
      installationUrl: "https://github.com/apps/luke/installations/new",
    },
  }));

  holdGitHubToken(() => ({
    rows: {
      token: {
        login: "octo",
        hint: "ghp_…wxyz",
        status: GITHUB_TOKEN_STATUS.VERIFIED,
        statusAt: 1,
        addedAt: 1,
        expiresAt: null,
      },
    },
  }));
  fakeActPort({
    ...fakeActPortCalls(),
    [ACT_KIND.WORKSPACE_TOKEN_REPOSITORY_SET]: ({ repository, added: adding }) => {
      added = adding
        ? [{ fullName: repository, addedBy: "user-octo", addedAt: 2, removable: true }, ...added]
        : added.filter((one) => one.fullName !== repository);
      reads.deliverTokenRepositories({ [WORKSPACE]: { rows: added } });

      return Promise.resolve(added);
    },
  });
  const container = document.body.appendChild(document.createElement("div"));

  const draw = () => {
    const root = createRoot(container);
    roots.push(root);
    act(() =>
      root.render(
        withQueryClient(
          createElement(GitHubSetup, { workspaceId: WORKSPACE, onReached: () => undefined }),
        ),
      ),
    );

    return root;
  };

  const first = draw();
  await settle();

  const radio = (words: string) =>
    [...container.querySelectorAll<HTMLElement>('[role="radio"]')].find((one) =>
      one.textContent?.includes(words),
    ) ?? assert.fail(`the step offers ${words}`);

  act(() => radio("Personal access token").click());
  await settle();

  const chip = () =>
    container.querySelector<HTMLButtonElement>(".ui-chip") ??
    assert.fail("the token's card draws its chip");

  act(() => chip().click());
  await settle();

  const option = (name: string) =>
    [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((one) =>
      one.textContent?.includes(name),
    ) ?? assert.fail(`the menu lists ${name}`);

  act(() => option("tools").click());
  await settle();
  act(() => option("notes").click());
  await settle();
  await act(() => lists.again());
  await settle();
  assert.deepEqual(
    [...container.querySelectorAll("li")].map((line) => line.textContent),
    ["octo/toolsToken", "octo/notesToken"],
  );
  // Back draws the step again, which forgets the card last pressed.
  act(() => first.unmount());
  draw();
  // The host hands a window opened again the token repositories as they stand now.
  act(() => reads.deliverTokenRepositories({ [WORKSPACE]: { rows: added } }));
  await settle();
  act(() => chip().click());
  await settle();
  act(() => option("tools").click());
  await settle();
  act(() => option("notes").click());
  await settle();
  await act(() => lists.again());
  await settle();

  assert.equal(radio("Personal access token").getAttribute("aria-checked"), "true");
  assert.equal(chip().textContent, "Add repositories");
});
