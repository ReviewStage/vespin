// placeholders.ts -- the stand-in rows the skeleton's Inbox and Tasks draw until the host's state replaces them.

import { PULL_REQUEST_STATE, type PullRequestState } from "@repo/features/agent-wire";
import { TASK_STATUS, type TaskStatus } from "@repo/features/task-wire";
import { type Choice, INBOX_LINE, type InboxLine, type SfSymbol } from "@repo/ui-native";

export const COLLECTION_ROUTE = {
  INBOX: "inbox",
  TASKS: "tasks",
} as const;

type CollectionRoute = (typeof COLLECTION_ROUTE)[keyof typeof COLLECTION_ROUTE];

const MINUTE_MS = 60_000;

/** The lines that hold an open ask, which wait on the reader and count on the Inbox's badge. */
const WAITING_LINES: readonly InboxLine[] = [INBOX_LINE.DECIDE, INBOX_LINE.DO, INBOX_LINE.ANSWER];

export type PlaceholderItem = {
  readonly id: string;
  /** A thread's title, or a task's name. */
  readonly title: string;
  /** A thread's last line, or where a task stands, which its page opens with. */
  readonly summary: string;
  /** When it last changed, in epoch milliseconds. */
  readonly at: number;
  /** Whether it is unread. */
  readonly unread?: boolean;
  /** Whether a thread is done. */
  readonly done?: boolean;
  /** The task a thread stands in. */
  readonly task?: { readonly name: string; readonly status: TaskStatus };
  /** What a thread's last line is. */
  readonly line?: InboxLine;
  /** The teammate a thread of someone else's waits on. */
  readonly face?: string;
  /** A task's status. */
  readonly status?: TaskStatus;
  /** A task's pull request's state. */
  readonly pullRequest?: PullRequestState;
  /** A decide ask's question, its options, and the labels the agent recommends. */
  readonly ask?: {
    readonly question: string;
    readonly choices: readonly Choice[];
    readonly recommended: readonly string[];
  };
  /** The Markdown its page draws under its title: a task's description. */
  readonly words?: string;
};

export type PlaceholderCollection = {
  /** The tab's route segment, which a row's detail is pushed under. */
  readonly route: CollectionRoute;
  /** The tab's title, as the panel names it. */
  readonly title: string;
  /** The symbol the collection stands behind. */
  readonly symbol: SfSymbol;
  /** What a regular-width detail column says before a row is selected. */
  readonly emptyDetail: string;
  readonly items: readonly PlaceholderItem[];
};

/** The repository the sample description's GitHub pages are files of. */
export const PLACEHOLDER_REPOSITORY = "ReviewStage/vespin";

/** A small striped picture written into the words, so the sample draws a picture with no network. */
const SAMPLE_PICTURE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAAAkCAIAAAC2bqvFAAAAdUlEQVR42u3WsQ2AIBgF4TeE0cLpmM411YSGPwzAhUuoDMW9Rr487S7nOo9yVr4TdH0dgKsfBhDrv49B1/cB3Pp/ALp+MgD3Vw26fhgAfdGCru8D0JqIFtJCWkgLaSEtpIW0kBbSQlpIC2khLaSFtJAW2tJCLyJxQls7oeS9AAAAAElFTkSuQmCC";

/**
 * A description holding every piece of Markdown the app draws, which the
 * Maestro flow `markdown.yaml` shoots in light and dark: headings, marked
 * words, lists and a task list, a quote, a table wider than the screen,
 * code, links, a mention chip of each kind, and a picture.
 */
const SAMPLE_DESCRIPTION = [
  "## What changed",
  "",
  "The renderer draws **strong**, *emphasis*, ~~struck~~ words and `inline code`, " +
    "a link to [Apple's guidelines](https://developer.apple.com/design/), and one " +
    "[into the app](https://vespin.dev/stage/inbox).",
  "",
  "### Mentions",
  "",
  "- Task: [@Brand the iOS app](https://vespin.dev/stage/task/1497)",
  "- Agent: [@Start @repo/ui-native design system](https://vespin.dev/stage/agent/04fed8e0-be8b-478e-8b52-239a884d17b1)",
  "- Pull request: [@#7776 Start the design system](https://github.com/ReviewStage/vespin/pull/7776)",
  "- Page: [@Invite funnel](https://vespin.dev/stage/task/2099/page/invite-funnel)",
  "- Date: [@Nov 9, 2026](mention://date/2026-11-09)",
  "- File: [@markdown.tsx](https://github.com/ReviewStage/vespin/blob/HEAD/packages/ui-native/src/markdown.tsx)",
  "",
  "### Checks",
  "",
  "1. Typecheck the app",
  "2. Bundle it for iOS",
  "",
  "- [x] Parse as the panel parses",
  "- [ ] Shoot it on the simulators",
  "",
  "> A quote stands apart from the words around it,",
  "> and wraps as they do.",
  "",
  "| Simulator | Width | Layout | Flows |",
  "| :-- | --: | :-: | :-- |",
  "| iPhone 18 Pro | compact | stacked | skeleton, markdown |",
  "| iPad Pro 11-inch (M5) | regular | split view | skeleton, markdown |",
  "",
  "```ts",
  'const blocks = markdownBlocks(words, { repository: "ReviewStage/vespin", now, zone });',
  "```",
  "",
  "---",
  "",
  `![A striped sample picture](${SAMPLE_PICTURE})`,
].join("\n");

/** A moment `minutes` before the app started, so the rows' times read as the panel's. */
function minutesAgo(minutes: number): number {
  return Date.now() - minutes * MINUTE_MS;
}

export const INBOX_PLACEHOLDER: PlaceholderCollection = {
  route: COLLECTION_ROUTE.INBOX,
  title: "Inbox",
  symbol: "tray",
  emptyDetail: "Select a thread",
  items: [
    {
      id: "review-the-invite-flow",
      title: "Review the invite flow",
      summary: "A pull request waits for your go.",
      task: { name: "Teammate invitations", status: TASK_STATUS.IN_PROGRESS },
      line: INBOX_LINE.DO,
      unread: true,
      at: minutesAgo(4),
    },
    {
      id: "pick-the-tab-bar-placement",
      title: "Pick the tab bar's placement",
      summary: "Bottom (recommended) / Sidebar",
      task: { name: "Build the iOS app", status: TASK_STATUS.IN_PROGRESS },
      line: INBOX_LINE.DECIDE,
      unread: true,
      at: minutesAgo(52),
      ask: {
        question: "Where should the tab bar stand?",
        choices: [
          { label: "Bottom", detail: "The system's tab bar, minimized as a list scrolls." },
          { label: "Sidebar", detail: "A rail beside the content, as the iPad stands it." },
        ],
        recommended: ["Bottom"],
      },
    },
    {
      id: "the-nightly-sweep-failed",
      title: "The nightly sweep failed",
      summary: "Ada: A run ended with an error.",
      task: { name: "Nightly sweep", status: TASK_STATUS.TODO },
      line: INBOX_LINE.SAID,
      face: "Ada Lovelace",
      at: minutesAgo(60 * 26),
    },
    {
      id: "name-the-badge",
      title: "Name the Inbox badge",
      summary: "Count what waits on you",
      task: { name: "Brand the iOS app", status: TASK_STATUS.DONE },
      line: INBOX_LINE.SETTLED,
      done: true,
      at: minutesAgo(60 * 24 * 3),
    },
  ],
};

export const TASKS_PLACEHOLDER: PlaceholderCollection = {
  route: COLLECTION_ROUTE.TASKS,
  title: "Tasks",
  symbol: "checklist",
  emptyDetail: "Select a task",
  items: [
    {
      id: "scaffold-the-expo-app",
      title: "Scaffold the Expo app and its CI",
      summary: "An agent is working.",
      status: TASK_STATUS.IN_PROGRESS,
      pullRequest: PULL_REQUEST_STATE.OPEN,
      unread: true,
      at: minutesAgo(12),
    },
    {
      id: "brand-the-ios-app",
      title: "Brand the iOS app",
      summary: "Waiting on the scaffold.",
      status: TASK_STATUS.TODO,
      at: minutesAgo(60 * 3),
    },
    {
      id: "ship-the-ios-app-to-testflight",
      title: "Ship the iOS app to TestFlight",
      summary: "Filed for later.",
      status: TASK_STATUS.BACKLOG,
      at: minutesAgo(60 * 24 * 3),
    },
    {
      id: "draw-markdown-in-ui-native",
      title: "Draw markdown in @repo/ui-native",
      summary: "An agent wrote up what it drew.",
      status: TASK_STATUS.IN_PROGRESS,
      at: minutesAgo(90),
      words: SAMPLE_DESCRIPTION,
    },
    {
      id: "plan-the-ios-app",
      title: "Plan the iOS app",
      summary: "The plan merged.",
      status: TASK_STATUS.DONE,
      pullRequest: PULL_REQUEST_STATE.MERGED,
      at: minutesAgo(60 * 24 * 6),
    },
  ],
};

/** How many threads wait on the reader, as the panel's Inbox badge counts them: open asks not yet done. */
export function waitingCount(collection: PlaceholderCollection): number {
  return collection.items.filter(
    (item) => item.done !== true && item.line !== undefined && WAITING_LINES.includes(item.line),
  ).length;
}
