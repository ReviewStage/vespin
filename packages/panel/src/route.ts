import {
  LINK_PLACE,
  type PullRequestThreadView,
  pullRequestAddressOf,
  type ReadLink,
  readLink,
} from "@repo/features/link-grammar";
import {
  decodeMention,
  MENTION_KIND,
  type MentionLines,
  pageRepositoryOf,
} from "@repo/features/mention-link";
import type { PagePlace } from "@repo/features/page-wire";
import {
  listedPullRequestOf,
  type OpenedPullRequest,
  pullRequestAgentOf,
  repositoryPullRequestOf,
} from "@repo/ui/pull-request-link";
import { type LinkRouter, type RoutedLink, routedPressOf } from "./places/link-places.js";

/**
 * route.ts -- the one table of where an address pressed opens: beside the surface it was pressed on, at a place the window goes to, or in the browser.
 *
 * An address (`addressOf`) is a place in the app as its link names it,
 * matched on the route tree (`places/link-places.ts`'s `routedPressOf`), or
 * a page on the web, which has no route: a pull request's on GitHub, a
 * file's of a repository, or any other. A surface is what the press came
 * from and what that holds: an Inbox item and what holds it, a task's page,
 * an agent's page, the window past every surface, and the window's Tasks tab
 * as it goes to a place. Each surface's choice lives with it, a place in
 * the app answered by the declaration its route matched, keyed by its name
 * (`LinkPlaceName`), and a page on the web by this module's own answers
 * (`pullRequestBeside`, `fileBeside`); this table is where the choices are
 * stated together, and nothing else decides them: a surface asks its own of
 * every link pressed on it first (`use-open-link.ts`'s `OpenHere`), the
 * window asks its own of what no surface took (`useOpenLink`), and the
 * Tasks tab asks its own of a thing of a task as it goes there. What each
 * surface then does with the answer is its own door's: which tab stands for
 * the thing, and how the window goes to a place, kind by kind.
 *
 * The table, by surface:
 *
 * - An Inbox item (`inbox-item-links.ts`) opens beside it what the panel
 *   standing for what holds it draws: a file of any repository, read through
 *   the item's workspace where it is not the item's own, a page of any task
 *   or agent on no task, read on its own place where it is not the item's,
 *   an archived agent's Changes, one of its task's agents' transcripts, at a
 *   message of it where the link names one, a review thread of one of its
 *   agents' pull requests, and a pull request as `pullRequestBeside` opens
 *   it. An agent of its task the panel does not draw, an archived one, is
 *   the window's, which opens its tab on the task; any other agent is the
 *   window's too, which opens it in the middle. Another Inbox item is chosen
 *   in the Inbox the item stands in, rather than in its task's Inbox tab.
 * - A task's page and an agent's page (`use-open-link.ts`'s
 *   `openPullRequestsHere`) open beside them a pull request one of their
 *   agents opened, an archived one's among them, in its Pull request tab,
 *   and any other of their repository by its number in their first agent's;
 *   and a page of any other task or agent on no task, read on its own place,
 *   their own pages being the window's to open as the panel's.
 * - The window (`throughWindow`) goes to every place in
 *   the app, and to the Pull request tab of a pull request a listed task's
 *   or a listed agent on no task's agent opened; anything else leaves for
 *   the browser, as everything does outside the window.
 * - The Tasks tab (`places/link-places.ts`'s `onTasksTab`) opens beside it a
 *   page, an agent's Changes, a worker, or a review thread of the task it
 *   shows with nothing standing over its plan, chooses that task's Overview
 *   for the task itself, one of its description's sections, or one of its
 *   comments, at the section or the comment, and goes to any other.
 */

/** The kinds of address a press names. */
export const ADDRESS = {
  /** A place in the app, as its link names it, or an older `luke://plan/` names a task or a section, matched on the route tree. */
  PLACE: "place",
  /** A pull request's page on GitHub, or any page under it. */
  PULL_REQUEST: "pull-request",
  /** A file of a repository, as its page on GitHub names it, or an older `luke://file/` names one of whichever repository the surface holds. */
  FILE: "file",
  /** Any other page. */
  WEB: "web",
} as const;

/** What a press names, and the address as it was written, which leaves for the browser where nothing in the window opens it. */
export type Address =
  | {
      readonly kind: typeof ADDRESS.PLACE;
      readonly link: ReadLink;
      /** The link place its route reads, matched on the route tree; none where it matches no link place's route, or the window has no router to match it on. */
      readonly routed: RoutedLink | undefined;
      /** None for a place handed rather than written. */
      readonly href?: string;
    }
  | {
      readonly kind: typeof ADDRESS.PULL_REQUEST;
      readonly href: string;
      readonly repository: string;
      readonly number: number;
    }
  | {
      readonly kind: typeof ADDRESS.FILE;
      readonly href: string;
      /** None for an older link, which names a file of whichever repository the surface holds. */
      readonly repository: string | undefined;
      readonly path: string;
      readonly lines: MentionLines | undefined;
    }
  | { readonly kind: typeof ADDRESS.WEB; readonly href: string };

/** A place in the app, as an address. */
export type PlaceAddress = Extract<Address, { readonly kind: typeof ADDRESS.PLACE }>;

/** The surfaces a press comes from. */
export const HERE = {
  /** An Inbox item, the panel beside it standing for what holds the item. */
  INBOX_ITEM: "inbox-item",
  /** A task's page. */
  TASK: "task",
  /** An agent's own page. */
  AGENT: "agent",
} as const;

/**
 * What a surface holds that a link may name: its repository, `owner/name`,
 * or none before one is chosen; the pull requests its agents opened, by
 * agent; the agents whose tabs it draws, none before they are read; and
 * every agent it holds, an archived one among them, whose Pull request tab
 * stands as a live agent's does.
 */
interface Holding {
  readonly repository: string | null | undefined;
  readonly pullRequests: ReadonlyMap<string, { readonly url: string }>;
  readonly agentIds: readonly string[] | undefined;
  readonly heldIds: readonly string[] | undefined;
}

/** The tasks and the agents on no task the window lists, as their rows name their pull requests. */
export interface Listed {
  readonly tasks: Parameters<typeof listedPullRequestOf>[1];
  readonly agents: Parameters<typeof listedPullRequestOf>[2];
}

/** The surface a press comes from, and what it holds. */
type Here =
  | ({
      readonly kind: typeof HERE.INBOX_ITEM;
      /** The task that holds the item; none for an item of an agent on no task. */
      readonly taskId: string | undefined;
      /** The agent on no task that holds the item, whose own pages open beside it; none for an item of a task. */
      readonly agentId: string | undefined;
    } & Holding)
  | ({
      readonly kind: typeof HERE.TASK;
      /** The task the page shows. */
      readonly taskId: string;
    } & Holding)
  | ({
      readonly kind: typeof HERE.AGENT;
      /** The agent the page shows. */
      readonly agentId: string;
    } & Holding);

/** The things a press opens beside a surface, in the panel there, or, an Inbox item, in the Inbox the surface stands in. */
export const THING = {
  FILE: "file",
  PAGE: "page",
  /** An agent's Changes, its Pull request tab, as an app link names it. */
  CHANGES: "changes",
  /** An agent's transcript, at one of its messages where the link names one. */
  TRANSCRIPT: "transcript",
  /** An agent's Pull request tab on its Conversation, as the pull request's page on GitHub names it. */
  PULL_REQUEST: "pull-request",
  /** One review thread of an agent's pull request, in its Pull request tab, on the view the link names. */
  THREAD: "thread",
  /** One of an agent's workers. */
  WORKER: "worker",
  /** An Inbox item, chosen in the Inbox. */
  INBOX_ITEM: "inbox-item",
} as const;

/** A thing a press opens beside a surface. */
export type Thing =
  | {
      readonly kind: typeof THING.FILE;
      readonly path: string;
      readonly lines: MentionLines | undefined;
      /** The repository, `owner/name`, the file is read from, where it is not the surface's own; none for the surface's own. */
      readonly repository?: string;
    }
  | {
      readonly kind: typeof THING.PAGE;
      readonly pageId: string;
      /** The task or the agent on no task the page stands on, where it is not the surface's own; none for the surface's own page. */
      readonly place?: PagePlace;
    }
  | { readonly kind: typeof THING.CHANGES; readonly agentId: string }
  | {
      readonly kind: typeof THING.TRANSCRIPT;
      readonly agentId: string;
      /** The message brought into view; none for the transcript as it stands. */
      readonly messageId?: string;
    }
  | {
      readonly kind: typeof THING.PULL_REQUEST;
      readonly agentId: string;
      /** The pull request's number, where it is another of the repository's than the one the agent opened. */
      readonly number?: number;
    }
  | {
      readonly kind: typeof THING.THREAD;
      readonly agentId: string;
      readonly threadId: string;
      readonly view: PullRequestThreadView;
    }
  | { readonly kind: typeof THING.WORKER; readonly agentId: string; readonly callId: string }
  | {
      readonly kind: typeof THING.INBOX_ITEM;
      readonly itemId: string;
      /** The task that holds it; none for an item of an agent on no task. */
      readonly taskId: string | undefined;
      /** The agent that posted it, where the link names it under its agent. */
      readonly agentId: string | undefined;
    };

/** What a press does. */
export const ROUTE = {
  /** Opens a thing in the panel beside the surface, as a tab of its own. */
  BESIDE: "beside",
  /** The window goes to a place. */
  GO: "go",
  /** Leaves for the browser. */
  EXTERNAL: "external",
  /** The surface opens nothing of it, and whatever stands around it is asked. */
  NOTHING: "nothing",
} as const;

/** What a press does, and with what. */
export type Route =
  | { readonly kind: typeof ROUTE.BESIDE; readonly thing: Thing }
  | { readonly kind: typeof ROUTE.GO; readonly link: ReadLink }
  | { readonly kind: typeof ROUTE.EXTERNAL; readonly href: string }
  | { readonly kind: typeof ROUTE.NOTHING };

export type InboxItemHere = Extract<Here, { readonly kind: typeof HERE.INBOX_ITEM }>;
export type PagesHere = Extract<Here, { readonly kind: typeof HERE.TASK | typeof HERE.AGENT }>;

export const NOTHING: Route = { kind: ROUTE.NOTHING };

export function beside(thing: Thing): Route {
  return { kind: ROUTE.BESIDE, thing };
}

export function go(link: ReadLink): Route {
  return { kind: ROUTE.GO, link };
}

/** The pull requests a surface's agents opened, by their pages on GitHub, each by the agent that opened it; only those of `owners` where it names them. */
function openedBy(holding: Holding, owners?: readonly string[]): OpenedPullRequest[] {
  return [...holding.pullRequests].flatMap(([agentId, { url }]) =>
    owners === undefined || owners.includes(agentId) ? [{ agentId, url }] : [],
  );
}

/** Whether a repository an address names is the one a surface holds, whatever the case its owner and name are spelled in, as GitHub reads them. */
function ofRepository(named: string, repository: string | null | undefined): boolean {
  return (
    repository !== null &&
    repository !== undefined &&
    named.toLowerCase() === repository.toLowerCase()
  );
}

/**
 * A pull request pressed on a surface: one an agent it holds opened, however
 * its page is spelled, a page under it among them, opens in that agent's
 * Pull request tab, and any other of its repository, such as one an agent
 * opened before moving to another branch, in its first agent's by its
 * number; one of another repository is the window's. An Inbox item, a task's
 * page and an agent's answer it alike, an archived agent's pull request,
 * merged or not, opening its tab too.
 */
export function pullRequestBeside(
  address: Extract<Address, { readonly kind: typeof ADDRESS.PULL_REQUEST }>,
  here: Holding,
): Route {
  const opened = openedBy(here, here.heldIds ?? here.agentIds);
  const agentId = pullRequestAgentOf(address.href, opened);
  if (agentId !== undefined) return beside({ kind: THING.PULL_REQUEST, agentId });
  if (!ofRepository(address.repository, here.repository)) return NOTHING;
  // A page under an agent's own pull request's, its files say, is still that agent's.
  const owner = opened.find(
    (each) => repositoryPullRequestOf(each.url, here.repository) === address.number,
  );
  if (owner !== undefined) return beside({ kind: THING.PULL_REQUEST, agentId: owner.agentId });
  const first = here.agentIds?.[0];
  return first === undefined
    ? NOTHING
    : beside({ kind: THING.PULL_REQUEST, agentId: first, number: address.number });
}

/**
 * An address no surface took: a place in the app goes there, a listed
 * task's or agent's pull request to its Pull request tab, on the place its
 * link matches on the route tree, and anything else, or everything outside
 * the window (`opensPlaces`), leaves for the browser.
 */
export function throughWindow(
  address: Address,
  opensPlaces: boolean,
  listed: Listed | undefined,
  router: LinkRouter | undefined,
): Route {
  if (!opensPlaces) return external(address);
  if (address.kind === ADDRESS.PLACE) return go(address.link);
  const opened =
    address.kind === ADDRESS.PULL_REQUEST && listed !== undefined
      ? listedPullRequestOf(address.href, listed.tasks, listed.agents)
      : undefined;
  if (opened === undefined) return external(address);
  const task = opened.taskId === undefined ? undefined : { planId: opened.taskId };
  const changes: ReadLink = {
    workspace: "",
    place: { kind: LINK_PLACE.CHANGES, ...task, agentId: opened.agentId },
  };
  // Note that the window goes to the Pull request tab's place as its route reads it, as a link to it would.
  return go(placeAddress(changes, router).routed?.link ?? changes);
}

/** A file pressed on an Inbox item, beside it: one of the item's repository, which the panel reads through what holds the item, and one of another repository, read through the item's workspace; an older link's, naming none, only where the item holds a repository. */
export function fileBeside(
  address: Extract<Address, { readonly kind: typeof ADDRESS.FILE }>,
  here: Holding,
): Route {
  const { path, lines, repository } = address;
  if (repository === undefined) {
    return here.repository !== null && here.repository !== undefined
      ? beside({ kind: THING.FILE, path, lines })
      : NOTHING;
  }
  return ofRepository(repository, here.repository)
    ? beside({ kind: THING.FILE, path, lines })
    : beside({ kind: THING.FILE, path, lines, repository });
}

/** The address as written, for the browser; nothing for a place handed rather than written. */
function external(address: Address): Route {
  return address.href === undefined ? NOTHING : { kind: ROUTE.EXTERNAL, href: address.href };
}

/** The task or the section an older `luke://plan/` names, as a link naming no workspace; none for any other mention. */
function mentionedLinkOf(mention: ReturnType<typeof decodeMention>): ReadLink | undefined {
  switch (mention?.kind) {
    case MENTION_KIND.TASK:
      return { workspace: "", place: { kind: LINK_PLACE.TASK, planId: mention.taskId } };
    case MENTION_KIND.SECTION:
      return {
        workspace: "",
        place: { kind: LINK_PLACE.SECTION, planId: mention.taskId, anchor: mention.anchor },
      };
    default:
      return undefined;
  }
}

/** A place in the app as an address, matched on the route tree of `router`, the window's; unmatched where there is none, as outside the window. `href` is the address as written, none for a place handed rather than written. */
export function placeAddress(
  link: ReadLink,
  router: LinkRouter | undefined,
  href?: string,
): PlaceAddress {
  const routed = router === undefined ? undefined : routedPressOf(router, link);
  return { kind: ADDRESS.PLACE, link, routed, ...(href === undefined ? {} : { href }) };
}

/**
 * The address a link is: a place an app link names, or a task or a section
 * an older `luke://plan/` does, matched on the route tree of `router`, the
 * window's, as `settle` hands it on, which names a task the window lists by
 * its id; a pull request's page on GitHub, or any page under it; a file's
 * page, read against its own repository, which a surface then holds it to,
 * or an older `luke://file/`, which names none; and any other page.
 */
export function addressOf(
  href: string,
  router: LinkRouter | undefined,
  settle: (link: ReadLink) => ReadLink = (link) => link,
): Address {
  const link = readLink(href);
  if (link !== undefined) return placeAddress(settle(link), router, href);
  const pullRequest = pullRequestAddressOf(href);
  if (pullRequest !== undefined) return { kind: ADDRESS.PULL_REQUEST, href, ...pullRequest };
  const repository = pageRepositoryOf(href);
  const mention = decodeMention(href, repository ?? null);
  if (mention?.kind === MENTION_KIND.FILE) {
    return { kind: ADDRESS.FILE, href, repository, path: mention.path, lines: mention.lines };
  }
  const mentioned = mentionedLinkOf(mention);
  return mentioned === undefined
    ? { kind: ADDRESS.WEB, href }
    : placeAddress(settle(mentioned), router, href);
}
