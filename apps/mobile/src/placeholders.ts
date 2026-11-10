// placeholders.ts -- the stand-in rows the Tasks tab draws until the host's tasks replace them.

import { PULL_REQUEST_STATE, type PullRequestState } from "@repo/features/agent-wire";
import { TASK_STATUS, type TaskStatus } from "@repo/features/task-wire";
import type { SfSymbol } from "@repo/ui-native";

const COLLECTION_ROUTE = {
  TASKS: "tasks",
} as const;

type CollectionRoute = (typeof COLLECTION_ROUTE)[keyof typeof COLLECTION_ROUTE];

const MINUTE_MS = 60_000;

export type PlaceholderItem = {
  readonly id: string;
  /** A task's name. */
  readonly title: string;
  /** Where a task stands, which its page opens with. */
  readonly summary: string;
  /** When it last changed, in epoch milliseconds. */
  readonly at: number;
  /** Whether it is unread. */
  readonly unread?: boolean;
  /** A task's status. */
  readonly status: TaskStatus;
  /** A task's pull request's state. */
  readonly pullRequest?: PullRequestState;
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
