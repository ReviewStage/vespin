/**
 * agent-pull-request-tab.ts -- the window every `agent-pull-request-tab*.test.ts` draws an agent's Pull request tab in: its fixtures, fakes, `draw`, and the helpers both of those files read.
 *
 * Importing it registers the `beforeEach` that answers the tab's acts and
 * the `afterEach` that unmounts what a test drew, as `automations-page.ts`
 * registers its own, so each file of the tab's tests meets the same window.
 * What one file alone reads stays in that file, beside the assertions it
 * serves. Synthetic people throughout.
 */

import assert from "node:assert/strict";
import {
  AGENT_CALL_FAILURE,
  type AgentChangesAnswerView,
  type AgentPullRequestWriteAnswerView,
  PULL_REQUEST_PART,
  type PullRequestPart,
} from "@repo/features/agent-view";
import {
  AGENT_STATUS,
  type AgentOverviewChecks,
  type AgentOverviewConversation,
  type AgentOverviewPullRequest,
  type AgentSummary,
  CHECK_STATE,
  CHECK_SUMMARY,
  CONVERSATION_ENTRY,
  DIFF_SIDE,
  MERGE_STATE,
  type MergeState,
  PULL_REQUEST_STATE,
  type PullRequestMerging,
  type PullRequestState,
  REVIEW_STATE,
  type ReviewThread,
} from "@repo/features/agent-wire";
import type { ReadLink } from "@repo/features/link-grammar";
import {
  MERGE_METHOD,
  PULL_REQUEST_WRITE_OUTCOME,
  type PullRequestActionRequest,
} from "@repo/features/pull-request-write-wire";
import { WORKSPACE_ROLE, type WorkspaceMember } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppWorkspaceMembers } from "@repo/host/app-state";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import type { Editor, TiptapEditorHTMLElement } from "@tiptap/core";
import { Effect, Predicate } from "effect";
import { act, createElement, Fragment, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, vi } from "vitest";
import type { SideBundles } from "../bundle-loader.js";
import { EDITOR_ROOT_SELECTOR } from "../description-editor/contract.js";
import { handedCommand, type TabActionGroups } from "../desktop/strip-tabs.js";
import type { DiffListProps, DiffViewModule, DiffViewProps } from "../diff-view/contract.js";
import type { FileTreeModule } from "../file-tree/contract.js";
import { type GitHubConnectControl, GitHubConnectProvider } from "../github-connect.js";
import { AgentPullRequestTab } from "../tasks/agent-pull-request-tab.js";
import { PULL_REQUEST_VIEW, type PullRequestView } from "../tasks/task-tab-model.js";
import type { AgentsControl } from "../tasks/use-agents.js";
import { OpenLinkProvider } from "../tasks/use-open-link.js";
import { ToastHost } from "../toast.js";
import { answeringChanges, fakeActPort, fakeActPortCalls, fakeAppBridge } from "./app-bridge.js";
import { DESKTOP_LINKS, fakeAppPlatform } from "./app-platform.js";
import { handHostReads, holdPullRequestParts, type PullRequestPartAnswers } from "./app-state.js";
import { installEditorLayout } from "./composer.js";
import { withQueryClient } from "./copy-feedback.js";
import { markdownHtmlParserLanded } from "./markdown.js";
import { peopleRead, withPeopleRead } from "./people-read.js";
import { landedBundles, onSideBundles } from "./side-bundles.js";
import { agentsControl } from "./tasks-control.js";

const CHARLES: WorkspaceMember = {
  userId: "user-charles",
  name: "Charles Pan",
  email: "charles@example.com",
  role: WORKSPACE_ROLE.MEMBER,
};

/** The workspace's people as the host holds them for the tab: Charles alone. */
export const HELD_PEOPLE: AppWorkspaceMembers = {
  "workspace-acme": { rows: { members: [CHARLES] } },
};

export const AGENT: AgentSummary = {
  id: "1e3c5a7b-9d2f-4b6e-8a1c-3e5f7a9b1d2c",
  taskId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Expiry job",
  createdAt: 1,
  status: AGENT_STATUS.COMPLETED,
  turnId: null,
};

export const PAGE = "https://github.com/acme/relay/pull/42";

export const CHARLES_ON_GITHUB = { login: "charlespan", bot: false, userId: CHARLES.userId };

/** A check as the overview lists one. */
export function check(name: string, state: (typeof CHECK_STATE)[keyof typeof CHECK_STATE]) {
  return {
    name,
    app: "GitHub Actions",
    state,
    url: `https://github.com/acme/relay/runs/${name}`,
    startedAt: 1_000,
    completedAt: state === CHECK_STATE.PENDING ? null : 66_000,
  };
}

/** An upload in the description, as GitHub's rendering names it. */
export const UPLOAD =
  "https://github.com/user-attachments/assets/4f2c1a3b-5d6e-4f70-8a9b-0c1d2e3f4a5b";

/** A bot's themed badge, its light image as GitHub's image proxy serves it. */
export const BADGE = "https://camo.githubusercontent.com/abc123/6c69676874";

/** A screenshot on a branch of the agent's own repository. */
export const SCREENSHOT =
  "https://raw.githubusercontent.com/acme/relay/pr-assets/pr-42/overview.png";

/** The image the service reads for it, a transparent pixel. */
export const PIXEL = { contentType: "image/png", base64: "iVBORw0KGgo=" } as const;

/** The pull request itself, as its overview's first read answers it. */
export const PULL_REQUEST: AgentOverviewPullRequest = {
  number: 42,
  title: "Expire invitations",
  url: PAGE,
  state: PULL_REQUEST_STATE.OPEN,
  html: [
    '<div class="markdown-heading" dir="auto"><h2 class="heading-element">Summary</h2>',
    '<a id="user-content-summary" class="anchor" aria-label="Permalink: Summary" href="#summary"><svg></svg></a></div>',
    '<p dir="auto">Expires invitations after <strong>seven days</strong>, as ',
    '<a class="user-mention notranslate" href="https://github.com/charlespan">@charlespan</a> asked.</p>',
    '<div class="highlight highlight-source-ts notranslate position-relative overflow-auto" dir="auto">',
    '<pre><span class="pl-k">const</span> days = 7;\n\nexport default days;</pre></div>',
    '<ul class="contains-task-list"><li class="task-list-item">',
    '<input type="checkbox" class="task-list-item-checkbox" disabled="" checked=""> Sweep</li></ul>',
    `<p dir="auto"><a target="_blank" href="${UPLOAD}"><img src="${UPLOAD}" alt="before and after"></a></p>`,
    '<p dir="auto"><img src="https://tracker.example.com/pixel.png" alt="pixel"></p>',
    '<p dir="auto"><a href="https://review.example.com"><picture>',
    '<source media="(prefers-color-scheme: dark)" srcset="https://camo.githubusercontent.com/abc123/6461726b">',
    `<img src="${BADGE}" alt="Request review" width="16" height="16"></picture></a></p>`,
    `<p dir="auto"><a href="${SCREENSHOT}"><img src="${SCREENSHOT}" alt="Overview"></a></p>`,
    '<p dir="auto">Run <code class="notranslate">pnpm test</code> first.</p>',
    "<script>window.stolen = true;</script>",
  ].join(""),
  base: "main",
  head: "luke/expiry-job",
  createdAt: 1_000,
  mergedAt: null,
  merge: MERGE_STATE.CONFLICTS,
  author: { login: "luke-agent[bot]", bot: true },
  requested: [],
};

/** Its checks, as the overview's second read answers them. */
export const CHECKS: AgentOverviewChecks = {
  checks: [
    check("lint", CHECK_STATE.FAILED),
    check("build", CHECK_STATE.PENDING),
    check("test", CHECK_STATE.PASSED),
  ],
};

/** Its conversation, as the overview's third read answers it. */
export const CONVERSATION: AgentOverviewConversation = {
  reviewers: [{ by: CHARLES_ON_GITHUB, state: REVIEW_STATE.CHANGES_REQUESTED }],
  conversation: [
    {
      kind: CONVERSATION_ENTRY.REVIEW,
      by: CHARLES_ON_GITHUB,
      state: REVIEW_STATE.CHANGES_REQUESTED,
      html: '<p dir="auto">Rename the flag.</p>',
      body: "",
      at: 2_000,
      url: `${PAGE}#pullrequestreview-1`,
    },
    {
      kind: CONVERSATION_ENTRY.COMMENT,
      by: CHARLES_ON_GITHUB,
      html: null,
      body: "Also, a **plain** note GitHub sent no rendering of",
      at: 3_000,
      url: `${PAGE}#issuecomment-2`,
    },
  ],
  earlier: 0,
};

/**
 * What the tab's fakes answer and record, and the hands a test moves the
 * window by, set again before each test. They are one object's fields rather
 * than bindings of their own, because a test file cannot assign a binding it
 * imports.
 */
class PullRequestTabWorld {
  root: Root | undefined;
  opened: string[] = [];
  /** Every image the tab asked the service for, by its address. */
  images: string[] = [];
  /** What each review thread's preview handed the diff bundle, in the order drawn. */
  previews: DiffViewProps[] = [];
  /** Every change to the pull request the tab asked for, by agent, in order. */
  changes: (readonly [string, PullRequestActionRequest])[] = [];
  /** How the service answers the next change asked for. */
  changeAnswer: AgentPullRequestWriteAnswerView = {
    outcome: PULL_REQUEST_WRITE_OUTCOME.DONE,
  };
  /** What the service waits on before it answers a change, where a test holds it; none answers at once. */
  changeHeld: Promise<void> | undefined;
  /** The number of the pull request each change named, none where it was the agent's own. */
  changeNumbers: (number | undefined)[] = [];
  /** What Files changed handed the diff bundle's list, mount first, each draw after it. */
  lists: DiffListProps[] = [];
  /** The files, or the lines of them, the list was scrolled to, in order. */
  listReveals: string[] = [];
  /** How the service answers the changes of the control made or drawn last. */
  drawnChanges: ReadChanges = () =>
    Promise.resolve({ pullRequest: { url: PAGE, truncated: false, files: [] } });
  /** How the host answers the parts of the control made or drawn last. */
  drawnParts: PullRequestPartAnswers = {};
}

export const world = new PullRequestTabWorld();

/** The diff bundle, a chunk of its own the panel imports, stood in for at its importer. */
const DIFF_STAND_IN: DiffViewModule = {
  mount: (_host, props) => {
    world.previews.push(props);

    return { update: () => undefined, unmount: () => undefined };
  },
  mountFile: () => ({
    update: () => undefined,
    revealLines: () => undefined,
    pickedLines: () => undefined,
    unmount: () => undefined,
  }),
  mountList: (_host, props) => {
    world.lists.push(props);

    return {
      update: (next) => world.lists.push(next),
      reveal: (path) => world.listReveals.push(path),
      revealLine: (path, side, line) => world.listReveals.push(`${path}:${side}:${line}`),
      revealLines: (range) =>
        world.listReveals.push(`${range.path}:${range.side}:${range.startLine}-${range.endLine}`),
      unmount: () => undefined,
    };
  },
};

/** The file tree's bundle, stood in for: it draws nothing, so its search field, the panel's own, is what narrows the files. */
const TREE_STAND_IN: FileTreeModule = {
  mount: () => {
    const nothing = () => undefined;

    return {
      reveal: nothing,
      search: nothing,
      only: nothing,
      within: nothing,
      relist: nothing,
      mark: nothing,
      unmount: nothing,
    };
  },
  fileIcon: () => ({ symbol: "", type: "" }),
};

let bundles: SideBundles;

beforeAll(async () => {
  bundles = await Effect.runPromise(
    landedBundles({
      diffView: () => Promise.resolve(DIFF_STAND_IN),
      fileTree: () => Promise.resolve(TREE_STAND_IN),
      descriptionEditor: () =>
        import("../description-editor/index.js").then((entry) => entry.descriptionEditor),
    }),
  );
});

beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

beforeEach(() => {
  installEditorLayout();
  window.localStorage.clear();
  world.opened = [];
  world.images = [];
  world.previews = [];
  world.changes = [];
  world.changeNumbers = [];
  world.changeAnswer = { outcome: PULL_REQUEST_WRITE_OUTCOME.DONE };
  world.lists = [];
  world.listReveals = [];
  world.changeHeld = undefined;
  world.drawnParts = {};
  fakeAppPlatform(DESKTOP_LINKS);
  fakeAppBridge({});
  fakeActPort({
    [ACT_KIND.GITHUB_OPEN]: ({ url }) => {
      world.opened.push(url);

      return Promise.resolve();
    },
    [ACT_KIND.WEB_OPEN]: ({ url }) => {
      world.opened.push(url);

      return Promise.resolve();
    },
    [ACT_KIND.AGENTS_PULL_REQUEST_ACTION]: (payload) => {
      world.changes.push([payload.agentId, payload.request]);
      world.changeNumbers.push(payload.number);
      const answer = world.changeAnswer;

      return (world.changeHeld ?? Promise.resolve()).then(() => answer);
    },
    [ACT_KIND.AGENTS_GITHUB_IMAGE]: ({ src }) => {
      world.images.push(src);

      return Promise.resolve(PIXEL);
    },
  });
  // Note that the workspace's people stand on the document from the first frame, as the host holds them for a tab drawn again.
  handHostReads({ members: HELD_PEOPLE });
});

afterEach(() => {
  act(() => world.root?.unmount());
  world.root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The pull request as what the agent published names it, which the tab's pill wears. */
export function published(state: PullRequestState) {
  return {
    number: PULL_REQUEST.number,
    title: PULL_REQUEST.title,
    url: PAGE,
    state,
    checks: CHECK_SUMMARY.FAILING,
    additions: 4,
    deletions: 1,
    changedFiles: 1,
  };
}

/** The overview's three parts, the pickers' options, and the member's viewed marks, any of them answering otherwise than the fixtures above, which answer neither the options nor the marks. */
interface OverviewReads {
  readonly pullRequest?: PullRequestPartAnswers[typeof PULL_REQUEST_PART.PULL_REQUEST];
  readonly reviewOptions?: PullRequestPartAnswers[typeof PULL_REQUEST_PART.REVIEW_OPTIONS];
  readonly checks?: PullRequestPartAnswers[typeof PULL_REQUEST_PART.CHECKS];
  readonly conversation?: PullRequestPartAnswers[typeof PULL_REQUEST_PART.CONVERSATION];
  readonly viewed?: PullRequestPartAnswers[typeof PULL_REQUEST_PART.VIEWED];
}

/** A read of the options or the marks the service did not answer. */
const unanswered = () => Promise.resolve({ failure: AGENT_CALL_FAILURE.UNANSWERED } as const);

/** An agent's changes as the service answers them, by the agent and the number a tab names. */
export type ReadChanges = (agentId: string, number?: number) => Promise<AgentChangesAnswerView>;

/** The plan's agents, the one whose pull request it is among them, its parts held by the host and answering as given and the fixtures otherwise. */
export function controlAnswering(
  reads: OverviewReads = {},
  state: PullRequestState = PULL_REQUEST_STATE.OPEN,
  readChanges: ReadChanges = () =>
    Promise.resolve({ pullRequest: { url: PAGE, truncated: false, files: [] } }),
): AgentsControl {
  const answers: PullRequestPartAnswers = {
    [PULL_REQUEST_PART.PULL_REQUEST]:
      reads.pullRequest ?? (() => Promise.resolve({ pullRequest: PULL_REQUEST })),
    [PULL_REQUEST_PART.CHECKS]: reads.checks ?? (() => Promise.resolve({ pullRequest: CHECKS })),
    [PULL_REQUEST_PART.CONVERSATION]:
      reads.conversation ?? (() => Promise.resolve({ pullRequest: CONVERSATION })),
    [PULL_REQUEST_PART.REVIEW_OPTIONS]: reads.reviewOptions ?? unanswered,
    [PULL_REQUEST_PART.VIEWED]: reads.viewed ?? unanswered,
  };

  const control = agentsControl({
    agents: [AGENT],
    agentIds: [AGENT.id],
    models: [],
    pullRequests: new Map([[AGENT.id, published(state)]]),
  });

  partsOf.set(control, answers);
  world.drawnParts = answers;
  changesOf.set(control, readChanges);
  world.drawnChanges = readChanges;

  return control;
}

/** How the service answers each control's changes, which a test drawing several controls in turn answers as it draws each. */
export const changesOf = new WeakMap<AgentsControl, ReadChanges>();

/** How the host answers each control's parts, which a test drawing several controls in turn answers as it draws each. */
export const partsOf = new WeakMap<AgentsControl, PullRequestPartAnswers>();

/** A part the control drawn last does not answer, held unanswered. */
const unanswering = () => new Promise<never>(() => undefined);

/** The header's parts the host has answered with what it read since the tab was last drawn. */
let answeredParts = new Set<PullRequestPart>();

/** What the header says while each of its parts is read, which a draw waits out once the host has answered the part. */
const READING_OF: Partial<Record<PullRequestPart, readonly string[]>> = {
  [PULL_REQUEST_PART.PULL_REQUEST]: ["Reading pull request", "Reading description"],
  [PULL_REQUEST_PART.CHECKS]: ["Reading checks"],
  [PULL_REQUEST_PART.CONVERSATION]: ["Reading conversation"],
};

/** `read`, its part counted as answered once it lands with what it read; a failure still draws beside its region's wait, so it is not counted. */
function answering<A>(part: PullRequestPart, read: Promise<A>): Promise<A> {
  return read.then((answer) => {
    if (!Predicate.isObjectOrArray(answer) || !("failure" in answer)) {
      answeredParts.add(part);
    }

    return answer;
  });
}

/** The host's holds on the tab's parts, answered as the control made or drawn last says, so a control made anew as a tab draws again answers alike. */
function holdDrawnParts(): void {
  answeredParts = new Set();
  holdPullRequestParts(handHostReads({}).deliverParts, {
    [PULL_REQUEST_PART.PULL_REQUEST]: (agentId, number) =>
      answering(
        PULL_REQUEST_PART.PULL_REQUEST,
        (world.drawnParts[PULL_REQUEST_PART.PULL_REQUEST] ?? unanswering)(agentId, number),
      ),
    [PULL_REQUEST_PART.CHECKS]: (agentId, number) =>
      answering(
        PULL_REQUEST_PART.CHECKS,
        (world.drawnParts[PULL_REQUEST_PART.CHECKS] ?? unanswering)(agentId, number),
      ),
    [PULL_REQUEST_PART.CONVERSATION]: (agentId, number) =>
      answering(
        PULL_REQUEST_PART.CONVERSATION,
        (world.drawnParts[PULL_REQUEST_PART.CONVERSATION] ?? unanswering)(agentId, number),
      ),
    [PULL_REQUEST_PART.REVIEW_OPTIONS]: (agentId, number) =>
      (world.drawnParts[PULL_REQUEST_PART.REVIEW_OPTIONS] ?? unanswering)(agentId, number),
    [PULL_REQUEST_PART.VIEWED]: (agentId, number) =>
      (world.drawnParts[PULL_REQUEST_PART.VIEWED] ?? unanswering)(agentId, number),
  });
  fakeActPort({
    ...fakeActPortCalls(),
    ...answeringChanges((agentId, number) => world.drawnChanges(agentId, number)),
  });
}

/** A read held open until the test lets it answer. */
export function held<A>() {
  const { promise, resolve } = Promise.withResolvers<A>();

  return { read: () => promise, answer: resolve };
}

/** The tab, holding the view its switch chooses as the side panel does. */
export function Switching({
  control,
  first,
}: {
  control: AgentsControl;
  /** The tab it opens on, as the chip that opened it asked. */
  first: PullRequestView;
}) {
  const [view, setView] = useState<PullRequestView>(first);
  const [actions, setActions] = useState<TabActionGroups | undefined>(undefined);

  return createElement(
    Fragment,
    null,
    createElement(Toolbar, { actions }),
    createElement(AgentPullRequestTab, {
      agentId: AGENT.id,
      control,
      shown: true,
      repository: "acme/relay",
      tree: { open: false, onToggle: () => undefined },
      view,
      onView: setView,
      onActions: setActions,
    }),
  );
}

/** What the side panel's toolbar ⋯ offers for the tab, as a row of presses: its items as the tab hands them up, and ⇧⌘O as the panel runs it from them. */
function Toolbar({ actions }: { actions: TabActionGroups | undefined }) {
  const chord = handedCommand(actions ?? [], APP_COMMAND.OPEN_ON_GITHUB);

  return createElement(
    Fragment,
    null,
    chord === undefined
      ? null
      : createElement("button", { type: "button", "data-chord": "", onClick: chord }, "⇧⌘O"),
    createElement(ToolbarItems, { actions }),
  );
}

function ToolbarItems({ actions }: { actions: TabActionGroups | undefined }) {
  return createElement(
    "div",
    { "data-toolbar": "" },
    (actions ?? []).flat().map((action) =>
      createElement(
        "button",
        {
          key: action.label,
          type: "button",
          disabled: "disabled" in action ? action.disabled : undefined,
          onClick: (event: React.MouseEvent<HTMLElement>) => {
            if ("items" in action || "panel" in action) return;

            if ("onAsk" in action) action.onAsk(event.currentTarget);
            else action.onSelect();
          },
        },
        action.label,
      ),
    ),
  );
}

/** Lets every promise settled so far run its continuations. */
export async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** The words of the Markdown box inside `within`, the one named `label` where given. */
export function boxWordsElement(
  within: ParentNode,
  label?: string,
): TiptapEditorHTMLElement | null {
  return within.querySelector<TiptapEditorHTMLElement>(
    label === undefined ? EDITOR_ROOT_SELECTOR : `${EDITOR_ROOT_SELECTOR}[aria-label="${label}"]`,
  );
}

/** The editor of the Markdown box inside `within`, the one named `label` where given. */
export function boxEditor(within: ParentNode, label?: string): Editor {
  const element = boxWordsElement(within, label) ?? assert.fail(`a box for ${label ?? "words"}`);

  return element.editor ?? assert.fail("the box's editor is running");
}

/** Writes `words` as the whole of the box's text, read as Markdown, as the member would. */
export function writeBox(within: ParentNode, words: string, label?: string): void {
  const editor = boxEditor(within, label);
  act(() => {
    editor.commands.setContent(words, { contentType: "markdown" });
  });
}

/** The words the box inside `within` reads, as drawn; none where no box stands. */
export function boxWords(within: ParentNode, label?: string): string | undefined {
  return boxWordsElement(within, label)?.textContent ?? undefined;
}

/** Presses a key in the box's words, as the member would. */
export function pressInBox(within: ParentNode, init: KeyboardEventInit, label?: string): void {
  const element = boxWordsElement(within, label) ?? assert.fail("a box to press in");
  act(() => {
    element.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
    );
  });
}

/** Nothing connected, and presses that do nothing, as outside the window. */
export const NO_GITHUB: GitHubConnectControl = {
  connection: undefined,
  connect: () => Promise.resolve(false),
  disconnect: () => Promise.resolve(false),
};

/** Draws the agent's tab inside the workspace's member directory and the account's GitHub, its reads landed; inside the window's opener for a place in the app where one is given. */
export async function draw(
  control: AgentsControl,
  first: PullRequestView = PULL_REQUEST_VIEW.CONVERSATION,
  github: GitHubConnectControl = NO_GITHUB,
  openPlace?: (link: ReadLink) => void,
) {
  world.drawnParts = partsOf.get(control) ?? world.drawnParts;
  world.drawnChanges = changesOf.get(control) ?? world.drawnChanges;

  return drawn(createElement(Switching, { control, first }), github, openPlace);
}

/** Draws `tab` inside the workspace's member directory and the account's GitHub, its reads landed; inside the window's opener for a place in the app where one is given. */
export async function drawn(
  tab: React.ReactElement,
  github: GitHubConnectControl = NO_GITHUB,
  openPlace?: (link: ReadLink) => void,
) {
  holdDrawnParts();
  const container = document.body.appendChild(document.createElement("div"));
  world.root = createRoot(container);
  act(() =>
    world.root?.render(
      withQueryClient(
        onSideBundles(
          bundles,
          createElement(GitHubConnectProvider, {
            value: github,
            children: withPeopleRead(
              { workspace: { id: "workspace-acme", memberCount: 2 }, readerId: "user-dana" },
              createElement(
                Fragment,
                null,
                createElement(ToastHost),
                openPlace === undefined
                  ? tab
                  : createElement(OpenLinkProvider, { value: openPlace, children: tab }),
              ),
            ),
          }),
        ),
      ),
    ),
  );
  await settle();
  // Note that a part the host answered draws a notify tick after its answer reaches its query, so the draw waits until no answered part still reads.
  await vi.waitFor(() =>
    assert.deepEqual(
      waiting(container).filter((words) =>
        [...answeredParts].some((part) => READING_OF[part]?.includes(words) === true),
      ),
      [],
    ),
  );
  // Note that the tab draws who opened and reviewed once the workspace's people reach their query.
  await peopleRead();

  return container;
}

/** The tab of the row under the header named as given. */
export function option(tab: HTMLElement, name: string): HTMLButtonElement {
  return (
    [...tab.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
      (each) => each.textContent?.startsWith(name) === true,
    ) ?? assert.fail(`the row offers ${name}`)
  );
}

/** What the tab named as given counts beside its name, its words after the name. */
export function tabCount(tab: HTMLElement, name: string): string {
  return (option(tab, name).textContent ?? "").slice(name.length);
}

/** How the Checks tab's glyph says its checks went, in its words. */
export function checksGlyph(tab: HTMLElement): string | null | undefined {
  return option(tab, "Checks").querySelector('[role="img"]')?.getAttribute("aria-label");
}

/** The tab named as given chosen, and what it reads landed. */
export async function choose(tab: HTMLElement, name: string): Promise<void> {
  act(() => option(tab, name).click());
  await settle();

  // Note that Files changed reads its changes through a query, so it is chosen once it no longer reads them.
  if (name === "Files changed") await vi.waitFor(() => assert.equal(readingChanges(tab), false));
}

/** Whether Files changed still says it is reading the changes. */
function readingChanges(tab: HTMLElement): boolean {
  return [...tab.querySelectorAll('[role="status"]')].some((status) =>
    status.textContent?.includes("Reading changes"),
  );
}

/** What every skeleton on screen says it stands for, those of a hidden tab left out. */
export function waiting(tab: HTMLElement): string[] {
  return [...tab.querySelectorAll('[aria-busy="true"]')].flatMap((each) =>
    each.closest("[hidden]") === null ? [each.textContent ?? ""] : [],
  );
}

/** The header's pill, in its seat after the title in its row's markup; none where the row holds none. */
export function pillOf(tab: HTMLElement): Element | undefined {
  return (
    tab.querySelector(".pull-request-title-row > .pull-request-state > :first-child") ?? undefined
  );
}

/** What the header says of where the pull request stands: its pill's words. */
export function standing(tab: HTMLElement): string | undefined {
  return pillOf(tab)?.textContent ?? undefined;
}

/** The merge control at the title row's end, where one stands. */
export function mergeControl(tab: HTMLElement): HTMLElement | null {
  return tab.querySelector<HTMLElement>(".pull-request-title-row .merge-control");
}

/** Where the merge stands, leading the title row's controls, where it says anything. */
export function mergeStatus(tab: HTMLElement): HTMLElement | null {
  return tab.querySelector<HTMLElement>(".pull-request-title-row .merge-chip");
}

/** What the toolbar's ⋯ offers for the tab, each item's words and whether it applies now. */
export function toolbarItems(tab: HTMLElement): string[] {
  return [...tab.querySelectorAll<HTMLButtonElement>("[data-toolbar] button")].map(
    (each) => `${each.textContent}${each.disabled ? " (off)" : ""}`,
  );
}

/** Presses the toolbar ⋯'s item named as given. */
export async function pressToolbar(tab: HTMLElement, label: string): Promise<void> {
  const item =
    [...tab.querySelectorAll<HTMLButtonElement>("[data-toolbar] button")].find(
      (each) => each.textContent === label,
    ) ?? assert.fail(`the toolbar's ⋯ offers ${label}`);

  await act(async () => item.click());
}

/** The words of every element the selector names, in order. */
export function words(container: HTMLElement, selector: string): string[] {
  return [...container.querySelectorAll(selector)].map((each) => each.textContent ?? "");
}

/** The labels a thread's head wears beside its path, in order. */
export function threadLabels(thread: HTMLElement): string[] {
  const head = thread.querySelector(".annotation-card-fold > summary")?.textContent ?? "";

  return ["Resolved", "Outdated"].filter((label) => head.includes(label));
}

/** A review thread on lines, open and current unless said otherwise. */
export function thread(overrides: Partial<ReviewThread> = {}): ReviewThread {
  return {
    path: "src/invite.ts",
    line: 13,
    startLine: 12,
    originalLine: 13,
    originalStartLine: 12,
    side: DIFF_SIDE.RIGHT,
    startSide: DIFF_SIDE.RIGHT,
    diffHunk: [
      "@@ -8,6 +8,7 @@ export function send()",
      " const one = 1;",
      " const two = 2;",
      " const three = 3;",
      " const four = 4;",
      "-  twice();",
      "+  once();",
      "+  done();",
    ].join("\n"),
    resolved: false,
    outdated: false,
    comments: [
      {
        by: CHARLES_ON_GITHUB,
        html: '<p dir="auto">Why <strong>once</strong>?</p>',
        body: "",
        at: 2_000,
        url: `${PAGE}#discussion_r1`,
      },
    ],
    more: 0,
    ...overrides,
  };
}

/** The Conversation's View options, at the end of its heading. */
export function viewOptions(tab: HTMLElement): HTMLButtonElement {
  return (
    tab.querySelector<HTMLButtonElement>(
      'section[aria-label="Conversation"] > .ui-disclosure-frame > .ui-disclosure-actions button[aria-label="View options"]',
    ) ?? assert.fail("the conversation offers View options")
  );
}

/** Files changed's View options, the diff's settings, rather than the Conversation's of the same name. */
export function filesViewOptions(tab: HTMLElement): HTMLButtonElement | undefined {
  return [...tab.querySelectorAll<HTMLButtonElement>('button[aria-label="View options"]')].find(
    (each) => each.closest('section[aria-label="Conversation"]') === null,
  );
}

/** Turns the Conversation's filter named as given in its View options, opening the menu first where it stands closed. */
export async function turnFilter(tab: HTMLElement, name: string): Promise<void> {
  if (document.querySelector('[role="menu"]:not([data-leaving])') === null) {
    act(() => viewOptions(tab).click());
    await settle();
  }

  await pressItem(name);
}

/** The heading of the Conversation view's section named as given, which folds it. */
export function sectionHead(tab: HTMLElement, name: string): HTMLElement {
  return (
    tab.querySelector<HTMLElement>(
      `section[aria-label="${name}"] > .ui-disclosure-frame > details.pull-request-section-fold > summary`,
    ) ?? assert.fail(`the ${name} folds under its heading`)
  );
}

/** Gives `element` the box jsdom lays out none for: how tall it stands, and how tall what it holds runs. */
export function sized(
  element: Element,
  box: { readonly height: number; readonly content?: number },
): void {
  Object.defineProperty(element, "offsetHeight", { configurable: true, value: box.height });
  Object.defineProperty(element, "clientHeight", { configurable: true, value: box.height });
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    value: box.content ?? box.height,
  });
}

/** The header's pill, as a press; nothing where it is no press. */
export function pillPress(tab: HTMLElement): HTMLButtonElement | undefined {
  const pill = pillOf(tab);

  return pill instanceof HTMLButtonElement ? pill : undefined;
}

/** The header's pill, as a press. */
export function pill(tab: HTMLElement): HTMLButtonElement {
  return pillPress(tab) ?? assert.fail("the pill is a press that opens what may be done");
}

/** Opens the pill's menu and presses its item of the words given. */
export async function pressAction(tab: HTMLElement, label: string): Promise<void> {
  act(() => pill(tab).click());

  const item =
    [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (each) => each.textContent === label,
    ) ?? assert.fail(`the pill's menu offers ${label}`);

  act(() => item.click());
  await settle();
}

/** The labels the pill's menu offers, opened and closed again. */
export function offered(tab: HTMLElement): string[] {
  act(() => pill(tab).click());
  const labels = words(document.body, '[role="menuitem"]');
  act(() => pill(tab).click());

  return labels;
}

/** How the pull request may be merged where a test says nothing else: squash or rebase, nothing asked for yet, checks passing. */
export const MERGING: PullRequestMerging = {
  methods: [MERGE_METHOD.SQUASH, MERGE_METHOD.REBASE],
  autoMergeAllowed: true,
  queue: false,
  queued: null,
  autoMerge: null,
  headSha: "c0ffee1",
  review: null,
  checks: CHECK_SUMMARY.PASSING,
};

/** The plan's agents, its pull request standing as given and merged as given, the member reading it able to bypass its base's rules where said. */
export function merging(
  merge: MergeState,
  merged: Partial<PullRequestMerging> = {},
  canBypassRules = false,
): AgentsControl {
  return controlAnswering({
    pullRequest: () =>
      Promise.resolve({
        pullRequest: { ...PULL_REQUEST, merge, canBypassRules, merging: { ...MERGING, ...merged } },
      }),
  });
}

/** The merge control's presses, the chevron's left out, in order. */
export function mergePresses(tab: HTMLElement): HTMLButtonElement[] {
  return [...(mergeControl(tab)?.querySelectorAll<HTMLButtonElement>("button") ?? [])].filter(
    (each) => each.getAttribute("aria-label") !== "Choose how to merge",
  );
}

/** What the merge control shows: its chip's word, tone, and GitHub's sentence for a reader; its press, the press's look, and whether a chevron chooses the method. None where it shows nothing. */
export function mergeShown(tab: HTMLElement) {
  const status = mergeStatus(tab);

  if (mergeControl(tab) === null && status === null) return undefined;
  const badge = status?.querySelector(".ui-chip");
  const [press] = mergePresses(tab);

  return {
    chip: badge?.textContent,
    tone: badge?.getAttribute("data-tone"),
    sentence: status?.querySelector(".ui-visually-hidden")?.textContent?.slice(2),
    press: press?.textContent,
    look: press?.getAttribute("data-variant"),
    chevron:
      (mergeControl(tab)?.querySelector('[aria-label="Choose how to merge"]') ?? null) !== null,
  };
}

/** The merge control's press of the words given, pressed. */
export async function pressBox(tab: HTMLElement, label: string): Promise<void> {
  // Note that the merge control offers its press once the pull request's merge read reaches its query.
  const press = await vi.waitFor(
    () =>
      mergePresses(tab).find((each) => each.textContent === label) ??
      assert.fail(`the merge control offers ${label}`),
  );

  act(() => press.click());
  await settle();
}

/** The press of the words given in the question over the window, pressed. */
export async function answerQuestion(label: string): Promise<void> {
  const press =
    [
      ...document.querySelectorAll<HTMLButtonElement>(
        '[role="dialog"] button, [role="alertdialog"] button',
      ),
    ].find((each) => each.textContent === label) ?? assert.fail(`the question offers ${label}`);

  act(() => press.click());
  await settle();
}

/** Presses the menu item whose label begins with the words given. */
export async function pressItem(words: string): Promise<void> {
  const item =
    [
      ...document.querySelectorAll<HTMLButtonElement>(
        ':is([role="menuitem"], [role="menuitemcheckbox"])',
      ),
    ].find((each) => each.querySelector(".ui-menu-item-label")?.textContent?.startsWith(words)) ??
    assert.fail(`the menu offers ${words}`);

  act(() => item.click());
  await settle();
}
