/**
 * ios-app-links.ts -- which of the home host's links the iPhone app opens, spelled once for the association file that hands them to the app and the app that routes them to its screens.
 *
 * A link the app draws a screen for is claimed for it in the host's Apple
 * App Site Association (`@repo/service/auth/apple-app-site-association`), so
 * iOS opens it in the app, which routes it by its place
 * (`@repo/features/link-grammar`) to the tab and item that draw it. Every
 * other link stays the web's, so iOS opens it in Safari, and the app hands
 * one that reached it some other way to Safari too. Note that the two lists
 * below must agree: a link claimed with no route of the app's would land
 * nowhere, and one routed but not claimed would never arrive by a tap.
 *
 * Apple reads the components in order and the first that matches decides,
 * each `*` matching any run of characters, slashes among them, so the
 * pages under a task are excluded before the task itself is claimed.
 */

import { IOS_OAUTH_CALLBACK_PATH } from "./ios-sign-in-wire.js";
import { LINK_DESTINATION, type LinkDestination } from "./link-grammar.js";

/** One path pattern of the association's `applinks` components, as Apple's format names its keys. */
export interface AppLinkComponent {
  readonly "/": string;
  readonly exclude?: true;
  readonly comment: string;
}

/** The paths the home host hands the app, in the order Apple reads them. */
export const IOS_APP_LINK_COMPONENTS: readonly AppLinkComponent[] = [
  { "/": IOS_OAUTH_CALLBACK_PATH, comment: "The sign-in's return." },
  { "/": "/*/task/*/inbox/*", comment: "A thread on a task's Inbox." },
  { "/": "/*/agent/*/inbox/*", comment: "A thread on an agent's Inbox." },
  {
    "/": "/*/task/*/*",
    exclude: true,
    comment: "A task's pages, versions, and comments, which the web draws.",
  },
  { "/": "/*/task/*", comment: "A task." },
  { "/": "/*/tasks", comment: "The task list." },
  { "/": "/*/inbox", comment: "The Inbox." },
  { "/": "/*/inbox/*", comment: "A thread, or a task's threads, on the Inbox." },
];

/** The app's own routes a link opens on: its tabs and their items. */
const IOS_ROUTE = {
  INBOX: "/inbox",
  TASKS: "/tasks",
} as const;

/**
 * The app's route for a place it draws, or none for a place it leaves to the
 * web. A task is routed as the link names it, by id or by number, for the
 * task's screen to find.
 */
export function iosAppRouteOf(place: LinkDestination): string | undefined {
  switch (place.kind) {
    case LINK_DESTINATION.INBOX:
      return IOS_ROUTE.INBOX;
    case LINK_DESTINATION.INBOX_ITEM:
      return `${IOS_ROUTE.INBOX}/${encodeURIComponent(place.itemId)}`;
    case LINK_DESTINATION.BOARD:
      return IOS_ROUTE.TASKS;
    case LINK_DESTINATION.TASK:
      return `${IOS_ROUTE.TASKS}/${encodeURIComponent(place.planId)}`;
    default:
      return undefined;
  }
}
