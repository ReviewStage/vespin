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

import { HOST_WIRE } from "./host-wire.js";
import { IOS_OAUTH_CALLBACK_PATH } from "./ios-sign-in-wire.js";
import {
  GITHUB_PAGE,
  gitHubPageLink,
  LINK_DESTINATION,
  type LinkDestination,
  pullRequestAddressOf,
  readLink,
  readShownLink,
  taskNumberOf,
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
  {
    "/": `${HOST_WIRE.CONNECT_PATH}/*`,
    comment: "A machine's pairing, which Settings › Machines approves or denies.",
  },
  { "/": "/*/task/*/inbox/*", comment: "A thread on a task's Inbox." },
  { "/": "/*/agent/*/inbox/*", comment: "A thread on an agent's Inbox." },
  { "/": "/*/agent/*/page/*", comment: "A page an older link names under its agent." },
  {
    "/": "/*/agent/*/message/*",
    comment: "A message of an agent's, such as one of a Manager's chat, landed on in its page.",
  },
  {
    "/": "/*/agent/*/*",
    exclude: true,
    comment: "An agent's workers and changes, which the web draws.",
  },
  { "/": "/*/agent/*", comment: "An agent, under its task or its workspace." },
  { "/": "/*/task/*/page/*", comment: "A page an agent showed on a task." },
  {
    "/": "/*/task/*/*",
    exclude: true,
    comment: "A task's versions, which the web draws.",
  },
  { "/": "/*/task/*", comment: "A task." },
  { "/": "/*/tasks", comment: "The task list." },
  {
    "/": "/*/person/*",
    comment: "A person's page in a workspace, or one of their machines on it.",
  },
  { "/": "/*/inbox", comment: "The Inbox." },
  { "/": "/*/inbox/*", comment: "A thread, or a task's threads, on the Inbox." },
];

/** The app's own routes a link opens on: its tabs and their items. */
const IOS_ROUTE = {
  INBOX: "/inbox",
  TASKS: "/tasks",
  AGENT: "/tasks/agent",
  /** A page an agent showed on a task, opened whole. */
  PAGE: "/tasks/page",
  /** A page under its agent's route, as an older link names it. */
  AGENT_PAGE: "page",
  COMMENTS: "/tasks/comments",
  PULL_REQUEST: "pull",
  /** A pull request by its workspace, its repository, and its number, under Tasks. */
  REPOSITORY_PULL_REQUEST: "/tasks/pull",
  /** The files a pull request changes, under its own route. */
  PULL_REQUEST_FILES: "files",
  /** The checks run on a pull request's head, under its own route. */
  PULL_REQUEST_CHECKS: "checks",
  /** One review thread of a pull request, by GitHub's id for it, under its own route. */
  PULL_REQUEST_THREAD: "thread",
  /** A new comment on a pull request, under its own route. */
  PULL_REQUEST_COMMENT: "comment",
  /** A person's page in the workspace the phone works in. */
  PERSON: "/tasks/person",
  /** One thread of a Manager's chat, by the message it hangs on, under its agent's route. */
  CHAT_THREAD: "thread",
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
      | typeof LINK_DESTINATION.PAGE
      | typeof LINK_DESTINATION.AGENT
      | typeof LINK_DESTINATION.MESSAGE
      | typeof LINK_DESTINATION.PERSON;
  }
>;

/** The path an address names, without its query, its fragment, or a trailing slash. */
function addressPath(address: string): string {
  return (address.split(/[?#]/u)[0] ?? "").replace(/\/$/u, "");
}

/** The query a task's route carries the workspace its link names it under by, where it names the task by number. */
const IOS_TASK_WORKSPACE_PARAM = "workspace";

/** A task's route as its link names it: by id, or by number with the workspace the number counts in, for the task's screen to find. */
function taskRoute(taskId: string, workspace: string | undefined): string {
  const route = `${IOS_ROUTE.TASKS}/${encodeURIComponent(taskId)}`;
  const numbered = taskNumberOf({ kind: LINK_DESTINATION.TASK, taskId }) !== undefined;

  return numbered && workspace !== undefined
    ? `${route}?${new URLSearchParams({ [IOS_TASK_WORKSPACE_PARAM]: workspace })}`
    : route;
}

/** The queries a page's route names its task by and the workspace its number counts in, or its page under an agent's route. */
const IOS_PAGE_PARAM = { TASK: "task", WORKSPACE: "workspace", PAGE: "page" } as const;

/**
 * The app's route for a page an agent showed, as a link names it: under its
 * task, or under its agent, as an older link does. A task named by number
 * carries the workspace the link names it under, as a task's route does, for
 * the page's screen to find it. Note that a link names no version, so the
 * page's screen opens at the newest the task's pages hold.
 */
function iosPageRoute(
  place: Extract<LinkDestination, { readonly kind: typeof LINK_DESTINATION.PAGE }>,
  workspace: string | undefined,
): string {
  if ("agentId" in place) {
    const query = new URLSearchParams({ [IOS_PAGE_PARAM.PAGE]: place.pageId });

    return `${iosAgentRoute(place.agentId)}/${IOS_ROUTE.AGENT_PAGE}?${query}`;
  }

  const numbered =
    taskNumberOf({ kind: LINK_DESTINATION.TASK, taskId: place.taskId }) !== undefined;

  const query = new URLSearchParams({ [IOS_PAGE_PARAM.TASK]: place.taskId });

  if (numbered && workspace !== undefined) query.set(IOS_PAGE_PARAM.WORKSPACE, workspace);

  return `${IOS_ROUTE.PAGE}/${encodeURIComponent(place.pageId)}?${query}`;
}

/**
 * The app's route for a place it draws, or none for a place it leaves to the
 * web. A task is routed as the link names it, by id or by number, for the
 * task's screen to find; a number carries `workspace`, the workspace the
 * link names it under, since a number counts within one workspace and the
 * screen finds a task the phone doesn't hold by both (`TASKS_FIND`).
 */
export function iosAppRouteOf(place: IosRoutedPlace, workspace?: string): string;
export function iosAppRouteOf(place: LinkDestination, workspace?: string): string | undefined;
export function iosAppRouteOf(place: LinkDestination, workspace?: string): string | undefined {
  switch (place.kind) {
    case LINK_DESTINATION.INBOX:
      return IOS_ROUTE.INBOX;
    case LINK_DESTINATION.INBOX_ITEM:
      return `${IOS_ROUTE.INBOX}/${encodeURIComponent(place.itemId)}`;
    case LINK_DESTINATION.BOARD:
      return IOS_ROUTE.TASKS;
    case LINK_DESTINATION.TASK:
      return taskRoute(place.taskId, workspace);
    case LINK_DESTINATION.PAGE:
      return iosPageRoute(place, workspace);
    case LINK_DESTINATION.AGENT:
      return iosAgentRoute(place.agentId);
    case LINK_DESTINATION.MESSAGE:
      return iosAgentMessageRoute(place.agentId, place.messageId);
    case LINK_DESTINATION.PERSON:
      return iosPersonRoute(place.userId);
    default:
      return undefined;
  }
}

/**
 * The code a machine's pairing link names (`/connect/<code>`), which the app
 * approves or denies on Settings › Machines rather than at a route a link
 * reaches by itself; none for any other address. Note that the code is
 * handed to the page, which reads the pairing and asks before anything is
 * sent, as the panel's Connect dialog does.
 */
export function iosHostConnectCode(address: string): string | undefined {
  const read = readShownLink(address);

  return read === undefined || "workspace" in read ? undefined : read.place.code;
}

/**
 * The app's route for a person's page, by their account id: who they are in
 * the workspace the phone works in, and what of theirs it holds. Note that a
 * link to one of their machines opens their page, since the phone draws no
 * machine of its own.
 */
function iosPersonRoute(userId: string): string {
  return `${IOS_ROUTE.PERSON}/${encodeURIComponent(userId)}`;
}

/** The app's route for an agent's page: its transcript and its composer. */
export function iosAgentRoute(agentId: string): string {
  return `${IOS_ROUTE.AGENT}/${encodeURIComponent(agentId)}`;
}

/** The query an agent's route names a message by, which its page brings into view and lights, or opens the chat thread it stands in to. */
const IOS_AGENT_MESSAGE_PARAM = "message";

/** The app's route for one of an agent's messages, as a link names it: the agent's page, landed on the message (`IOS_AGENT_MESSAGE_PARAM`). */
function iosAgentMessageRoute(agentId: string, messageId: string): string {
  const query = new URLSearchParams({ [IOS_AGENT_MESSAGE_PARAM]: messageId });

  return `${iosAgentRoute(agentId)}?${query}`;
}

/**
 * The app's route for a pull request an agent opened, under the agent's
 * page, as a link, a handoff, or a launch made before pull requests were
 * opened by their repository names it; its screen reads the agent's
 * repository and opens the pull request by it.
 */
export function iosPullRequestRoute(agentId: string, number: number): string {
  return `${iosAgentRoute(agentId)}/${IOS_ROUTE.PULL_REQUEST}/${number}`;
}

/**
 * The pull request an agent's route names by the agent and its number
 * (`iosPullRequestRoute`), by its workspace, repository, and number: the
 * agent's listed pull request where it is that number, by the repository
 * its address names, else the agent's own repository's, in the agent's
 * workspace; none while the agent is read, or for one with no repository.
 */
export function iosAgentPullRequestOf(
  agent: { readonly workspaceId: string; readonly repository: string | null } | undefined,
  listed: { readonly number: number; readonly url: string } | undefined,
  number: number,
):
  | { readonly workspaceId: string; readonly repository: string; readonly number: number }
  | undefined {
  if (agent === undefined) return undefined;
  const named = listed?.number === number ? pullRequestAddressOf(listed.url) : undefined;
  const repository = named?.repository ?? agent.repository;

  return repository === null ? undefined : { workspaceId: agent.workspaceId, repository, number };
}

/** The query a pull request's route names the agent it was opened from by, which its screen offers to Handoff; the pull request is read by its repository alone. */
const IOS_PULL_REQUEST_AGENT_PARAM = "agent";

/** The app's route for a pull request by the workspace whose installation reaches its repository, the repository's owner and name, and its number, with the agent it was opened from where there is one. */
export function iosRepositoryPullRequestRoute(
  pullRequest: {
    readonly workspaceId: string;
    readonly repository: string;
    readonly number: number;
  },
  agentId?: string,
): string {
  const [owner = "", name = ""] = pullRequest.repository.split("/");
  const steps = [pullRequest.workspaceId, owner, name].map(encodeURIComponent);
  const route = `${IOS_ROUTE.REPOSITORY_PULL_REQUEST}/${steps.join("/")}/${pullRequest.number}`;

  return agentId === undefined
    ? route
    : `${route}?${new URLSearchParams({ [IOS_PULL_REQUEST_AGENT_PARAM]: agentId })}`;
}

/** The app's route for the files a pull request changes, by its workspace, its repository, and its number: its own route's Files. */
export function iosPullRequestFilesRoute(pullRequest: {
  readonly workspaceId: string;
  readonly repository: string;
  readonly number: number;
}): string {
  return `${iosRepositoryPullRequestRoute(pullRequest)}/${IOS_ROUTE.PULL_REQUEST_FILES}`;
}

/** The app's route for the checks run on a pull request's head, by its workspace, its repository, and its number: its own route's Checks. */
export function iosPullRequestChecksRoute(pullRequest: {
  readonly workspaceId: string;
  readonly repository: string;
  readonly number: number;
}): string {
  return `${iosRepositoryPullRequestRoute(pullRequest)}/${IOS_ROUTE.PULL_REQUEST_CHECKS}`;
}

/** The app's route for one review thread of a pull request, by GitHub's id for it, where its comments are read and replied to. */
export function iosPullRequestThreadRoute(
  pullRequest: {
    readonly workspaceId: string;
    readonly repository: string;
    readonly number: number;
  },
  threadId: string,
): string {
  return `${iosRepositoryPullRequestRoute(pullRequest)}/${IOS_ROUTE.PULL_REQUEST_THREAD}/${encodeURIComponent(threadId)}`;
}

/** The app's route for a new comment on a pull request, at the foot of its conversation. */
export function iosPullRequestCommentRoute(pullRequest: {
  readonly workspaceId: string;
  readonly repository: string;
  readonly number: number;
}): string {
  return `${iosRepositoryPullRequestRoute(pullRequest)}/${IOS_ROUTE.PULL_REQUEST_COMMENT}`;
}

/**
 * The tabs whose stacks the app's pages are pushed onto, each mounting the
 * thread, task, and agent screens in a route group of its own name
 * (`(inbox)`, `(tasks)`, `(search)`, `(automations)`), so one tab's link can
 * open on another's stack.
 */
export const IOS_TAB = {
  INBOX: "inbox",
  TASKS: "tasks",
  SEARCH: "search",
  AUTOMATIONS: "automations",
} as const;

export type IosTab = (typeof IOS_TAB)[keyof typeof IOS_TAB];

/** The tab `name` names, as a route's first segment or a route group's name; none for any other. */
function tabNamed(name: string | undefined): IosTab | undefined {
  return Object.values(IOS_TAB).find((tab) => tab === name);
}

/** The tab a route group is, by its segment as the router reads it (`(inbox)`); none for any other segment, such as a sheet's. */
export function iosTabOfGroup(segment: string | undefined): IosTab | undefined {
  const group = /^\(([^()]+)\)$/u.exec(segment ?? "")?.[1];

  return tabNamed(group);
}

/** The tab a route of the app's is its own by its first segment: the Inbox's for a thread, Tasks' for a task, an agent, and the pages under them. */
export function iosRouteTab(route: string): IosTab | undefined {
  return tabNamed(route.split(/[/?#]/u).find((segment) => segment !== ""));
}

/**
 * The routes no tab's split view lists, so a regular window has no list to
 * select one beside: a person's page. Note that such a route is pushed onto
 * the tab standing in every window, as a compact window pushes it, because
 * on its own tab Back would land on that tab's empty detail rather than where
 * it was opened from.
 */
const UNLISTED_ROUTES: readonly string[] = [IOS_ROUTE.PERSON];

/** Whether a tab's split view lists the route's kind, as the Inbox's lists a thread and Tasks' a task or an agent; a person's page it lists nowhere. */
function splitViewLists(route: string): boolean {
  const path = route.split(/[?#]/u)[0] ?? "";

  return !UNLISTED_ROUTES.some((unlisted) => path === unlisted || path.startsWith(`${unlisted}/`));
}

/**
 * The tab a route is opened from, for `iosRouteOnTab`: the tab standing in a
 * compact window; in a regular one, none for a route a split view lists, so
 * it opens on its own tab, whose split view selects it beside its list, but
 * the tab standing for one no split view lists, such as a person's page.
 */
export function iosRouteStanding(
  route: string,
  standing: IosTab | undefined,
  compact: boolean,
): IosTab | undefined {
  return compact || !splitViewLists(route) ? standing : undefined;
}

/**
 * A route of the app's named on the tab whose stack opens it: `standing`,
 * the tab the person is on, for a page every tab mounts, a thread, a task,
 * an agent, or a page under them, so Back returns where it was opened from,
 * as Mail and Messages push; the route's own tab for a tab's root, which no
 * other tab mounts, and wherever no tab stands. A route outside the tabs,
 * such as a sheet's, comes back as it is.
 */
export function iosRouteOnTab(route: string, standing: IosTab | undefined): string {
  const [first, second] = route.split(/[/?#]/u).filter((segment) => segment !== "");
  const own = tabNamed(first);

  if (own === undefined) return route;
  const tab = second !== undefined && standing !== undefined ? standing : own;

  return `/(${tab})${route}`;
}

/**
 * Whether the route is a conversation, which a compact window's tab bar
 * steps aside for, as Messages hides its tabs in a chat so the composer
 * stands alone at the foot: a thread (`/inbox/<id>`), an agent's page, a
 * thread of a Manager's chat, a pull request it opened, or a comment's thread on a task's description or a
 * new comment, each ending in its reply field. A list, a task, and a page the
 * agent showed keep the bar.
 */
export function iosRouteHidesTabs(pathname: string): boolean {
  const [tab, first, second, third] = pathname.split("/").filter((segment) => segment !== "");
  const route = `/${tab ?? ""}`;

  if (route === IOS_ROUTE.INBOX) return first !== undefined;

  if (`${route}/${first ?? ""}` === IOS_ROUTE.COMMENTS) return second !== undefined;

  if (`${route}/${first ?? ""}` === IOS_ROUTE.REPOSITORY_PULL_REQUEST) return second !== undefined;

  if (`${route}/${first ?? ""}` !== IOS_ROUTE.AGENT || second === undefined) return false;

  return third === undefined || third === IOS_ROUTE.PULL_REQUEST || third === IOS_ROUTE.CHAT_THREAD;
}

/**
 * The agent whose own page the route is, whose composer holds a voice
 * call's presses while the call is into it; none on any other route,
 * a page under the agent's included, such as a pull request it opened.
 */
export function iosRouteAgent(pathname: string): string | undefined {
  const [tab, first, agentId, under] = pathname.split("/").filter((segment) => segment !== "");

  if (`/${tab ?? ""}/${first ?? ""}` !== IOS_ROUTE.AGENT || under !== undefined) return undefined;

  return agentId;
}

/**
 * The app's route for an address a link or a chip names: a vespin.dev
 * place the app draws, or a pull request's own page on GitHub, which opens
 * on the app's pull request screen by its repository and number where the
 * link stands in a workspace, which reads it; none for any other, or a pull
 * request named with no workspace at hand, which Safari opens. Note that a
 * page under a pull request, its Files changed or a commit, stays GitHub's,
 * since the app draws no diff.
 */
export function iosAppRouteOfAddress(
  address: string,
  workspaceId: string | undefined,
): string | undefined {
  const read = readLink(address);

  if (read !== undefined) return iosAppRouteOf(read.place, read.workspace);
  const named = pullRequestAddressOf(address);

  if (named === undefined) return undefined;
  const own = gitHubPageLink({ kind: GITHUB_PAGE.PULL_REQUEST, ...named });

  if (workspaceId === undefined || addressPath(address).toLowerCase() !== own.toLowerCase()) {
    return undefined;
  }

  return iosRepositoryPullRequestRoute({ workspaceId, ...named });
}
