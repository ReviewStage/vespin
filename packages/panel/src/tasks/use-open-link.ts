import {
  LINK_DESTINATION,
  type LinkDestination,
  openableLinkOf,
  type ReadLink,
  taskNumberOf,
  withTaskId,
} from "@repo/features/link-grammar";
import { type DescriptionMention, MENTION_KIND } from "@repo/features/mention-link";
import type { PagePlace } from "@repo/features/page-wire";
import { isGitHubAddress } from "@repo/host/acts";
import { listedPullRequestOf } from "@repo/ui/pull-request-link";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import {
  createContext,
  createElement,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
} from "react";
import { appPlatform } from "../app-platform.js";
import type { LinkDestinationName, LinkRouter } from "../places/link-places.js";
import {
  ADDRESS,
  type Address,
  addressOf,
  beside,
  go,
  type HERE,
  NOTHING,
  placeAddress,
  ROUTE,
  type Route,
  THING,
} from "../places/pressed-address.js";
import { type Holding, pullRequestBeside } from "../places/pull-request-beside.js";
import { useSteadyDoor } from "../steady-door.js";
import { pullRequestsOnGitHubNow } from "./pull-request-opens.js";
import { numberedTaskIdNow } from "./use-link-standing.js";

/**
 * use-open-link.ts -- how a link in written words opens: a transcript's, an agent tab's, or an Inbox item's.
 *
 * An app link, the address of a task, a section, an agent, an Inbox item,
 * or any other place in the app (`@repo/features/link-grammar`), opens in the
 * window, on that place, never the browser, as Linear's and Slack's own
 * links open in their apps; one written before the link was settled
 * (`luke://plan/<id>`) still opens its task. The window's opener for a
 * place (`App`'s) is handed down on a context, as Settings' is
 * (`../open-settings.tsx`); outside the window, as in a test of one
 * surface, there is none, and an app link opens in the browser as any
 * other web page does.
 *
 * A page on GitHub, such as the pull request an agent opened, goes through
 * `github.open`, the act every GitHub press in the window goes through; any
 * other web page goes through `web.open`. Both open in the default browser,
 * and neither asks first. An address neither act takes — a `file:`, a
 * `javascript:`, another app's scheme — is no link, and the surface draws
 * its words going nowhere.
 *
 * A place may open some links where it stands before the window does
 * (`OpenAddressesHere`), as the window's Inbox opens a file, a page, or a pull
 * request of the item's task in the panel beside the item rather than
 * leaving for the task, and a place a part names rather than a link writes,
 * an agent a message's sender names or a review thread a Pull request tab
 * jumps to, is asked of it the same way (`useOpenPlace`,
 * `OpenAddressesHere`); a task opens a pull
 * request one of its agents opened in that agent's Pull request tab, and any
 * other pull request of its repository no listed task's agent opened in a
 * Pull request tab by its number, rather than on GitHub
 * (`openPullRequestsHere`). Past the place, the window opens
 * a pull request any listed task's agent opened in that agent's Pull request
 * tab, on its task (`ListedPullRequests`), wherever it is pressed:
 * a thread, a version, a task's card, or another task. Inside a pull
 * request's own tab, a link leaves for GitHub (`PullRequestsOnGitHub`), and
 * everywhere it does where the account chose to open pull requests on
 * GitHub (`pull-request-opens.ts`), but for a link to one of a pull
 * request's own comments pressed in its tab, which that tab still opens.
 * Where each opens is each surface's own answer (`../places/pressed-address.ts`
 * states them together), which each place, then the window
 * (`throughWindow`), asks of the link's address, a place in the app matched
 * on the route tree.
 */

/** A task's page a press comes from, and what it holds. */
export type PagesHere = {
  readonly kind: typeof HERE.TASK;
  /** The task the page shows. */
  readonly taskId: string;
} & Holding;

/** The tasks the window lists, as their rows name their pull requests. */
export interface Listed {
  readonly tasks: Parameters<typeof listedPullRequestOf>[1];
}

const OpenLinkContext = createContext<((link: ReadLink) => void) | undefined>(undefined);

/** Hands the window's opener for a place in the app to everything under it. */
export const OpenLinkProvider = OpenLinkContext.Provider;

/** Opens a link where the place stands, answering whether it did; one it did not is the window's to open. */
export type OpenHere = (href: string) => boolean;

/** Opens an address where the place stands, a place handed rather than written among them, answering whether it did; one it did not is the window's to open. */
export type OpenAddressHere = (address: Address) => boolean;

const OpenHereContext = createContext<OpenAddressHere | undefined>(undefined);

/** Hands everything under it the place's own opener of addresses, asked first of every link opened there and every place a part there names. */
export const OpenAddressesHere = OpenHereContext.Provider;

/** Only what a link writes, which a place handed rather than written never is. */
function ofLinks(open: OpenHere): OpenAddressHere {
  return (address) => address.href !== undefined && open(address.href);
}

/**
 * Under it, `open` is asked first of every link opened, and any place's own
 * opener around it after, as a pull request's tab opens a link to one of
 * its own comments on GitHub at that comment (`pull-request-anchors.ts`).
 */
export function OpenHereFirst({
  open,
  children,
}: {
  open: OpenHere;
  children: ReactNode;
}): ReactNode {
  const around = useContext(OpenHereContext);

  const first = useCallback<OpenAddressHere>(
    (address) => ofLinks(open)(address) || around?.(address) === true,
    [open, around],
  );

  return createElement(OpenHereContext.Provider, { value: first }, children);
}

/**
 * Under it, an address the place around opens nothing of, so the window
 * goes to it, is told to `leaving` first, as a link pressed in the side
 * panel to an agent elsewhere carries the panel along.
 */
export function OnLeavingHere({
  leaving,
  children,
}: {
  leaving: (address: Address) => void;
  children: ReactNode;
}): ReactNode {
  const around = useContext(OpenHereContext);

  const open = useCallback<OpenAddressHere>(
    (address) => {
      if (around?.(address) === true) return true;
      leaving(address);

      return false;
    },
    [around, leaving],
  );

  return createElement(OpenHereContext.Provider, { value: open }, children);
}

/** Reads the tasks the window lists as they stand now. */
type ListedTasksReader = () => Listed;

const ListedTasksContext = createContext<ListedTasksReader | undefined>(undefined);

/**
 * Hands everything under it the tasks the window lists, whose pull requests open in their Pull request tabs. Note that it hands a reader
 * standing across draws rather than the list, which is read as a link is
 * opened, because the list is new on every patch to any listed task, and
 * every part opening links would be drawn again with it.
 */
export function ListedPullRequests({
  tasks,
  children,
}: {
  tasks: Listed["tasks"];
  children: ReactNode;
}): ReactNode {
  const read = useSteadyDoor((): Listed => ({ tasks }));

  return createElement(ListedTasksContext.Provider, { value: read }, children);
}

/**
 * Under it, a link to a pull request leaves for GitHub, neither the place
 * nor the window opening it in a tab: as inside a pull request's own tab,
 * which already is that pull request. Any other address is still the
 * place's to open first, as a review thread the tab jumps to is beside an
 * Inbox item.
 */
export function PullRequestsOnGitHub({ children }: { children: ReactNode }): ReactNode {
  const around = useContext(OpenHereContext);

  const open = useCallback<OpenAddressHere>(
    (address) => address.kind !== ADDRESS.PULL_REQUEST && around?.(address) === true,
    [around],
  );

  return createElement(
    OpenHereContext.Provider,
    { value: around === undefined ? undefined : open },
    createElement(ListedTasksContext.Provider, { value: undefined }, children),
  );
}

/** What a place of the app pressed on a task's page opens beside it, read as its declaration reads it. */
type PagePlaceBeside = (place: LinkDestination, here: PagesHere) => Route;

/**
 * Each place of the app a task's page opens beside it, by the name of the
 * declaration its route matched (`LINK_ROUTED_PLACE`): a page of another
 * task than the one it shows, read on its own place; its own is the
 * window's, which opens it as the panel's, and so is an older link's page
 * an agent showed on itself, which the window finds the task of. Every
 * other place is the window's.
 */
const PAGE_BESIDE: Readonly<Partial<Record<LinkDestinationName, PagePlaceBeside>>> = {
  PAGE: (at, here) => {
    // Note that a task named by a number no one found the task for is no place a page reads on, so the window finds it on the service.
    if (at.kind !== LINK_DESTINATION.PAGE || taskNumberOf(at) !== undefined) return NOTHING;

    if (!("planId" in at) || at.planId === here.taskId) return NOTHING;
    const place: PagePlace = { taskId: at.planId };

    return beside({ kind: THING.PAGE, pageId: at.pageId, place });
  },
};

/**
 * What an address pressed on a task's page or an agent's opens beside it: a
 * pull request as `pullRequestBeside` opens it, and a place of the app by
 * the declaration its route matched (`PAGE_BESIDE`); any other address is
 * the window's.
 */
function besidePages(address: Address, here: PagesHere): Route {
  switch (address.kind) {
    case ADDRESS.PLACE: {
      const { routed } = address;

      return routed === undefined
        ? NOTHING
        : (PAGE_BESIDE[routed.name]?.(routed.link.place, here) ?? NOTHING);
    }

    case ADDRESS.PULL_REQUEST:
      return pullRequestBeside(address, here);
    default:
      return NOTHING;
  }
}

/**
 * A task's page's opener for what it opens beside it
 * (`besidePages`): a pull request of one of its agents', in that agent's Pull
 * request tab through `open`, or another of its repository, by its number in
 * its first agent's; and a page of another place through `openPage`, read on
 * that place; any other address is the window's.
 */
export function openPullRequestsHere(
  here: PagesHere,
  open: (agentId: string, number?: number) => void,
  openPage: (pageId: string, place: PagePlace) => void,
): OpenAddressHere {
  return (address) => {
    // Only what a link writes, which a place handed rather than written never is.
    if (address.href === undefined) return false;
    const routed = besidePages(address, here);

    if (routed.kind !== ROUTE.BESIDE) return false;
    const { thing } = routed;

    if (thing.kind === THING.PAGE && thing.place !== undefined) {
      openPage(thing.pageId, thing.place);

      return true;
    }

    if (thing.kind !== THING.PULL_REQUEST) return false;
    open(thing.agentId, thing.number);

    return true;
  };
}

/** The place a mention of a plan, or of one of its sections, names. */
export function placeOfMention(mention: DescriptionMention): LinkDestination {
  return mention.kind === MENTION_KIND.TASK
    ? { kind: LINK_DESTINATION.TASK, planId: mention.taskId }
    : { kind: LINK_DESTINATION.SECTION, planId: mention.taskId, anchor: mention.anchor };
}

/**
 * The link with the task its place names by its number, `…/task/42`, named
 * by its id where the window lists that task, so a place asked of it knows
 * the task as its own; any other link as it is. Note that a number the
 * window lists no task for stays a number, which only the window opens,
 * finding the task on the service (`use-tasks-tab.ts`'s `openLink`).
 */
function byListedTaskId(link: ReadLink, client: QueryClient): ReadLink {
  const number = taskNumberOf(link.place);

  const taskId =
    number === undefined
      ? undefined
      : numberedTaskIdNow(client)({ workspace: link.workspace, number });

  return taskId === undefined ? link : { ...link, place: withTaskId(link.place, taskId) };
}

/** The address as written, for the browser; nothing for a place handed rather than written. */
function external(address: Address): Route {
  return address.href === undefined ? NOTHING : { kind: ROUTE.EXTERNAL, href: address.href };
}

/**
 * An address no surface took: a place in the app goes there, a listed
 * task's or agent's pull request to its Pull request tab, on the place its
 * link matches on the route tree, unless the account opens pull requests on
 * GitHub, and anything else, or everything outside the window
 * (`opensPlaces`), leaves for the browser.
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
    address.kind === ADDRESS.PULL_REQUEST && address.onGitHub !== true && listed !== undefined
      ? listedPullRequestOf(address.href, listed.tasks)
      : undefined;

  if (opened === undefined) return external(address);

  const changes: ReadLink = {
    workspace: "",
    place: { kind: LINK_DESTINATION.CHANGES, planId: opened.taskId, agentId: opened.agentId },
  };

  // Note that the window goes to the Pull request tab's place as its route reads it, as a link to it would.
  return go(placeAddress(changes, router).routed?.link ?? changes);
}

/**
 * The address with the listed agent that opened the pull request it names,
 * however its page is spelled, among the tasks the window lists, so a place asked of it first leaves another task's to the
 * window, and with whether the account opens pull requests on GitHub; any
 * other address as it is.
 */
function withListedAgent(address: Address, listed: Listed | undefined, onGitHub: boolean): Address {
  if (address.kind !== ADDRESS.PULL_REQUEST) return address;
  const named = { ...address, onGitHub };

  if (listed === undefined) return named;

  return { ...named, listed: listedPullRequestOf(address.href, listed.tasks) };
}

/** Opens an address where the place it is pressed on opens it, else where the window does (`throughWindow`): a place in the app there, a listed task's pull request in its Pull request tab, anything else in the browser. */
function openAddress(
  address: Address,
  doors: {
    readonly openPlace: ((link: ReadLink) => void) | undefined;
    readonly openHere: OpenAddressHere | undefined;
    readonly listed: ListedTasksReader | undefined;
    readonly router: LinkRouter | undefined;
    /** Whether the account opens pull requests on GitHub, read as the press lands. */
    readonly onGitHub: boolean;
  },
): void {
  const { openPlace, openHere, listed, router, onGitHub } = doors;
  const listing = listed?.();
  const named = withListedAgent(address, listing, onGitHub);

  if (openHere?.(named) === true) return;
  const routed = throughWindow(named, openPlace !== undefined, listing, router);

  if (routed.kind === ROUTE.GO) {
    openPlace?.(routed.link);
  } else if (routed.kind !== ROUTE.EXTERNAL) {
    return;
  } else if (isGitHubAddress(routed.href)) {
    // Note that the act's own guard picks it, since `github.open` refuses a page of GitHub's written in http.
    appPlatform().openGitHub(routed.href);
  } else {
    appPlatform().openWeb(routed.href);
  }
}

/** The window's router, which a press is matched on; none outside it, as in a test of one surface. */
export function useLinkRouter(): LinkRouter | undefined {
  const router: LinkRouter | undefined = useRouter({ warn: false });

  return router ?? undefined;
}

/** The opener for a plan, or one of its sections, as a mention's chip names it: where the place it is pressed on opens it, else in the window; nothing outside the window. */
export function useOpenTask(): ((mention: DescriptionMention) => void) | undefined {
  const open = useOpenPlace();

  return useMemo(
    () =>
      open === undefined
        ? undefined
        : (mention: DescriptionMention) => open(placeOfMention(mention)),
    [open],
  );
}

/** The opener for a place in the app a part names rather than a link writes, as a link to it would open it, one of an agent's messages among them: where the place it is pressed on opens it, else in the window; nothing outside the window. */
export function useOpenPlace(): ((place: LinkDestination) => void) | undefined {
  const openPlace = useContext(OpenLinkContext);
  const openHere = useContext(OpenHereContext);
  const router = useLinkRouter();

  return useMemo(
    () =>
      openPlace === undefined
        ? undefined
        : (place: LinkDestination) =>
            openAddress(placeAddress({ workspace: "", place }, router), {
              openPlace,
              openHere,
              listed: undefined,
              router,
              onGitHub: false,
            }),
    [openPlace, openHere, router],
  );
}

/**
 * Whether a link is one the window opens, as every client reads one
 * (`openableLinkOf`), so a link the iPhone app opens is never drawn here as
 * words; an app link is a web address, and it takes it.
 */
export function opensAsLink(href: string): boolean {
  return openableLinkOf(href) !== undefined;
}

/** Opens a link {@link opensAsLink} admits: where the place it is pressed on opens it, else an app link in the window where it can be, a listed task's or a listed agent's on no task's pull request in its Pull request tab, anything else in the browser, over the capability it belongs to (`throughWindow`). */
export function useOpenLink(): (href: string) => void {
  const openPlace = useContext(OpenLinkContext);
  const openHere = useContext(OpenHereContext);
  const listed = useContext(ListedTasksContext);
  const queryClient = useQueryClient();
  const router = useLinkRouter();

  return useCallback(
    (href: string) =>
      openAddress(
        addressOf(href, router, (link) => byListedTaskId(link, queryClient)),
        { openPlace, openHere, listed, router, onGitHub: pullRequestsOnGitHubNow(queryClient) },
      ),
    [openPlace, openHere, listed, queryClient, router],
  );
}

/**
 * The press of a link that opens a page outside the window, over `open`
 * ({@link useOpenLink}'s): the page opens through the platform's link-open
 * act, so a refused address toasts as any refused open does, and the browser
 * does not follow the address a second time. Note that the link is still an
 * `<a href>`, so a right-click offers its link menu and a reader's link list
 * finds it.
 */
export function linkPressOf(
  open: (href: string) => void,
  href: string,
): (event: MouseEvent<HTMLAnchorElement>) => void {
  return (event) => {
    event.preventDefault();
    open(href);
  };
}
