// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { AgentOverviewPullRequestAnswerView } from "@repo/features/agent-view";
import {
  type AgentOverviewConversation,
  CHANGED_FILE_STATUS,
  CHECK_SUMMARY,
  CONVERSATION_ENTRY,
  DEPLOYMENT_STATE,
  DIFF_SIDE,
  MERGE_STATE,
  type PendingReviewComment,
  PULL_REQUEST_STATE,
  REVIEW_STATE,
  type ReviewThread,
} from "@repo/features/agent-wire";
import {
  LINK_DESTINATION,
  PULL_REQUEST_THREAD_VIEW,
  type ReadLink,
} from "@repo/features/link-grammar";
import { LIVE_READ } from "@repo/features/live-wire";
import {
  FILE_VIEWED_STATE,
  PULL_REQUEST_ACTION,
  PULL_REQUEST_WRITE_OUTCOME,
  REVIEW_COMMENT_MODE,
} from "@repo/features/pull-request-write-wire";
import { WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import { EXPERIMENT } from "@repo/settings";
import { appSettingsWire, experimentsOn, settingsView } from "@repo/settings/testing";
import { TextSelection } from "@tiptap/pm/state";
import { act, createElement, useState } from "react";
import { test, vi } from "vitest";
import { LinkWorkspaceProvider } from "../copy-link-item.js";
import { DIFF_SELECTION_SIDE, type DiffListSelection } from "../diff-view/contract.js";
import { SHELL_ROOM } from "../shell-room.js";
import { ShellRoomContext } from "../stage-room.js";
import {
  AGENT,
  answerQuestion,
  boxEditor,
  boxWords,
  boxWordsElement,
  CHARLES_ON_GITHUB,
  CHECKS,
  CONVERSATION,
  changesOf,
  checksGlyph,
  choose,
  controlAnswering,
  draw,
  drawn,
  filesViewOptions,
  HELD_PEOPLE,
  held,
  MERGING,
  mergePresses,
  mergeShown,
  mergeStatus,
  merging,
  offered,
  option,
  PAGE,
  PULL_REQUEST,
  partsOf,
  pillOf,
  pressAction,
  pressBox,
  pressInBox,
  pressToolbar,
  published,
  type ReadChanges,
  Switching,
  sectionHead,
  settle,
  sized,
  standing,
  tabCount,
  thread,
  threadLabels,
  toolbarItems,
  turnFilter,
  words,
  world,
  writeBox,
} from "../testing/agent-pull-request-tab.js";
import { fakeAppBridge, fakeAppBridgeCalls } from "../testing/app-bridge.js";
import { copyingInto, DESKTOP_LINKS, fakeAppPlatform } from "../testing/app-platform.js";
import { handSettings } from "../testing/app-state.js";
import { restOn } from "../testing/hint-rest.js";
import { chooseMenuItem } from "../testing/phone-head.js";
import { newestToastAction, newestToastSays } from "../testing/toast.js";
import { windowRouter } from "../testing/window-router.js";
import { AgentPullRequestTab } from "./agent-pull-request-tab.js";
import { PULL_REQUEST_VIEW, type PullRequestView } from "./task-tab-model.js";
import { type ThreadReveal, ThreadRevealProvider } from "./thread-reveal.js";
import type { AgentsControl } from "./use-agents.js";
import { OpenLinkProvider } from "./use-open-link.js";

/**
 * agent-pull-request-tab-comments.test.ts -- an agent's Pull request tab
 * replies on and resolves review threads, closes and reopens its pull
 * request from the pill, edits its title in place, and comments on the
 * Conversation and on lines in Files changed, which counts what was viewed.
 * Split from `agent-pull-request-tab.test.ts` under CI's per-file cap, over
 * the same window (`testing/agent-pull-request-tab.ts`). Synthetic people
 * throughout.
 */

/** The lines the header counts after the branches, once it draws them. */
function headerLines(tab: HTMLElement): string | undefined {
  return tab.querySelector(".pull-request-lines")?.textContent ?? undefined;
}

/** A review carrying the threads given, as the conversation's read answers one. */
function reviewWith(threads: readonly ReviewThread[]): AgentOverviewConversation {
  return {
    ...CONVERSATION,
    conversation: [
      {
        kind: CONVERSATION_ENTRY.REVIEW,
        by: CHARLES_ON_GITHUB,
        state: REVIEW_STATE.COMMENTED,
        html: null,
        body: "",
        at: 2_500,
        url: `${PAGE}#pullrequestreview-9`,
        threads,
      },
    ],
  };
}

/** The thread's own press named `label`: Resolve or Reopen at its head's end, or its reply's send. */
function threadPress(thread: HTMLElement, label: string): HTMLButtonElement {
  return (
    [
      ...thread.querySelectorAll<HTMLButtonElement>(
        ".comment-tools button, .pull-request-thread-actions button",
      ),
    ].find((each) => each.getAttribute("aria-label") === label) ??
    assert.fail(`the thread offers ${label}`)
  );
}

/** Writes a reply in the thread's box as the member would. */
function writeReply(thread: HTMLElement, words: string): void {
  writeBox(thread, words, "Reply");
}

/** The thread as GitHub holds it once the changes asked so far were made: their replies after its comment, and resolved by the last resolve or unresolve. */
function threadAfterChanges(): ReviewThread {
  const base = thread({ id: "PRRT_flag" });
  let resolved = false;
  const replies: ReviewThread["comments"][number][] = [];

  for (const [, request] of world.changes) {
    if (request.action === PULL_REQUEST_ACTION.REPLY_TO_THREAD) {
      replies.push({
        by: CHARLES_ON_GITHUB,
        html: null,
        body: request.body,
        at: 3_000,
        url: `${PAGE}#discussion_r${10 + replies.length}`,
      });
    }

    if (request.action === PULL_REQUEST_ACTION.RESOLVE_THREAD) resolved = true;

    if (request.action === PULL_REQUEST_ACTION.UNRESOLVE_THREAD) resolved = false;
  }

  return { ...base, resolved, comments: [...base.comments, ...replies] };
}

test("a thread is replied on from its box and resolved and opened again from its head, each asked of the service for the agent by the thread's id, the thread then drawn as GitHub holds it", async () => {
  const tab = await draw(
    controlAnswering({
      conversation: () => Promise.resolve({ pullRequest: reviewWith([threadAfterChanges()]) }),
    }),
  );

  const card = (): HTMLElement =>
    tab.querySelector<HTMLElement>(".pull-request-thread") ?? assert.fail("the thread is drawn");

  const labels = () => threadLabels(card());

  writeReply(card(), "Renamed in the next push.");
  act(() => threadPress(card(), "Reply").click());
  await settle();
  assert.equal(boxWords(card(), "Reply"), "", "the box empties once GitHub took it");
  assert.match(
    card().querySelector(".annotation-comments")?.textContent ?? "",
    /Renamed in the next push\./u,
    "the reply is drawn under the thread once read again",
  );

  act(() => threadPress(card(), "Resolve").click());
  await settle();
  assert.deepEqual(labels(), ["Resolved"]);

  act(() => threadPress(card(), "Reopen").click());
  await settle();
  assert.deepEqual(labels(), []);
  assert.ok(threadPress(card(), "Resolve"), "the thread stands open again");

  assert.deepEqual(world.changes, [
    [
      AGENT.id,
      {
        action: PULL_REQUEST_ACTION.REPLY_TO_THREAD,
        threadId: "PRRT_flag",
        body: "Renamed in the next push.",
      },
    ],
    [AGENT.id, { action: PULL_REQUEST_ACTION.RESOLVE_THREAD, threadId: "PRRT_flag" }],
    [AGENT.id, { action: PULL_REQUEST_ACTION.UNRESOLVE_THREAD, threadId: "PRRT_flag" }],
  ]);
});

test("while a thread's resolve is out, its reply stands still, neither sent nor let go, so nothing is posted twice", async () => {
  const held = Promise.withResolvers<void>();
  world.changeHeld = held.promise;

  const tab = await draw(
    controlAnswering({
      conversation: () => Promise.resolve({ pullRequest: reviewWith([threadAfterChanges()]) }),
    }),
  );

  const card = (): HTMLElement =>
    tab.querySelector<HTMLElement>(".pull-request-thread") ?? assert.fail("the thread is drawn");

  writeReply(card(), "Done.");
  act(() => threadPress(card(), "Resolve").click());
  await vi.waitFor(() => assert.equal(threadPress(card(), "Reply").disabled, true));
  pressInBox(card(), { key: "Enter", metaKey: true });
  pressInBox(card(), { key: "Escape" });

  assert.equal(threadPress(card(), "Reply").disabled, true);
  assert.equal(boxWords(card()), "Done.", "Escape lets nothing go");
  held.resolve();
  await settle();
  assert.deepEqual(
    world.changes.map(([, request]) => request.action),
    [PULL_REQUEST_ACTION.RESOLVE_THREAD],
  );
});

test("a reply GitHub refuses says so under its thread in GitHub's own words, its words kept, and a thread read with no id offers nothing to press", async () => {
  world.changeAnswer = {
    outcome: PULL_REQUEST_WRITE_OUTCOME.REFUSED,
    words: "Pull request review thread is locked",
  };

  const tab = await draw(
    controlAnswering({
      conversation: () =>
        Promise.resolve({
          pullRequest: reviewWith([
            thread({ id: "PRRT_flag" }),
            thread({ path: "src/other.ts", comments: [] }),
          ]),
        }),
    }),
  );

  const [withId, withoutId] = [...tab.querySelectorAll<HTMLElement>(".pull-request-thread")];
  assert.ok(withId !== undefined && withoutId !== undefined);

  writeReply(withId, "Done.");
  act(() => threadPress(withId, "Reply").click());
  await vi.waitFor(() =>
    assert.equal(
      withId.querySelector(".pull-request-thread-note [role='alert']")?.textContent,
      "GitHub refused this change.\nGitHub said: “Pull request review thread is locked”",
    ),
  );
  assert.equal(boxWords(withId), "Done.");
  assert.equal(withoutId.querySelector(".pull-request-thread-actions") === null, true);
});

test("a folded thread whose Reopen GitHub refuses opens, so its refusal stands in view under its comments", async () => {
  world.changeAnswer = { outcome: PULL_REQUEST_WRITE_OUTCOME.REFUSED, words: "Not allowed." };

  const tab = await draw(
    controlAnswering({
      conversation: () =>
        Promise.resolve({ pullRequest: reviewWith([thread({ id: "PRRT_flag", resolved: true })]) }),
    }),
  );

  const card = (): HTMLElement =>
    tab.querySelector<HTMLElement>(".pull-request-thread") ?? assert.fail("the thread is drawn");

  const opened = () =>
    card().querySelector(".annotation-card-fold > summary")?.getAttribute("aria-expanded");

  assert.equal(opened(), "false", "a resolved thread stands folded");

  act(() => threadPress(card(), "Reopen").click());
  await vi.waitFor(() => assert.equal(opened(), "true"));
  assert.match(
    card().querySelector(".pull-request-thread-note [role='alert']")?.textContent ?? "",
    /Not allowed\./u,
  );
});

test("a tab naming another pull request of the agent's repository by its number reads that one, counts its own lines and files, and changes it rather than the agent's own", async () => {
  const asked: unknown[] = [];
  const url = "https://github.com/acme/relay/pull/41";

  const earlier = {
    ...published(PULL_REQUEST_STATE.OPEN),
    number: 41,
    title: "Lay the invitations' base",
    url,
    additions: 9,
    deletions: 2,
    changedFiles: 3,
  };

  const recorded =
    <A>(kind: string, answer: A) =>
    (agentId: string, number?: number) => {
      asked.push([kind, agentId, number]);

      return Promise.resolve(answer);
    };

  const control = {
    ...controlAnswering({
      pullRequest: recorded("pull request", {
        pullRequest: {
          ...PULL_REQUEST,
          number: 41,
          title: earlier.title,
          url,
          merge: MERGE_STATE.CLEAN,
          merging: MERGING,
        },
      }),
      conversation: recorded("conversation", { pullRequest: CONVERSATION }),
    }),
    numberedPullRequests: new Map([[AGENT.id, new Map([[41, earlier]])]]),
  };

  const tab = await drawn(
    createElement(AgentPullRequestTab, {
      agentId: AGENT.id,
      number: 41,
      control,
      shown: true,
      repository: "acme/relay",
      tree: { open: false, onToggle: () => undefined },
      view: PULL_REQUEST_VIEW.CONVERSATION,
      onView: () => undefined,
    }),
  );

  assert.deepEqual(asked, [
    ["pull request", AGENT.id, 41],
    ["conversation", AGENT.id, 41],
  ]);
  assert.equal(headerLines(tab), "+9 −2");
  assert.equal(tabCount(tab, "Files changed"), "3");
  await pressAction(tab, "Close pull request");
  assert.deepEqual(world.changes, [[AGENT.id, { action: PULL_REQUEST_ACTION.CLOSE }]]);
  assert.deepEqual(world.changeNumbers, [41]);
});

test("a numbered pull request nothing published shows how its checks went on its Checks tab from the merge read, before they are read, where the merge control draws no chip for them", async () => {
  const control = controlAnswering({
    pullRequest: () =>
      Promise.resolve({
        pullRequest: {
          ...PULL_REQUEST,
          number: 41,
          merge: MERGE_STATE.BLOCKED,
          merging: { ...MERGING, checks: CHECK_SUMMARY.FAILING },
        },
      }),
  });

  const tab = await drawn(
    createElement(AgentPullRequestTab, {
      agentId: AGENT.id,
      number: 41,
      control,
      shown: true,
      repository: "acme/relay",
      tree: { open: false, onToggle: () => undefined },
      view: PULL_REQUEST_VIEW.CONVERSATION,
      onView: () => undefined,
    }),
  );

  assert.equal(checksGlyph(tab), "failing");
  assert.equal(mergeShown(tab), undefined);
});

test("an open pull request's pill offers Close and a closed one's Reopen, each asked of the service for the agent", async () => {
  const open = await draw(merging(MERGE_STATE.CLEAN));
  // Note that Close asks first until the read says the pull request is out of the merge queue.
  await vi.waitFor(() => assert.equal(mergeShown(open)?.press, "Squash and merge"));
  await pressAction(open, "Close pull request");
  act(() => world.root?.unmount());
  world.root = undefined;

  const closed = await draw(
    controlAnswering({
      pullRequest: () =>
        Promise.resolve({ pullRequest: { ...PULL_REQUEST, state: PULL_REQUEST_STATE.CLOSED } }),
    }),
  );

  await vi.waitFor(() => assert.deepEqual(offered(closed), ["Reopen pull request"]));
  await pressAction(closed, "Reopen pull request");

  assert.deepEqual(world.changes, [
    [AGENT.id, { action: PULL_REQUEST_ACTION.CLOSE }],
    [AGENT.id, { action: PULL_REQUEST_ACTION.REOPEN }],
  ]);
});

test("the pill is named by the words it draws, so a change out reads as the screen does, and the name returns with its words", async () => {
  const tab = await draw(merging(MERGE_STATE.CLEAN));
  const pill = () => pillOf(tab) ?? assert.fail("the pill stands");
  assert.equal(pill().getAttribute("aria-label"), `Pull request ${pill().textContent}`);

  const answer = Promise.withResolvers<void>();
  world.changeHeld = answer.promise;
  await pressAction(tab, "Close pull request");
  // Note that the change is out once its mutation says so, which it hands React a moment later.
  await vi.waitFor(() =>
    assert.match(pill().textContent ?? "", /…$/u, "the pill says its change is out"),
  );
  assert.equal(pill().getAttribute("aria-label"), `Pull request ${pill().textContent}`);

  answer.resolve();
  await vi.waitFor(() => assert.doesNotMatch(pill().textContent ?? "", /…$/u));
  assert.equal(pill().getAttribute("aria-label"), `Pull request ${pill().textContent}`);
});

test("Close acts at once on an open pull request and a draft, a toast offering Reopen, which sends the reopen and goes", async () => {
  const question = () =>
    document.querySelector(
      '[role="dialog"]:not(.ui-toast), [role="alertdialog"]:not(.ui-toast)',
    ) !== null;

  const tab = await draw(merging(MERGE_STATE.CLEAN));
  // Note that Close asks first until the read says the pull request is out of the merge queue.
  await vi.waitFor(() => assert.equal(mergeShown(tab)?.press, "Squash and merge"));
  await pressAction(tab, "Close pull request");

  assert.equal(question(), false, "closing is not asked about");
  assert.deepEqual(world.changes, [[AGENT.id, { action: PULL_REQUEST_ACTION.CLOSE }]]);
  assert.equal(newestToastSays(), "Pull request closedReopen");

  act(() => newestToastAction()?.click());
  await settle();
  assert.deepEqual(world.changes, [
    [AGENT.id, { action: PULL_REQUEST_ACTION.CLOSE }],
    [AGENT.id, { action: PULL_REQUEST_ACTION.REOPEN }],
  ]);
  assert.notEqual(newestToastSays(), "Pull request closedReopen", "the toast goes with its press");
  act(() => world.root?.unmount());
  world.root = undefined;
  world.changes.length = 0;

  const draft = await draw(
    controlAnswering(
      {
        pullRequest: () =>
          Promise.resolve({
            pullRequest: { ...PULL_REQUEST, state: PULL_REQUEST_STATE.DRAFT },
          }),
      },
      PULL_REQUEST_STATE.DRAFT,
    ),
  );

  await pressAction(draft, "Close pull request");
  assert.equal(question(), false, "a draft's Close is not asked about either");
  assert.equal(newestToastSays(), "Pull request closedReopen");
});

test("a Close GitHub would not take offers no Reopen", async () => {
  world.changeAnswer = { outcome: PULL_REQUEST_WRITE_OUTCOME.REFUSED, words: "Not allowed." };
  const tab = await draw(merging(MERGE_STATE.CLEAN));
  // Note that Close asks first until the read says the pull request is out of the merge queue.
  await vi.waitFor(() => assert.equal(mergeShown(tab)?.press, "Squash and merge"));
  await pressAction(tab, "Close pull request");

  assert.equal(newestToastSays(), undefined);
  assert.match(tab.querySelector(".pull-request-write-note")?.textContent ?? "", /Not allowed\./u);
});

test("Close on an open pull request whose merge status could not be read asks first, since it may be queued, and sends nothing until it is answered", async () => {
  const tab = await draw(controlAnswering());
  await pressAction(tab, "Close pull request");

  const question = document.querySelector(
    '[role="dialog"]:not(.ui-toast), [role="alertdialog"]:not(.ui-toast)',
  );

  assert.match(
    question?.textContent ?? "",
    /Could not read whether this pull request is in the merge queue/u,
  );
  assert.deepEqual(world.changes, []);
});

test("Close on a pull request in the merge queue asks first with the queue's warning, sending nothing until it is answered, and Cancel leaves it queued", async () => {
  const tab = await draw(
    merging(MERGE_STATE.CLEAN, {
      queue: true,
      queued: { position: 2 },
      autoMerge: { method: null },
    }),
  );

  const question = () =>
    document.querySelector('[role="dialog"]:not(.ui-toast), [role="alertdialog"]:not(.ui-toast)')
      ?.textContent ?? undefined;

  await pressAction(tab, "Close pull request");

  assert.match(question() ?? "", /Close this pull request\?/u);
  assert.match(
    question() ?? "",
    /Removing this pull request from the queue could impact other pull requests in the queue\./u,
  );
  assert.deepEqual(world.changes, [], "nothing is sent while it is asked");

  await answerQuestion("Cancel");
  assert.equal(question(), undefined);
  assert.deepEqual(world.changes, []);
  assert.equal(newestToastSays(), undefined);

  await pressAction(tab, "Close pull request");
  await answerQuestion("Close pull request");
  assert.deepEqual(world.changes, [[AGENT.id, { action: PULL_REQUEST_ACTION.CLOSE }]]);
  assert.equal(
    newestToastSays(),
    undefined,
    "reopening does not queue it again, so none is offered",
  );
});

test("an open pull request GitHub holds in its merge queue says Queued and its place in the pill, in the attention tone with the merge's glyph, its menu offering Close and never Convert to draft; the merge control draws no chip, only Remove from queue", async () => {
  const tab = await draw(
    merging(MERGE_STATE.CLEAN, {
      queue: true,
      queued: { position: 2 },
      autoMerge: { method: null },
    }),
  );

  // Note that the pill says Queued once the pull request's read reaches its query.
  await vi.waitFor(() => assert.equal(standing(tab), "Queued #2"));
  const pill = pillOf(tab) ?? assert.fail("the pill stands");
  assert.deepEqual(
    [standing(tab), pill.getAttribute("data-tone"), pill.getAttribute("aria-label")],
    ["Queued #2", "attention", "Pull request Queued #2"],
  );
  assert.equal(
    pill.querySelector("[data-pull-request-mark]")?.getAttribute("data-pull-request-state"),
    "queued",
  );
  assert.deepEqual(offered(tab), ["Close pull request"]);
  assert.equal(mergeStatus(tab) === null, true, "no chip says it again");
  assert.deepEqual(
    mergePresses(tab).map((each) => each.textContent),
    ["Remove from queue"],
  );
  act(() => world.root?.unmount());
  world.root = undefined;

  const open = await draw(merging(MERGE_STATE.CLEAN));
  // Note that the queued read the draw before held stands in the cache until this draw's read lands.
  await vi.waitFor(() =>
    assert.equal(standing(open), "Open", "out of the queue the pill says where it stands"),
  );
  assert.deepEqual(offered(open), ["Convert to draft", "Close pull request"]);
});

test("with the Merge queue experiment on, a queued pull request's pill offers View merge queue first, which opens the listed workspace's Merge queue page on that pull request", async () => {
  const earlier = fakeAppBridgeCalls().requestAppState ?? assert.fail("the document is handed");

  const acme = {
    id: "workspace-acme",
    name: "Acme",
    slug: "acme",
    role: WORKSPACE_ROLE.MEMBER,
    github: null,
  };

  fakeAppBridge({
    ...fakeAppBridgeCalls(),
    requestAppState: async () => {
      const state = await earlier();

      return {
        ...state,
        settings: appSettingsWire(
          settingsView({ experiments: experimentsOn(EXPERIMENT.MERGE_QUEUE) }),
        ),
        tasks: { ...state.tasks, workspaces: [acme] },
      };
    },
  });
  const router = windowRouter();

  const control = merging(MERGE_STATE.CLEAN, {
    queue: true,
    queued: { position: 2 },
    autoMerge: { method: null },
  });

  world.drawnParts = partsOf.get(control) ?? world.drawnParts;
  world.drawnChanges = changesOf.get(control) ?? world.drawnChanges;

  const tab = await drawn(
    router.provide(createElement(Switching, { control, first: PULL_REQUEST_VIEW.CONVERSATION })),
  );

  await vi.waitFor(() =>
    assert.deepEqual(offered(tab), ["View merge queue", "Close pull request"]),
  );
  await pressAction(tab, "View merge queue");

  const { pathname, search } = router.history.location;
  assert.deepEqual([pathname, new URLSearchParams(search).get("pr")], ["/acme/merge-queue", PAGE]);
});

test("a pull request published as queued says Queued in the pill while its own read is out, and its place once it lands", async () => {
  const pullRequest = held<AgentOverviewPullRequestAnswerView>();

  const tab = await draw({
    ...controlAnswering({ pullRequest: pullRequest.read }),
    pullRequests: new Map([[AGENT.id, { ...published(PULL_REQUEST_STATE.OPEN), queued: true }]]),
  });

  assert.equal(standing(tab), "Queued");

  await act(async () =>
    pullRequest.answer({
      pullRequest: {
        ...PULL_REQUEST,
        merging: { ...MERGING, queue: true, queued: { position: 2 } },
      },
    }),
  );
  await settle();
  await vi.waitFor(() => assert.equal(standing(tab), "Queued #2"));
});

/** The title's words, focused as a click in them focuses them. */
function titleWords(tab: HTMLElement): HTMLElement {
  const words =
    tab.querySelector<HTMLElement>('[aria-label="Pull request title"]') ??
    assert.fail("the title's words stand to be edited");

  act(() => words.focus());

  return words;
}

/** Words typed over the title's, as React hears them. */
function typeTitle(words: HTMLElement, typed: string): void {
  act(() => {
    words.textContent = typed;
    words.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** A key pressed in the title's words, while an input method composes a word where `composing` says; whether something took it. */
async function key(words: HTMLElement, name: string, composing = false): Promise<boolean> {
  const event = new KeyboardEvent("keydown", {
    key: name,
    bubbles: true,
    cancelable: true,
    isComposing: composing,
  });

  act(() => {
    words.dispatchEvent(event);
  });
  await settle();

  return event.defaultPrevented;
}

test("the title is edited where it stands: Return keeps new words trimmed, and Escape, or words unchanged, sends nothing", async () => {
  const tab = await draw(controlAnswering());
  const words = titleWords(tab);
  assert.equal(words.textContent, PULL_REQUEST.title);
  typeTitle(words, "Something else");
  assert.equal(await key(words, "Enter", true), false, "an input method's Return types on");
  assert.equal(await key(words, "Escape", true), false, "an input method's Escape types on");
  assert.equal(document.activeElement, words);
  assert.equal(await key(words, "Escape"), true, "Escape is taken, so the window stands down");
  assert.notEqual(document.activeElement, words, "Escape leaves the words");
  assert.equal(words.textContent, PULL_REQUEST.title, "Escape puts the title back");

  titleWords(tab);
  await key(words, "Enter");
  assert.deepEqual(world.changes, [], "neither Escape nor the same words change anything");

  titleWords(tab);
  typeTitle(words, "  Expire invitations after a week  ");
  await key(words, "Enter");
  assert.deepEqual(world.changes, [
    [
      AGENT.id,
      { action: PULL_REQUEST_ACTION.EDIT_TITLE, title: "Expire invitations after a week" },
    ],
  ]);
  assert.notEqual(document.activeElement, words, "Return leaves the words");
});

test("the title's edit is kept as the focus leaves its words, and where GitHub refuses it the title comes back", async () => {
  world.changeAnswer = {
    outcome: PULL_REQUEST_WRITE_OUTCOME.REFUSED,
    words: "Pull request is locked.",
  };
  const tab = await draw(controlAnswering());
  const words = titleWords(tab);
  typeTitle(words, "Expire invitations after a day");
  act(() => words.blur());
  await settle();
  assert.deepEqual(world.changes, [
    [AGENT.id, { action: PULL_REQUEST_ACTION.EDIT_TITLE, title: "Expire invitations after a day" }],
  ]);
  await vi.waitFor(() => assert.equal(words.textContent, PULL_REQUEST.title));
});

test("the title's edit stands as typed while it is out, though a read from before it lands meanwhile", async () => {
  let title = PULL_REQUEST.title;

  const tab = await draw(
    controlAnswering({
      pullRequest: () => Promise.resolve({ pullRequest: { ...PULL_REQUEST, title } }),
    }),
  );

  const sending = Promise.withResolvers<void>();
  world.changeHeld = sending.promise;
  const words = titleWords(tab);
  typeTitle(words, "Expire invitations after a day");
  act(() => words.blur());
  await vi.waitFor(() => assert.equal(world.changes.length, 1));

  // A read GitHub answered before it took the change, with a title someone else gave it.
  title = "Expire stale invitations";
  await pressToolbar(tab, "Refresh");
  await settle();
  assert.equal(words.textContent, "Expire invitations after a day");

  title = "Expire invitations after a day";
  await act(async () => sending.resolve());
  await settle();
  assert.equal(words.textContent, "Expire invitations after a day");
});

test("Refresh, the one its screen offers, reads Files changed again once the view was shown", async () => {
  let changeReads = 0;

  const readChanges: ReadChanges = () => {
    changeReads += 1;

    return Promise.resolve({ pullRequest: { url: PAGE, truncated: false, files: [] } });
  };

  const tab = await draw(controlAnswering({}, PULL_REQUEST_STATE.OPEN, readChanges));
  await pressToolbar(tab, "Refresh");
  await settle();
  assert.equal(changeReads, 0, "Files changed is not read before it is shown");

  await choose(tab, "Files changed");
  assert.equal(changeReads, 1);
  await pressToolbar(tab, "Refresh");
  await settle();
  assert.equal(changeReads, 2);
});

test("Files changed draws each review thread under its line, its comments through the overview's own drawing, and while Minimize inline comments is on, as one chip at the line's end that shows it", async () => {
  const review = {
    kind: CONVERSATION_ENTRY.REVIEW,
    by: CHARLES_ON_GITHUB,
    state: REVIEW_STATE.COMMENTED,
    html: null,
    body: "",
    at: 2_500,
    url: `${PAGE}#pullrequestreview-9`,
    threads: [thread()],
  } as const;

  const readChanges: ReadChanges = () =>
    Promise.resolve({
      pullRequest: {
        url: PAGE,
        truncated: false,
        files: [
          {
            path: "src/invite.ts",
            previousPath: null,
            status: CHANGED_FILE_STATUS.MODIFIED,
            additions: 2,
            deletions: 1,
            omitted: null,
            // The hunk as the pull request's files carry it, its header counting the lines it holds.
            patch: thread().diffHunk.replace("@@ -8,6 +8,7 @@", "@@ -8,5 +8,6 @@"),
          },
        ],
      },
    });

  handSettings({}, { [LIVE_READ.WORKSPACE_MEMBERS]: HELD_PEOPLE });

  const tab = await draw(
    controlAnswering(
      {
        conversation: () =>
          Promise.resolve({ pullRequest: { ...CONVERSATION, conversation: [review] } }),
      },
      PULL_REQUEST_STATE.OPEN,
      readChanges,
    ),
  );

  await choose(tab, "Files changed");

  const minimize = async () => {
    act(() => filesViewOptions(tab)?.click());

    const toggle = [...document.querySelectorAll<HTMLButtonElement>('[role="switch"]')].find(
      (each) => each.getAttribute("aria-label") === "Minimize inline comments",
    );

    act(() => toggle?.click());
    await settle();
    act(() => filesViewOptions(tab)?.click());
  };

  const drawn = world.lists.at(-1) ?? assert.fail("the files are drawn");
  const file = drawn.files.find((each) => each.path === "src/invite.ts");
  assert.deepEqual(file?.annotations, [
    { key: `${PAGE}#discussion_r1`, side: "additions", line: 13 },
  ]);
  const note = drawn.renderAnnotation("src/invite.ts", `${PAGE}#discussion_r1`);
  assert.equal(note.querySelector(".pull-request-thread-comment strong")?.textContent, "once");
  assert.equal(note.querySelector("details")?.open, true, "a current thread stands open");
  await minimize();
  // Note that the setting's write lands a moment after the press, and the chip with it.
  await vi.waitFor(() =>
    assert.equal(note.querySelector(".diff-thread-chip-row > summary") !== null, true),
  );

  const chip =
    note.querySelector<HTMLElement>(".diff-thread-chip-row > summary") ??
    assert.fail("a chip stands");

  assert.equal(chip.getAttribute("aria-label"), "1 comment by Charles Pan · 1 open, show");
  assert.equal(
    note.querySelector(".pull-request-thread-comment") === null,
    true,
    "minimized, no thread is drawn",
  );
  act(() => chip.click());
  await settle();
  assert.ok(note.querySelector(".pull-request-thread-comment"), "the chip shows the line's thread");
  assert.equal(
    note.querySelector(".diff-thread-chip-row > summary")?.getAttribute("aria-label"),
    "1 comment by Charles Pan · 1 open, hide",
  );
});

test("the pointer resting on a review thread in Files changed lights the lines it is on, and leaving it lets them go; a minimized chip lights the widest of its threads' lines, and again once the pointer comes back from a thread it shows", async () => {
  const review = {
    kind: CONVERSATION_ENTRY.REVIEW,
    by: CHARLES_ON_GITHUB,
    state: REVIEW_STATE.COMMENTED,
    html: null,
    body: "",
    at: 2_500,
    url: `${PAGE}#pullrequestreview-9`,
    threads: [
      thread(),
      thread({
        // A first line above the patch's hunk, which no drawn row holds.
        startLine: 3,
        originalStartLine: 3,
        comments: [
          { ...(thread().comments[0] ?? assert.fail("a comment")), url: `${PAGE}#discussion_r2` },
        ],
      }),
    ],
  } as const;

  handSettings({}, { [LIVE_READ.WORKSPACE_MEMBERS]: HELD_PEOPLE });

  const tab = await draw(
    controlAnswering(
      {
        conversation: () =>
          Promise.resolve({ pullRequest: { ...CONVERSATION, conversation: [review] } }),
      },
      PULL_REQUEST_STATE.OPEN,
      () =>
        Promise.resolve({
          pullRequest: { url: PAGE, headSha: READ_HEAD, truncated: false, files: [INVITE_FILE] },
        }),
    ),
  );

  await choose(tab, "Files changed");

  const note = (world.lists.at(-1) ?? assert.fail("the files are drawn")).renderAnnotation(
    INVITE_FILE.path,
    `${PAGE}#discussion_r1`,
  );

  const drawnThread =
    note.querySelector<HTMLElement>(".pull-request-thread-comment") ??
    assert.fail("the thread is drawn");

  act(() => {
    drawnThread.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  });
  assert.deepEqual(world.lists.at(-1)?.selected, {
    path: INVITE_FILE.path,
    selection: {
      start: 12,
      side: DIFF_SELECTION_SIDE.ADDITIONS,
      end: 13,
      endSide: DIFF_SELECTION_SIDE.ADDITIONS,
    },
  });
  act(() => {
    drawnThread.dispatchEvent(
      new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }),
    );
  });
  assert.equal(world.lists.at(-1)?.selected, undefined, "its lines are let go");
  // The keyboard in the card lights its lines as the pointer does, and lets them go as it leaves.
  const summary = note.querySelector<HTMLElement>("summary") ?? assert.fail("the card's head");
  document.documentElement.dataset.keyboard = "true";
  act(() => {
    summary.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  });
  assert.equal(world.lists.at(-1)?.selected?.selection.end, 13, "the focus lights its lines");
  act(() => {
    summary.dispatchEvent(
      new FocusEvent("focusout", { bubbles: true, relatedTarget: document.body }),
    );
  });
  assert.equal(world.lists.at(-1)?.selected, undefined, "the focus leaving lets them go");
  delete document.documentElement.dataset.keyboard;

  act(() => filesViewOptions(tab)?.click());
  await settle();

  const minimize =
    [...document.querySelectorAll<HTMLButtonElement>('[role="switch"]')].find(
      (each) => each.getAttribute("aria-label") === "Minimize inline comments",
    ) ?? assert.fail("the diff settings offer Minimize inline comments");

  act(() => minimize.click());
  await vi.waitFor(() =>
    assert.equal(note.querySelector(".diff-thread-chip-row > summary") !== null, true),
  );

  const chip =
    note.querySelector<HTMLElement>(".diff-thread-chip-row > summary") ??
    assert.fail("the threads are minimized");

  const litFrom = () => world.lists.at(-1)?.selected?.selection.start;
  act(() => {
    chip.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  });
  assert.equal(
    litFrom(),
    3,
    "the chip lights the widest of its threads' lines, 3–13, though no drawn row holds line 3",
  );

  act(() => chip.click());
  await settle();

  const shown =
    [
      ...note.querySelectorAll<HTMLElement>(
        ".diff-thread-chip-threads .pull-request-thread-comment",
      ),
    ].find((each) => each.textContent?.includes("once")) ??
    assert.fail("the chip shows the thread on lines 12–13");

  act(() => {
    shown.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  });
  assert.equal(litFrom(), 12, "a thread shown under the chip lights its own lines");
  act(() => {
    shown.dispatchEvent(
      new MouseEvent("mouseout", {
        bubbles: true,
        relatedTarget: note.querySelector(".diff-thread-chip-row > summary"),
      }),
    );
  });
  assert.equal(litFrom(), 3, "back on the chip, the chip's lines light again");
  // The keyboard in a thread the chip shows lights that thread's lines, not the chip's.
  document.documentElement.dataset.keyboard = "true";
  act(() => {
    shown.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  });
  delete document.documentElement.dataset.keyboard;
  assert.equal(litFrom(), 12, "the focused thread lights its own lines");
});

test("a review thread on its line in Files changed is replied on and resolved as in the Conversation", async () => {
  const flagged = thread({ id: "PRRT_flag" });

  const readChanges: ReadChanges = () =>
    Promise.resolve({
      pullRequest: {
        url: PAGE,
        truncated: false,
        files: [
          {
            path: "src/invite.ts",
            previousPath: null,
            status: CHANGED_FILE_STATUS.MODIFIED,
            additions: 2,
            deletions: 1,
            omitted: null,
            patch: flagged.diffHunk.replace("@@ -8,6 +8,7 @@", "@@ -8,5 +8,6 @@"),
          },
        ],
      },
    });

  const tab = await draw(
    controlAnswering(
      { conversation: () => Promise.resolve({ pullRequest: reviewWith([flagged]) }) },
      PULL_REQUEST_STATE.OPEN,
      readChanges,
    ),
  );

  await choose(tab, "Files changed");
  const drawn = world.lists.at(-1) ?? assert.fail("the files are drawn");
  assert.ok(
    drawn.files.some((file) => file.annotations.some((one) => one.line === 13)),
    "the thread is drawn on its line",
  );
  const note = drawn.renderAnnotation("src/invite.ts", `${PAGE}#discussion_r1`);

  writeReply(note, "Renamed.");
  pressInBox(note, { key: "Enter" }, "Reply");
  await settle();
  act(() => threadPress(note, "Resolve").click());
  await settle();

  assert.deepEqual(world.changes, [
    [
      AGENT.id,
      { action: PULL_REQUEST_ACTION.REPLY_TO_THREAD, threadId: "PRRT_flag", body: "Renamed." },
    ],
    [AGENT.id, { action: PULL_REQUEST_ACTION.RESOLVE_THREAD, threadId: "PRRT_flag" }],
  ]);
});

/** Writes in the comment box at the Conversation's foot as the member would. */
function writeComment(tab: HTMLElement, words: string): HTMLElement {
  const box =
    tab.querySelector<HTMLElement>(".pull-request-comment-box") ??
    assert.fail("the Conversation ends in a comment box");

  writeBox(box, words, "Comment");

  return box;
}

/** The comment box's Comment press. */
function commentPress(tab: HTMLElement): HTMLButtonElement {
  return (
    tab.querySelector<HTMLButtonElement>(
      ".pull-request-comment-box .ui-composer-foot button[aria-label='Comment']",
    ) ?? assert.fail("the box offers Comment")
  );
}

test("a comment written at the Conversation's foot is asked of the service for the agent, after which the box lets its words go and the comment stands in the conversation", async () => {
  const tab = await draw(
    controlAnswering({
      conversation: () =>
        Promise.resolve({
          pullRequest: {
            ...CONVERSATION,
            conversation: [
              ...CONVERSATION.conversation,
              ...world.changes.flatMap(([, request]) =>
                request.action === PULL_REQUEST_ACTION.COMMENT
                  ? [
                      {
                        kind: CONVERSATION_ENTRY.COMMENT,
                        by: CHARLES_ON_GITHUB,
                        html: null,
                        body: request.body,
                        at: 4_000,
                        url: `${PAGE}#issuecomment-9`,
                      },
                    ]
                  : [],
              ),
            ],
          },
        }),
    }),
  );

  assert.equal(commentPress(tab).disabled, true, "a blank comment is not sent");

  const box = writeComment(tab, "Shipping after **lunch**.");
  pressInBox(box, { key: "Enter", metaKey: true });
  await settle();

  assert.deepEqual(world.changes, [
    [AGENT.id, { action: PULL_REQUEST_ACTION.COMMENT, body: "Shipping after **lunch**." }],
  ]);
  assert.equal(
    boxWords(tab.querySelector(".pull-request-comment-box") ?? tab),
    "",
    "the box lets its words go",
  );
  assert.match(
    tab.querySelector(".pull-request-conversation")?.textContent ?? "",
    /Shipping after lunch\./u,
  );
});

test("a comment GitHub refuses says so under the box in GitHub's own words, its words kept for another try", async () => {
  world.changeAnswer = {
    outcome: PULL_REQUEST_WRITE_OUTCOME.REFUSED,
    words: "Conversation is locked to collaborators",
  };
  const tab = await draw(controlAnswering());

  writeComment(tab, "Ping?");
  act(() => commentPress(tab).click());

  // Note that GitHub's answer reaches React a tick after it lands, as the change's mutation hands it on.
  await vi.waitFor(() =>
    assert.equal(
      tab.querySelector(".pull-request-comment-note [role='alert']")?.textContent,
      "GitHub refused this change.\nGitHub said: “Conversation is locked to collaborators”",
    ),
  );
  assert.equal(boxWords(tab.querySelector(".pull-request-comment-box") ?? tab), "Ping?");
});

/** The head the changes were read at, which a comment on their lines names. */
const READ_HEAD = "c0ffee1c0ffee1c0ffee1c0ffee1c0ffee1c0ffe";

/** One changed file whose hunk is the review threads' own: old lines 8–12, the last removed, and new lines 8–13, the last two added. */
const INVITE_FILE = {
  path: "src/invite.ts",
  previousPath: null,
  status: CHANGED_FILE_STATUS.MODIFIED,
  additions: 2,
  deletions: 1,
  omitted: null,
  patch: thread().diffHunk.replace("@@ -8,6 +8,7 @@", "@@ -8,5 +8,6 @@"),
};

/** The tab over that one file, read at `READ_HEAD`, its conversation holding the member's pending review as given; a read of the changes after the first answers `reread` in its place where one is given. */
async function drawCommentable(
  pendingReview?: { readonly comments: number } | null,
  reread: typeof INVITE_FILE = INVITE_FILE,
) {
  const read = { changes: 0 };

  const tab = await draw(
    controlAnswering(
      {
        conversation: () =>
          Promise.resolve({
            pullRequest: {
              ...CONVERSATION,
              ...(pendingReview === undefined ? undefined : { pendingReview }),
            },
          }),
      },
      PULL_REQUEST_STATE.OPEN,
      () => {
        read.changes += 1;

        return Promise.resolve({
          pullRequest: {
            url: PAGE,
            headSha: READ_HEAD,
            truncated: false,
            files: [read.changes === 1 ? INVITE_FILE : reread],
          },
        });
      },
    ),
  );

  await choose(tab, "Files changed");

  return { tab };
}

/** Presses the gutter's + on the lines given of the file, as the diff bundle tells the view, and the comment it opened. */
async function pickLines(selection: DiffListSelection["selection"]): Promise<HTMLElement> {
  // Note that the changes land through a query, so the files are picked from once they are drawn.
  await vi.waitFor(() => assert.equal(world.lists.length > 0, true, "the files are drawn"));
  const drawn = world.lists.at(-1) ?? assert.fail("the files are drawn");
  const onComment = drawn.onComment ?? assert.fail("the gutter offers a comment");
  act(() => onComment({ path: INVITE_FILE.path, selection }));
  await settle();

  return commentNotes().at(-1)?.element ?? assert.fail("the pick opens a comment");
}

/** The comments the files' last draw stands under their lines, in the order they were opened: each note's place and the element drawn in it. */
function commentNotes() {
  const drawn = world.lists.at(-1);

  if (drawn === undefined) return [];

  return drawn.files
    .flatMap((file) =>
      file.annotations.map((note) => ({
        path: file.path,
        side: note.side,
        line: note.line,
        element: drawn.renderAnnotation(file.path, note.key),
      })),
    )
    .filter((note) => note.element.querySelector(".line-comment") !== null);
}

/** Writes the comment's words as the member would. */
function writeLineComment(comment: HTMLElement, words: string): void {
  writeBox(comment, words, "Comment");
}

/** The comment's press of the words given. */
function commentOffer(comment: HTMLElement, label: string): HTMLButtonElement {
  return (
    [...comment.querySelectorAll<HTMLButtonElement>("button")].find(
      (each) => pressName(each) === label,
    ) ?? assert.fail(`the comment offers ${label}`)
  );
}

/** What a press is called to a reader: its words, or the name a round press wears in their place. */
function pressName(press: Element): string | null {
  const words = press.textContent ?? "";

  return words === "" ? press.getAttribute("aria-label") : words;
}

/** What a comment's box offers in its foot, by name, in order. */
function footOffers(comment: HTMLElement): readonly (string | null)[] {
  return [...comment.querySelectorAll(".ui-composer-foot button")].map(pressName);
}

/** Chooses `label` in the ⋯ of the first pending comment in `comment`, as the member would. */
function pendingAct(comment: HTMLElement, label: string): void {
  act(() =>
    (
      comment.querySelector<HTMLButtonElement>('button[aria-label="Comment actions"]') ??
      assert.fail("the pending comment offers its ⋯")
    ).click(),
  );
  chooseMenuItem(label);
}

/** Whether the files' last draw stands a comment under a line. */
function commentDrawn(): boolean {
  return commentNotes().length > 0;
}

test("the gutter's + opens a comment under the last line picked, however the pick was dragged, its lines lit; Add single comment sends it for the agent at the head the files were read at, after which it closes and lets its words go", async () => {
  await drawCommentable();

  const comment = await pickLines({
    start: 13,
    side: DIFF_SELECTION_SIDE.ADDITIONS,
    end: 12,
    endSide: DIFF_SELECTION_SIDE.ADDITIONS,
  });

  assert.equal(comment.querySelector(".line-comment-head")?.textContent, "Comment on lines 12–13");
  assert.deepEqual(
    commentNotes().map(({ path, side, line }) => ({ path, side, line })),
    [{ path: INVITE_FILE.path, side: DIFF_SELECTION_SIDE.ADDITIONS, line: 13 }],
  );
  assert.equal(world.lists.at(-1)?.selected?.path, INVITE_FILE.path);
  assert.deepEqual(footOffers(comment), [
    "Add a suggestion",
    "Cancel",
    "Start a review",
    "Add single comment",
  ]);

  writeLineComment(comment, "Why **twice**?");
  act(() => commentOffer(comment, "Add single comment").click());
  await settle();

  assert.deepEqual(world.changes, [
    [
      AGENT.id,
      {
        action: PULL_REQUEST_ACTION.ADD_REVIEW_COMMENT,
        mode: REVIEW_COMMENT_MODE.SINGLE,
        path: INVITE_FILE.path,
        line: 13,
        side: DIFF_SIDE.RIGHT,
        startLine: 12,
        startSide: DIFF_SIDE.RIGHT,
        body: "Why **twice**?",
        headSha: READ_HEAD,
      },
    ],
  ]);
  assert.equal(commentDrawn(), false, "the comment closes once GitHub took it");
  assert.equal(world.lists.at(-1)?.selected, undefined, "its lines are no longer lit");

  const again = await pickLines({
    start: 12,
    side: DIFF_SELECTION_SIDE.DELETIONS,
    end: 12,
    endSide: DIFF_SELECTION_SIDE.DELETIONS,
  });

  assert.equal(boxWords(again), "", "its words were let go");
  assert.equal(again.querySelector(".line-comment-head")?.textContent, "Comment on line 12");
});

test("several comments stand open at once, each under its own lines with its own words, the last opened lit; one closed unsent comes back with its words, and lines ending where an open one ends move it rather than open another", async () => {
  await drawCommentable();

  const added = {
    start: 12,
    side: DIFF_SELECTION_SIDE.ADDITIONS,
    end: 13,
    endSide: DIFF_SELECTION_SIDE.ADDITIONS,
  };

  const removed = {
    start: 12,
    side: DIFF_SELECTION_SIDE.DELETIONS,
    end: 12,
    endSide: DIFF_SELECTION_SIDE.DELETIONS,
  };

  writeLineComment(await pickLines(added), "Why twice?");
  writeLineComment(await pickLines(removed), "Gone?");

  const heads = () =>
    commentNotes().map((note) => note.element.querySelector(".line-comment-head")?.textContent);

  const words = () => commentNotes().map((note) => boxWords(note.element));
  assert.deepEqual(heads(), ["Comment on lines 12–13", "Comment on line 12"]);
  assert.deepEqual(words(), ["Why twice?", "Gone?"]);
  assert.deepEqual(world.lists.at(-1)?.selected, { path: INVITE_FILE.path, selection: removed });

  const [first] = commentNotes();
  act(() => commentOffer(first?.element ?? assert.fail("the first stands"), "Cancel").click());
  await settle();
  assert.deepEqual(heads(), ["Comment on line 12"], "Cancel closes that comment alone");
  assert.deepEqual(world.lists.at(-1)?.selected, { path: INVITE_FILE.path, selection: removed });

  await pickLines({ ...added, start: 13 });
  assert.deepEqual(heads(), ["Comment on line 12", "Comment on line 13"]);
  assert.deepEqual(words(), ["Gone?", "Why twice?"], "the words written there come back");
  await pickLines(added);
  assert.deepEqual(
    heads(),
    ["Comment on line 12", "Comment on lines 12–13"],
    "lines ending on the same line move the comment there",
  );
});

test("the words of a line comment outlast the tab: a window drawn again finds them where the same lines are picked, and Add single comment lets them go", async () => {
  await drawCommentable();

  const added = {
    start: 12,
    side: DIFF_SELECTION_SIDE.ADDITIONS,
    end: 13,
    endSide: DIFF_SELECTION_SIDE.ADDITIONS,
  };

  const removed = {
    start: 12,
    side: DIFF_SELECTION_SIDE.DELETIONS,
    end: 12,
    endSide: DIFF_SELECTION_SIDE.DELETIONS,
  };

  writeLineComment(await pickLines(added), "Why twice?");
  writeLineComment(await pickLines(removed), "Gone?");

  // Closing the tab and reading the window again, as a relaunch does.
  act(() => world.root?.unmount());
  world.root = undefined;
  await drawCommentable();

  assert.equal(commentDrawn(), false, "no comment stands open before the lines are picked");
  assert.equal(boxWords(await pickLines(added)), "Why twice?", "the words come back on the lines");
  assert.equal(boxWords(await pickLines(removed)), "Gone?", "and on the side they were written on");

  const other = await pickLines({
    start: 8,
    side: DIFF_SELECTION_SIDE.ADDITIONS,
    end: 8,
    endSide: DIFF_SELECTION_SIDE.ADDITIONS,
  });

  assert.equal(boxWords(other), "", "other lines meet none of them");

  const [first] = commentNotes();
  act(() =>
    commentOffer(first?.element ?? assert.fail("a comment stands"), "Add single comment").click(),
  );
  await settle();
  act(() => world.root?.unmount());
  world.root = undefined;
  await drawCommentable();

  assert.equal(boxWords(await pickLines(added)), "", "the words GitHub took are let go");
  assert.equal(boxWords(await pickLines(removed)), "Gone?", "the others stay");
});

test("the words of a line comment are kept apart for each pull request a tab shows: the agent's own and one named by its number do not meet each other's", async () => {
  const lines = {
    start: 13,
    side: DIFF_SELECTION_SIDE.ADDITIONS,
    end: 13,
    endSide: DIFF_SELECTION_SIDE.ADDITIONS,
  };

  await drawCommentable();
  writeLineComment(await pickLines(lines), "For the agent's own");
  act(() => world.root?.unmount());
  world.root = undefined;

  const control = {
    ...controlAnswering({}, PULL_REQUEST_STATE.OPEN, () =>
      Promise.resolve({
        pullRequest: { url: PAGE, headSha: READ_HEAD, truncated: false, files: [INVITE_FILE] },
      }),
    ),
    numberedPullRequests: new Map([
      [AGENT.id, new Map([[41, published(PULL_REQUEST_STATE.OPEN)]])],
    ]),
  };

  await drawn(
    createElement(AgentPullRequestTab, {
      agentId: AGENT.id,
      number: 41,
      control,
      shown: true,
      repository: "acme/relay",
      tree: { open: false, onToggle: () => undefined },
      view: PULL_REQUEST_VIEW.FILES,
      onView: () => undefined,
    }),
  );
  await settle();
  const numbered = await pickLines(lines);
  assert.equal(boxWords(numbered), "", "the numbered pull request meets none of the agent's own");
  writeLineComment(numbered, "For #41");
  act(() => world.root?.unmount());
  world.root = undefined;

  await drawCommentable();
  assert.equal(boxWords(await pickLines(lines)), "For the agent's own");
});

test("a comment opened on lines takes the keyboard once the list stands its note in the window", async () => {
  await drawCommentable();

  const comment = await pickLines({
    start: 13,
    side: DIFF_SELECTION_SIDE.ADDITIONS,
    end: 13,
    endSide: DIFF_SELECTION_SIDE.ADDITIONS,
  });

  const field = boxWordsElement(comment) ?? assert.fail("the comment has words");
  assert.notEqual(document.activeElement, field, "a note not yet in the window takes nothing");

  document.body.append(comment);
  await settle();
  assert.equal(document.activeElement, field);
});

test("code selected as text on lines GitHub takes a comment on is offered a Comment press, which opens a comment on those lines; elsewhere, or once let go, nothing is offered", async () => {
  const { tab } = await drawCommentable();
  const tellText = world.lists.at(-1)?.onSelectText ?? assert.fail("the list hears selected text");
  const rect = { top: 120, left: 40, right: 200, bottom: 160 };
  const offer = () => tab.querySelector<HTMLButtonElement>(".diff-list-offer button");

  act(() =>
    tellText({
      picked: {
        path: INVITE_FILE.path,
        selection: {
          start: 30,
          side: DIFF_SELECTION_SIDE.ADDITIONS,
          end: 31,
          endSide: DIFF_SELECTION_SIDE.ADDITIONS,
        },
      },
      rect,
    }),
  );
  assert.equal(offer() === null, true, "lines no hunk holds are offered nothing");

  const selection = {
    start: 12,
    side: DIFF_SELECTION_SIDE.ADDITIONS,
    end: 13,
    endSide: DIFF_SELECTION_SIDE.ADDITIONS,
  };

  act(() => tellText({ picked: { path: INVITE_FILE.path, selection }, rect }));
  assert.equal(offer()?.getAttribute("aria-label"), "Comment on lines 12–13");
  act(() => tellText(undefined));
  assert.equal(offer() === null, true, "a selection let go takes its offer with it");

  act(() => tellText({ picked: { path: INVITE_FILE.path, selection }, rect }));
  act(() => offer()?.click());
  await settle();
  assert.equal(offer() === null, true);
  assert.deepEqual(
    commentNotes().map((note) => note.element.querySelector(".line-comment-head")?.textContent),
    ["Comment on lines 12–13"],
  );
});

/** The rows the `/` menu inside `within` offers now, by their words; none while it stands closed. */
function slashRows(within: ParentNode): string[] {
  return [...within.querySelectorAll(".ui-block-menu .ui-combobox-option-label")].map(
    (row) => row.textContent ?? "",
  );
}

/** Types `words` on a line of their own after the box's text, the caret in the box, as the member would; a comment's note is stood in the window first, as the list stands it. */
async function typeOnNewLine(within: HTMLElement, words: string): Promise<void> {
  if (!within.isConnected) document.body.append(within);
  await settle();
  const editor = boxEditor(within);
  act(() => {
    editor.view.focus();
    editor.view.dispatch(
      editor.state.tr
        .setSelection(TextSelection.atEnd(editor.state.doc))
        .split(editor.state.doc.content.size - 1),
    );
  });
  act(() => {
    editor.view.dispatch(editor.state.tr.insertText(words));
  });
}

test("a comment on the head's lines offers a Suggestion in its / menu and over its words, which lays in GitHub's suggestion block holding the lines as they read now, sent as written; one on the old side, and the Conversation's comment, offer none", async () => {
  const { tab } = await drawCommentable();

  const comment = await pickLines({
    start: 12,
    side: DIFF_SELECTION_SIDE.ADDITIONS,
    end: 13,
    endSide: DIFF_SELECTION_SIDE.ADDITIONS,
  });

  writeLineComment(comment, "Say it once:");

  await typeOnNewLine(comment, "/sugg");
  assert.deepEqual(slashRows(comment), ["Suggestion"]);
  pressInBox(comment, { key: "Enter" });

  assert.equal(
    comment.querySelector("pre > code.language-suggestion")?.textContent,
    "  once();\n  done();",
    "the lines stand in the block as they read now, to be changed",
  );
  act(() => commentOffer(comment, "Add single comment").click());
  await settle();
  const sent = world.changes.at(-1)?.[1];
  assert.ok(sent?.action === PULL_REQUEST_ACTION.ADD_REVIEW_COMMENT, "the comment is sent");
  assert.equal(sent.body, "Say it once:\n\n```suggestion\n  once();\n  done();\n```");

  const pressed = await pickLines({
    start: 13,
    side: DIFF_SELECTION_SIDE.ADDITIONS,
    end: 13,
    endSide: DIFF_SELECTION_SIDE.ADDITIONS,
  });

  act(() =>
    (
      pressed.querySelector<HTMLButtonElement>('button[aria-label="Add a suggestion"]') ??
      assert.fail("a suggestion is offered over the words")
    ).click(),
  );
  assert.equal(pressed.querySelector("pre > code.language-suggestion")?.textContent, "  done();");

  const old = await pickLines({
    start: 12,
    side: DIFF_SELECTION_SIDE.DELETIONS,
    end: 12,
    endSide: DIFF_SELECTION_SIDE.DELETIONS,
  });

  await typeOnNewLine(old, "/");
  assert.ok(slashRows(old).includes("Code block"), "the / menu stands");
  assert.ok(!slashRows(old).includes("Suggestion"), "the old side's lines take no suggestion");
  assert.equal(old.querySelector('button[aria-label="Add a suggestion"]') === null, true);

  await act(async () => option(tab, "Conversation").click());
  await settle();

  const box =
    tab.querySelector<HTMLElement>(".pull-request-comment-box") ??
    assert.fail("the Conversation ends in a comment box");

  await typeOnNewLine(box, "/");
  assert.ok(slashRows(box).includes("Code block"), "the / menu stands");
  assert.ok(!slashRows(box).includes("Suggestion"), "a comment on no lines takes no suggestion");
});

test("a member holding a pending review adds a comment to it and nothing else, and Review counts its comments and offers to discard it, asking first", async () => {
  const { tab } = await drawCommentable({ comments: 2 });

  const comment = await pickLines({
    start: 12,
    side: DIFF_SELECTION_SIDE.DELETIONS,
    end: 12,
    endSide: DIFF_SELECTION_SIDE.DELETIONS,
  });

  assert.deepEqual(footOffers(comment), ["Cancel", "Add review comment"]);
  writeLineComment(comment, "Gone?");
  act(() => commentOffer(comment, "Add review comment").click());
  await settle();

  const review =
    tab.querySelector<HTMLButtonElement>('[aria-label="Review, 2 pending comments"]') ??
    assert.fail("Review counts the pending comments");

  act(() => review.click());

  const panel =
    tab.querySelector<HTMLElement>('[role="dialog"]') ?? assert.fail("Review opens its panel");

  assert.match(panel.textContent ?? "", /2 pending comments will be published\./u);
  act(() => commentOffer(panel, "Discard").click());

  const question =
    document.querySelector<HTMLElement>('[role="alertdialog"]') ??
    assert.fail("Discard asks first");

  act(() => commentOffer(question, "Discard review").click());
  await settle();

  assert.deepEqual(
    world.changes.map(([, request]) => request),
    [
      {
        action: PULL_REQUEST_ACTION.ADD_REVIEW_COMMENT,
        mode: REVIEW_COMMENT_MODE.REVIEW,
        path: INVITE_FILE.path,
        line: 12,
        side: DIFF_SIDE.LEFT,
        body: "Gone?",
        headSha: READ_HEAD,
      },
      { action: PULL_REQUEST_ACTION.DISCARD_REVIEW },
    ],
  );
});

test("a comment GitHub refuses says so under it in GitHub's own words, its words kept, beside Refresh changes, which draws the files as read again", async () => {
  world.changeAnswer = {
    outcome: PULL_REQUEST_WRITE_OUTCOME.REFUSED,
    words: "Pull request review thread line must be part of the diff",
  };
  await drawCommentable(undefined, { ...INVITE_FILE, additions: 5 });

  const lines = () =>
    world.lists
      .at(-1)
      ?.renderHeader(INVITE_FILE.path)
      .querySelector(".agent-published-lines .ui-count-part")?.textContent;

  const comment = await pickLines({
    start: 9,
    side: DIFF_SELECTION_SIDE.ADDITIONS,
    end: 9,
    endSide: DIFF_SELECTION_SIDE.ADDITIONS,
  });

  writeLineComment(comment, "Here.");
  act(() => commentOffer(comment, "Start a review").click());
  await vi.waitFor(() =>
    assert.equal(
      comment.querySelector(".line-comment-note [role='alert']")?.textContent,
      "GitHub refused this change.\nGitHub said: “Pull request review thread line must be part of the diff”",
    ),
  );
  assert.equal(boxWords(comment), "Here.");
  assert.match(lines() ?? "", /\+2/u);
  act(() => commentOffer(comment, "Refresh changes").click());
  await settle();
  assert.match(lines() ?? "", /\+5/u, "the files are drawn as read again");
});

test("Discard's question stands busy until GitHub answers, and says GitHub's refusal in its words", async () => {
  const held = Promise.withResolvers<void>();
  world.changeHeld = held.promise;
  world.changeAnswer = {
    outcome: PULL_REQUEST_WRITE_OUTCOME.REFUSED,
    words: "Review is not pending",
  };
  const { tab } = await drawCommentable({ comments: 1 });
  act(() =>
    (
      tab.querySelector<HTMLButtonElement>('[aria-label="Review, 1 pending comment"]') ??
      assert.fail("Review counts the pending comment")
    ).click(),
  );

  const panel =
    tab.querySelector<HTMLElement>('[role="dialog"]') ?? assert.fail("Review opens its panel");

  act(() => commentOffer(panel, "Discard").click());

  const question = () =>
    document.querySelector<HTMLElement>('[role="alertdialog"]') ??
    assert.fail("Discard asks first");

  act(() => commentOffer(question(), "Discard review").click());
  await settle();

  assert.equal(question().getAttribute("aria-busy"), "true", "the question waits on GitHub");
  held.resolve();
  await settle();
  assert.match(question().textContent ?? "", /GitHub said: “Review is not pending”/u);
});

test("Remove from queue's question goes once a read finds the pull request out of the queue, and a refusal stands in the question for another try", async () => {
  let reads = 0;
  const queued = { queue: true, queued: { position: 2 }, autoMerge: { method: null } } as const;

  const question = () =>
    document.querySelector('[role="dialog"]:not(.ui-toast), [role="alertdialog"]:not(.ui-toast)');

  const tab = await draw(
    controlAnswering({
      pullRequest: () => {
        reads += 1;
        const left = reads > 1 ? { queued: null, autoMerge: null } : {};

        return Promise.resolve({
          pullRequest: {
            ...PULL_REQUEST,
            merge: MERGE_STATE.CLEAN,
            merging: { ...MERGING, ...queued, ...left },
          },
        });
      },
    }),
  );

  await pressBox(tab, "Remove from queue");
  assert.equal(question() !== null, true, "leaving the queue is asked about");
  await pressToolbar(tab, "Refresh");
  await settle();
  assert.equal(question() === null, true, "out of the queue, the question goes");
  assert.deepEqual(world.changes, []);
  act(() => world.root?.unmount());
  world.root = undefined;

  world.changeAnswer = { outcome: PULL_REQUEST_WRITE_OUTCOME.REFUSED, words: "Not in the queue." };
  const again = await draw(merging(MERGE_STATE.CLEAN, queued));
  await pressBox(again, "Remove from queue");
  await answerQuestion("Remove from queue");
  assert.match(
    question()?.textContent ?? "",
    /Not in the queue\./u,
    "the refusal stands in the question",
  );
});

test("Remove from queue's question goes with its panel: hidden, the question is let go and nothing leaves the queue, and shown again it asks nothing", async () => {
  let show: (shown: boolean) => void = () => undefined;

  const control = merging(MERGE_STATE.CLEAN, {
    queue: true,
    queued: { position: 2 },
    autoMerge: { method: null },
  });

  function Hiding() {
    const [shown, setShown] = useState(true);
    show = setShown;

    return createElement(AgentPullRequestTab, {
      agentId: AGENT.id,
      control,
      shown,
      repository: "acme/relay",
      tree: { open: false, onToggle: () => undefined },
      view: PULL_REQUEST_VIEW.CONVERSATION,
      onView: () => undefined,
    });
  }

  const tab = await drawn(createElement(Hiding));

  // Note that the question is read as whether it stands, so a failure prints a word rather than a whole DOM node.
  const question = () =>
    document.querySelector(
      '[role="dialog"]:not(.ui-toast), [role="alertdialog"]:not(.ui-toast)',
    ) !== null;

  await pressBox(tab, "Remove from queue");
  assert.equal(question(), true, "leaving the queue is asked about");
  act(() => show(false));
  assert.equal(question(), false, "the question goes as its panel hides");
  act(() => show(true));
  await settle();

  assert.equal(question(), false, "the panel comes back asking nothing");
  assert.deepEqual(world.changes, []);
});

/** The thread the jumps below land on, by GitHub's node id. */
const JUMPED = "PRRT_kwDOjump";

/** The route's opener the last `Routed` drew, as a link pressed anywhere in the window reaches it. */
let routeOpen: (link: ReadLink) => void = () => undefined;

/** The Pull request tab inside the window's route for a review thread's link, as `openLink` takes it: the view the link names chosen, and the ask left for the tab; every link opened heard. */
function Routed({
  control,
  heard,
  first = PULL_REQUEST_VIEW.CONVERSATION,
}: {
  control: AgentsControl;
  heard: ReadLink[];
  first?: PullRequestView;
}) {
  const [view, setView] = useState<PullRequestView>(first);
  const [reveal, setReveal] = useState<ThreadReveal | undefined>(undefined);

  const open = (link: ReadLink) => {
    heard.push(link);
    const { place } = link;

    if (place.kind !== LINK_DESTINATION.PULL_REQUEST_THREAD) return;
    setView(place.view);
    setReveal((last) => ({
      agentId: place.agentId,
      threadId: place.threadId,
      view: place.view,
      ask: (last?.ask ?? 0) + 1,
    }));
  };

  routeOpen = open;

  return createElement(
    OpenLinkProvider,
    { value: open },
    createElement(
      ThreadRevealProvider,
      {
        value: {
          reveal,
          onRevealed: (ask: number) => setReveal((last) => (last?.ask === ask ? undefined : last)),
        },
      },
      createElement(AgentPullRequestTab, {
        agentId: AGENT.id,
        control,
        shown: true,
        repository: "acme/relay",
        tree: { open: false, onToggle: () => undefined },
        view,
        onView: setView,
      }),
    ),
  );
}

/** A control whose conversation holds the threads given and whose changes hold the files given. */
function jumpControl(
  threads: readonly ReviewThread[],
  files: readonly (typeof INVITE_FILE)[] = [INVITE_FILE],
): AgentsControl {
  return controlAnswering(
    { conversation: () => Promise.resolve({ pullRequest: reviewWith(threads) }) },
    PULL_REQUEST_STATE.OPEN,
    () =>
      Promise.resolve({ pullRequest: { url: PAGE, headSha: READ_HEAD, truncated: false, files } }),
  );
}

/** Lets the frames a landing waits on pass. */
async function frames(count = 3): Promise<void> {
  for (let frame = 0; frame < count; frame += 1) {
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  }
}

/** A thread's head press in the Conversation, which takes it to Files changed. */
function headPress(tab: HTMLElement): HTMLButtonElement {
  return (
    tab.querySelector<HTMLButtonElement>('button[aria-label^="View in Files changed"]') ??
    assert.fail("the thread's file and lines take it to Files changed")
  );
}

/** Ends a card's ring, as its animation would. Note that jsdom has no AnimationEvent, so React hears the prefixed name there, which is sent beside the standard one. */
function ringEnds(card: Element): void {
  for (const name of ["animationend", "webkitAnimationEnd"]) {
    const end = new Event(name, { bubbles: true });
    Object.defineProperty(end, "animationName", { value: "ui-landed" });
    act(() => card.dispatchEvent(end));
  }
}

/** A thread's ⋯ opened and the item named pressed. */
async function threadMenuItem(card: Element, label: string): Promise<void> {
  act(() =>
    (
      card.querySelector<HTMLButtonElement>('button[aria-label="Review thread actions"]') ??
      assert.fail("the thread has its ⋯")
    ).click(),
  );

  const item =
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (each) => each.textContent?.includes(label) === true,
    ) ?? assert.fail(`the ⋯ offers ${label}`);

  act(() => item.click());
  await settle();
}

test("a thread's file and lines in the Conversation take it to Files changed through the window's route for its link: its collapsed file opened, its minimized chip shown, the list scrolled to its line, its lines lit, the thread ringed and focused, and the lines let go as the ring ends", async () => {
  handSettings({}, { [LIVE_READ.WORKSPACE_MEMBERS]: HELD_PEOPLE });
  const heard: ReadLink[] = [];

  const tab = await drawn(
    createElement(Routed, { control: jumpControl([thread({ id: JUMPED })]), heard }),
  );

  // The member collapsed the file and minimized the comments in Files changed before.
  await choose(tab, "Files changed");

  const header = (world.lists.at(-1) ?? assert.fail("the files are drawn")).renderHeader(
    INVITE_FILE.path,
  );

  act(() => header.querySelector<HTMLButtonElement>('button[aria-label="Collapse file"]')?.click());
  act(() => filesViewOptions(tab)?.click());
  act(() =>
    [...document.querySelectorAll<HTMLButtonElement>('[role="switch"]')]
      .find((each) => each.getAttribute("aria-label") === "Minimize inline comments")
      ?.click(),
  );
  act(() => filesViewOptions(tab)?.click());
  await settle();
  assert.equal(world.lists.at(-1)?.files[0]?.collapsed, true, "the file stands collapsed");
  await choose(tab, "Conversation");

  act(() => headPress(tab).click());
  await settle();

  assert.deepEqual(heard.at(-1)?.place, {
    kind: LINK_DESTINATION.PULL_REQUEST_THREAD,
    agentId: AGENT.id,
    threadId: JUMPED,
    view: PULL_REQUEST_THREAD_VIEW.FILES,
  });
  assert.equal(option(tab, "Files changed").getAttribute("aria-selected"), "true");
  const list = world.lists.at(-1) ?? assert.fail("the files are drawn");
  assert.equal(list.files[0]?.collapsed, false, "the file is opened");
  assert.deepEqual(world.listReveals, [`${INVITE_FILE.path}:additions:13`]);

  const lit = {
    path: INVITE_FILE.path,
    selection: {
      start: 12,
      side: DIFF_SELECTION_SIDE.ADDITIONS,
      end: 13,
      endSide: DIFF_SELECTION_SIDE.ADDITIONS,
    },
  };

  assert.deepEqual(list.selected, lit);
  const note = list.renderAnnotation(INVITE_FILE.path, `${PAGE}#discussion_r1`);

  const card =
    note.querySelector(".diff-inline-thread") ?? assert.fail("the chip shows its thread");

  // Pierre draws the thread's note into the list, where it stands in sight.
  (tab.querySelector(".diff-list") ?? assert.fail("the list's box")).appendChild(note);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 600, 400));
  await frames();

  assert.equal(card.hasAttribute("data-landed"), true, "the thread is ringed");
  assert.equal(document.activeElement, card.querySelector("summary"), "the thread takes the focus");
  ringEnds(card);
  assert.equal(world.lists.at(-1)?.selected, undefined, "its lines are let go as the ring ends");
  assert.equal(card.hasAttribute("data-landed"), false);
});

test("a thread on a line no hunk shows, and one a later push outdated, land on their file's list above its diff, opened, the list scrolled to the file's header", async () => {
  const outside = thread({
    id: JUMPED,
    line: 40,
    startLine: 40,
    originalLine: 40,
    originalStartLine: 40,
  });

  const outdated = thread({
    id: "PRRT_kwDOgone",
    line: null,
    startLine: null,
    outdated: true,
    comments: [
      { ...(thread().comments[0] ?? assert.fail("a comment")), url: `${PAGE}#discussion_r2` },
    ],
  });

  const tab = await draw(jumpControl([outside, outdated]));

  act(() => headPress(tab).click());
  await settle();
  assert.equal(option(tab, "Files changed").getAttribute("aria-selected"), "true");
  // Note that the file is revealed once Files changed has read its changes, which land through a query.
  await vi.waitFor(() => assert.deepEqual(world.listReveals, [INVITE_FILE.path]));

  await choose(tab, "Conversation");

  const folded =
    [...tab.querySelectorAll<HTMLElement>(".pull-request-thread")].find((each) =>
      threadLabels(each).includes("Outdated"),
    ) ?? assert.fail("the outdated thread is drawn");

  assert.equal(folded.querySelector("details")?.open, false, "an outdated thread stands folded");
  act(() => headPress(folded).click());
  await settle();

  assert.deepEqual(world.listReveals, [INVITE_FILE.path, INVITE_FILE.path]);

  const above = (world.lists.at(-1) ?? assert.fail("the files are drawn")).renderAnnotation(
    INVITE_FILE.path,
    "above-additions",
  );

  const opened = [...above.querySelectorAll<HTMLElement>(".diff-inline-thread")].map(
    (each) => each.querySelector("details")?.open,
  );

  assert.deepEqual(opened, [true, true], "the outdated thread is opened above the diff");
});

test("a link to a thread opens a folded Conversation to land on it, centering it in the room under the heading stuck at the top, and a card taller than that room landing with its top just under the heading", async () => {
  window.localStorage.setItem(
    "app.conversation-filters",
    JSON.stringify({ hideBots: false, hideResolved: false, conversationOpen: false }),
  );
  const heard: ReadLink[] = [];

  const tab = await drawn(
    createElement(Routed, { control: jumpControl([thread({ id: JUMPED })]), heard }),
  );

  assert.equal(sectionHead(tab, "Conversation").getAttribute("aria-expanded"), "false");
  assert.equal(
    tab.querySelector(".pull-request-thread") === null,
    true,
    "a folded Conversation draws none",
  );

  // The scroller jsdom lays out none for: 400px tall over a long run, clearing 58px at its top for its heading and fade.
  const scroller =
    tab.querySelector<HTMLElement>("[aria-label='Pull request conversation']") ??
    assert.fail("the conversation scrolls");

  scroller.style.overflowY = "auto";
  scroller.style.scrollPaddingTop = "58px";
  sized(scroller, { height: 400, content: 4000 });
  let top = 0;
  Object.defineProperty(scroller, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (value: number) => {
      top = value;
    },
  });
  let cardHeight = 100;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this === scroller) return DOMRect.fromRect({ x: 0, y: 0, width: 600, height: 400 });

    if (this.classList.contains("pull-request-thread")) {
      return DOMRect.fromRect({ x: 0, y: 900, width: 600, height: cardHeight });
    }

    return DOMRect.fromRect({ x: 0, y: 0, width: 0, height: 0 });
  });

  const reveal = async () => {
    act(() =>
      routeOpen({
        workspace: "acme",
        place: {
          kind: LINK_DESTINATION.PULL_REQUEST_THREAD,
          taskId: AGENT.taskId ?? "",
          agentId: AGENT.id,
          threadId: JUMPED,
          view: PULL_REQUEST_THREAD_VIEW.CONVERSATION,
        },
      }),
    );
    await settle();
    await frames();
  };

  await reveal();
  assert.equal(sectionHead(tab, "Conversation").getAttribute("aria-expanded"), "true");
  const card = tab.querySelector(".pull-request-thread") ?? assert.fail("the thread is drawn");
  assert.equal(card.hasAttribute("data-landed"), true, "the thread is landed on");
  assert.equal(top, 900 + 100 / 2 - (58 + (400 - 58) / 2), "centered under the heading's band");

  ringEnds(card);
  top = 0;
  cardHeight = 600;
  await reveal();
  assert.equal(top, 900 - 58, "a tall card's top stands just under the heading's band");
});

test("a thread whose file the changes no longer hold stays in the Conversation, brought into view there; a link to one the conversation no longer holds is let go", async () => {
  const heard: ReadLink[] = [];

  const tab = await drawn(
    createElement(Routed, {
      control: jumpControl([thread({ id: JUMPED, path: "src/gone.ts" })]),
      heard,
    }),
  );

  act(() => headPress(tab).click());
  await settle();
  await frames();

  // Note that the Conversation is chosen through the route a Query notification later than the press.
  await vi.waitFor(() =>
    assert.equal(option(tab, "Conversation").getAttribute("aria-selected"), "true"),
  );
  assert.deepEqual(world.listReveals, [], "no file is scrolled to");
  const card = tab.querySelector(".pull-request-thread") ?? assert.fail("the thread stands");
  assert.equal(card.hasAttribute("data-landed"), true, "the thread is shown where it stays");

  ringEnds(card);
  act(() =>
    routeOpen({
      workspace: "acme",
      place: {
        kind: LINK_DESTINATION.PULL_REQUEST_THREAD,
        taskId: AGENT.taskId ?? "",
        agentId: AGENT.id,
        threadId: "PRRT_kwDOnone",
        view: PULL_REQUEST_THREAD_VIEW.CONVERSATION,
      },
    }),
  );
  await settle();
  await frames();
  assert.equal(card.hasAttribute("data-landed"), false, "nothing is landed on");
});

test("every review thread's head leads with its chevron and ends with its ⋯, in the Conversation as on its line in Files changed, and a press on the row folds it", async () => {
  const tab = await drawn(
    createElement(
      LinkWorkspaceProvider,
      { value: "acme" },
      createElement(Routed, {
        control: jumpControl([thread({ id: JUMPED })]),
        heard: [],
        first: PULL_REQUEST_VIEW.FILES,
      }),
    ),
  );

  const inline = (world.lists.at(-1) ?? assert.fail("the files are drawn")).renderAnnotation(
    INVITE_FILE.path,
    `${PAGE}#discussion_r1`,
  );

  document.body.appendChild(inline);
  await choose(tab, "Conversation");
  const card = tab.querySelector(".pull-request-thread") ?? assert.fail("the thread is drawn");

  for (const [where, root] of [
    ["the Conversation", card],
    ["its line", inline],
  ] as const) {
    const head =
      root.querySelector<HTMLElement>(".annotation-card-fold > summary") ??
      assert.fail(`the thread on ${where} has a head`);

    assert.ok(
      head.firstElementChild?.querySelector(".ui-disclosure-turn"),
      `on ${where}, the chevron leads the head`,
    );

    const menu =
      head
        .closest(".ui-disclosure-frame")
        ?.lastElementChild?.querySelector(".pull-request-thread-menu") ??
      assert.fail(`on ${where}, the ⋯ ends the head's row`);

    assert.equal(head.contains(menu), false, `on ${where}, the ⋯ stands beside the head`);
    assert.equal(
      head.querySelector("button") === null,
      true,
      `on ${where}, no control stands in the head`,
    );
    assert.equal(head.getAttribute("aria-expanded"), "true");
    act(() => head.click());
    assert.equal(head.getAttribute("aria-expanded"), "false", `on ${where}, the row folds it`);
  }
});

test("a thread's ⋯ in Files changed shows it in the Conversation through the same route, standing through Hide resolved, ringed and focused there", async () => {
  window.localStorage.clear();
  const heard: ReadLink[] = [];
  const resolved = thread({ id: JUMPED, resolved: true });

  const tab = await drawn(
    createElement(Routed, {
      control: jumpControl([resolved]),
      heard,
      first: PULL_REQUEST_VIEW.FILES,
    }),
  );

  await choose(tab, "Conversation");
  await turnFilter(tab, "Hide resolved");
  assert.equal(
    tab.querySelector(".pull-request-thread") === null,
    true,
    "Hide resolved leaves it out",
  );
  await choose(tab, "Files changed");

  const note = (world.lists.at(-1) ?? assert.fail("the files are drawn")).renderAnnotation(
    INVITE_FILE.path,
    `${PAGE}#discussion_r1`,
  );

  document.body.appendChild(note);

  await threadMenuItem(note, "View in Conversation");
  await frames();

  assert.equal(heard.at(-1)?.place.kind, LINK_DESTINATION.PULL_REQUEST_THREAD);
  assert.equal(option(tab, "Conversation").getAttribute("aria-selected"), "true");
  const card = tab.querySelector(".pull-request-thread") ?? assert.fail("the thread stands");
  assert.equal(card.querySelector("details")?.open, true, "the resolved thread is opened");
  assert.equal(card.hasAttribute("data-landed"), true);
  assert.equal(document.activeElement, card.querySelector("summary"));
});

test("Copy link in a thread's ⋯ copies its Vespin link in the view it is drawn in; a thread with no id offers no ⋯ and no press to Files changed", async () => {
  const copied: string[] = [];
  fakeAppPlatform({ ...DESKTOP_LINKS, ...copyingInto(copied) });

  const tab = await drawn(
    createElement(
      LinkWorkspaceProvider,
      { value: "acme" },
      createElement(Switching, {
        control: jumpControl([thread({ id: JUMPED }), thread({ comments: [] })]),
        first: PULL_REQUEST_VIEW.CONVERSATION,
      }),
    ),
  );

  const [card] = tab.querySelectorAll(".pull-request-thread");

  await threadMenuItem(card ?? assert.fail("the thread is drawn"), "Copy link");

  assert.deepEqual(copied, [
    `https://vespin.dev/acme/agent/${AGENT.id}/changes/conversation/thread/${JUMPED}`,
  ]);
});

test("a link in the pull request's words to one of its own comments on GitHub opens it in the tab: a line comment through its thread's route, a comment brought into view, ringed and focused; one the read did not reach opens on GitHub", async () => {
  const heard: ReadLink[] = [];

  const links = [
    `<a href="${PAGE}#discussion_r1">the thread</a>`,
    `<a href="${PAGE}#issuecomment-2">the note</a>`,
    `<a href="${PAGE}#issuecomment-99">an older note</a>`,
  ].join(" ");

  const conversation = reviewWith([thread({ id: JUMPED })]);

  const tab = await drawn(
    createElement(Routed, {
      control: controlAnswering({
        pullRequest: () =>
          Promise.resolve({ pullRequest: { ...PULL_REQUEST, html: `<p>See ${links}.</p>` } }),
        conversation: () =>
          Promise.resolve({
            pullRequest: {
              ...conversation,
              conversation: [...conversation.conversation, ...CONVERSATION.conversation.slice(-1)],
            },
          }),
      }),
      heard,
    }),
  );

  const press = async (words: string) => {
    const link =
      [...tab.querySelectorAll<HTMLElement>(".pull-request-words a")].find(
        (each) => each.textContent === words,
      ) ?? assert.fail(`the description links ${words}`);

    await act(async () => link.click());
    await settle();
  };

  await press("the thread");
  assert.deepEqual(heard.at(-1)?.place, {
    kind: LINK_DESTINATION.PULL_REQUEST_THREAD,
    agentId: AGENT.id,
    threadId: JUMPED,
    view: PULL_REQUEST_THREAD_VIEW.CONVERSATION,
  });

  await press("the note");
  await frames();

  const note =
    [...tab.querySelectorAll<HTMLElement>(".pull-request-entry")].find((each) =>
      each.textContent?.includes("GitHub sent no rendering of"),
    ) ?? assert.fail("the note is drawn");

  assert.equal(note.hasAttribute("data-landed"), true, "the note is ringed");
  assert.equal(document.activeElement, note, "the note takes the focus");
  ringEnds(note);
  act(() => note.blur());
  await press("the note");
  await frames();
  assert.equal(note.hasAttribute("data-landed"), true, "the same link pressed again lands again");
  assert.equal(document.activeElement, note);

  await press("an older note");
  assert.deepEqual(
    world.opened,
    [`${PAGE}#issuecomment-99`],
    "only the note the read did not reach leaves for GitHub",
  );
});

test("a thread on a changed image a filter left out lands above its picture once the filter is cleared, the list scrolled to the file's header rather than a line the picture draws none of", async () => {
  const logo = {
    path: "assets/logo.svg",
    previousPath: null,
    status: CHANGED_FILE_STATUS.MODIFIED,
    additions: 1,
    deletions: 1,
    omitted: null,
    patch: "@@ -1,3 +1,3 @@\n <svg>\n-<rect/>\n+<circle/>\n </svg>",
  };

  const onLogo = thread({
    id: JUMPED,
    path: logo.path,
    line: 2,
    startLine: null,
    originalLine: 2,
    originalStartLine: null,
    startSide: null,
  });

  // The picture is read as it comes near the view, which nothing here watches.
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );

  function WithTree() {
    const [view, setView] = useState<PullRequestView>(PULL_REQUEST_VIEW.FILES);

    return createElement(AgentPullRequestTab, {
      agentId: AGENT.id,
      control: jumpControl([onLogo], [INVITE_FILE, logo]),
      shown: true,
      repository: "acme/relay",
      tree: { open: true, onToggle: () => undefined },
      view,
      onView: setView,
    });
  }

  const tab = await drawn(createElement(WithTree));

  const field =
    tab.querySelector<HTMLInputElement>('input[aria-label="Search files"]') ??
    assert.fail("the tree's search stands");

  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, "src");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
  assert.deepEqual(
    world.lists.at(-1)?.files.map((file) => file.path),
    [INVITE_FILE.path],
    "the filter leaves the image out",
  );
  await choose(tab, "Conversation");

  act(() => headPress(tab).click());
  await settle();

  assert.deepEqual(world.listReveals, [logo.path]);
  const list = world.lists.at(-1) ?? assert.fail("the files are drawn");
  assert.ok(
    list.files.some((file) => file.path === logo.path),
    "the filter is cleared",
  );

  const holding = (list.files.find((file) => file.path === logo.path)?.annotations ?? []).find(
    (note) =>
      list.renderAnnotation(logo.path, note.key).querySelector(".diff-inline-thread") !== null,
  );

  assert.equal(holding?.line, 0, "the thread stands above the picture, on no line of it");
});

test("a landing waits for the panel to be visible before it takes the focus, as a panel still arriving refuses it", async () => {
  const heard: ReadLink[] = [];

  const tab = await drawn(
    createElement(Routed, {
      control: jumpControl([thread({ id: JUMPED, path: "src/gone.ts" })]),
      heard,
    }),
  );

  tab.style.visibility = "hidden";

  act(() => headPress(tab).click());
  await settle();
  await frames();
  const card = tab.querySelector(".pull-request-thread") ?? assert.fail("the thread stands");
  assert.equal(card.hasAttribute("data-landed"), false, "nothing lands on a hidden panel");

  tab.style.visibility = "visible";
  await frames();
  assert.equal(card.hasAttribute("data-landed"), true, "the landing ends once the panel is seen");
  assert.equal(document.activeElement, card.querySelector("summary"));
});

/** Three files of differing sizes, +60 −7 in all, as the changes read names them. */
const SIZED = [
  ["a.ts", 10, 2],
  ["b.ts", 20, 5],
  ["c.ts", 30, 0],
] as const;

/** The plan's agents, the pull request published at the size given (+60 −7 in 3 files unless told), its changes those three files, read in full unless told, and the member's marks as given. */
function viewing(
  marked: readonly string[],
  options: {
    readonly published?: readonly [number, number];
    readonly changedFiles?: number;
    readonly truncated?: boolean;
  } = {},
) {
  const [additions, deletions] = options.published ?? [60, 7];
  const changedFiles = options.changedFiles ?? SIZED.length;

  const viewed = () =>
    Promise.resolve({
      outcome: PULL_REQUEST_WRITE_OUTCOME.DONE,
      files: SIZED.map(([path]) => ({
        path,
        state: marked.includes(path) ? FILE_VIEWED_STATE.VIEWED : FILE_VIEWED_STATE.UNVIEWED,
      })),
    });

  const control: AgentsControl = {
    ...controlAnswering({ viewed }, PULL_REQUEST_STATE.OPEN, () =>
      Promise.resolve({
        pullRequest: {
          url: PAGE,
          truncated: options.truncated ?? false,
          files: SIZED.map(([path, additions, deletions]) => ({
            path,
            previousPath: null,
            status: CHANGED_FILE_STATUS.MODIFIED,
            additions,
            deletions,
            patch: "@@ -1 +1 @@\n-a\n+b\n",
            omitted: null,
          })),
        },
      }),
    ),
    pullRequests: new Map([
      [AGENT.id, { ...published(PULL_REQUEST_STATE.OPEN), additions, deletions, changedFiles }],
    ]),
  };

  return { control };
}

/** A file's Viewed box, in the header Files changed's list draws for it. */
function viewedBoxOf(path: string): HTMLInputElement {
  const list = world.lists.at(-1) ?? assert.fail("Files changed draws its list");
  const head = list.renderHeader(path);

  if (!head.isConnected) document.body.append(head);

  return (
    head.querySelector<HTMLInputElement>('.diff-list-viewed input[type="checkbox"]') ??
    assert.fail(`${path} offers a Viewed box`)
  );
}

/** What the hint over the header's lines says, once the pointer rests on them. */
async function linesHint(tab: HTMLElement): Promise<string | undefined> {
  const lines = tab.querySelector<HTMLElement>(".pull-request-lines");

  if (lines === null) return assert.fail("the header counts the lines");
  restOn(lines);
  await settle();
  // Note that words taking no focus own their hint, which a reader hears at their end.
  const hint = lines.getAttribute("aria-owns");

  return hint === null ? undefined : (document.getElementById(hint)?.textContent ?? undefined);
}

test("the header counts the lines published until Files changed is first opened; then those left to review, the whole in its hint, as the tab counts the files viewed", async () => {
  const tab = await draw(viewing(["a.ts"]).control);
  assert.equal(headerLines(tab), "+60 −7");
  assert.equal(tabCount(tab, "Files changed"), "3");

  await choose(tab, "Files changed");
  await vi.waitFor(() => assert.equal(headerLines(tab), "+50 −5 left"));
  assert.equal(await linesHint(tab), "+60 −7 total");
  assert.equal(tabCount(tab, "Files changed"), "1/3 viewed");
  await choose(tab, "Conversation");
  assert.equal(headerLines(tab), "+50 −5 left", "the count stands on another tab");
  assert.equal(tabCount(tab, "Files changed"), "1/3 viewed");
});

test("ticking a file's Viewed box counts it at once, before GitHub answers, and one GitHub refuses counts again as its mark goes back", async () => {
  const { control } = viewing(["a.ts"]);
  const tab = await draw(control, PULL_REQUEST_VIEW.FILES);
  await vi.waitFor(() => assert.equal(headerLines(tab), "+50 −5 left"));

  const { promise, resolve } = Promise.withResolvers<void>();
  world.changeHeld = promise;
  act(() => viewedBoxOf("c.ts").click());
  assert.equal(headerLines(tab), "+20 −5 left", "the tick counts at once");
  assert.equal(tabCount(tab, "Files changed"), "2/3 viewed");
  resolve();
  await settle();
  assert.equal(headerLines(tab), "+20 −5 left");

  world.changeHeld = undefined;
  world.changeAnswer = {
    outcome: PULL_REQUEST_WRITE_OUTCOME.REFUSED,
    words: "Pull request is locked.",
  };
  act(() => viewedBoxOf("b.ts").click());
  await settle();
  assert.equal(headerLines(tab), "+20 −5 left", "a refused mark counts again");
  assert.equal(tabCount(tab, "Files changed"), "2/3 viewed");
  assert.deepEqual(
    world.changes.map(([, request]) => request),
    [
      { action: PULL_REQUEST_ACTION.MARK_FILE_VIEWED, path: "c.ts" },
      { action: PULL_REQUEST_ACTION.MARK_FILE_VIEWED, path: "b.ts" },
    ],
  );
});

test("with every file viewed, or none, the header counts the whole and hints nothing more", async () => {
  for (const [marked, files] of [
    [["a.ts", "b.ts", "c.ts"], "3/3 viewed"],
    [[], "3"],
  ] as const) {
    const tab = await draw(viewing(marked).control, PULL_REQUEST_VIEW.FILES);
    assert.equal(headerLines(tab), "+60 −7", `${marked.length} viewed`);
    assert.equal(
      tab.querySelector(".pull-request-lines")?.getAttribute("aria-owns") === null,
      true,
    );
    await vi.waitFor(() => assert.equal(tabCount(tab, "Files changed"), files));
    act(() => world.root?.unmount());
    world.root = undefined;
  }
});

test("ticking the last file left counts the whole again, every file viewed", async () => {
  const tab = await draw(viewing(["a.ts", "b.ts"]).control, PULL_REQUEST_VIEW.FILES);
  await vi.waitFor(() => assert.equal(headerLines(tab), "+30 −0 left"));
  act(() => viewedBoxOf("c.ts").click());
  await settle();
  assert.equal(headerLines(tab), "+60 −7");
});

test("once its files are read, the header and Files changed count from them, so a pull request pushed to since it was published counts what the read holds", async () => {
  const tab = await draw(viewing(["a.ts"], { published: [40, 5], changedFiles: 2 }).control);
  assert.equal(headerLines(tab), "+40 −5", "until the files land, what was published");
  assert.equal(tabCount(tab, "Files changed"), "2");
  await choose(tab, "Files changed");
  await vi.waitFor(() => assert.equal(headerLines(tab), "+50 −5 left"));
  assert.equal(await linesHint(tab), "+60 −7 total");
  assert.equal(tabCount(tab, "Files changed"), "1/3 viewed");
});

test("where the read stopped short of every file, the whole is what was published, and every file read being viewed still leaves the rest to review", async () => {
  const tab = await draw(
    viewing(["a.ts", "b.ts", "c.ts"], { published: [100, 20], changedFiles: 5, truncated: true })
      .control,
    PULL_REQUEST_VIEW.FILES,
  );

  await vi.waitFor(() => assert.equal(headerLines(tab), "+40 −13 left"));
  assert.equal(await linesHint(tab), "+100 −20 total");
  assert.equal(tabCount(tab, "Files changed"), "3/5 viewed");
});

test("where the read stopped short of more files than were published, Files changed counts at least those read", async () => {
  const tab = await draw(
    viewing(["a.ts", "b.ts"], { changedFiles: 1, truncated: true }).control,
    PULL_REQUEST_VIEW.FILES,
  );

  await vi.waitFor(() => assert.equal(tabCount(tab, "Files changed"), "2/3 viewed"));
});

/** A comment of the member's own pending review on the invite file, starting a thread of its own on line 12 unless told otherwise. */
function draftOf(overrides: Partial<PendingReviewComment> = {}): PendingReviewComment {
  return {
    id: "PRRC_start",
    by: { login: "dana", bot: false },
    path: INVITE_FILE.path,
    line: 12,
    startLine: null,
    side: DIFF_SIDE.RIGHT,
    startSide: null,
    html: '<p dir="auto">Why <strong>four</strong>?</p>',
    body: "Why **four**?",
    at: 3_000,
    ...overrides,
  };
}

/** Writes words into the field labeled as given, as the member would. */
function typeInto(within: Element, label: string, words: string): void {
  writeBox(within, words, label);
}

test("a pending comment edited and saved untouched sends its Markdown back byte for byte, GitHub's alert, mention, issue, and suggestion as written", async () => {
  const body = "> [!NOTE]\n> cc @dana, see #123.\n\n```suggestion\n  once();\n```";

  const tab = await draw(
    controlAnswering(
      {
        conversation: () =>
          Promise.resolve({
            pullRequest: {
              ...reviewWith([]),
              pendingReview: { comments: 1, drafts: [draftOf({ html: null, body })] },
            },
          }),
      },
      PULL_REQUEST_STATE.OPEN,
      () =>
        Promise.resolve({
          pullRequest: { url: PAGE, headSha: READ_HEAD, truncated: false, files: [INVITE_FILE] },
        }),
    ),
  );

  await choose(tab, "Files changed");

  const card = (world.lists.at(-1) ?? assert.fail("the files are drawn")).renderAnnotation(
    INVITE_FILE.path,
    "PRRC_start",
  );

  // Note that the card folded closed opens for its ⋯'s Edit, so the field it opens is in view.
  act(() =>
    (card.querySelector<HTMLElement>(".annotation-card-fold > summary") ?? assert.fail()).click(),
  );
  await settle();
  assert.equal(card.querySelector(".pull-request-thread-comment") === null, true, "folded closed");
  pendingAct(card, "Edit");
  await settle();
  assert.ok(card.querySelector("pre > code.language-suggestion"), "the edit opens on its Markdown");
  act(() => commentOffer(card, "Save").click());
  await settle();

  assert.deepEqual(world.changes, [
    [AGENT.id, { action: PULL_REQUEST_ACTION.EDIT_REVIEW_COMMENT, commentId: "PRRC_start", body }],
  ]);
});

test("the member's pending comments stand on their lines in Files changed, marked Pending in their own name: a reply as its thread's last comment, a new one as a card of its own; Edit sends new words, Delete asks first, and the Review panel lists them", async () => {
  const reply = draftOf({
    id: "PRRC_reply",
    threadId: JUMPED,
    line: 13,
    html: null,
    body: "Still once?",
  });

  const tab = await draw(
    controlAnswering(
      {
        conversation: () =>
          Promise.resolve({
            pullRequest: {
              ...reviewWith([thread({ id: JUMPED })]),
              pendingReview: { comments: 2, drafts: [reply, draftOf()] },
            },
          }),
      },
      PULL_REQUEST_STATE.OPEN,
      () =>
        Promise.resolve({
          pullRequest: { url: PAGE, headSha: READ_HEAD, truncated: false, files: [INVITE_FILE] },
        }),
    ),
  );

  await choose(tab, "Files changed");

  const list = world.lists.at(-1) ?? assert.fail("the files are drawn");
  assert.deepEqual(
    list.files[0]?.annotations.map(({ key, side, line }) => [key, side, line]),
    [
      [`${PAGE}#discussion_r1`, "additions", 13],
      ["PRRC_start", "additions", 12],
    ],
    "the reply adds no card of its own",
  );
  const card = list.renderAnnotation(INVITE_FILE.path, "PRRC_start");
  assert.match(card.textContent ?? "", /dana.*Pending/u);
  assert.match(
    card.querySelector(".annotation-card-fold > summary")?.textContent ?? "",
    /Pending/u,
  );
  assert.equal(
    (card.textContent ?? "").split("Pending").length - 1,
    1,
    "the card it starts wears Pending in its head alone",
  );
  assert.match(card.textContent ?? "", /Why four\?/u, "its words as GitHub rendered them");
  const replied = list.renderAnnotation(INVITE_FILE.path, `${PAGE}#discussion_r1`);
  const comments = [...replied.querySelectorAll<HTMLElement>(".pull-request-thread-comment")];
  assert.equal(comments.length, 2);
  assert.match(comments[1]?.textContent ?? "", /dana.*Pending.*Still once\?/u);
  assert.doesNotMatch(
    comments[0]?.textContent ?? "",
    /Pending/u,
    "the published comment stays as it was",
  );

  // Edit opens the words in place; Cancel keeps nothing, Save sends the new words.
  pendingAct(card, "Edit");
  typeInto(card, "Pending comment", "Thrown away");
  act(() => commentOffer(card, "Cancel").click());
  assert.equal(boxWordsElement(card) === null, true);
  pendingAct(card, "Edit");
  assert.equal(boxWords(card), "Why four?", "the edit opens on the comment's own words");
  typeInto(card, "Pending comment", "Why **five**?");
  act(() => commentOffer(card, "Save").click());
  await settle();

  // Delete asks first, since it cannot be undone.
  pendingAct(comments[1] ?? assert.fail(), "Delete");

  const question =
    document.querySelector<HTMLElement>('[role="alertdialog"]') ?? assert.fail("Delete asks first");

  act(() => commentOffer(question, "Delete comment").click());
  await settle();

  assert.deepEqual(world.changes, [
    [
      AGENT.id,
      {
        action: PULL_REQUEST_ACTION.EDIT_REVIEW_COMMENT,
        commentId: "PRRC_start",
        body: "Why **five**?",
      },
    ],
    [AGENT.id, { action: PULL_REQUEST_ACTION.DELETE_REVIEW_COMMENT, commentId: "PRRC_reply" }],
  ]);

  act(() =>
    (
      tab.querySelector<HTMLButtonElement>('[aria-label="Review, 2 pending comments"]') ??
      assert.fail("Review counts the pending comments")
    ).click(),
  );

  const panel =
    tab.querySelector<HTMLElement>('[role="dialog"]') ?? assert.fail("Review opens its panel");

  const listed = [...panel.querySelectorAll('ol[aria-label="Pending"] > li')].map(
    (each) => each.querySelector(".pull-request-pending-where")?.textContent,
  );

  assert.deepEqual(listed, ["src/invite.ts · line 13", "src/invite.ts · line 12"]);
  assert.equal(
    panel.querySelector(".pull-request-pending-where")?.getAttribute("data-font"),
    "mono",
    "a pending comment's place reads in the monospace face, as a path does",
  );

  // ⌘↩ in a listed comment's edit saves that comment alone, never the whole review.
  const entry = panel.querySelector<HTMLElement>('ol[aria-label="Pending"] > li') ?? assert.fail();
  pendingAct(entry, "Edit");
  typeInto(entry, "Pending comment", "Still once, really?");
  pressInBox(entry, { key: "Enter", metaKey: true }, "Pending comment");
  await settle();
  assert.deepEqual(
    world.changes.slice(2).map(([, change]) => change),
    [
      {
        action: PULL_REQUEST_ACTION.EDIT_REVIEW_COMMENT,
        commentId: "PRRC_reply",
        body: "Still once, really?",
      },
    ],
  );
  act(() => commentOffer(panel, "Cancel").click());

  // A Delete asked in Files changed goes as another view of the tab is chosen.
  pendingAct(card, "Delete");
  assert.ok(document.querySelector('[role="alertdialog"]'), "Delete asks first");
  await act(async () => option(tab, "Conversation").click());
  await settle();
  assert.equal(document.querySelector('[role="alertdialog"]') === null, true);
});

test("on a phone no Preview stands beside the title, and Files changed draws no bar: the task's header's ⋯ offers each after the pull request's own, the merge staying in the header", async () => {
  const readChanges: ReadChanges = () =>
    Promise.resolve({
      pullRequest: {
        url: PAGE,
        truncated: false,
        files: [
          {
            path: "src/invite.ts",
            previousPath: null,
            status: CHANGED_FILE_STATUS.MODIFIED,
            additions: 1,
            deletions: 0,
            omitted: null,
            patch: "@@ -1,1 +1,2 @@\n const seats = 3;\n+const plan = 1;",
          },
        ],
      },
    });

  const control = controlAnswering(
    {
      checks: () =>
        Promise.resolve({
          pullRequest: {
            ...CHECKS,
            deployments: [
              {
                environment: "Preview – luke-web",
                state: DEPLOYMENT_STATE.READY,
                url: "https://web-git-expiry.vercel.app",
              },
            ],
          },
        }),
    },
    PULL_REQUEST_STATE.OPEN,
    readChanges,
  );

  const tab = await drawn(
    createElement(
      ShellRoomContext.Provider,
      { value: SHELL_ROOM.NARROW },
      createElement(Switching, {
        control,
        first: PULL_REQUEST_VIEW.CONVERSATION,
      }),
    ),
  );

  assert.deepEqual(
    words(tab, ".pull-request-title-actions button").filter((each) => /Preview/u.test(each)),
    [],
    "beside the title stands the merge alone",
  );
  assert.deepEqual(toolbarItems(tab), [
    "Copy GitHub link",
    "Open on GitHub",
    "Refresh",
    "Preview – luke-web",
  ]);
  await pressToolbar(tab, "Preview – luke-web");
  assert.deepEqual(world.opened, ["https://web-git-expiry.vercel.app"]);

  await choose(tab, "Files changed");
  assert.equal(tab.querySelector(".file-view-bar") === null, true, "Files changed draws no bar");
  assert.deepEqual(toolbarItems(tab), [
    "Copy GitHub link",
    "Open on GitHub",
    "Refresh",
    "Preview – luke-web",
    "Show files",
    "View options",
    "Collapse all files",
    "Copy patch",
    "Download patch",
  ]);

  await choose(tab, "Conversation");
  assert.deepEqual(
    toolbarItems(tab).slice(4),
    [],
    "Files changed's items go with it once another view is shown",
  );
});
