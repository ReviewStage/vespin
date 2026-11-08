// placeholders.ts -- the stand-in rows the skeleton's Inbox and Tasks draw until the host's state replaces them.

import type { LabelProps } from "@expo/ui/swift-ui";

/** An SF Symbol's name, as `@expo/ui` types it. */
type SystemImage = NonNullable<LabelProps["systemImage"]>;

const COLLECTION_ROUTE = {
  INBOX: "inbox",
  TASKS: "tasks",
} as const;

type CollectionRoute = (typeof COLLECTION_ROUTE)[keyof typeof COLLECTION_ROUTE];

export type PlaceholderItem = {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly symbol: SystemImage;
};

export type PlaceholderCollection = {
  /** The tab's route segment, which a row's detail is pushed under. */
  readonly route: CollectionRoute;
  /** The tab's title, as the panel names it. */
  readonly title: string;
  /** The symbol the collection stands behind. */
  readonly symbol: SystemImage;
  /** What a regular-width detail column says before a row is selected. */
  readonly emptyDetail: string;
  readonly items: readonly PlaceholderItem[];
};

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
    },
    {
      id: "pick-the-tab-bar-placement",
      title: "Pick the tab bar's placement",
      summary: "An agent asks you to decide.",
      symbol: "questionmark.circle",
    },
    {
      id: "the-nightly-sweep-failed",
      title: "The nightly sweep failed",
      summary: "A run ended with an error.",
      symbol: "exclamationmark.triangle",
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
      summary: "In progress",
      symbol: "circle.lefthalf.filled",
    },
    {
      id: "brand-the-ios-app",
      title: "Brand the iOS app",
      summary: "Todo",
      symbol: "circle",
    },
    {
      id: "ship-the-ios-app-to-testflight",
      title: "Ship the iOS app to TestFlight",
      summary: "Backlog",
      symbol: "circle.dashed",
    },
  ],
};
