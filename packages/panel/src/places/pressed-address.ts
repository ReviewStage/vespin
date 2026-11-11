/**
 * pressed-address.ts -- what an address pressed names, the surface it is pressed on, and what the press opens: beside that surface, at a place the window goes to, or in the browser.
 *
 * An address (`addressOf`) is a place in the app as its link names it,
 * matched on the route tree (`link-places.ts`'s `routedPressOf`), or a page
 * on the web, which has no route: a pull request's on GitHub, a file's of a
 * repository, or any other. A surface is what the press came from and what
 * that holds: an Inbox item and what holds it, a task's page, an agent's
 * page, the window past every surface, and the window's Tasks tab as it goes
 * to a place. Each surface's choice lives with it, a place in the app
 * answered by the declaration its route matched, keyed by its name
 * (`LinkDestinationName`), and a page on the web by the surface's own answers
 * (`pull-request-beside.ts`, `inbox-item-links.ts`'s `fileBeside`); the list
 * below is where the choices are stated together, and nothing else decides
 * them: a surface asks its own of every link pressed on it first
 * (`use-open-link.ts`'s `OpenHere`), the window asks its own of what no
 * surface took (`useOpenLink`), and the Tasks tab asks its own of a thing of
 * a task as it goes there. What each surface then does with the answer is
 * its own door's: which tab stands for the thing, and how the window goes to
 * a place, kind by kind.
 *
 * The choices, by surface, where the account opens pull requests in the
 * app; where it chose GitHub (`pull-request-opens.ts`), a pull request's page
 * leaves for the browser from every surface:
 *
 * - An Inbox item (`inbox-item-links.ts`) opens beside it what the panel
 *   standing for what holds it draws: a file of any repository, read through
 *   the item's workspace where it is not the item's own, a page of any task,
 *   read on its own place where it is not the item's,
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
 *   and any other of their repository no listed agent opened by its number
 *   in their first agent's;
 *   and a page of any other task or agent on no task, read on its own place,
 *   their own pages being the window's to open as the panel's.
 * - The window (`use-open-link.ts`'s `throughWindow`) goes to every place in
 *   the app, and to the Pull request tab of a pull request a listed task's
 *   or a listed agent on no task's agent opened; anything else leaves for
 *   the browser, as everything does outside the window.
 * - The Tasks tab (`link-places.ts`'s `onTasksTab`) opens beside it a
 *   page, an agent's Changes, a worker, or a review thread of the task it
 *   shows with nothing standing over its plan, chooses that task's Overview
 *   for the task itself, one of its description's sections, or one of its
 *   comments, at the section or the comment, and goes to any other.
 */

import {
  LINK_DESTINATION,
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
import type { listedPullRequestOf } from "@repo/ui/pull-request-link";
import { type LinkRouter, type RoutedLink, routedPressOf } from "./link-places.js";

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
      /** The agent of a task or the agent on no task the window lists that opened it, and its task; none where the window lists none, or is not asked. */
      readonly listed: ReturnType<typeof listedPullRequestOf>;
      /** Whether the account opens pull requests on GitHub (`pull-request-opens.ts`), so no surface opens it in a tab and the window leaves it for the browser; none where it is not asked. */
      readonly onGitHub?: boolean;
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
} as const;

/** The things a press opens beside a surface, in the panel there, or, an Inbox item, in the Inbox the surface stands in. */
export const THING = {
  FILE: "file",
  PAGE: "page",
  /** An agent's Changes, its Pull request tab, as an app link names it. */
  CHANGES: "changes",
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
      /** The task that holds it. */
      readonly taskId: string;
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

export const NOTHING: Route = { kind: ROUTE.NOTHING };

/** The task or the section an older `luke://plan/` names, as a link naming no workspace; none for any other mention. */
function mentionedLinkOf(mention: ReturnType<typeof decodeMention>): ReadLink | undefined {
  switch (mention?.kind) {
    case MENTION_KIND.TASK:
      return { workspace: "", place: { kind: LINK_DESTINATION.TASK, planId: mention.taskId } };
    case MENTION_KIND.SECTION:
      return {
        workspace: "",
        place: { kind: LINK_DESTINATION.SECTION, planId: mention.taskId, anchor: mention.anchor },
      };
    default:
      return undefined;
  }
}

export function beside(thing: Thing): Route {
  return { kind: ROUTE.BESIDE, thing };
}

export function go(link: ReadLink): Route {
  return { kind: ROUTE.GO, link };
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
  if (pullRequest !== undefined) {
    return { kind: ADDRESS.PULL_REQUEST, href, ...pullRequest, listed: undefined };
  }
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
