/**
 * ios-app-links.ts -- which of the home host's links the iPhone app opens, spelled once for the association file that hands them to the app and the app that routes them to its screens, and which pull requests on GitHub it opens on its own.
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
import {
  GITHUB_PAGE,
  gitHubPageLink,
  LINK_DESTINATION,
  type LinkDestination,
  pullRequestAddressOf,
  readLink,
  samePullRequest,
} from "./link-grammar.js";

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
    "/": "/*/agent/*/*",
    exclude: true,
    comment: "An agent's pages, workers, changes, and messages, which the web draws.",
  },
  { "/": "/*/agent/*", comment: "An agent, under its task or its workspace." },
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
  AGENT: "/tasks/agent",
  PULL_REQUEST: "pull",
} as const;

/** A place the app draws a screen for, which always has a route of the app's. */
type IosRoutedPlace = Extract<
  LinkDestination,
  {
    readonly kind:
      | typeof LINK_DESTINATION.INBOX
      | typeof LINK_DESTINATION.INBOX_ITEM
      | typeof LINK_DESTINATION.BOARD
      | typeof LINK_DESTINATION.TASK
      | typeof LINK_DESTINATION.AGENT;
  }
>;

/** A pull request one of the member's agents opened, by the agent and the pull request's page on GitHub. */
export interface AgentPullRequestLink {
  readonly agentId: string;
  readonly pullRequest: { readonly url: string };
}

/** The path an address names, without its query, its fragment, or a trailing slash. */
function addressPath(address: string): string {
  return (address.split(/[?#]/u)[0] ?? "").replace(/\/$/u, "");
}

/**
 * The app's route for a place it draws, or none for a place it leaves to the
 * web. A task is routed as the link names it, by id or by number, for the
 * task's screen to find.
 */
export function iosAppRouteOf(place: IosRoutedPlace): string;
export function iosAppRouteOf(place: LinkDestination): string | undefined;
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
    case LINK_DESTINATION.AGENT:
      return iosAgentRoute(place.agentId);
    default:
      return undefined;
  }
}

/** The app's route for an agent's page: its transcript and its composer. */
export function iosAgentRoute(agentId: string): string {
  return `${IOS_ROUTE.AGENT}/${encodeURIComponent(agentId)}`;
}

/** The app's route for a pull request an agent opened, on its own screen under the agent's page. */
export function iosPullRequestRoute(agentId: string, number: number): string {
  return `${iosAgentRoute(agentId)}/${IOS_ROUTE.PULL_REQUEST}/${number}`;
}

/**
 * Whether the route is a conversation, which a compact window's tab bar
 * steps aside for, as Messages hides its tabs in a chat so the composer
 * stands alone at the foot: a thread (`/inbox/<id>`), an agent's page, or
 * a pull request it opened. A list, a task, and a page the agent showed keep
 * the bar.
 */
export function iosRouteHidesTabs(pathname: string): boolean {
  const [tab, first, second, third] = pathname.split("/").filter((segment) => segment !== "");
  const route = `/${tab ?? ""}`;

  if (route === IOS_ROUTE.INBOX) return first !== undefined;

  if (`${route}/${first ?? ""}` !== IOS_ROUTE.AGENT || second === undefined) return false;

  return third === undefined || third === IOS_ROUTE.PULL_REQUEST;
}

/**
 * The app's route for an address a link or a chip names: a vespin.dev
 * place the app draws, or a pull request's own page on GitHub that one of
 * `pullRequests` is, which opens on the app's pull request screen; none for
 * any other, which Safari opens. Note that a page under a pull request, its
 * Files changed or a commit, stays GitHub's, since the app draws no diff.
 */
export function iosAppRouteOfAddress(
  address: string,
  pullRequests: readonly AgentPullRequestLink[],
): string | undefined {
  const read = readLink(address);

  if (read !== undefined) return iosAppRouteOf(read.place);
  const named = pullRequestAddressOf(address);

  if (named === undefined) return undefined;
  const own = gitHubPageLink({ kind: GITHUB_PAGE.PULL_REQUEST, ...named });

  if (addressPath(address).toLowerCase() !== own.toLowerCase()) return undefined;
  const opened = pullRequests.find(({ pullRequest }) => samePullRequest(pullRequest.url, address));

  return opened === undefined ? undefined : iosPullRequestRoute(opened.agentId, named.number);
}
