// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { MOTION_DELAY_MS } from "@repo/brand";
import {
  AGENT_CALL_FAILURE,
  type AgentOverviewChecksAnswerView,
  type AgentOverviewConversationAnswerView,
  type AgentOverviewPullRequestAnswerView,
} from "@repo/features/agent-view";
import {
  type AgentOverviewChecks,
  type AgentOverviewConversation,
  type AgentOverviewPullRequest,
  CHECK_STATE,
  CHECK_SUMMARY,
  CONVERSATION_ENTRY,
  DEPLOYMENT_STATE,
  type GitHubPerson,
  MERGE_STATE,
  PULL_REQUEST_STATE,
  REVIEW_DECISION,
  REVIEW_STATE,
} from "@repo/features/agent-wire";
import { FAILURE_FACT } from "@repo/features/failure-facts";
import { LINK_DESTINATION, type ReadLink } from "@repo/features/link-grammar";
import { LIVE_READ } from "@repo/features/live-wire";
import {
  MERGE_METHOD,
  PULL_REQUEST_ACTION,
  PULL_REQUEST_WRITE_OUTCOME,
  type PullRequestActionRequest,
  REACTION,
  REVIEW_EVENT,
} from "@repo/features/pull-request-write-wire";
import { type ShownFailureSentry, sendShownFailure } from "@repo/features/shown-failure";
import { IDLE_TASKS_VIEW } from "@repo/features/tasks-view";
import { WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import { serveEffectsOn } from "@repo/ui/testing/effect-services";
import { Clock, Context, Effect } from "effect";
import { TestClock } from "effect/testing";
import { act, createElement } from "react";
import { onTestFinished, test, vi } from "vitest";
import { installShownFailureReporter } from "../failure-report.js";
import { SHELL_ROOM } from "../shell-room.js";
import { ShellRoomContext } from "../stage-room.js";
import {
  AGENT,
  answerQuestion,
  BADGE,
  boxEditor,
  boxWords,
  CHARLES_ON_GITHUB,
  CHECKS,
  CONVERSATION,
  check,
  checksGlyph,
  choose,
  controlAnswering,
  draw,
  drawn,
  held,
  MERGING,
  mergeControl,
  mergePresses,
  mergeShown,
  mergeStatus,
  merging,
  NO_GITHUB,
  offered,
  option,
  PAGE,
  PIXEL,
  PULL_REQUEST,
  pill,
  pillOf,
  pillPress,
  pressAction,
  pressBox,
  pressInBox,
  pressItem,
  pressToolbar,
  SCREENSHOT,
  Switching,
  sectionHead,
  settle,
  sized,
  standing,
  tabCount,
  thread,
  threadLabels,
  toolbarItems,
  UPLOAD,
  viewOptions,
  waiting,
  words,
  world,
  writeBox,
} from "../testing/agent-pull-request-tab.js";
import { fakeAppBridge, fakeAppBridgeCalls } from "../testing/app-bridge.js";
import { copyingInto, DESKTOP_LINKS, fakeAppPlatform } from "../testing/app-platform.js";
import { testQueryClientNow } from "../testing/copy-feedback.js";
import { restOn } from "../testing/hint-rest.js";
import { relayout } from "../testing/resize-observer.js";
import { viewerPlace } from "../testing/viewer-place.js";
import { RepositoryRemedyProvider } from "./repository-remedy.js";
import { PULL_REQUEST_VIEW } from "./task-tab-model.js";
import type { AgentsControl } from "./use-agents.js";

/**
 * agent-pull-request-tab.test.ts -- an agent's Pull request tab draws its
 * pull request as a page: where it stands beside its title, its branches,
 * whether it would merge, its checks with what failed first, its
 * description as markdown, and its comments and reviews in time order, a
 * long one sending the reader to GitHub for the rest; it opens the agent's
 * Changes from its bar, says so where there is no pull request yet, and
 * offers a retry where a read failed. The overview is three reads, the pull
 * request itself, its checks, and its conversation, each drawn as it lands,
 * a skeleton until then, under the pill and title the app already held.
 * Synthetic people throughout.
 */

/** The button whose words match, where one stands. */
function buttonWith(container: HTMLElement, label: RegExp): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find((each) =>
    label.test(each.textContent ?? ""),
  );
}

test("the tab draws the pull request as a page: its standing and branches, whether it merges, its checks with failures first, its description, and its conversation in time order", async () => {
  const tab = await draw(controlAnswering());

  assert.equal(standing(tab), "Open");
  await vi.waitFor(() =>
    assert.equal(
      tab.querySelector(".pull-request-branches")?.textContent,
      "main ← luke/expiry-job",
    ),
  );
  assert.equal(tab.querySelector(".pull-request-title")?.textContent, "Expire invitations #42");
  const merge = mergeStatus(tab) ?? assert.fail("an open pull request says where its merge stands");
  assert.equal(merge.querySelector(".ui-chip")?.textContent, "Conflicts");
  assert.equal(
    merge.querySelector(".ui-visually-hidden")?.textContent,
    ": Conflicts with main",
    "an open pull request says whether it would merge",
  );

  const opener =
    tab.querySelector(".pull-request-people [data-actor-ref]") ??
    assert.fail("who opened it is named");

  assert.deepEqual(
    [opener.querySelector(".ui-inline-ref-label")?.textContent, opener.getAttribute("data-kind")],
    ["luke-agent", "github"],
    "Vespin's own App's bot opened it, an App's bot on GitHub like any other",
  );

  const description =
    tab.querySelector('[aria-label="Description"]') ?? assert.fail("the description stands");

  assert.equal(
    description.querySelector(".ui-markdown-heading")?.textContent,
    "Summary",
    "GitHub's heading stands, as words and no heading element",
  );
  assert.equal(
    description.querySelector("a.anchor, [href='#summary']") === null,
    true,
    "its permalink does not",
  );
  assert.equal(description.querySelector("strong")?.textContent, "seven days");
  assert.match(
    description.textContent ?? "",
    /@charlespan asked\./u,
    "a mention stands as GitHub drew it",
  );
  assert.equal(description.querySelector(".ui-code-card-title")?.textContent, "TypeScript");
  assert.equal(
    description.querySelector(".ui-code-card-body")?.textContent,
    "const days = 7;\n\nexport default days;",
    "a highlighted block is the window's own code block in its language, a blank line in it kept",
  );
  assert.equal(
    description.querySelector('[role="checkbox"]')?.getAttribute("aria-label"),
    "Sweep",
    "a task list stands, each box named by its item",
  );
  assert.equal(description.querySelectorAll(".ui-code-card").length, 1, "inline code stays inline");
  assert.match(description.textContent ?? "", /Run pnpm test first\./u);
  assert.equal(description.querySelector("script") === null, true, "a script never stands");
  assert.ok(!("stolen" in window), "nor does it run");
  await settle();
  assert.deepEqual(
    world.images,
    [UPLOAD, BADGE, SCREENSHOT],
    "only an image GitHub serves is asked for, through the service",
  );

  const upload = await vi.waitFor(
    () =>
      description.querySelector<HTMLImageElement>('img[alt="before and after"]') ??
      assert.fail("the upload is drawn"),
  );

  await vi.waitFor(() =>
    assert.equal(upload.src, `data:${PIXEL.contentType};base64,${PIXEL.base64}`),
  );
  assert.equal(
    description.querySelector('img[alt="pixel"]') === null,
    true,
    "an image elsewhere is not drawn",
  );
  assert.match(description.textContent ?? "", /pixel/u, "it stands as its link");
  assert.equal(
    description.querySelector("source") === null,
    true,
    "a themed badge names no address the window would read itself",
  );

  for (const alt of ["Request review", "Overview"]) {
    assert.equal(
      description.querySelector<HTMLImageElement>(`img[alt="${alt}"]`)?.src,
      `data:${PIXEL.contentType};base64,${PIXEL.base64}`,
      `${alt} is drawn from what the service read`,
    );
  }

  const entries = [...tab.querySelectorAll(".pull-request-entry")];
  assert.equal(entries.length, 2);
  assert.match(entries[0]?.textContent ?? "", /Changes requested/u);
  assert.match(entries[0]?.textContent ?? "", /Rename the flag\./u);
  assert.equal(
    entries[1]?.querySelector("strong")?.textContent,
    "plain",
    "a comment GitHub sent no rendering of stands as its markdown",
  );
  assert.equal(
    tab.querySelector(".pull-request-earlier button") === null,
    true,
    "nothing was left on GitHub",
  );

  await choose(tab, "Checks");
  const checks = tab.querySelector('[aria-label="Checks"]') ?? assert.fail("the checks stand");
  assert.equal(
    checks.querySelector(".pull-request-count")?.textContent,
    "1 failed, 1 running, 1 passed",
  );
  assert.deepEqual(words(tab, "li .ui-list-row-title"), [
    "lint, failed",
    "build, running",
    "test, passed",
  ]);
  assert.deepEqual(
    words(tab, 'li .ui-list-row-meta:not(:has([role="timer"]))'),
    ["1m 5s", "1m 5s"],
    "a finished check says how long it ran",
  );
});

it.effect(
  "a check wears its App's avatar, a status's picture off GitHub's avatar host read through the service; a running one counts each second from when it started, a finished one says how long it ran",
  () =>
    Effect.gen(function* () {
      serveEffectsOn(Context.make(Clock.Clock, yield* Clock.Clock));
      yield* TestClock.setTime(66_000);

      const checks: AgentOverviewChecks = {
        checks: [
          {
            ...check("build", CHECK_STATE.PENDING),
            avatarUrl: "https://avatars.githubusercontent.com/in/15368?v=4",
          },
          { ...check("vercel", CHECK_STATE.PASSED), app: null, avatarUrl: BADGE },
          check("lint", CHECK_STATE.PASSED),
        ],
      };

      const tab = yield* Effect.promise(() =>
        draw(
          controlAnswering({ checks: () => Promise.resolve({ pullRequest: checks }) }),
          PULL_REQUEST_VIEW.CONVERSATION,
        ),
      );

      yield* Effect.promise(() => choose(tab, "Checks"));

      const rows = [...tab.querySelectorAll('[aria-label="Check list"] > li')];
      assert.equal(
        rows[0]?.querySelector("img")?.getAttribute("src"),
        "https://avatars.githubusercontent.com/in/15368?v=4&s=32",
        "an App's logo is drawn from GitHub's avatar host at its size",
      );
      assert.ok(
        world.images.every((src) => !src.startsWith("https://avatars.githubusercontent.com/")),
        "a picture GitHub's avatar host serves is never asked of the service",
      );
      yield* Effect.promise(() =>
        vi.waitFor(() =>
          assert.equal(
            rows[1]?.querySelector("img")?.getAttribute("src"),
            `data:${PIXEL.contentType};base64,${PIXEL.base64}`,
            "any other is drawn as the service read it",
          ),
        ),
      );
      assert.deepEqual(words(tab, '[role="timer"]'), ["1m 5s"]);

      yield* TestClock.adjust("1 second");
      yield* Effect.promise(settle);
      assert.deepEqual(words(tab, '[role="timer"]'), ["1m 6s"], "the running one counts on");
      assert.deepEqual(words(tab, 'li .ui-list-row-meta:not(:has([role="timer"]))'), [
        "1m 5s",
        "1m 5s",
      ]);

      yield* Effect.promise(() => choose(tab, "Conversation"));
      assert.deepEqual(
        words(tab, '[role="timer"]'),
        [],
        "a count behind a hidden tab reads no clock",
      );
      yield* TestClock.adjust("1 second");
      yield* Effect.promise(() => choose(tab, "Checks"));
      assert.deepEqual(
        words(tab, '[role="timer"]'),
        ["1m 7s"],
        "shown again, it counts from the clock",
      );
      act(() => world.root?.unmount());
      world.root = undefined;
    }),
);

test("a picture GitHub linked to itself opens over the window rather than in the browser: Enlarge walks that entry's pictures from the one pressed, drawn from what was read, and Open on GitHub opens the one shown; a badge keeps its link", async () => {
  const tab = await draw(controlAnswering());
  await settle();

  const description =
    tab.querySelector('[aria-label="Description"]') ?? assert.fail("the description stands");

  // Note that a picture is drawn once its query hands its read to React, a tick after it lands.
  await vi.waitFor(() =>
    assert.equal(description.querySelector('img[alt="before and after"]') === null, false),
  );
  assert.equal(
    description.querySelector('img[alt="before and after"]')?.closest("a") === null,
    true,
    "GitHub's link to the picture itself is gone",
  );

  const badge =
    description.querySelector<HTMLImageElement>(
      'a[href^="https://review.example.com"] img[alt="Request review"]',
    ) ?? assert.fail("a badge linked elsewhere keeps its link");

  assert.deepEqual(
    [badge.width, badge.height],
    [16, 16],
    "a badge stands at the size its author wrote on it, as GitHub draws it",
  );
  assert.equal(description.querySelector('[aria-label="Enlarge Request review"]') === null, true);

  const enlarge =
    description.querySelector<HTMLButtonElement>('[aria-label="Enlarge before and after"]') ??
    assert.fail("the upload has Enlarge");

  act(() => enlarge.click());

  const viewer = () =>
    document.querySelector<HTMLElement>('[role="dialog"]') ?? assert.fail("the viewer stands");

  const shown = () => [
    viewer().querySelector(".attachment-viewer-title")?.textContent,
    viewerPlace(viewer()),
  ];

  assert.deepEqual(shown(), ["before and after.png", "1 of 2"]);
  assert.equal(
    viewer().querySelector("img")?.getAttribute("src"),
    `data:${PIXEL.contentType};base64,${PIXEL.base64}`,
  );
  act(() => viewer().querySelector<HTMLButtonElement>('[aria-label="Next file"]')?.click());
  assert.deepEqual(shown(), ["Overview.png", "2 of 2"]);

  const onGitHub =
    [...viewer().querySelectorAll<HTMLAnchorElement>("a")].find(
      (link) => link.textContent === "Open on GitHub",
    ) ?? assert.fail("the viewer offers Open on GitHub as a link");

  assert.equal(onGitHub.getAttribute("href"), SCREENSHOT, "a link to the page GitHub linked");
  act(() => onGitHub.click());
  await settle();
  assert.deepEqual(world.opened, [SCREENSHOT]);
});

test("in the viewer, Open on GitHub opens the upload GitHub linked a picture to, which lasts, rather than the address it is drawn from; a picture that shares its link with words keeps the link and stays out of the walk", async () => {
  const drawnFrom = "https://user-images.githubusercontent.com/1/signed-preview.png";

  const tab = await draw(
    controlAnswering({
      pullRequest: () =>
        Promise.resolve({
          pullRequest: {
            ...PULL_REQUEST,
            html: [
              `<p dir="auto"><a target="_blank" href="${UPLOAD}"><img src="${drawnFrom}" alt="upload"></a></p>`,
              `<p dir="auto"><a href="${SCREENSHOT}"><img src="${SCREENSHOT}" alt="Overview"> the original</a></p>`,
            ].join(""),
          },
        }),
    }),
  );

  await settle();

  const description =
    tab.querySelector('[aria-label="Description"]') ?? assert.fail("the description stands");

  assert.equal(description.querySelector('[aria-label="Enlarge Overview"]') === null, true);
  await vi.waitFor(() =>
    assert.equal(description.querySelector('[aria-label="Enlarge upload"]') === null, false),
  );
  act(() =>
    (
      description.querySelector<HTMLButtonElement>('[aria-label="Enlarge upload"]') ??
      assert.fail("the upload has Enlarge")
    ).click(),
  );

  const viewer =
    document.querySelector<HTMLElement>('[role="dialog"]') ?? assert.fail("the viewer stands");

  assert.equal(viewerPlace(viewer), undefined, "it walks the upload alone");
  act(() =>
    (
      [...viewer.querySelectorAll<HTMLAnchorElement>("a")].find(
        (link) => link.textContent === "Open on GitHub",
      ) ?? assert.fail("the viewer offers Open on GitHub as a link")
    ).click(),
  );
  await settle();
  assert.deepEqual(world.opened, [UPLOAD]);
});

test("the Checks tab lists the head's deployments over its checks: each environment, where it stands, and a press opening the address it serves; a head with none lists no deployments", async () => {
  const deployed: AgentOverviewChecks = {
    ...CHECKS,
    deployments: [
      {
        environment: "Preview – luke-web",
        state: DEPLOYMENT_STATE.READY,
        url: "https://web-git-expiry.vercel.app",
        avatarUrl: "https://avatars.githubusercontent.com/in/8329?v=4",
      },
      { environment: "staging", state: DEPLOYMENT_STATE.FAILED, url: null },
    ],
  };

  const tab = await draw(
    controlAnswering({ checks: () => Promise.resolve({ pullRequest: deployed }) }),
  );

  await choose(tab, "Checks");

  const headings = [...tab.querySelectorAll(".pull-request-heading")].flatMap((each) =>
    each.closest("[hidden]") === null ? [each.firstChild?.textContent] : [],
  );

  assert.deepEqual(headings, ["Deployments", "Checks"], "the deployments stand over the checks");
  assert.deepEqual(
    [...tab.querySelectorAll(".pull-request-heading")].flatMap((each) =>
      each.closest("[hidden]") === null ? [each.getAttribute("data-variant")] : [],
    ),
    ["group", "group"],
    "a section's heading is set in the group role",
  );

  const deployments =
    tab.querySelector<HTMLElement>('[aria-label="Deployments"]') ??
    assert.fail("the deployments stand");

  assert.equal(deployments.querySelector(".pull-request-count")?.textContent, "2");
  assert.deepEqual(words(deployments, "li .ui-list-row-title"), ["Preview – luke-web", "staging"]);
  assert.deepEqual(words(deployments, "li .ui-list-row-description"), ["Deployed", "Failed"]);
  assert.equal(
    deployments.querySelector("img")?.getAttribute("src"),
    "https://avatars.githubusercontent.com/in/8329?v=4&s=32",
  );
  const buttons = deployments.querySelectorAll<HTMLButtonElement>("li > button");
  assert.equal(buttons.length, 1, "a deployment naming no address opens nothing");
  act(() => buttons[0]?.click());
  await settle();
  assert.deepEqual(world.opened, ["https://web-git-expiry.vercel.app"]);

  act(() => world.root?.unmount());
  const none = await draw(controlAnswering());
  await choose(none, "Checks");
  assert.equal(none.querySelector('[aria-label="Deployments"]') === null, true);
});

test("the header offers Preview once the checks land, before their tab is shown: one deployment serving an address opens at a press, several drop a menu of their environments, and one still deploying or naming no address offers none", async () => {
  const preview = (tab: HTMLElement) =>
    [...tab.querySelectorAll<HTMLElement>(".pull-request-title-actions :is(a, button)")].find(
      (control) => control.textContent?.startsWith("Preview"),
    );

  const ready = (environment: string, url: string) => ({
    environment,
    state: DEPLOYMENT_STATE.READY,
    url,
  });

  const one = await draw(
    controlAnswering({
      checks: () =>
        Promise.resolve({
          pullRequest: {
            ...CHECKS,
            deployments: [
              ready("Preview – luke-web", "https://web-git-expiry.vercel.app"),
              { environment: "docs", state: DEPLOYMENT_STATE.PENDING, url: null },
              { environment: "staging", state: DEPLOYMENT_STATE.FAILED, url: null },
            ],
          },
        }),
    }),
  );

  const single = await vi.waitFor(() => preview(one) ?? assert.fail("the header offers Preview"));
  assert.equal(single.tagName, "A", "one deployment is a link to the address it serves");
  assert.equal(single.getAttribute("href"), "https://web-git-expiry.vercel.app");
  act(() => single.click());
  await settle();
  assert.deepEqual(world.opened, ["https://web-git-expiry.vercel.app"]);

  act(() => world.root?.unmount());
  world.opened = [];

  const several = await draw(
    controlAnswering({
      checks: () =>
        Promise.resolve({
          pullRequest: {
            ...CHECKS,
            deployments: [
              ready("Preview – luke-web", "https://web-git-expiry.vercel.app"),
              ready("Preview – docs", "https://docs-git-expiry.vercel.app"),
            ],
          },
        }),
    }),
  );

  // Note that the checks the first draw read stand in the cache until this draw's read lands.
  const menuButton = await vi.waitFor(() => {
    const button = preview(several) ?? assert.fail("the header offers Preview");
    assert.equal(button.getAttribute("aria-haspopup"), "menu");

    return button;
  });

  act(() => menuButton.click());
  const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  assert.deepEqual(
    items.map((item) => item.textContent),
    ["Preview – luke-web", "Preview – docs"],
  );
  act(() => items[1]?.click());
  await settle();
  assert.deepEqual(world.opened, ["https://docs-git-expiry.vercel.app"]);

  act(() => world.root?.unmount());

  const none = await draw(
    controlAnswering({
      checks: () =>
        Promise.resolve({
          pullRequest: {
            ...CHECKS,
            deployments: [{ environment: "docs", state: DEPLOYMENT_STATE.PENDING, url: null }],
          },
        }),
    }),
  );

  // Note that the checks the draw before read stand in the cache until this draw's read lands.
  await vi.waitFor(() =>
    assert.equal(preview(none) === undefined, true, "nothing serving offers no Preview"),
  );
});

test("every check is listed, however many there are, those that failed first, then those still running, then the rest, with no control folding any away", async () => {
  const passing = Array.from({ length: 6 }, (_, at) => check(`test ${at}`, CHECK_STATE.PASSED));

  const many: AgentOverviewChecks = {
    checks: [
      check("lint", CHECK_STATE.FAILED),
      check("types", CHECK_STATE.FAILED),
      check("build", CHECK_STATE.PENDING),
      ...passing,
      check("deploy", CHECK_STATE.SKIPPED),
    ],
  };

  const tab = await draw(
    controlAnswering({ checks: () => Promise.resolve({ pullRequest: many }) }),
  );

  await choose(tab, "Checks");
  assert.deepEqual(words(tab, "li .ui-list-row-title"), [
    "lint, failed",
    "types, failed",
    "build, running",
    "test 0, passed",
    "test 1, passed",
    "test 2, passed",
    "test 3, passed",
    "test 4, passed",
    "test 5, passed",
    "deploy, skipped",
  ]);
  assert.equal(buttonWith(tab, /^Show (all|less)/u), undefined, "nothing folds the list");
});

test("the earlier entries a read left on GitHub are counted first, in the heading too, and open the pull request", async () => {
  const tab = await draw(
    controlAnswering({
      conversation: () => Promise.resolve({ pullRequest: { ...CONVERSATION, earlier: 3 } }),
    }),
  );

  const conversation =
    tab.querySelector('[aria-label="Conversation"]') ?? assert.fail("the conversation stands");

  await vi.waitFor(() =>
    assert.equal(conversation.querySelector(".pull-request-count")?.textContent, "5"),
  );

  const earlier =
    conversation.querySelector<HTMLAnchorElement>(".pull-request-earlier a") ??
    assert.fail("the earlier entries are counted");

  assert.equal(earlier.textContent, "3 earlier comments on GitHub");
  assert.equal(earlier.getAttribute("href"), PAGE, "a link to the pull request's page");
  await act(async () => earlier.click());
  assert.deepEqual(world.opened, [PAGE]);
});

test("a review that only left line comments draws each thread under it: its file and lines over the lines it is on drawn as Files changed draws a diff, then its comments; a resolved or outdated one folds closed under its label until opened", async () => {
  const review = {
    kind: CONVERSATION_ENTRY.REVIEW,
    by: CHARLES_ON_GITHUB,
    state: REVIEW_STATE.COMMENTED,
    html: null,
    body: "",
    at: 2_500,
    url: `${PAGE}#pullrequestreview-9`,
    threads: [
      thread({ more: 2 }),
      thread({
        path: "src/old.ts",
        line: null,
        startLine: null,
        originalLine: 9,
        originalStartLine: null,
        resolved: true,
        outdated: true,
        comments: [
          {
            by: CHARLES_ON_GITHUB,
            html: '<p dir="auto">Moved away.</p>',
            body: "",
            at: 2_400,
            url: `${PAGE}#discussion_r7`,
          },
        ],
      }),
    ],
  } as const;

  const tab = await draw(
    controlAnswering({
      conversation: () =>
        Promise.resolve({ pullRequest: { ...CONVERSATION, conversation: [review] } }),
    }),
  );

  await vi.waitFor(() =>
    assert.equal(tab.querySelectorAll(".pull-request-thread").length, 2, "both threads stand"),
  );
  const [open, folded] = [...tab.querySelectorAll<HTMLElement>(".pull-request-thread")];
  assert.ok(open !== undefined && folded !== undefined, "both threads stand under the review");
  assert.equal(
    open.querySelector(".annotation-card-where")?.textContent,
    "src/invite.tsL12–13",
    "the strip over the head names its file and lines",
  );
  const [preview] = world.previews;
  assert.ok(open.querySelector(".pull-request-thread-lines"), "the open thread's lines are drawn");
  assert.deepEqual(
    preview?.patch.split("\n").slice(3),
    [
      "@@ -10,3 +10,4 @@ export function send()",
      " const three = 3;",
      " const four = 4;",
      "-  twice();",
      "+  once();",
      "+  done();",
      "",
    ],
    "the end of the hunk, from three rows above the range to its line, handed to the diff bundle",
  );
  assert.deepEqual(preview?.selected, {
    start: 12,
    side: "additions",
    end: 13,
    endSide: "additions",
  });
  assert.deepEqual(
    [preview?.look.layout, preview?.look.inlineDiff, preview?.excerpt],
    ["unified", "none", true],
    "a preview is an excerpt drawn unified, its lines tinted whole",
  );
  assert.equal(open.querySelector(".pull-request-thread-comment strong")?.textContent, "once");

  const more =
    open.querySelector<HTMLAnchorElement>(".annotation-card-more a") ??
    assert.fail("the replies left on GitHub are counted");

  assert.equal(more.textContent, "2 more replies on GitHub");
  assert.equal(more.getAttribute("href"), `${PAGE}#discussion_r1`, "a link to the last reply");
  await act(async () => more.click());
  assert.deepEqual(world.opened, [`${PAGE}#discussion_r1`]);

  const head =
    folded.querySelector<HTMLElement>(".annotation-card-fold > summary") ?? assert.fail("a head");

  assert.deepEqual(threadLabels(folded), ["Resolved", "Outdated"]);
  assert.match(
    folded.querySelector(".annotation-card-where")?.textContent ?? "",
    /src\/old\.tsL9/u,
    "an outdated thread names the line it was made on, folded too",
  );
  assert.equal(
    folded.querySelector(".pull-request-thread-comment") === null,
    true,
    "folded closed",
  );
  act(() => head.click());
  await settle();
  assert.match(
    folded.querySelector(".pull-request-thread-comment")?.textContent ?? "",
    /Moved away\./u,
    "a press opens it",
  );
});

/** A reaction's pill in a row of them, a press or a count, named by who reacted. */
const REACTION_PILL = '[aria-label*=" reacted with "]';

test("the description, a comment, a review, and a thread comment wear their reactions under their words, each its emoji and count, the reader's own lit only where the read named them among who gave it", async () => {
  const dana = { login: "danak", bot: false, userId: "user-dana" };

  const review = {
    kind: CONVERSATION_ENTRY.REVIEW,
    by: CHARLES_ON_GITHUB,
    state: REVIEW_STATE.APPROVED,
    html: '<p dir="auto">Good.</p>',
    body: "",
    at: 2_500,
    url: `${PAGE}#pullrequestreview-9`,
    reactions: [{ content: REACTION.HOORAY, count: 1, by: [CHARLES_ON_GITHUB] }],
    threads: [
      thread({
        comments: [
          {
            by: CHARLES_ON_GITHUB,
            html: '<p dir="auto">Why?</p>',
            body: "",
            at: 2_000,
            url: `${PAGE}#discussion_r1`,
            reactions: [{ content: REACTION.THUMBS_DOWN, count: 3 }],
          },
        ],
      }),
    ],
  } as const;

  const tab = await draw(
    controlAnswering({
      conversation: () =>
        Promise.resolve({
          pullRequest: {
            ...CONVERSATION,
            descriptionReactions: [
              { content: REACTION.THUMBS_UP, count: 12, by: [CHARLES_ON_GITHUB, dana] },
              { content: REACTION.ROCKET, count: 1, by: [CHARLES_ON_GITHUB] },
            ],
            conversation: [
              review,
              {
                kind: CONVERSATION_ENTRY.COMMENT,
                by: CHARLES_ON_GITHUB,
                html: '<p dir="auto">Thanks.</p>',
                body: "",
                at: 3_000,
                url: `${PAGE}#issuecomment-2`,
                reactions: [{ content: REACTION.EYES, count: 2, by: [dana, CHARLES_ON_GITHUB] }],
              },
            ],
          },
        }),
    }),
  );

  /** Each pill under the element given: what it says to a reader, and whether it is lit as the reader's. */
  const pills = (under: Element | null) =>
    [...(under?.querySelectorAll(REACTION_PILL) ?? [])].map((pill) => [
      pill.textContent,
      pill.getAttribute("aria-label"),
      pill.getAttribute("aria-pressed") ??
        String(pill.querySelector('.ui-badge[data-lit="true"]') !== null),
    ]);

  await vi.waitFor(() =>
    assert.deepEqual(pills(tab.querySelector('[aria-label="Description"]')), [
      ["👍12", "Charles Pan, you, and 10 more reacted with thumbs up", "true"],
      ["🚀1", "Charles Pan reacted with rocket", "false"],
    ]),
  );
  const [reviewed, commented] = [...tab.querySelectorAll(".pull-request-entry")];
  assert.deepEqual(
    pills(
      reviewed?.querySelector(
        ":scope > .ui-comment > .ui-comment-body > .pull-request-reactions",
      ) ?? null,
    ),
    [["🎉1", "Charles Pan reacted with hooray", "false"]],
  );
  assert.deepEqual(
    pills(reviewed?.querySelector(".pull-request-thread-comment") ?? null),
    [["👎3", "3 reacted with thumbs down", "false"]],
    "a reaction the read only counted is never lit",
  );
  assert.deepEqual(pills(commented ?? null), [
    ["👀2", "You and Charles Pan reacted with eyes", "true"],
  ]);
});

/** The conversation with a heart on the description, the reader's own as given, and a comment wearing eyes. */
function reacted(heart: { readonly count: number; readonly mine: boolean } | undefined) {
  return {
    ...CONVERSATION,
    descriptionSubject: "PR_42",
    descriptionReactions:
      heart === undefined || heart.count === 0 ? [] : [{ content: REACTION.HEART, ...heart }],
    conversation: [
      {
        kind: CONVERSATION_ENTRY.COMMENT,
        by: CHARLES_ON_GITHUB,
        html: '<p dir="auto">Thanks.</p>',
        body: "",
        at: 3_000,
        url: `${PAGE}#issuecomment-2`,
        subject: "IC_2",
        reactions: [{ content: REACTION.EYES, count: 1, by: [CHARLES_ON_GITHUB] }],
      },
    ],
  };
}

/** The description's heart, as a press. */
function heartOf(tab: HTMLElement): HTMLButtonElement | null {
  return (
    tab
      .querySelector('[aria-label="Description"]')
      ?.querySelector<HTMLButtonElement>(`button${REACTION_PILL}`) ?? null
  );
}

test("a reaction is pressed to take the reader's own back, waits on its change with the state pill unmoved, and is drawn as GitHub left it once the conversation is read again", async () => {
  let heart = { count: 2, mine: true };

  const tab = await draw(
    controlAnswering({
      conversation: () => Promise.resolve({ pullRequest: reacted(heart) }),
    }),
  );

  const pressed = await vi.waitFor(
    () => heartOf(tab) ?? assert.fail("the description's heart is a press"),
  );

  assert.equal(pressed.getAttribute("aria-pressed"), "true", "lit as the reader's own");
  const pill = tab.querySelector(".pull-request-state")?.textContent;

  const removing = Promise.withResolvers<void>();
  world.changeHeld = removing.promise;
  act(() => pressed.click());
  // Note that a change reaches the act port a few steps after its press, as its mutation sends it.
  await vi.waitFor(() =>
    assert.deepEqual(world.changes, [
      [
        AGENT.id,
        { action: PULL_REQUEST_ACTION.REMOVE_REACTION, subject: "PR_42", content: REACTION.HEART },
      ],
    ]),
  );
  assert.equal(pressed.getAttribute("aria-busy"), "true", "the heart waits on its change");
  assert.ok(
    [
      ...tab.querySelectorAll<HTMLButtonElement>(
        `[aria-label="Description"] button${REACTION_PILL}`,
      ),
    ].every((each) => each.disabled),
    "the row's other presses wait too",
  );
  assert.equal(tab.querySelector(".pull-request-state")?.textContent, pill, "the pill is unmoved");

  heart = { count: 1, mine: false };
  await act(async () => removing.resolve());
  await settle();
  const after = heartOf(tab) ?? assert.fail("the heart still stands, given by another");
  assert.deepEqual(
    [after.textContent, after.getAttribute("aria-pressed")],
    ["❤️1", "false"],
    "drawn as GitHub left it",
  );
});

test("a reaction pressed again before the conversation is read again takes back what the first press gave", async () => {
  const fresh = Promise.withResolvers<{ pullRequest: ReturnType<typeof reacted> }>();
  let asked = 0;

  const tab = await draw(
    controlAnswering({
      conversation: () => {
        asked += 1;

        return asked === 1 ? Promise.resolve({ pullRequest: reacted(undefined) }) : fresh.promise;
      },
    }),
  );

  // Note that the comment's reactions stand once the conversation's read reaches its query.
  const eyes = await vi.waitFor(
    () =>
      tab.querySelector<HTMLButtonElement>(`.pull-request-entry button${REACTION_PILL}`) ??
      assert.fail("the comment's eyes are a press"),
  );

  act(() => eyes.click());
  await settle();
  assert.deepEqual(
    [eyes.textContent, eyes.getAttribute("aria-pressed"), eyes.disabled],
    ["👀2", "true", false],
    "once GitHub gave it, the eyes are the reader's while the read is out",
  );
  assert.equal(
    eyes.getAttribute("aria-label"),
    "Charles Pan and 1 more reacted with eyes",
    "who else gave it is still named",
  );
  act(() => eyes.click());
  await vi.waitFor(() =>
    assert.deepEqual(
      world.changes.map(([, request]) => request.action),
      [PULL_REQUEST_ACTION.ADD_REACTION, PULL_REQUEST_ACTION.REMOVE_REACTION],
    ),
  );
  await settle();
  await act(async () => fresh.resolve({ pullRequest: reacted(undefined) }));
  await settle();
});

test("Add reaction opens one row of GitHub's eight, each named, the arrows moving along it; a pick gives it, and a reaction nobody had given stands as the reader's while it is given, GitHub's refusal standing under the row", async () => {
  const tab = await draw(
    controlAnswering({
      conversation: () => Promise.resolve({ pullRequest: reacted(undefined) }),
    }),
  );

  // Note that the comment stands once the conversation's read reaches its query.
  const add = await vi.waitFor(
    () =>
      tab.querySelector<HTMLButtonElement>('.pull-request-entry [aria-label="Add reaction"]') ??
      assert.fail("the comment offers Add reaction"),
  );

  const entry = tab.querySelector(".pull-request-entry") ?? assert.fail("the comment stands");
  act(() => add.click());

  const row =
    entry.querySelector<HTMLElement>('[role="toolbar"]') ?? assert.fail("a row of reactions opens");

  const choices = [...row.querySelectorAll<HTMLButtonElement>("button")];
  assert.deepEqual(
    choices.map((each) => [each.textContent, each.getAttribute("aria-label")]),
    [
      ["👍", "Thumbs up"],
      ["👎", "Thumbs down"],
      ["😄", "Laugh"],
      ["🎉", "Hooray"],
      ["😕", "Confused"],
      ["❤️", "Heart"],
      ["🚀", "Rocket"],
      ["👀", "Eyes"],
    ],
  );
  assert.equal(document.activeElement, choices[0], "the first takes the focus");
  act(() => {
    row.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
  });
  assert.equal(document.activeElement, choices[7], "the arrows wrap along the row");
  assert.equal(choices[7]?.getAttribute("aria-pressed"), "false");

  const giving = Promise.withResolvers<void>();
  world.changeHeld = giving.promise;
  world.changeAnswer = { outcome: PULL_REQUEST_WRITE_OUTCOME.REFUSED, words: "Rate limited." };
  const rocket = choices[6] ?? assert.fail("the row offers Rocket");
  act(() => rocket.click());
  assert.equal(entry.querySelector('[role="toolbar"]') === null, true, "a pick closes the row");
  await vi.waitFor(() =>
    assert.deepEqual(world.changes.at(-1), [
      AGENT.id,
      { action: PULL_REQUEST_ACTION.ADD_REACTION, subject: "IC_2", content: REACTION.ROCKET },
    ]),
  );
  assert.deepEqual(
    [...entry.querySelectorAll(REACTION_PILL)].map((each) => [
      each.textContent,
      each.getAttribute("aria-busy"),
    ]),
    [
      ["🚀1", "true"],
      ["👀1", null],
    ],
    "a reaction nobody had given stands as the reader's while it is given",
  );
  await act(async () => giving.resolve());
  await settle();
  assert.match(
    entry.querySelector(".pull-request-reaction-note")?.textContent ?? "",
    /Rate limited\./u,
    "GitHub's refusal stands under the row",
  );
});

/** Who wrote each entry still drawn, and how many threads stand under it. */
function drawnEntries(tab: HTMLElement): string[] {
  return [...tab.querySelectorAll(".pull-request-entry")].map(
    (entry) =>
      `${entry.querySelector(".ui-comment-head .ui-inline-ref-label")?.textContent} ${entry.querySelectorAll(".pull-request-thread").length}`,
  );
}

test("View options holds Hide resolved and Hide bots as switches, each counting what it leaves out and leaving it out while on, a review whose every thread was resolved going with them, and stay as left for the next conversation drawn", async () => {
  const devin = { login: "devin-ai-integration[bot]", bot: true };

  const conversation: AgentOverviewConversation = {
    reviewers: [],
    conversation: [
      {
        kind: CONVERSATION_ENTRY.REVIEW,
        by: devin,
        state: REVIEW_STATE.COMMENTED,
        html: '<p dir="auto">Found one issue.</p>',
        body: "",
        at: 1_500,
        url: `${PAGE}#pullrequestreview-1`,
        threads: [thread({ resolved: true })],
      },
      {
        kind: CONVERSATION_ENTRY.REVIEW,
        by: CHARLES_ON_GITHUB,
        state: REVIEW_STATE.COMMENTED,
        html: '<p dir="auto">Two things.</p>',
        body: "",
        at: 2_000,
        url: `${PAGE}#pullrequestreview-2`,
        threads: [
          thread({ resolved: true }),
          thread({
            path: "src/other.ts",
            comments: [
              {
                ...(thread().comments[0] ?? assert.fail("a comment")),
                url: `${PAGE}#discussion_r2`,
              },
            ],
          }),
        ],
      },
      {
        kind: CONVERSATION_ENTRY.REVIEW,
        by: CHARLES_ON_GITHUB,
        state: REVIEW_STATE.APPROVED,
        html: '<p dir="auto">Settled.</p>',
        body: "",
        at: 2_500,
        url: `${PAGE}#pullrequestreview-3`,
        threads: [thread({ resolved: true })],
      },
      {
        kind: CONVERSATION_ENTRY.COMMENT,
        by: { login: "vercel[bot]", bot: true },
        html: '<p dir="auto">Deployed.</p>',
        body: "",
        at: 3_000,
        url: `${PAGE}#issuecomment-4`,
      },
      {
        kind: CONVERSATION_ENTRY.COMMENT,
        by: CHARLES_ON_GITHUB,
        html: '<p dir="auto">Thanks.</p>',
        body: "",
        at: 3_500,
        url: `${PAGE}#issuecomment-5`,
      },
    ],
    earlier: 0,
  };

  const control = controlAnswering({
    conversation: () => Promise.resolve({ pullRequest: conversation }),
  });

  const tab = await draw(control);

  const all = [
    "devin-ai-integration 1",
    "Charles Pan 2",
    "Charles Pan 1",
    "vercel 0",
    "Charles Pan 0",
  ];

  await vi.waitFor(() =>
    assert.deepEqual(drawnEntries(tab), all, "both start off, everything drawn"),
  );
  assert.equal(
    viewOptions(tab).getAttribute("aria-description"),
    null,
    "nothing is said filtered while both are off",
  );

  act(() => viewOptions(tab).click());
  await settle();
  assert.deepEqual(
    [...document.querySelectorAll('[role="menuitemcheckbox"]')].map((item) => item.textContent),
    ["Hide resolved3", "Hide bots2"],
    "each is a switch counting what it would leave out, resolved threads and bots' entries",
  );
  assert.equal(
    sectionHead(tab, "Conversation").getAttribute("aria-expanded"),
    "true",
    "a press on View options in the heading folds nothing",
  );

  await pressItem("Hide bots");
  assert.deepEqual(
    menuItems(),
    [
      { label: "Hide resolved", checked: "false" },
      { label: "Hide bots", checked: "true" },
    ],
    "the menu stands while a filter is turned",
  );
  assert.equal(viewOptions(tab).getAttribute("aria-description"), "Filtered");
  assert.deepEqual(drawnEntries(tab), ["Charles Pan 2", "Charles Pan 1", "Charles Pan 0"]);

  await pressItem("Hide bots");
  await pressItem("Hide resolved");
  assert.deepEqual(
    drawnEntries(tab),
    ["Charles Pan 1", "vercel 0", "Charles Pan 0"],
    "a resolved thread goes, and a review whose every thread was resolved with it; a comment stays",
  );

  await pressItem("Hide bots");
  act(() => world.root?.unmount());
  world.root = undefined;
  document.body.innerHTML = "";
  const again = await draw(control);
  act(() => viewOptions(again).click());
  await settle();
  assert.deepEqual(
    menuItems(),
    [
      { label: "Hide resolved", checked: "true" },
      { label: "Hide bots", checked: "true" },
    ],
    "the choice stands for the next conversation drawn",
  );
  assert.deepEqual(drawnEntries(again), ["Charles Pan 1", "Charles Pan 0"]);
});

test("where the filters leave nothing of the conversation, it says no comment matches", async () => {
  window.localStorage.setItem(
    "app.conversation-filters",
    JSON.stringify({ hideBots: true, hideResolved: false }),
  );

  const tab = await draw(
    controlAnswering({
      conversation: () =>
        Promise.resolve({
          pullRequest: {
            ...CONVERSATION,
            conversation: CONVERSATION.conversation.map((entry) => ({
              ...entry,
              by: { login: "vercel[bot]", bot: true },
            })),
          },
        }),
    }),
  );

  const conversation =
    tab.querySelector('[aria-label="Conversation"]') ?? assert.fail("the conversation stands");

  await vi.waitFor(() =>
    assert.equal(
      conversation.querySelector(".pull-request-none")?.textContent,
      "No matching comments.",
    ),
  );
  assert.equal(conversation.querySelector(".pull-request-entry") === null, true);
});

test("the Description and the Conversation each fold under a heading pressed across its row, both open at first, and each stays as left, on its own, for the next pull request drawn", async () => {
  const control = controlAnswering();
  const tab = await draw(control);
  const description = sectionHead(tab, "Description");
  const conversation = sectionHead(tab, "Conversation");
  assert.deepEqual(
    [description, conversation].map((head) => head.getAttribute("aria-expanded")),
    ["true", "true"],
    "both start open",
  );
  assert.ok(tab.querySelector('[aria-label="Description"] .pull-request-words'));
  assert.ok(tab.querySelector('[aria-label="Conversation"] .pull-request-entry'));

  act(() => description.click());
  assert.equal(description.getAttribute("aria-expanded"), "false");
  assert.equal(tab.querySelector('[aria-label="Description"] .pull-request-words') === null, true);
  assert.ok(tab.querySelector(".pull-request-entry"), "the Conversation stays open");

  act(() => conversation.click());
  assert.equal(conversation.getAttribute("aria-expanded"), "false");
  assert.equal(tab.querySelector(".pull-request-entry") === null, true);
  assert.equal(
    tab.querySelector('[aria-label="Conversation"] .pull-request-count')?.textContent,
    "2",
    "a folded Conversation still counts what it holds",
  );

  act(() => world.root?.unmount());
  world.root = undefined;
  document.body.innerHTML = "";
  const again = await draw(control);
  assert.deepEqual(
    ["Description", "Conversation"].map((name) =>
      sectionHead(again, name).getAttribute("aria-expanded"),
    ),
    ["false", "false"],
    "each fold stands for the next pull request drawn",
  );
  act(() => sectionHead(again, "Description").click());
  assert.ok(again.querySelector('[aria-label="Description"] .pull-request-words'));
  assert.equal(
    sectionHead(again, "Conversation").getAttribute("aria-expanded"),
    "false",
    "opening one leaves the other as it was kept",
  );
});

test("opened on its files, as a link to its changes opens it, the header stands above them with where each reviewer stands, and switching between the tabs draws each as it was", async () => {
  const approved = { login: "alexr", bot: false };

  const tab = await draw(
    controlAnswering({
      conversation: () =>
        Promise.resolve({
          pullRequest: {
            ...CONVERSATION,
            reviewers: [{ by: approved, state: REVIEW_STATE.APPROVED }],
          },
        }),
    }),
    PULL_REQUEST_VIEW.FILES,
  );

  // The views' own panels, not the Write and Preview panel of a comment box inside one.
  const shownPanel = () =>
    [...tab.querySelectorAll<HTMLElement>('[role="tabpanel"]')].filter(
      (each) => !each.hidden && each.parentElement?.closest('[role="tabpanel"]') === null,
    );

  const header = () =>
    tab.querySelector<HTMLElement>(".pull-request-header") ?? assert.fail("the header stands");

  assert.equal(option(tab, "Files changed").getAttribute("aria-selected"), "true");
  assert.equal(shownPanel().length, 1);
  assert.match(shownPanel()[0]?.textContent ?? "", /This pull request changes no files\./u);
  assert.equal(
    header().querySelector(".pull-request-title")?.textContent,
    "Expire invitations #42",
  );
  assert.equal(
    header().querySelectorAll('[aria-label="Reviewers"] > li').length,
    1,
    "a reviewer who approved, and is asked for nothing, stands in the header above the files",
  );

  await choose(tab, "Checks");
  assert.deepEqual(words(shownPanel()[0] ?? tab, "li .ui-list-row-title"), [
    "lint, failed",
    "build, running",
    "test, passed",
  ]);

  await choose(tab, "Conversation");
  assert.deepEqual(waiting(tab), [], "nothing is waited on again");
  assert.equal(shownPanel()[0]?.querySelectorAll(".pull-request-entry").length, 2);
});

test("an App's bot stands by the logo GitHub gives it at its App's address, in the header's Opened by and Reviewers and in the conversation, its robot only until the logo loads", async () => {
  const devin = {
    login: "devin-ai-integration[bot]",
    bot: true,
    avatarUrl: "https://avatars.githubusercontent.com/in/811515?v=4",
  };

  const lukeBot = {
    login: "luke-agent[bot]",
    bot: true,
    avatarUrl: "https://avatars.githubusercontent.com/in/4242?v=4",
  };

  const tab = await draw(
    controlAnswering({
      pullRequest: () => Promise.resolve({ pullRequest: { ...PULL_REQUEST, author: lukeBot } }),
      conversation: () =>
        Promise.resolve({
          pullRequest: {
            reviewers: [{ by: devin, state: REVIEW_STATE.COMMENTED }],
            conversation: [
              {
                kind: CONVERSATION_ENTRY.REVIEW,
                by: devin,
                state: REVIEW_STATE.COMMENTED,
                html: '<p dir="auto">Found 1 potential issue.</p>',
                body: "",
                at: 2_000,
                url: `${PAGE}#pullrequestreview-1`,
              },
            ],
            earlier: 0,
          },
        }),
    }),
  );

  const header =
    tab.querySelector<HTMLElement>(".pull-request-header") ?? assert.fail("the header stands");

  const face =
    header.querySelector('[aria-label="Reviewers"] .actor-mark[data-bot="true"]') ??
    assert.fail("the bot reviewer stands on its square");

  const picture = face.querySelector("img") ?? assert.fail("its logo is asked for");
  assert.equal(
    picture.getAttribute("src"),
    "https://avatars.githubusercontent.com/in/811515?v=4&s=36",
  );
  assert.ok(face.querySelector(".lucide-bot"), "its robot stands while the logo loads");
  act(() => {
    picture.dispatchEvent(new Event("load"));
  });
  assert.equal(
    face.querySelector(".lucide-bot") === null,
    true,
    "the logo stands in the robot's place",
  );

  const opener =
    header.querySelector(
      '.pull-request-people [data-actor-ref] .actor-mark[data-bot="true"] img',
    ) ?? assert.fail("who opened it is asked for by its logo");

  assert.match(
    opener.getAttribute("src") ?? "",
    /^https:\/\/avatars\.githubusercontent\.com\/in\/4242\?/u,
  );
  assert.ok(
    [...tab.querySelectorAll(".pull-request-entry .ui-comment-face img")].some((each) =>
      (each.getAttribute("src") ?? "").startsWith(
        "https://avatars.githubusercontent.com/in/811515?",
      ),
    ),
    "the bot's review in the conversation is drawn by its logo",
  );
});

test("each tab counts what Vespin holds of it: the conversation its comments, reviews, and threads; the checks how they went as published from the first frame, and how many once read; the files how many were published", async () => {
  const checks = held<AgentOverviewChecksAnswerView>();
  const tab = await draw(controlAnswering({ checks: checks.read }));
  assert.equal(tabCount(tab, "Conversation"), "2");
  assert.equal(
    checksGlyph(tab),
    "failing",
    "how the checks went, as published, stands before they are read",
  );
  assert.equal(tabCount(tab, "Checks"), "", "how many waits on their read");
  assert.equal(tabCount(tab, "Files changed"), "1");

  checks.answer({ pullRequest: CHECKS });
  await settle();
  await vi.waitFor(() =>
    assert.equal(
      tabCount(tab, "Checks"),
      "1",
      "beside a failure, how many failed, read with the header",
    ),
  );
  await choose(tab, "Checks");
  assert.equal(checksGlyph(tab), "failing");

  act(() => option(tab, "Checks").focus());
  act(() => {
    option(tab, "Checks").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
  });
  await settle();
  assert.equal(
    option(tab, "Chapters").getAttribute("aria-selected"),
    "true",
    "the arrows move along the row, Chapters after Checks",
  );
});

test("the Checks tab counts what its glyph says: beside a wait how many still run, and where all passed how many there are", async () => {
  const running: AgentOverviewChecks = {
    checks: [
      check("build", CHECK_STATE.PENDING),
      check("e2e", CHECK_STATE.PENDING),
      check("test", CHECK_STATE.PASSED),
    ],
  };

  const waits = await draw(
    controlAnswering({ checks: () => Promise.resolve({ pullRequest: running }) }),
  );

  await choose(waits, "Checks");
  assert.equal(checksGlyph(waits), "running");
  assert.equal(tabCount(waits, "Checks"), "2");

  act(() => world.root?.unmount());

  const passing: AgentOverviewChecks = {
    checks: [
      check("lint", CHECK_STATE.PASSED),
      check("test", CHECK_STATE.PASSED),
      check("docs", CHECK_STATE.SKIPPED),
    ],
  };

  const passed = await draw(
    controlAnswering({ checks: () => Promise.resolve({ pullRequest: passing }) }),
  );

  await choose(passed, "Checks");
  assert.equal(checksGlyph(passed), "passing");
  assert.equal(tabCount(passed, "Checks"), "3");
});

test("a check that ran for no time, skipped or canceled before it began, says no duration", async () => {
  const none: AgentOverviewChecks = {
    checks: [
      { ...check("cancelled", CHECK_STATE.FAILED), completedAt: 1_000 },
      { ...check("docs", CHECK_STATE.SKIPPED), completedAt: 1_000 },
      check("test", CHECK_STATE.PASSED),
    ],
  };

  const tab = await draw(
    controlAnswering({ checks: () => Promise.resolve({ pullRequest: none }) }),
  );

  await choose(tab, "Checks");
  assert.deepEqual(words(tab, "li .ui-list-row-meta"), ["1m 5s"]);
});

test("a merged pull request says so on its pill, as its overview read it, says nothing of merging, and one with no description, checks, or comments says so", async () => {
  const merged: AgentOverviewPullRequest = {
    ...PULL_REQUEST,
    state: PULL_REQUEST_STATE.MERGED,
    mergedAt: 9_000,
    html: "",
  };

  const tab = await draw(
    // Note that what the agent published was last read open, so the pill says what the overview read.
    controlAnswering(
      {
        pullRequest: () => Promise.resolve({ pullRequest: merged }),
        checks: () => Promise.resolve({ pullRequest: { checks: [] } }),
        conversation: () =>
          Promise.resolve({ pullRequest: { reviewers: [], conversation: [], earlier: 0 } }),
      },
      PULL_REQUEST_STATE.OPEN,
    ),
  );

  assert.equal(standing(tab), "Merged");
  assert.equal(mergeControl(tab) === null, true, "a merged pull request has no merge control");
  await choose(tab, "Checks");
  assert.deepEqual(words(tab, ".pull-request-none"), [
    "No description provided.",
    "Nobody has commented yet.",
    "No checks have run on this pull request.",
  ]);
});

test("where what the agent published is not read, the header still says where the pull request stands, and the toolbar's ⋯ and ⇧⌘O open it on GitHub, as its overview read it; the header holds no ⋯ of its own", async () => {
  const control = {
    ...controlAnswering(),
    pullRequests: new Map(),
  };

  const tab = await draw(control);
  assert.equal(standing(tab), "Open");
  assert.equal(
    tab.querySelector('.pull-request-tab button[aria-label="Open on GitHub"]') === null,
    true,
    "GitHub is no button of its own",
  );
  assert.equal(
    tab.querySelector(".pull-request-header [aria-haspopup='menu'][aria-label$='actions']") ===
      null,
    true,
    "the header holds no ⋯",
  );
  assert.deepEqual(toolbarItems(tab), ["Copy GitHub link", "Open on GitHub", "Refresh"]);
  await pressToolbar(tab, "Open on GitHub");
  await settle();
  assert.deepEqual(world.opened, [PAGE]);
  const chord = tab.querySelector<HTMLButtonElement>("[data-chord]") ?? assert.fail("⇧⌘O opens it");
  await act(async () => chord.click());
  assert.deepEqual(world.opened, [PAGE, PAGE]);
});

test("the toolbar's ⋯ offers Refresh dimmed while a read is out, which a refresh would only repeat", async () => {
  const pullRequest = held<AgentOverviewPullRequestAnswerView>();
  const tab = await draw(controlAnswering({ pullRequest: pullRequest.read }));
  assert.deepEqual(toolbarItems(tab), ["Copy GitHub link", "Open on GitHub", "Refresh (off)"]);
  await act(async () => pullRequest.answer({ pullRequest: PULL_REQUEST }));
  await vi.waitFor(() =>
    assert.deepEqual(toolbarItems(tab), ["Copy GitHub link", "Open on GitHub", "Refresh"]),
  );
});

test("the toolbar's ⋯ offers nothing for the pull request before any of it is held", async () => {
  const pullRequest = held<AgentOverviewPullRequestAnswerView>();

  const tab = await draw({
    ...controlAnswering({ pullRequest: pullRequest.read }),
    pullRequests: new Map(),
  });

  assert.deepEqual(toolbarItems(tab), []);
  await act(async () => pullRequest.answer({ pullRequest: PULL_REQUEST }));
  await settle();
  await vi.waitFor(() =>
    assert.deepEqual(toolbarItems(tab), ["Copy GitHub link", "Open on GitHub", "Refresh"]),
  );
});

test("a screen reader meets the title before the pill, which comes after it in the title row's markup", async () => {
  const tab = await draw(controlAnswering());

  const title =
    tab.querySelector(".pull-request-title-row .pull-request-title") ??
    assert.fail("the title stands in the title row");

  const pill = pillOf(tab) ?? assert.fail("the pill stands in the title row");
  assert.ok(
    title.compareDocumentPosition(pill) & Node.DOCUMENT_POSITION_FOLLOWING,
    "the pill follows the title",
  );
  assert.match(title.textContent ?? "", /#42/u);
  assert.match(pill.textContent ?? "", /Open/u);
});

/** Scrolls `box` to `top` from wherever it stood, as a finger dragging it does. */
function scrollTo(box: Element, top: number): void {
  Object.defineProperty(box, "scrollTop", { configurable: true, value: top });
  act(() => {
    box.dispatchEvent(new Event("scroll"));
  });
}

/** A Pull request tab on a phone's Conversation, the header, its one-line title, and the conversation's scroller given the boxes a phone lays them out in, so the header folds away 160 pixels. */
async function phoneTab(conversationRuns: number) {
  const tab = await drawn(
    createElement(
      ShellRoomContext.Provider,
      { value: SHELL_ROOM.NARROW },
      createElement(Switching, {
        control: controlAnswering(),
        first: PULL_REQUEST_VIEW.CONVERSATION,
      }),
    ),
  );

  const header = tab.querySelector(".pull-request-header") ?? assert.fail("the header stands");

  const line =
    tab.querySelector(".pull-request-compact") ?? assert.fail("the title's one line stands");

  const conversation =
    tab.querySelector("[aria-label='Pull request conversation']") ??
    assert.fail("the conversation scrolls");

  sized(header, { height: 200 });
  sized(line, { height: 40 });
  sized(conversation, { height: 400, content: conversationRuns });
  act(() => relayout());

  return { tab, conversation, folded: () => header.hasAttribute("data-folded") };
}

/** Lets `box` be scrolled to where a scroll the tab makes asks, at once, as a glide lands. */
function glides(box: Element): void {
  Object.defineProperty(box, "scrollTo", {
    configurable: true,
    value: ({ top }: ScrollToOptions) => {
      Object.defineProperty(box, "scrollTop", { configurable: true, value: top });
      box.dispatchEvent(new Event("scroll"));
    },
  });
}

/** Scrolls `box` to `top` and lets go there, as a finger lifted once the scroll comes to rest. */
function rest(box: Element, top: number): void {
  scrollTo(box, top);
  act(() => {
    box.dispatchEvent(new Event("scrollend"));
  });
}

test("on a phone the header folds away as far as the view under it is scrolled, folded once past its room and back with the finger, and another view follows its own scroll", async () => {
  const { tab, conversation, folded } = await phoneTab(2000);

  scrollTo(conversation, 100);
  assert.equal(folded(), false, "part-way, the header is still folding away");
  scrollTo(conversation, 160);
  assert.equal(folded(), true, "scrolled past its room, the header is folded");
  scrollTo(conversation, 400);
  assert.equal(folded(), true);
  scrollTo(conversation, 159);
  assert.equal(folded(), false, "scrolled back a pixel, it comes back with the finger");

  scrollTo(conversation, 400);
  await choose(tab, "Checks");
  assert.equal(folded(), false, "another view, at its top, shows the header whole");
});

test("a box scrolled inside the view, a comment's field, folds nothing; only the view's own scroller does", async () => {
  const { conversation, folded } = await phoneTab(2000);
  const field = conversation.appendChild(document.createElement("textarea"));
  sized(field, { height: 100, content: 1000 });
  scrollTo(field, 300);
  assert.equal(folded(), false, "the field's own scroll leaves the header whole");
  scrollTo(conversation, 300);
  assert.equal(folded(), true);
});

test("a scroll left resting with the header part-way folded glides on to whichever end is nearer", async () => {
  const { conversation, folded } = await phoneTab(2000);
  glides(conversation);
  rest(conversation, 120);
  assert.equal(folded(), true, "past half its room, it glides on until folded");
  rest(conversation, 50);
  assert.equal(conversation.scrollTop, 0, "short of half, it glides back to the top");
});

test("a scroll left resting at the end of a view too short to fold the header whole stays at its end", async () => {
  const { conversation } = await phoneTab(400 + 100);
  glides(conversation);
  rest(conversation, 100);
  assert.equal(conversation.scrollTop, 100);
});

test("an agent with no pull request yet says so, and the toolbar's ⋯ offers nothing for one, though what it published is still held", async () => {
  const none = await draw(
    controlAnswering({
      pullRequest: () => Promise.resolve({ pullRequest: null }),
      checks: () => Promise.resolve({ pullRequest: null }),
      conversation: () => Promise.resolve({ pullRequest: null }),
    }),
  );

  assert.match(none.textContent ?? "", /No pull request yet\./u);
  assert.equal(none.querySelector("[aria-label='Pull request conversation']") === null, true);
  assert.deepEqual(toolbarItems(none), []);
});

test("the pill, the title, and the files' count stand from what Vespin holds before any read lands; each part is a skeleton until its own read lands, and is drawn the moment it does, whatever the order", async () => {
  const pullRequest = held<{ pullRequest: AgentOverviewPullRequest }>();
  const checks = held<{ pullRequest: AgentOverviewChecks }>();
  const conversation = held<{ pullRequest: AgentOverviewConversation }>();

  const tab = await draw(
    controlAnswering({
      pullRequest: pullRequest.read,
      checks: checks.read,
      conversation: conversation.read,
    }),
  );

  const section = (title: string) =>
    tab.querySelector<HTMLElement>(`[aria-label="${title}"]`) ??
    assert.fail(`the ${title} section stands`);

  assert.equal(standing(tab), "Open");
  assert.equal(
    tab.querySelector(".pull-request-title")?.textContent,
    "Expire invitations #42",
    "the title is what Vespin held of the pull request",
  );
  assert.equal(tabCount(tab, "Files changed"), "1");
  assert.deepEqual(waiting(tab), [
    "Reading pull request",
    "Reading description",
    "Reading conversation",
  ]);

  conversation.answer({ pullRequest: CONVERSATION });
  await settle();
  assert.equal(section("Conversation").querySelectorAll(".pull-request-entry").length, 2);
  await vi.waitFor(() =>
    assert.deepEqual(waiting(tab), ["Reading pull request", "Reading description"]),
  );

  pullRequest.answer({ pullRequest: { ...PULL_REQUEST, title: "Expire invitations weekly" } });
  await vi.waitFor(() => assert.deepEqual(waiting(tab), []));
  assert.equal(tab.querySelector(".pull-request-branches")?.textContent, "main ← luke/expiry-job");
  assert.equal(
    tab.querySelector(".pull-request-title")?.textContent,
    "Expire invitations weekly #42",
    "the read's title replaces what was held",
  );
  assert.equal(
    section("Description").querySelector(".ui-markdown-heading")?.textContent,
    "Summary",
  );

  await choose(tab, "Checks");
  assert.deepEqual(waiting(tab), ["Reading checks"]);
  checks.answer({ pullRequest: CHECKS });
  await settle();
  await vi.waitFor(() => assert.deepEqual(waiting(tab), []));
  assert.deepEqual(words(section("Checks"), "li .ui-list-row-title"), [
    "lint, failed",
    "build, running",
    "test, passed",
  ]);
});

test("until the pull request's own read lands, the line under the title draws what its link's card draws of it, as the host holds it for the agent's task's workspace", async () => {
  const workspace = {
    id: "workspace-acme",
    name: "Acme",
    role: WORKSPACE_ROLE.OWNER,
    github: { login: "acme", active: true },
    memberCount: 2,
  };

  const pullRequest = {
    number: 42,
    title: "Expire invitations",
    url: PAGE,
    state: PULL_REQUEST_STATE.OPEN,
    baseRef: "main",
    headRef: "luke/expiry-job",
    author: "luke-agent[bot]",
    openedAt: 1_000,
  };

  // The host holds the pull request's link standing, as a chip naming it read it, and the workspace it was read through.
  const earlier = fakeAppBridgeCalls().requestAppState ?? assert.fail("the document is handed");
  fakeAppBridge({
    ...fakeAppBridgeCalls(),
    requestAppState: async () => {
      const state = await earlier();

      return {
        ...state,
        tasks: {
          ...IDLE_TASKS_VIEW,
          workspaces: [workspace],
          tasks: [
            {
              id: AGENT.taskId,
              workspaceId: workspace.id,
              name: "Expire invitations",
              createdAt: 1,
              updatedAt: 1,
              repository: "acme/relay",
            },
          ],
        },
        [LIVE_READ.LINK_STANDINGS]: { [workspace.id]: { [PAGE]: { rows: { pullRequest } } } },
      };
    },
  });
  const control = controlAnswering({ pullRequest: held<never>().read });
  const tab = await draw(control);

  await vi.waitFor(() => assert.deepEqual(waiting(tab), ["Reading description"]));
  assert.equal(tab.querySelector(".pull-request-branches")?.textContent, "main ← luke/expiry-job");
  assert.match(tab.querySelector(".pull-request-opened")?.textContent ?? "", /opened/u);
});

/** A read answering each ask with the next of the answers given, the last again once they run out. */
function inTurn<A>(...answers: readonly A[]): () => Promise<A> {
  let ask = 0;

  return () => {
    const answer = answers[Math.min(ask, answers.length - 1)] ?? assert.fail("an answer is given");
    ask += 1;

    return Promise.resolve(answer);
  };
}

test("a part whose read failed says so with a Retry that reads it alone, the others standing; Refresh reads again the header's reads and the checks once shown", async () => {
  const failure = { failure: AGENT_CALL_FAILURE.UNANSWERED } as const;
  const later = (name: string) => ({ checks: [check(name, CHECK_STATE.PASSED)] });

  const tab = await draw(
    controlAnswering({
      pullRequest: inTurn<AgentOverviewPullRequestAnswerView>(
        { pullRequest: PULL_REQUEST },
        { pullRequest: { ...PULL_REQUEST, title: "Expire invitations weekly" } },
      ),
      checks: inTurn<AgentOverviewChecksAnswerView>(
        failure,
        { pullRequest: later("retried") },
        { pullRequest: later("refreshed") },
      ),
      conversation: inTurn<AgentOverviewConversationAnswerView>(
        { pullRequest: CONVERSATION },
        { pullRequest: { ...CONVERSATION, conversation: CONVERSATION.conversation.slice(0, 1) } },
      ),
    }),
  );

  await choose(tab, "Checks");

  const checks =
    tab.querySelector('[aria-label="Checks"]') ?? assert.fail("the checks section stands");

  assert.match(checks.textContent ?? "", /The checks could not be read\./u);
  assert.equal(tab.querySelector(".pull-request-branches")?.textContent, "main ← luke/expiry-job");
  assert.equal(tab.querySelectorAll(".pull-request-entry").length, 2, "the conversation stands");

  const retry =
    [...checks.querySelectorAll("button")].find((button) => button.textContent === "Retry") ??
    assert.fail("the failed section offers a retry");

  act(() => retry.click());
  await settle();
  assert.deepEqual(words(tab, "li .ui-list-row-title"), ["retried, passed"]);
  assert.equal(
    tab.querySelector(".pull-request-title")?.textContent,
    "Expire invitations #42",
    "the pull request is not read again",
  );
  assert.equal(tab.querySelectorAll(".pull-request-entry").length, 2, "nor is the conversation");

  await pressToolbar(tab, "Refresh");
  await settle();
  assert.deepEqual(words(tab, "li .ui-list-row-title"), ["refreshed, passed"]);
  assert.equal(
    tab.querySelector(".pull-request-title")?.textContent,
    "Expire invitations weekly #42",
  );
  assert.equal(tab.querySelectorAll(".pull-request-entry").length, 1);
});

test("where nothing of the pull request is held and its reads fail, the line under the title alone says so, reporting what failed beneath it, and its Retry reads every failed part again; Files changed still reads on its own", async () => {
  const failure = {
    failure: AGENT_CALL_FAILURE.UNANSWERED,
    cause: { _tag: FAILURE_FACT.HOSTED_UNANSWERED, fault: "timeout" },
  } as const;

  const reported: Parameters<ShownFailureSentry["logger"]["warn"]>[1][] = [];

  const recording: ShownFailureSentry = {
    captureException: () => "",
    logger: {
      warn: (_message, attributes) => reported.push(attributes),
      error: (_message, attributes) => reported.push(attributes),
    },
    getActiveSpan: () => undefined,
    getCurrentScope: () => ({
      getPropagationContext: () => ({ traceId: "0af7651916cd43dd8448eb211c80319c" }),
    }),
  };

  onTestFinished(
    installShownFailureReporter(
      (report) => sendShownFailure(recording, report),
      testQueryClientNow(),
    ),
  );

  const control = {
    ...controlAnswering({
      pullRequest: inTurn<AgentOverviewPullRequestAnswerView>(failure, {
        pullRequest: PULL_REQUEST,
      }),
      conversation: inTurn<AgentOverviewConversationAnswerView>(failure, {
        pullRequest: CONVERSATION,
      }),
    }),
    pullRequests: new Map(),
  };

  const tab = await draw(control);

  const header =
    tab.querySelector(".pull-request-header") ?? assert.fail("the header stands, failed");

  await vi.waitFor(() =>
    assert.match(header.textContent ?? "", /The pull request could not be read\./u),
  );
  await vi.waitFor(() =>
    assert.equal(
      tab.querySelector('[aria-label="Conversation"]') === null,
      true,
      "the conversation's failure is the title's to say",
    ),
  );
  assert.equal(tab.querySelectorAll('[role="alert"]').length, 1);
  assert.deepEqual(
    reported.map((attributes) => [
      attributes["failure.surface"],
      attributes["failure.code"],
      attributes["error.root.tag"],
      attributes["error.root.fault"],
    ]),
    [["pull_request.read", "unanswered", "HostedUnanswered", "timeout"]],
  );

  await choose(tab, "Files changed");
  assert.match(
    tab.textContent ?? "",
    /This pull request changes no files\./u,
    "the files read on their own",
  );

  const retry =
    [...header.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Retry",
    ) ?? assert.fail("the title's failure offers a retry");

  await act(async () => retry.click());
  await settle();
  assert.equal(tab.querySelector(".pull-request-title")?.textContent, "Expire invitations #42");
  await choose(tab, "Conversation");
  await vi.waitFor(() => assert.match(tab.textContent ?? "", /Rename the flag\./u));
  assert.equal(tab.querySelectorAll(".pull-request-entry").length, 2);
});

test("the pill wears what was published of the checks only for the pull request they were read on, never a newer one whose checks failed to read", async () => {
  const control = {
    ...controlAnswering({
      pullRequest: () => Promise.resolve({ pullRequest: { ...PULL_REQUEST, number: 43 } }),
      checks: () => Promise.resolve({ failure: AGENT_CALL_FAILURE.UNANSWERED }),
    }),
  };

  const tab = await draw(control);
  const mark = pillOf(tab)?.querySelector("[aria-label]") ?? assert.fail("a mark");
  assert.match(mark.getAttribute("aria-label") ?? "", /43/u);
  assert.doesNotMatch(
    mark.getAttribute("aria-label") ?? "",
    /checks failing/u,
    "#42's failing checks are not #43's",
  );
});

test("a draft's pill offers Ready for review, and Close pull request in red, which is asked of the service for the agent, and the tab reads the pull request again, its pill then saying it is open and offering Convert to draft", async () => {
  let reads = 0;

  const tab = await draw(
    controlAnswering(
      {
        pullRequest: () => {
          reads += 1;

          return Promise.resolve({
            pullRequest: {
              ...PULL_REQUEST,
              state: reads === 1 ? PULL_REQUEST_STATE.DRAFT : PULL_REQUEST_STATE.OPEN,
            },
          });
        },
      },
      PULL_REQUEST_STATE.DRAFT,
    ),
  );

  assert.equal(pill(tab).textContent, "Draft");
  assert.deepEqual(offered(tab), ["Ready for review", "Close pull request"]);

  await pressAction(tab, "Ready for review");

  assert.deepEqual(world.changes, [[AGENT.id, { action: PULL_REQUEST_ACTION.READY_FOR_REVIEW }]]);
  assert.equal(pill(tab).textContent, "Open");
  assert.deepEqual(offered(tab), ["Convert to draft", "Close pull request"]);
  assert.equal(tab.querySelector(".pull-request-write-note") === null, true);
});

test("a member GitHub would not take as signed in is offered to sign in with GitHub again, and a merged pull request's pill offers nothing", async () => {
  let connects = 0;
  world.changeAnswer = { outcome: PULL_REQUEST_WRITE_OUTCOME.SIGN_IN_REQUIRED };

  const tab = await draw(controlAnswering(), PULL_REQUEST_VIEW.CONVERSATION, {
    ...NO_GITHUB,
    connect: () => {
      connects += 1;

      return Promise.resolve(true);
    },
  });

  await pressAction(tab, "Convert to draft");

  // Note that the refusal lands through the change's mutation, so the note is read once drawn.
  await vi.waitFor(() =>
    assert.equal(
      tab.querySelector(".pull-request-write-note") !== null,
      true,
      "the tab says why the change was not made",
    ),
  );

  const note =
    tab.querySelector<HTMLElement>(".pull-request-write-note") ??
    assert.fail("the tab says why the change was not made");

  assert.match(note.textContent ?? "", /Sign in with GitHub to make this change as you\./u);

  const signIn =
    [...note.querySelectorAll("button")].find(
      (button) => button.textContent === "Sign in with GitHub",
    ) ?? assert.fail("the line offers to sign in with GitHub");

  act(() => signIn.click());
  assert.equal(connects, 1);
  act(() => world.root?.unmount());
  world.root = undefined;

  const merged = await draw(
    controlAnswering({
      pullRequest: () =>
        Promise.resolve({ pullRequest: { ...PULL_REQUEST, state: PULL_REQUEST_STATE.MERGED } }),
    }),
  );

  // Note that the open pull request the draw before read stands in the cache until this draw's read lands.
  await vi.waitFor(() => assert.equal(standing(merged), "Merged"));
  assert.ok(pillPress(merged) === undefined, "a merged pull request's pill is no press");
});

test("a change refused for a repository out of the workspace's reach says where access is given, and Open Settings opens the GitHub of the agent's task's workspace", async () => {
  world.changeAnswer = { failure: AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE };
  const opened: string[] = [];

  const tab = await drawn(
    createElement(RepositoryRemedyProvider, {
      value: {
        openWorkspaceGitHub: (taskId) => opened.push(taskId),
        openGitHub: () => undefined,
        chooseRepository: () => undefined,
        moveTask: () => Promise.resolve(false),
      },
      children: createElement(Switching, {
        control: controlAnswering(),
        first: PULL_REQUEST_VIEW.CONVERSATION,
      }),
    }),
  );

  await pressAction(tab, "Convert to draft");

  // Note that the refusal lands through the change's mutation, so the note is read once drawn.
  await vi.waitFor(() =>
    assert.equal(
      tab.querySelector(".pull-request-write-note") !== null,
      true,
      "the tab says why the change was not made",
    ),
  );

  const note =
    tab.querySelector<HTMLElement>(".pull-request-write-note") ??
    assert.fail("the tab says why the change was not made");

  assert.match(
    note.textContent ?? "",
    /Vespin cannot reach this task's repository on GitHub\. Choose which repositories Vespin can see\./u,
  );

  const open =
    [...note.querySelectorAll("button")].find((button) => button.textContent === "Open Settings") ??
    assert.fail("the line offers Settings, where access is given");

  act(() => open.click());
  assert.deepEqual(opened, [AGENT.taskId]);
});

test("a change GitHub refused says so in GitHub's own words until dismissed, and the pull request is read again in case it moved", async () => {
  let reads = 0;
  world.changeAnswer = {
    outcome: PULL_REQUEST_WRITE_OUTCOME.REFUSED,
    words: "Pull request is in the merge queue.",
  };

  const tab = await draw(
    controlAnswering({
      pullRequest: () => {
        reads += 1;

        return Promise.resolve({ pullRequest: PULL_REQUEST });
      },
    }),
  );

  await pressAction(tab, "Convert to draft");

  await vi.waitFor(() =>
    assert.equal(tab.querySelector(".pull-request-write-note") === null, false),
  );

  const note =
    tab.querySelector<HTMLElement>(".pull-request-write-note") ??
    assert.fail("the tab says GitHub refused");

  assert.equal(
    note.querySelector("[role='alert']")?.textContent,
    "GitHub refused this change.\nGitHub said: “Pull request is in the merge queue.”",
  );
  assert.ok(reads > 1, "the pull request is read again after GitHub answered");

  const dismiss =
    note.querySelector<HTMLButtonElement>('[aria-label="Dismiss"]') ??
    assert.fail("the line may be dismissed");

  act(() => dismiss.click());
  await vi.waitFor(() =>
    assert.ok(tab.querySelector(".pull-request-write-note") === null, "the line is dismissed"),
  );
});

/** Each case of the merge control: its name, the pull request's control, and what the control shows. */
function mergeCases() {
  const draft = controlAnswering(
    {
      pullRequest: () =>
        Promise.resolve({
          pullRequest: {
            ...PULL_REQUEST,
            state: PULL_REQUEST_STATE.DRAFT,
            merge: MERGE_STATE.DRAFT,
            canBypassRules: true,
            merging: MERGING,
          },
        }),
    },
    PULL_REQUEST_STATE.DRAFT,
  );

  const none = { chip: undefined, tone: undefined, sentence: undefined };

  const held = (chip: string, tone: string, sentence: string) => ({
    chip,
    tone,
    sentence,
    press: undefined,
    look: undefined,
    chevron: false,
  });

  const cases = [
    [
      "ready",
      merging(MERGE_STATE.CLEAN),
      { ...none, press: "Squash and merge", look: "primary", chevron: true },
    ],
    [
      "ready by one method",
      merging(MERGE_STATE.CLEAN, { methods: [MERGE_METHOD.MERGE] }),
      { ...none, press: "Merge pull request", look: "primary", chevron: false },
    ],
    [
      "checks running, auto-merge offered before any bypass",
      merging(MERGE_STATE.BLOCKED, { checks: CHECK_SUMMARY.PENDING }, true),
      { ...none, press: "Enable auto-merge", look: "outline", chevron: true },
    ],
    [
      "a merge queue's base",
      merging(MERGE_STATE.CLEAN, { queue: true }),
      { ...none, press: "Merge when ready", look: "primary", chevron: false },
    ],
    [
      "queued",
      merging(MERGE_STATE.UNKNOWN, {
        queue: true,
        queued: { position: 3 },
        autoMerge: { method: null },
      }),
      { ...none, press: "Remove from queue", look: "outline", chevron: false },
    ],
    [
      "auto-merge on, waiting on its checks, which its press says",
      merging(MERGE_STATE.BLOCKED, {
        checks: CHECK_SUMMARY.PENDING,
        autoMerge: { method: MERGE_METHOD.SQUASH },
      }),
      { ...none, press: "Disable auto-merge", look: "outline", chevron: false },
    ],
    [
      "auto-merge on, about to merge",
      merging(MERGE_STATE.CLEAN, { autoMerge: { method: MERGE_METHOD.SQUASH } }),
      { ...none, press: "Disable auto-merge", look: "outline", chevron: false },
    ],
    [
      "auto-merge on, a review required",
      merging(MERGE_STATE.BLOCKED, {
        review: REVIEW_DECISION.REVIEW_REQUIRED,
        autoMerge: { method: MERGE_METHOD.SQUASH },
      }),
      {
        chip: "Review required",
        tone: "attention",
        sentence: "Auto-merge is on (squash). A required review is missing",
        press: "Disable auto-merge",
        look: "outline",
        chevron: false,
      },
    ],
    [
      "conflicts, which no bypass merges",
      merging(MERGE_STATE.CONFLICTS, {}, true),
      held("Conflicts", "danger", "Conflicts with main"),
    ],
    [
      "behind",
      merging(MERGE_STATE.BEHIND),
      held("Behind", "attention", "Behind main; it must be brought up to date"),
    ],
    [
      "checking, which no bypass merges",
      merging(MERGE_STATE.UNKNOWN, {}, true),
      held("Checking", "working", "GitHub is still checking whether it merges"),
    ],
    [
      "review required",
      merging(MERGE_STATE.BLOCKED, { review: REVIEW_DECISION.REVIEW_REQUIRED }),
      held(
        "Review required",
        "attention",
        "A required review is missing, so it can't be merged yet",
      ),
    ],
    ["checks failing", merging(MERGE_STATE.BLOCKED, { checks: CHECK_SUMMARY.FAILING }), undefined],
    [
      "checks failing and a review required",
      merging(MERGE_STATE.BLOCKED, {
        checks: CHECK_SUMMARY.FAILING,
        review: REVIEW_DECISION.REVIEW_REQUIRED,
      }),
      held(
        "Review required",
        "attention",
        "A required review is missing, so it can't be merged yet",
      ),
    ],
    [
      "changes requested",
      merging(MERGE_STATE.BLOCKED, { review: REVIEW_DECISION.CHANGES_REQUESTED }),
      held("Changes requested", "danger", "Changes were requested, so it can't be merged yet"),
    ],
    [
      "blocked",
      merging(MERGE_STATE.BLOCKED),
      held("Blocked", "danger", "Merging is blocked by a required review or check"),
    ],
    ["a draft, which its pill says", draft, undefined],
  ] as const;

  return cases;
}

test.each(mergeCases().map(([name]) => name))(
  "the merge control is a chip saying what holds the merge up, GitHub's sentence for a reader, beside the one press that may be made now, in the look of what it does; checks alone holding it up draw no chip, the Checks tab saying them: %s",
  async (name) => {
    const [, control, expected] =
      mergeCases().find(([each]) => each === name) ?? assert.fail(`no case ${name}`);

    const tab = await draw(control);
    await vi.waitFor(() => assert.deepEqual(mergeShown(tab), expected, name));
  },
);

test("a pull request ready to merge offers the first method the repository allows as its press, its chevron choosing another, kept for the repository; the press merges at once, as stage-cli's does, at the head it read", async () => {
  const first = await draw(merging(MERGE_STATE.CLEAN));

  // Note that the merge control stands once the pull request's merge read reaches its query.
  const chevron = await vi.waitFor(
    () =>
      first.querySelector<HTMLButtonElement>('.merge-control [aria-label="Choose how to merge"]') ??
      assert.fail("the chevron chooses the method"),
  );

  act(() => chevron.click());
  assert.deepEqual(menuItems(), [
    { label: "Squash and merge", checked: "true" },
    { label: "Rebase and merge", checked: "false" },
  ]);
  await pressItem("Rebase and merge");
  await vi.waitFor(() => assert.equal(mergeShown(first)?.press, "Rebase and merge"));
  assert.deepEqual(world.changes, [], "choosing a method merges nothing");
  act(() => world.root?.unmount());
  world.root = undefined;

  const again = await draw(merging(MERGE_STATE.CLEAN));
  await vi.waitFor(() =>
    assert.equal(mergeShown(again)?.press, "Rebase and merge", "the method chosen is kept"),
  );
  await pressBox(again, "Rebase and merge");
  assert.equal(
    document.querySelector(
      '[role="dialog"]:not(.ui-toast), [role="alertdialog"]:not(.ui-toast)',
    ) === null,
    true,
    "a merge asks nothing first",
  );
  assert.deepEqual(world.changes, [
    [
      AGENT.id,
      { action: PULL_REQUEST_ACTION.MERGE, method: MERGE_METHOD.REBASE, headSha: "c0ffee1" },
    ],
  ]);
});

test("auto-merge is offered while checks run, and turned off once on; a merge queue's base offers Merge when ready; each is asked of the service for the agent at once, and Remove from queue asks first, as Bypass rules and merge… does, naming what it bypasses, for a member GitHub lets merge a blocked pull request past its base's rules", async () => {
  const queueQuestion = {
    answer: "Remove from queue",
    says: /could impact other pull requests in the queue/u,
  };

  const cases: readonly (readonly [
    AgentsControl,
    string,
    { readonly answer: string; readonly says: RegExp } | undefined,
    PullRequestActionRequest,
  ])[] = [
    [
      merging(MERGE_STATE.BLOCKED, { checks: CHECK_SUMMARY.PENDING }),
      "Enable auto-merge",
      undefined,
      {
        action: PULL_REQUEST_ACTION.ENABLE_AUTO_MERGE,
        method: MERGE_METHOD.SQUASH,
        headSha: "c0ffee1",
      },
    ],
    [
      merging(MERGE_STATE.BLOCKED, { autoMerge: { method: MERGE_METHOD.SQUASH } }),
      "Disable auto-merge",
      undefined,
      { action: PULL_REQUEST_ACTION.DISABLE_AUTO_MERGE },
    ],
    [
      merging(MERGE_STATE.CLEAN, { queue: true }),
      "Merge when ready",
      undefined,
      { action: PULL_REQUEST_ACTION.ENABLE_AUTO_MERGE, headSha: "c0ffee1" },
    ],
    [
      merging(MERGE_STATE.CLEAN, {
        queue: true,
        queued: { position: 2 },
        autoMerge: { method: null },
      }),
      "Remove from queue",
      queueQuestion,
      { action: PULL_REQUEST_ACTION.DEQUEUE },
    ],
    [
      controlAnswering({
        pullRequest: () =>
          Promise.resolve({
            pullRequest: {
              ...PULL_REQUEST,
              merge: MERGE_STATE.BLOCKED,
              canBypassRules: true,
              merging: { ...MERGING, review: REVIEW_DECISION.REVIEW_REQUIRED },
            },
          }),
      }),
      "Bypass rules and merge…",
      {
        answer: "Bypass rules and merge",
        says: /A required review is missing\. This merges it into main now by squash/u,
      },
      { action: PULL_REQUEST_ACTION.MERGE, method: MERGE_METHOD.SQUASH, headSha: "c0ffee1" },
    ],
  ];

  for (const [control, label, question, request] of cases) {
    world.changes = [];
    const tab = await draw(control);
    await pressBox(tab, label);

    if (question !== undefined) {
      assert.deepEqual(world.changes, [], `${label} asks first`);
      assert.match(
        document.querySelector(
          '[role="dialog"]:not(.ui-toast), [role="alertdialog"]:not(.ui-toast)',
        )?.textContent ?? "",
        question.says,
      );
      await answerQuestion(question.answer);
    }

    assert.deepEqual(world.changes, [[AGENT.id, request]], label);
    act(() => world.root?.unmount());
    world.root = undefined;
  }
});

test("while a merge's change is out its press stands busy, a second press sends nothing, nor does a review submitted from the Review panel, and where GitHub refuses it the tab says so in GitHub's own words", async () => {
  const { promise, resolve } = Promise.withResolvers<void>();
  world.changeHeld = promise;
  world.changeAnswer = {
    outcome: PULL_REQUEST_WRITE_OUTCOME.REFUSED,
    words: "Pull request is not mergeable.",
  };
  const tab = await draw(merging(MERGE_STATE.CLEAN));
  await pressBox(tab, "Squash and merge");
  await vi.waitFor(() => {
    const [press] = mergePresses(tab);
    assert.equal(press?.getAttribute("aria-busy"), "true");
    assert.equal(press?.getAttribute("aria-label"), "Merging");
  });
  // A second change while the first is out is dropped, from any control of the pull request.
  const [press] = mergePresses(tab);
  await act(async () => press?.click());
  writeReview(openReview(tab), "Looks right.");
  await submitReview(tab.querySelector<HTMLElement>('[role="dialog"]') ?? tab, "Approve");
  resolve();
  await vi.waitFor(() =>
    assert.equal(
      tab.querySelector(".pull-request-write-note [role='alert']")?.textContent,
      "GitHub refused this change.\nGitHub said: “Pull request is not mergeable.”",
    ),
  );
  await settle();
  // Note that the review is read once the merge has settled, since one waiting its turn would go then.
  assert.deepEqual(
    world.changes.map(([, change]) => change.action),
    [PULL_REQUEST_ACTION.MERGE],
    "the merge alone went",
  );
});

test("a change GitHub took keeps its press busy until the tab reads the pull request again, so Merge when ready never stands again before Disable auto-merge", async () => {
  const readBack = held<AgentOverviewPullRequestAnswerView>();
  let reads = 0;

  const before = {
    ...PULL_REQUEST,
    merge: MERGE_STATE.CLEAN,
    merging: { ...MERGING, queue: true },
  };

  const after = { ...before, merging: { ...before.merging, autoMerge: { method: null } } };

  const tab = await draw(
    controlAnswering({
      pullRequest: () => {
        reads += 1;

        return reads === 1 ? Promise.resolve({ pullRequest: before }) : readBack.read();
      },
    }),
  );

  await pressBox(tab, "Merge when ready");
  const [busy] = mergePresses(tab);
  assert.equal(busy?.getAttribute("aria-busy"), "true", "GitHub answered, the read is still out");
  assert.equal(busy?.getAttribute("aria-label"), "Turning on auto-merge");
  readBack.answer({ pullRequest: after });
  await settle();
  assert.equal(mergeShown(tab)?.press, "Disable auto-merge");
  assert.equal(mergePresses(tab)[0]?.getAttribute("aria-busy"), null);
});

test("Review stands at the end of the tabs' row however the pull request stands, open, a draft, closed, or merged, as GitHub takes a review of each", async () => {
  const states = [
    [PULL_REQUEST_STATE.OPEN, true],
    [PULL_REQUEST_STATE.DRAFT, true],
    [PULL_REQUEST_STATE.CLOSED, true],
    [PULL_REQUEST_STATE.MERGED, true],
  ] as const;

  for (const [state, offered] of states) {
    const tab = await draw(
      controlAnswering(
        { pullRequest: () => Promise.resolve({ pullRequest: { ...PULL_REQUEST, state } }) },
        state,
      ),
    );

    const row =
      tab.querySelector<HTMLElement>(".pull-request-tab > .ui-pane-bar") ??
      assert.fail("the tabs' row stands");

    const review = buttonWith(row, /^Review$/u);
    assert.equal(review !== undefined, offered, state);
    const before = review?.closest(".pull-request-review")?.parentElement?.previousElementSibling;
    assert.equal(
      before?.firstElementChild?.getAttribute("role") ?? null,
      offered ? "tablist" : null,
      "Review follows the tabs",
    );
    assert.equal(
      buttonWith(tab.querySelector(".pull-request-header") ?? tab, /^Review$/u),
      undefined,
    );
    act(() => world.root?.unmount());
    world.root = undefined;
  }
});

/** The Review press at the end of the tabs' row. */
function reviewPress(tab: HTMLElement): HTMLButtonElement {
  return (
    buttonWith(tab.querySelector(".pull-request-tab > .ui-pane-bar") ?? tab, /^Review$/u) ??
    assert.fail("an open pull request's tabs offer Review")
  );
}

/** Opens the review panel from the tabs' row. */
function openReview(tab: HTMLElement): HTMLElement {
  act(() => reviewPress(tab).click());

  return tab.querySelector<HTMLElement>('[role="dialog"]') ?? assert.fail("Review opens the panel");
}

/** Writes the review's words as the member would. */
function writeReview(panel: HTMLElement, words: string): void {
  writeBox(panel, words, "Review comment");
}

/** Chooses what the review says by its label, and submits it. */
async function submitReview(panel: HTMLElement, label: string): Promise<void> {
  const choice =
    [
      ...panel.querySelectorAll<HTMLButtonElement>(
        '[aria-label="What the review says"] [role="radio"]',
      ),
    ].find((each) => each.textContent?.startsWith(label)) ??
    assert.fail(`the panel offers ${label}`);

  act(() => choice.click());

  const submit =
    [...panel.querySelectorAll("button")].find((each) => each.textContent === "Submit review") ??
    assert.fail("the panel submits");

  act(() => submit.click());
  await settle();
}

test("Review opens a panel whose choice and words are submitted for the agent as one review, after which it closes, lets its words go, and the conversation is read again", async () => {
  let conversationReads = 0;

  const tab = await draw(
    controlAnswering({
      conversation: () => {
        conversationReads += 1;

        return Promise.resolve({ pullRequest: CONVERSATION });
      },
    }),
  );

  const panel = openReview(tab);
  assert.deepEqual(words(panel, '[aria-label="What the review says"] [role="radio"]'), [
    "Comment",
    "Approve",
    "Request changes",
  ]);

  writeReview(panel, "Ship it once **CI** is green.");
  await submitReview(panel, "Approve");

  assert.deepEqual(world.changes, [
    [
      AGENT.id,
      {
        action: PULL_REQUEST_ACTION.SUBMIT_REVIEW,
        event: REVIEW_EVENT.APPROVE,
        body: "Ship it once **CI** is green.",
      },
    ],
  ]);
  assert.equal(conversationReads, 2, "the conversation is read again once GitHub took the review");
  assert.equal(tab.querySelector('[role="dialog"]') === null, true, "the panel closes");
  const reopened = openReview(tab);
  assert.equal(boxWords(reopened), "", "the submitted words are let go");
  assert.equal(
    reopened
      .querySelector('[aria-label="What the review says"] [aria-checked="true"]')
      ?.textContent?.startsWith("Comment"),
    true,
    "a fresh review says Comment",
  );
});

test("Escape in the review's words closes the panel and hands the focus back to Review, its words kept", async () => {
  const tab = await draw(controlAnswering());
  const panel = openReview(tab);
  writeReview(panel, "Almost.");

  pressInBox(panel, { key: "Escape" }, "Review comment");
  await settle();

  assert.equal(tab.querySelector('[role="dialog"]'), null, "the panel closes");
  assert.equal(document.activeElement, reviewPress(tab), "the focus is back on Review");
  assert.equal(boxWords(openReview(tab), "Review comment"), "Almost.");
  assert.deepEqual(world.changes, []);
});

test("Enter submits the review from its words, while Shift+Enter only adds a line and an input method's Enter sends nothing", async () => {
  const tab = await draw(controlAnswering());
  const panel = openReview(tab);

  writeReview(panel, "Looks right.");
  pressInBox(panel, { key: "Enter", shiftKey: true }, "Review comment");
  await settle();
  assert.deepEqual(world.changes, [], "Shift+Enter sends nothing");
  assert.deepEqual(
    boxEditor(panel, "Review comment").state.doc.children.map((block) => block.textContent),
    ["Looks right.", ""],
    "Shift+Enter adds a line",
  );
  pressInBox(panel, { key: "Enter", isComposing: true, keyCode: 229 }, "Review comment");
  await settle();
  assert.deepEqual(world.changes, [], "nor does an input method's Enter");

  pressInBox(panel, { key: "Enter" }, "Review comment");
  await settle();

  assert.deepEqual(world.changes, [
    [
      AGENT.id,
      {
        action: PULL_REQUEST_ACTION.SUBMIT_REVIEW,
        event: REVIEW_EVENT.COMMENT,
        // Note that the line Shift+Enter left open after the words holds nothing, so it writes nothing.
        body: "Looks right.",
      },
    ],
  ]);
});

test("a review GitHub refuses says so in GitHub's own words inside the panel, never over the header, and the words written stand for another try", async () => {
  world.changeAnswer = {
    outcome: PULL_REQUEST_WRITE_OUTCOME.REFUSED,
    words: "Review Can not approve your own pull request",
  };
  const tab = await draw(controlAnswering());
  const panel = openReview(tab);

  writeReview(panel, "LGTM");
  await submitReview(panel, "Approve");

  await vi.waitFor(() =>
    assert.equal(
      panel.querySelector(".pull-request-review-note [role='alert']")?.textContent,
      "GitHub refused this change.\nGitHub said: “Review Can not approve your own pull request”",
    ),
  );
  assert.equal(tab.querySelector(".pull-request-write-note") === null, true);
  assert.equal(boxWords(panel), "LGTM");
});

test("a merged pull request still takes a review, sent for the agent as one on an open one is, and keeps its comment box, as GitHub does", async () => {
  const merged = await draw(
    controlAnswering(
      {
        pullRequest: () =>
          Promise.resolve({
            pullRequest: { ...PULL_REQUEST, state: PULL_REQUEST_STATE.MERGED, mergedAt: 5_000 },
          }),
      },
      PULL_REQUEST_STATE.MERGED,
    ),
  );

  assert.ok(merged.querySelector(".pull-request-comment-box"), "its comment box stands");
  const panel = openReview(merged);
  writeReview(panel, "Late, but LGTM");
  await submitReview(panel, "Approve");
  assert.deepEqual(world.changes.at(-1), [
    AGENT.id,
    {
      action: PULL_REQUEST_ACTION.SUBMIT_REVIEW,
      event: REVIEW_EVENT.APPROVE,
      body: "Late, but LGTM",
    },
  ]);
});

test("a press outside the review panel closes it, its words kept, and one on a short window opens it on the side with more room, bounded to that room", async () => {
  // Note that jsdom lays out nothing, so the press stands low in a 768px window and the panel is taller than either side.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.classList.contains("pull-request-review")) {
      return DOMRect.fromRect({ x: 600, y: 300, width: 80, height: 28 });
    }

    if (this.classList.contains("ui-anchored-popover")) {
      return DOMRect.fromRect({ x: 0, y: 0, width: 480, height: 600 });
    }

    return DOMRect.fromRect({ x: 0, y: 0, width: 0, height: 0 });
  });

  try {
    const tab = await draw(controlAnswering());
    const panel = openReview(tab);

    const layer =
      tab.querySelector<HTMLElement>(".ui-anchored-popover") ??
      assert.fail("the panel hangs from Review");

    assert.equal(layer.dataset.side, "below");
    assert.equal(layer.style.getPropertyValue("--ui-popover-room"), `${768 - 328 - 4 - 8}px`);

    writeReview(panel, "Half a thought");
    act(() => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });

    assert.equal(tab.querySelector('[role="dialog"]') === null, true);
    assert.equal(boxWords(openReview(tab)), "Half a thought");
  } finally {
    vi.restoreAllMocks();
  }
});

test("a pull request's labels stand before the picker that edits them, as its reviewers do: with none, the picker says what it adds; once some stand, it is a plus named for editing them, the two closing the line of people", async () => {
  let labels: { name: string; color: string }[] = [];

  const tab = await draw(
    controlAnswering({
      pullRequest: () => Promise.resolve({ pullRequest: { ...PULL_REQUEST, labels } }),
    }),
  );

  const people = () =>
    tab.querySelector<HTMLElement>(".pull-request-header .pull-request-people") ??
    assert.fail("the line of people stands");

  const labelGroup = () =>
    people().querySelector(".pull-request-label-group") ?? assert.fail("the labels' group stands");

  const labelPicker = () => labelGroup().querySelector(".pull-request-picker button");

  assert.equal(tab.querySelector(".pull-request-header .pull-request-labels") === null, true);
  assert.equal(labelPicker()?.getAttribute("aria-label"), "Label");

  labels = [{ name: "bug", color: "d73a4a" }];
  await pressToolbar(tab, "Refresh");
  await settle();

  const list =
    labelGroup().querySelector('[aria-label="Labels"]') ?? assert.fail("its labels stand");

  assert.equal(list.textContent, "bug");
  assert.equal(
    list.compareDocumentPosition(labelPicker() ?? assert.fail("its picker stands")) &
      Node.DOCUMENT_POSITION_FOLLOWING,
    Node.DOCUMENT_POSITION_FOLLOWING,
    "the picker follows the labels",
  );
  assert.equal(labelPicker()?.getAttribute("aria-label"), "Edit labels");
  assert.equal(people().lastElementChild, labelGroup(), "they close the line of people");
});

it.effect(
  "each branch is a chip that copies its name: a button the keyboard reaches, named for what it copies, its glyph turning to the check and saying Copied once the clipboard took it",
  () =>
    Effect.gen(function* () {
      serveEffectsOn(Context.make(Clock.Clock, yield* Clock.Clock));
      const copied: string[] = [];
      fakeAppPlatform({ ...DESKTOP_LINKS, ...copyingInto(copied) });

      const tab = yield* Effect.promise(() =>
        draw(controlAnswering(), PULL_REQUEST_VIEW.CONVERSATION),
      );

      const branches =
        tab.querySelector<HTMLElement>(".pull-request-header .pull-request-branches") ??
        assert.fail("the branches stand");

      const chips = [...branches.querySelectorAll<HTMLButtonElement>("button")];
      const head = chips[1] ?? assert.fail("the head's chip stands");

      assert.deepEqual(
        chips.map((chip) => [
          chip.getAttribute("aria-label"),
          chip.type,
          chip.disabled,
          chip.tabIndex,
        ]),
        [
          ["Copy branch main", "button", false, 0],
          ["Copy branch luke/expiry-job", "button", false, 0],
        ],
      );

      yield* Effect.promise(async () => {
        await act(async () => head.click());
        await settle();
      });
      assert.deepEqual(copied, ["luke/expiry-job"]);
      assert.equal(
        head.getAttribute("aria-label"),
        "Copy branch luke/expiry-job",
        "its name stays",
      );

      yield* Effect.promise(async () => {
        await act(async () => chips[0]?.click());
        await settle();
      });
      assert.deepEqual(copied, ["luke/expiry-job", "main"]);
      act(() => world.root?.unmount());
      world.root = undefined;
    }),
);

test("a head on a fork is named, and copied, as GitHub names it: the fork's account, then its branch", async () => {
  const copied: string[] = [];
  fakeAppPlatform({ ...DESKTOP_LINKS, ...copyingInto(copied) });

  const tab = await draw(
    controlAnswering({
      pullRequest: () =>
        Promise.resolve({
          pullRequest: { ...PULL_REQUEST, head: "patch-1", headOwner: "octocat" },
        }),
    }),
  );

  const head =
    tab.querySelector<HTMLButtonElement>('[aria-label="Copy branch octocat:patch-1"]') ??
    assert.fail("the head's chip names its fork");

  assert.equal(tab.querySelector(".pull-request-branches")?.textContent, "main ← octocat:patch-1");
  await act(async () => head.click());
  await settle();
  assert.deepEqual(copied, ["octocat:patch-1"]);
});

test("who opened it reads as one phrase with when: opened a while ago, or, once merged, opened · merged a while ago", async () => {
  const opened = (tab: HTMLElement) => {
    const line =
      tab.querySelector(".pull-request-header .pull-request-opened") ??
      assert.fail("who opened it stands");

    const times = [...line.querySelectorAll("time")];

    return [
      line.querySelector("[data-actor-ref] .ui-inline-ref-label")?.textContent,
      line.querySelector(".pull-request-quiet")?.textContent,
      times.map((time) => time.getAttribute("datetime")),
    ];
  };

  const open = await draw(controlAnswering());
  const [who, said, at] = opened(open);
  assert.equal(who, "luke-agent");
  assert.match(String(said), /^opened \S/u);
  assert.deepEqual(at, [new Date(1_000).toISOString()], "when it was opened");
  act(() => world.root?.unmount());
  document.body.innerHTML = "";

  const merged = await draw(
    controlAnswering(
      {
        pullRequest: () =>
          Promise.resolve({
            pullRequest: {
              ...PULL_REQUEST,
              state: PULL_REQUEST_STATE.MERGED,
              mergedAt: 5_000,
            },
          }),
      },
      PULL_REQUEST_STATE.MERGED,
    ),
  );

  await vi.waitFor(() => assert.match(String(opened(merged)[1]), /^opened · merged \S/u));
  const [, mergedSaid, mergedAt] = opened(merged);
  assert.match(String(mergedSaid), /^opened · merged \S/u);
  assert.deepEqual(
    mergedAt,
    [new Date(5_000).toISOString()],
    "when it merged, the moment that matters",
  );
});

test("its reviewers stand compactly, three faces and a count of the rest: where each stands, a change asked for outlasting a new ask, its author left out, and Apps' bots last; those asked stand asked until the reviews land", async () => {
  const author = { login: "luke-agent[bot]", bot: true };
  const priya = { login: "priyan", bot: false };
  const alex = { login: "alexr", bot: false };
  const linter = { login: "lint-app[bot]", bot: true };
  const conversation = held<{ pullRequest: AgentOverviewConversation }>();

  const tab = await draw(
    controlAnswering({
      pullRequest: () =>
        Promise.resolve({
          pullRequest: {
            ...PULL_REQUEST,
            author,
            requested: [linter, CHARLES_ON_GITHUB, priya, author],
          },
        }),
      conversation: conversation.read,
    }),
  );

  const faces = () =>
    [...tab.querySelectorAll('.pull-request-header [aria-label="Reviewers"] > li')].map((face) =>
      face.getAttribute("aria-label"),
    );

  assert.deepEqual(faces(), [
    "Charles Pan · Review requested",
    "priyan · Review requested",
    "lint-app · Review requested",
  ]);

  conversation.answer({
    pullRequest: {
      ...CONVERSATION,
      reviewers: [
        { by: CHARLES_ON_GITHUB, state: REVIEW_STATE.CHANGES_REQUESTED },
        { by: alex, state: REVIEW_STATE.APPROVED },
      ],
    },
  });
  await settle();
  await vi.waitFor(() =>
    assert.deepEqual(faces(), [
      "Charles Pan · Changes requested",
      "alexr · Approved",
      "priyan · Review requested",
      "lint-app · Review requested",
    ]),
  );
  assert.equal(
    tab.querySelector(".pull-request-header .actor-stack-more")?.textContent,
    "+1",
    "the fourth is counted rather than drawn",
  );
});

test("the stack it stands in sits beside its branches; its menu lists it tip first, and opens an agent's Pull request tab on its task, this one or another, and one no agent owns on GitHub", async () => {
  const elsewhere = "3c5e7a9b-1d2f-4a6b-8c0e-2f4a6b8c0e1d";

  const entry = (number: number, agent?: { id: string; taskId: string }) => ({
    number,
    title: `Step ${number}`,
    url: `https://github.com/acme/relay/pull/${number}`,
    draft: number === 46,
    ...(agent === undefined ? undefined : { agent }),
  });

  const sibling = { id: "5a7c9e1b-3d5f-4b7d-9f1b-3d5f7b9d1f3a", taskId: AGENT.taskId };
  const away = { id: "7c9e1b3d-5f7b-4d9f-8b3d-5f7b9d1f3b5d", taskId: elsewhere };
  const beside = { id: "9e1b3d5f-7b9d-4f1b-8d5f-7b9d1f3b5d7f", taskId: elsewhere };
  const links: ReadLink[] = [];

  const tab = await draw(
    controlAnswering({
      pullRequest: () =>
        Promise.resolve({
          pullRequest: {
            ...PULL_REQUEST,
            stack: [
              entry(38, away),
              entry(40, sibling),
              entry(42, { id: AGENT.id, taskId: AGENT.taskId }),
              entry(44, beside),
              entry(46),
            ],
          },
        }),
    }),
    PULL_REQUEST_VIEW.CONVERSATION,
    undefined,
    (link) => links.push(link),
  );

  const button = await vi.waitFor(
    () =>
      tab.querySelector<HTMLButtonElement>(
        '.pull-request-branch-row button[aria-label="Stack, 3 of 5"]',
      ) ?? assert.fail("the stack stands beside the branches"),
  );

  assert.equal(button.textContent, "Stack 3/5");

  const items = () => [
    ...document.querySelectorAll<HTMLButtonElement>(
      ':is([role="menuitem"], [role="menuitemcheckbox"])',
    ),
  ];

  const press = (number: number) => {
    act(() => button.click());

    const item =
      items().find((each) => each.textContent?.startsWith(`#${number} `)) ??
      assert.fail(`the menu lists #${number}`);

    act(() => item.click());
  };

  act(() => button.click());
  assert.deepEqual(
    items().map((item) => item.textContent?.split(" ")[0]),
    ["#46", "#44", "#42", "#40", "#38"],
  );
  const current = items()[2];
  assert.equal(current?.getAttribute("aria-checked"), "true");
  assert.equal(current?.disabled, false, "this pull request is drawn at full strength");
  act(() => button.click());

  press(42);
  press(40);
  press(38);
  press(44);
  press(46);
  assert.deepEqual(links, [
    {
      workspace: "",
      place: { kind: LINK_DESTINATION.CHANGES, taskId: AGENT.taskId, agentId: sibling.id },
    },
    {
      workspace: "",
      place: { kind: LINK_DESTINATION.CHANGES, taskId: elsewhere, agentId: away.id },
    },
    {
      workspace: "",
      place: { kind: LINK_DESTINATION.CHANGES, taskId: elsewhere, agentId: beside.id },
    },
  ]);
  await vi.waitFor(() => assert.deepEqual(world.opened, ["https://github.com/acme/relay/pull/46"]));
});

test("a pull request of the stack GitHub's merge queue holds says Queued in the stack's menu, and one it does not says nothing of it", async () => {
  const entry = (number: number, queued: boolean) => ({
    number,
    title: `Step ${number}`,
    url: `https://github.com/acme/relay/pull/${number}`,
    draft: false,
    ...(queued ? { queued: true as const } : undefined),
  });

  const tab = await draw(
    controlAnswering({
      pullRequest: () =>
        Promise.resolve({
          pullRequest: { ...PULL_REQUEST, stack: [entry(40, true), entry(42, false)] },
        }),
    }),
    PULL_REQUEST_VIEW.CONVERSATION,
  );

  const button = await vi.waitFor(
    () =>
      tab.querySelector<HTMLButtonElement>(
        '.pull-request-branch-row button[aria-label="Stack, 2 of 2"]',
      ) ?? assert.fail("the stack stands beside the branches"),
  );

  act(() => button.click());

  const items = [
    ...document.querySelectorAll<HTMLButtonElement>(
      ':is([role="menuitem"], [role="menuitemcheckbox"])',
    ),
  ];

  assert.deepEqual(
    items.map((item) => item.textContent),
    ["#42 Step 42", "#40 Step 40Queued · Opens on GitHub"],
  );
  act(() => button.click());
});

test("a pull request in no stack draws no stack", async () => {
  const tab = await draw(
    controlAnswering({
      pullRequest: () => Promise.resolve({ pullRequest: { ...PULL_REQUEST, stack: [] } }),
    }),
  );

  await vi.waitFor(() =>
    assert.ok(tab.querySelector(".pull-request-header .pull-request-branches") !== null),
  );
  assert.equal(tab.querySelector(".pull-request-stack") === null, true);
});

/** The items of the menu standing open, by their words and whether each is checked. */
function menuItems(): { readonly label: string; readonly checked: string | null }[] {
  return [
    ...document.querySelectorAll<HTMLButtonElement>(
      ':is([role="menuitem"], [role="menuitemcheckbox"])',
    ),
  ].map((item) => ({
    label: item.querySelector(".ui-menu-item-label")?.textContent ?? "",
    checked: item.getAttribute("aria-checked"),
  }));
}

/** The rows of the picker standing open, by their words and whether each is checked. */
function pickerRows(): { readonly label: string; readonly checked: boolean }[] {
  return [...document.querySelectorAll<HTMLElement>('[role="option"]')].map((row) => ({
    label: row.querySelector(".ui-combobox-option-label")?.textContent ?? "",
    checked: row.getAttribute("aria-current") === "true",
  }));
}

/** The picker's row whose label begins with the words given. */
function pickerRow(words: string): HTMLElement {
  return (
    [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((row) =>
      row.querySelector(".ui-combobox-option-label")?.textContent?.startsWith(words),
    ) ?? assert.fail(`the picker offers ${words}`)
  );
}

/** Picks the picker's row whose label begins with the words given. */
async function pickRow(words: string): Promise<void> {
  // Note that the rows stand once what the pickers offer reaches its query.
  const row = await vi.waitFor(() => pickerRow(words));
  act(() => row.click());
  await settle();
}

test("the reviewer picker lists the repository's teams then its people, the author left out and those asked checked; choosing one asks a review of them as the member, and the picker waits on the pull request's read before it opens again, then checks them", async () => {
  let asked: readonly GitHubPerson[] = [CHARLES_ON_GITHUB];
  const reread = held<{ pullRequest: AgentOverviewPullRequest }>();
  let reads = 0;

  const tab = await draw(
    controlAnswering({
      pullRequest: () => {
        reads += 1;

        const answer = {
          pullRequest: {
            ...PULL_REQUEST,
            requested: asked,
            requestedTeams: [{ slug: "platform", name: "Platform" }],
          },
        };

        return reads === 1 ? Promise.resolve(answer) : reread.read();
      },
      reviewOptions: () =>
        Promise.resolve({
          labels: [],
          users: [
            CHARLES_ON_GITHUB,
            { login: "priyan", bot: false },
            PULL_REQUEST.author ?? assert.fail(),
          ],
          teams: [
            { slug: "platform", name: "Platform" },
            { slug: "design", name: "Design" },
          ],
        }),
    }),
  );

  const picker = () =>
    tab.querySelector<HTMLButtonElement>(
      '.pull-request-reviewers [aria-label="Reviewer"], .pull-request-reviewers [aria-label="Edit reviewers"]',
    ) ?? assert.fail("the reviewer picker stands beside the reviewers");

  await vi.waitFor(picker);
  act(() => picker().click());
  await settle();
  await vi.waitFor(() =>
    assert.deepEqual(pickerRows(), [
      { label: "Platform", checked: true },
      { label: "Design", checked: false },
      { label: "charlespan", checked: true },
      { label: "priyan", checked: false },
    ]),
  );
  const priyan = pickerRow("priyan");
  assert.equal(
    priyan.querySelector<HTMLElement>(".actor-mark")?.dataset.kind,
    "github",
    "a reviewer is offered by their GitHub face, not a generic icon",
  );
  restOn(priyan);
  const card = document.querySelector('.ui-tooltip-card [data-actor-card="github"]');
  assert.match(card?.textContent ?? "", /priyan/u);
  await pickRow("priyan");

  assert.deepEqual(world.changes, [
    [
      AGENT.id,
      { action: PULL_REQUEST_ACTION.REQUEST_REVIEW, reviewer: { kind: "user", name: "priyan" } },
    ],
  ]);
  assert.equal(
    tab
      .querySelector('.pull-request-reviewers [aria-label="Updating reviewers"]')
      ?.getAttribute("aria-busy"),
    "true",
    "nothing is chosen from what the pull request held before",
  );
  asked = [CHARLES_ON_GITHUB, { login: "priyan", bot: false }];
  reread.answer({
    pullRequest: {
      ...PULL_REQUEST,
      requested: asked,
      requestedTeams: [{ slug: "platform", name: "Platform" }],
    },
  });
  await settle();
  await vi.waitFor(() => picker());
  act(() => picker().click());
  await settle();
  assert.deepEqual(
    pickerRows().find((item) => item.label === "priyan"),
    { label: "priyan", checked: true },
  );
  await pickRow("Platform");
  assert.deepEqual(world.changes.at(-1), [
    AGENT.id,
    {
      action: PULL_REQUEST_ACTION.REMOVE_REVIEW_REQUEST,
      reviewer: { kind: "team", name: "platform" },
    },
  ]);
});

test("a picker's choice shows its button busy once the change has waited the settle delay, and clears when GitHub answers; the other picker only stands disabled", async () => {
  const answer = Promise.withResolvers<void>();
  world.changeHeld = answer.promise;

  const tab = await draw(
    controlAnswering({
      reviewOptions: () =>
        Promise.resolve({
          labels: [{ name: "docs", color: "0075ca" }],
          users: [{ login: "priyan", bot: false }],
          teams: [],
        }),
    }),
  );

  const picker = (name: string) =>
    tab.querySelector<HTMLButtonElement>(
      `.pull-request-header .pull-request-picker button[aria-label^="${name}"]`,
    );

  const ringed = (name: string) => picker(name)?.querySelector(".ui-spinner-ring") != null;
  const labels = () => picker("Label") ?? picker("Edit labels") ?? picker("Updating labels");

  const reviewers = () =>
    picker("Reviewer") ?? picker("Edit reviewers") ?? picker("Updating reviewers");

  act(() => labels()?.click());
  await settle();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  try {
    await pickRow("docs");
    assert.equal(picker("Updating labels")?.getAttribute("aria-busy"), "true");
    assert.equal(ringed("Updating labels"), false);
    act(() => vi.advanceTimersByTime(MOTION_DELAY_MS.SETTLE - 1));
    assert.equal(ringed("Updating labels"), false);
    act(() => vi.advanceTimersByTime(1));
    assert.equal(ringed("Updating labels"), true);
    assert.equal(reviewers()?.disabled, true, "the other picker is held, not busy");
    assert.equal(reviewers()?.getAttribute("aria-busy"), null);
  } finally {
    vi.useRealTimers();
  }

  // Note that the answer reaches React through the change's mutation, which hands it on a timer of its own, so it lands on real timers.
  answer.resolve();
  await vi.waitFor(() =>
    assert.equal(
      picker("Updating labels") === null,
      true,
      "the button is named for what it adds again",
    ),
  );
  assert.equal(labels()?.getAttribute("aria-busy"), null);
});

test("the label picker lists the repository's labels, those on the pull request checked, and takes one off or puts one on as chosen; a merged pull request is offered no reviewers", async () => {
  const tab = await draw(
    controlAnswering(
      {
        pullRequest: () =>
          Promise.resolve({
            pullRequest: {
              ...PULL_REQUEST,
              state: PULL_REQUEST_STATE.MERGED,
              mergedAt: 2_000,
              labels: [{ name: "bug", color: "d73a4a" }],
            },
          }),
        reviewOptions: () =>
          Promise.resolve({
            labels: [
              { name: "bug", color: "d73a4a" },
              { name: "docs", color: "0075ca" },
            ],
            users: [],
            teams: [],
          }),
      },
      PULL_REQUEST_STATE.MERGED,
    ),
  );

  assert.equal(tab.querySelector('[aria-label="Reviewer"]') === null, true);

  // Note that the picker is read again before each press, because taking off the last label turns its plus into the word "Label".
  const picker = () =>
    tab.querySelector<HTMLButtonElement>(
      '.pull-request-label-group [aria-label="Label"], .pull-request-label-group [aria-label="Edit labels"]',
    ) ?? assert.fail("the label picker stands after the labels");

  act(() => picker().click());
  await settle();
  await vi.waitFor(() =>
    assert.deepEqual(pickerRows(), [
      { label: "bug", checked: true },
      { label: "docs", checked: false },
    ]),
  );
  await pickRow("bug");
  act(() => picker().click());
  await settle();
  await pickRow("docs");

  assert.deepEqual(world.changes, [
    [AGENT.id, { action: PULL_REQUEST_ACTION.REMOVE_LABEL, label: "bug" }],
    [AGENT.id, { action: PULL_REQUEST_ACTION.ADD_LABEL, label: "docs" }],
  ]);
});

test("a reviewer chosen stands in the header before GitHub answers, and goes back where GitHub refused, our sentence first and GitHub's words quoted on the line under it", async () => {
  const answer = Promise.withResolvers<void>();
  world.changeHeld = answer.promise;
  world.changeAnswer = {
    outcome: PULL_REQUEST_WRITE_OUTCOME.REFUSED,
    words: "Reviews may only be requested from collaborators.",
  };

  const tab = await draw(
    controlAnswering({
      reviewOptions: () =>
        Promise.resolve({ labels: [], users: [{ login: "priyan", bot: false }], teams: [] }),
    }),
  );

  const faces = () =>
    [...tab.querySelectorAll('.pull-request-header [aria-label="Reviewers"] > li')].map((face) =>
      face.getAttribute("aria-label"),
    );

  const before = faces();
  assert.ok(!before.includes("priyan · Review requested"));

  act(() =>
    (
      tab.querySelector<HTMLButtonElement>(
        '.pull-request-reviewers [aria-label="Reviewer"], .pull-request-reviewers [aria-label="Edit reviewers"]',
      ) ?? assert.fail("the reviewer picker stands beside the reviewers")
    ).click(),
  );
  await settle();
  await pickRow("priyan");
  assert.deepEqual(
    faces(),
    [...before, "priyan · Review requested"],
    "the choice is drawn before GitHub answers",
  );

  answer.resolve();
  await vi.waitFor(() =>
    assert.equal(
      tab.querySelector(".pull-request-write-note [role='alert']")?.textContent,
      "GitHub refused this change.\nGitHub said: “Reviews may only be requested from collaborators.”",
    ),
  );
  assert.deepEqual(faces(), before, "a choice GitHub refused goes back");
});

test("a label chosen stands under the title before GitHub answers, in the color the repository gives it, and stays once the pull request's read carries it", async () => {
  const answer = Promise.withResolvers<void>();
  world.changeHeld = answer.promise;
  let labeled = false;

  const tab = await draw(
    controlAnswering({
      pullRequest: () =>
        Promise.resolve({
          pullRequest: {
            ...PULL_REQUEST,
            labels: labeled ? [{ name: "docs", color: "0075ca" }] : [],
          },
        }),
      reviewOptions: () =>
        Promise.resolve({ labels: [{ name: "docs", color: "0075ca" }], users: [], teams: [] }),
    }),
  );

  const labels = () =>
    [
      ...tab.querySelectorAll<HTMLElement>(".pull-request-header .pull-request-label > .ui-badge"),
    ].map((label) => [label.textContent, label.style.getPropertyValue("--ui-badge-fill-light")]);

  act(() =>
    (
      tab.querySelector<HTMLButtonElement>(
        '.pull-request-label-group [aria-label="Label"], .pull-request-label-group [aria-label="Edit labels"]',
      ) ?? assert.fail("the label picker stands beside the reviewers")
    ).click(),
  );
  await settle();
  await pickRow("docs");
  assert.deepEqual(labels(), [["docs", "#0075ca"]], "the label is drawn before GitHub answers");

  labeled = true;
  answer.resolve();
  await settle();
  assert.deepEqual(labels(), [["docs", "#0075ca"]]);
  assert.equal(tab.querySelector(".pull-request-write-note") === null, true);
});

test("a picker whose repository could not be read offers Retry in its menu, which reads it again and lists what it finds", async () => {
  let reads = 0;

  const tab = await draw(
    controlAnswering({
      reviewOptions: () => {
        reads += 1;

        return Promise.resolve(
          reads === 1
            ? { failure: AGENT_CALL_FAILURE.UNANSWERED }
            : { labels: [], users: [{ login: "priyan", bot: false }], teams: [] },
        );
      },
    }),
  );

  act(() =>
    (
      tab.querySelector<HTMLButtonElement>(
        '.pull-request-reviewers [aria-label="Reviewer"], .pull-request-reviewers [aria-label="Edit reviewers"]',
      ) ?? assert.fail("the reviewer picker stands beside the reviewers")
    ).click(),
  );
  await settle();

  const note = await vi.waitFor(
    () =>
      document.querySelector<HTMLElement>(".ui-menu-note-row") ??
      assert.fail("the picker says the repository could not be read in its list's place"),
  );

  assert.deepEqual(pickerRows(), []);
  assert.match(note.textContent ?? "", /The repository could not be read\./u);

  const retry =
    [...note.querySelectorAll("button")].find((button) => button.textContent === "Retry") ??
    assert.fail("the note offers Retry");

  act(() => retry.click());
  await settle();
  assert.equal(reads, 2);
  assert.deepEqual(pickerRows(), [{ label: "priyan", checked: false }]);
});
