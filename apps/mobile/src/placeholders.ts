// placeholders.ts -- the stand-in rows the skeleton's Inbox and Tasks draw until the host's state replaces them.

import { TASK_STATUS, type TaskStatus } from "@repo/features/task-wire";
import type { Choice, SfSymbol } from "@repo/ui-native";

const COLLECTION_ROUTE = {
  INBOX: "inbox",
  TASKS: "tasks",
} as const;

type CollectionRoute = (typeof COLLECTION_ROUTE)[keyof typeof COLLECTION_ROUTE];

const MINUTE_MS = 60_000;

export type PlaceholderItem = {
  readonly id: string;
  readonly title: string;
  /** The row's muted line: the last word in its thread, or where the task stands. */
  readonly summary: string;
  /** The glyph leading the summary. */
  readonly symbol: SfSymbol;
  /** Whether the row is unread; a collection whose rows are never unread leaves it out. */
  readonly unread?: boolean;
  /** The task's status, drawn as its mark. */
  readonly status?: TaskStatus;
  /** The agent or teammate the row is from, drawn as its avatar where no status leads. */
  readonly from?: string;
  /** When it last changed, in epoch milliseconds. */
  readonly at?: number;
  /** A decide ask's options, which its detail draws to pick from. */
  readonly choices?: readonly Choice[];
  /** The labels of the options the agent recommends. */
  readonly recommended?: readonly string[];
  /** The message its detail draws, as the Markdown it was written in. */
  readonly message?: string;
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

/** The repository the sample message's GitHub pages are files of. */
export const PLACEHOLDER_REPOSITORY = "ReviewStage/vespin";

/** A small striped picture written into the words, so the sample draws a picture with no network. */
const SAMPLE_PICTURE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAAAkCAIAAAC2bqvFAAAAdUlEQVR42u3WsQ2AIBgF4TeE0cLpmM411YSGPwzAhUuoDMW9Rr487S7nOo9yVr4TdH0dgKsfBhDrv49B1/cB3Pp/ALp+MgD3Vw26fhgAfdGCru8D0JqIFtJCWkgLaSEtpIW0kBbSQlpIC2khLaSFtJAW2tJCLyJxQls7oeS9AAAAAElFTkSuQmCC";

/**
 * A message holding every piece of Markdown the app draws, which the
 * Maestro flow `markdown.yaml` shoots in light and dark: headings, marked
 * words, lists and a task list, a quote, a table wider than the screen,
 * code, links, a mention chip of each kind, and a picture.
 */
const SAMPLE_MESSAGE = [
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
      symbol: "arrow.triangle.pull",
      unread: true,
      from: "Invite flow",
      at: minutesAgo(4),
    },
    {
      id: "pick-the-tab-bar-placement",
      title: "Pick the tab bar's placement",
      summary: "An agent asks you to decide.",
      symbol: "questionmark.circle",
      unread: true,
      from: "Tab bar",
      at: minutesAgo(52),
      choices: [
        { label: "Bottom", detail: "The system's tab bar, minimized as a list scrolls." },
        { label: "Sidebar", detail: "A rail beside the content, as the iPad stands it." },
      ],
      recommended: ["Bottom"],
    },
    {
      id: "read-the-renderer-report",
      title: "Read the renderer's report",
      summary: "An agent wrote up what it drew.",
      symbol: "text.bubble",
      unread: true,
      from: "Markdown",
      at: minutesAgo(90),
      message: SAMPLE_MESSAGE,
    },
    {
      id: "the-nightly-sweep-failed",
      title: "The nightly sweep failed",
      summary: "A run ended with an error.",
      symbol: "exclamationmark.triangle",
      unread: false,
      from: "Nightly sweep",
      at: minutesAgo(60 * 26),
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
      symbol: "hammer",
      status: TASK_STATUS.IN_PROGRESS,
      at: minutesAgo(12),
    },
    {
      id: "brand-the-ios-app",
      title: "Brand the iOS app",
      summary: "Waiting on the scaffold.",
      symbol: "hourglass",
      status: TASK_STATUS.TODO,
      at: minutesAgo(60 * 3),
    },
    {
      id: "ship-the-ios-app-to-testflight",
      title: "Ship the iOS app to TestFlight",
      summary: "Filed for later.",
      symbol: "tray.and.arrow.down",
      status: TASK_STATUS.BACKLOG,
      at: minutesAgo(60 * 24 * 3),
    },
    {
      id: "plan-the-ios-app",
      title: "Plan the iOS app",
      summary: "The plan merged.",
      symbol: "checkmark",
      status: TASK_STATUS.DONE,
      at: minutesAgo(60 * 24 * 6),
    },
  ],
};
