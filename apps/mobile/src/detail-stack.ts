// detail-stack.ts -- the pages each place pushes over its detail inside the detail's own column, in a window wide enough for three columns, as Mail opens a message's related pages beside its list with a Back there.

import { IOS_TAB, type IosTab, iosRouteOnTab } from "@repo/features/ios-app-links";
import { type Href, useRouter } from "expo-router";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import {
  placeOfRoute,
  placeRoute,
  SIDEBAR_PLACE,
  type SidebarPlace,
} from "./screens/app-sidebar.js";
import { useOwnTab } from "./tab-route.js";
import { useThreeColumns } from "./use-window-size-class.js";

/** What a page pushed over the detail is, as the route a compact window pushes for it names it. */
export const PUSHED_PAGE = {
  TASK: "task",
  AGENT: "agent",
  PULL_REQUEST: "pull-request",
  AGENT_PAGE: "agent-page",
  TASK_PAGE: "task-page",
  COMMENTS: "comments",
  NEW_COMMENT: "new-comment",
  HISTORY: "history",
  VERSION: "version",
} as const;

/** A page pushed over the detail, with what its route's params name. */
export type PushedPage =
  | { readonly kind: typeof PUSHED_PAGE.TASK; readonly taskId: string }
  | {
      readonly kind: typeof PUSHED_PAGE.AGENT;
      readonly agentId: string;
      /** The suggestion a box opened the agent on, as the route's `suggestedBy` and `button` name it. */
      readonly suggestedBy?: string | undefined;
      readonly button?: string | undefined;
    }
  | {
      readonly kind: typeof PUSHED_PAGE.PULL_REQUEST;
      readonly agentId: string;
      readonly number: number;
    }
  | {
      readonly kind: typeof PUSHED_PAGE.AGENT_PAGE;
      readonly agentId: string;
      readonly pageId: string;
      readonly version: number;
      readonly title: string;
    }
  | {
      readonly kind: typeof PUSHED_PAGE.TASK_PAGE;
      readonly pageId: string;
      readonly taskId: string;
      /** The task's workspace, which a later workspace switch leaves as it is; the workspace chosen where none is named. */
      readonly workspaceId: string | undefined;
      readonly version: number;
      readonly title: string;
    }
  | {
      readonly kind: typeof PUSHED_PAGE.COMMENTS;
      readonly threadId: string;
      readonly taskId: string;
    }
  | {
      readonly kind: typeof PUSHED_PAGE.NEW_COMMENT;
      readonly taskId: string;
      readonly from: string;
      readonly to: string;
      readonly quote: string;
    }
  | { readonly kind: typeof PUSHED_PAGE.HISTORY; readonly taskId: string }
  | {
      readonly kind: typeof PUSHED_PAGE.VERSION;
      readonly taskId: string;
      readonly seq: number;
      readonly at: number | undefined;
      readonly newest: number | undefined;
    };

/** A page on a place's stack, by the key its column's path names it by. */
export type HeldPage = { readonly key: string; readonly page: PushedPage };

/** A place's pushed pages, oldest first, and the detail they were pushed over, by its root's key (`useStackRoot`). */
export type PlaceStack = { readonly over: string | undefined; readonly pages: readonly HeldPage[] };

/**
 * The first segment under a tab's `tasks` route of each page that stands in
 * the detail's stack rather than over the window, as the router names them
 * (`tasks/agent/[id]`, `tasks/comments/[id]`, …).
 */
const STACKED_ROUTE = {
  AGENT: "agent",
  PAGE: "page",
  COMMENTS: "comments",
  HISTORY: "history",
  VERSION: "version",
} as const;

/** The tabs' route every stacked page stands under. */
const TASKS_SEGMENT = "tasks";

const EMPTY: PlaceStack = { over: undefined, pages: [] };

/** The tab whose stack each place's routes stand on. */
const PLACE_TAB = {
  [SIDEBAR_PLACE.INBOX]: IOS_TAB.INBOX,
  [SIDEBAR_PLACE.TASKS]: IOS_TAB.TASKS,
  [SIDEBAR_PLACE.SEARCH]: IOS_TAB.SEARCH,
} as const satisfies Record<SidebarPlace, IosTab>;

/** What each place's detail stands for now, such as its picked thread's id, as its split view last drew it. */
const roots = new Map<SidebarPlace, string | undefined>();

/** Each place's stack, as it was last pushed or popped. */
const stacks = new Map<SidebarPlace, PlaceStack>();

const listeners = new Set<() => void>();

/** The last key handed out, so each page pushed is named apart from every other. */
let serial = 0;

/** The place whose detail a view stands in; none outside a three-column split view's detail. */
const DetailPlace = createContext<SidebarPlace | undefined>(undefined);

/** The key of the pushed page a view stands in; none in the detail's root. */
const PageKey = createContext<string | undefined>(undefined);

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

function set(place: SidebarPlace, stack: PlaceStack): void {
  if (stack.pages.length === 0) stacks.delete(place);
  else stacks.set(place, stack);

  for (const listener of listeners) listener();
}

/** A place's stack as it stands; empty before anything is pushed. */
function stackOf(place: SidebarPlace): PlaceStack {
  return stacks.get(place) ?? EMPTY;
}

/**
 * Pushes a page over a place's detail. Note that a stack pushed over another
 * detail than the one standing now starts afresh, because the pages it held
 * belonged to a row no longer picked.
 */
function pushDetail(place: SidebarPlace, page: PushedPage): void {
  const over = roots.get(place);
  const was = stackOf(place);
  const kept = was.over === over ? was.pages : [];
  serial += 1;

  set(place, { over, pages: [...kept, { key: String(serial), page }] });
}

/** Leaves a place's stack with the pages its column's path still names, as Back or a swipe back pops it. */
export function keepDetailPath(place: SidebarPlace, path: readonly string[]): void {
  const was = stackOf(place);
  const kept = new Set(path);

  set(place, { over: was.over, pages: was.pages.filter((held) => kept.has(held.key)) });
}

/** Empties a place's stack, as a row picked in its list replaces the detail it stood over. */
export function clearDetail(place: SidebarPlace): void {
  if (stacks.has(place)) set(place, EMPTY);
}

/** Pops the page `key` names, and every page over it, off a place's stack. */
function popDetail(place: SidebarPlace, key: string): void {
  const was = stackOf(place);
  const at = was.pages.findIndex((held) => held.key === key);

  if (at >= 0) set(place, { over: was.over, pages: was.pages.slice(0, at) });
}

/** Puts a page in the place of the page `key` names, as a new comment gives way to the thread it started. */
function replaceDetail(place: SidebarPlace, key: string, page: PushedPage): void {
  const was = stackOf(place);
  serial += 1;
  const next = String(serial);

  set(place, {
    over: was.over,
    pages: was.pages.map((held) => (held.key === key ? { key: next, page } : held)),
  });
}

/** An agent route's params, as `AgentScreen` reads them. */
type AgentRouteParams = { id: string; suggestedBy?: string; button?: string };

/** A version route's params, as `VersionScreen` reads them. */
type VersionRouteParams = { id: string; seq: string; at?: string; newest?: string };

/** The route a compact window or a portrait iPad pushes for a page, on the tab `tab` names, with the params its screen reads. */
function routeOf(page: PushedPage, tab: IosTab): Href {
  const on = (route: string) => iosRouteOnTab(route, tab);

  switch (page.kind) {
    case PUSHED_PAGE.TASK:
      return { pathname: on("/tasks/[id]"), params: { id: page.taskId } };
    case PUSHED_PAGE.AGENT: {
      const params: AgentRouteParams = { id: page.agentId };

      if (page.suggestedBy !== undefined) params.suggestedBy = page.suggestedBy;

      if (page.button !== undefined) params.button = page.button;

      return { pathname: on("/tasks/agent/[id]"), params };
    }

    case PUSHED_PAGE.PULL_REQUEST:
      return {
        pathname: on("/tasks/agent/[id]/pull/[number]"),
        params: { id: page.agentId, number: String(page.number) },
      };
    case PUSHED_PAGE.AGENT_PAGE:
      return {
        pathname: on("/tasks/agent/[id]/page"),
        params: {
          id: page.agentId,
          page: page.pageId,
          version: String(page.version),
          title: page.title,
        },
      };
    case PUSHED_PAGE.TASK_PAGE:
      return {
        pathname: on("/tasks/page/[id]"),
        params: {
          id: page.pageId,
          task: page.taskId,
          workspace: page.workspaceId ?? "",
          version: String(page.version),
          title: page.title,
        },
      };
    case PUSHED_PAGE.COMMENTS:
      return {
        pathname: on("/tasks/comments/[id]"),
        params: { id: page.threadId, task: page.taskId },
      };
    case PUSHED_PAGE.NEW_COMMENT:
      return {
        pathname: on("/tasks/comments/new"),
        params: { task: page.taskId, from: page.from, to: page.to, quote: page.quote },
      };
    case PUSHED_PAGE.HISTORY:
      return { pathname: on("/tasks/history/[id]"), params: { id: page.taskId } };
    case PUSHED_PAGE.VERSION: {
      const params: VersionRouteParams = { id: page.taskId, seq: String(page.seq) };

      if (page.at !== undefined) params.at = String(page.at);

      if (page.newest !== undefined) params.newest = String(page.newest);

      return { pathname: on("/tasks/version/[id]"), params };
    }
  }
}

/** A place's stack, live as it is pushed and popped. */
export function useDetailStack(place: SidebarPlace): PlaceStack {
  return useSyncExternalStore(subscribe, () => stackOf(place));
}

/**
 * Names what a place's detail stands for as its split view draws it, such
 * as the picked thread's id, so a page is pushed over that detail and goes
 * as another row is picked. Note that it is kept as each draw commits, so a
 * press in the detail right after a pick pushes over the new row.
 */
export function useStackRoot(place: SidebarPlace, root: string | undefined): void {
  useLayoutEffect(() => {
    roots.set(place, root);
  }, [place, root]);
}

/** Stands the views under it in a place's detail, so a page they open is pushed over it there. */
export const DetailPlaceProvider = DetailPlace.Provider;

/** Names the pushed page the views under it stand in, so it can leave or give way to another. */
export const PageKeyProvider = PageKey.Provider;

/**
 * Pushes a page over the detail the calling view stands in, answering
 * whether it did: false outside a three-column split view's detail, where
 * the caller pushes its route as it always has, so a compact window and a
 * portrait iPad stand their pages over the window as before.
 */
export function useDetailPush(): (page: PushedPage) => boolean {
  const place = useContext(DetailPlace);

  return useCallback(
    (page) => {
      if (place === undefined) return false;
      pushDetail(place, page);

      return true;
    },
    [place],
  );
}

/**
 * How the pushed page the calling view stands in leaves its stack, as an
 * archived agent or a restored version goes back, and gives way to another
 * page in its place; none outside a pushed page, where the caller moves its
 * route as it always has.
 */
export function useDetailLeave():
  | { readonly leave: () => void; readonly replace: (page: PushedPage) => void }
  | undefined {
  const place = useContext(DetailPlace);
  const key = useContext(PageKey);

  if (place === undefined || key === undefined) return undefined;

  return {
    leave: () => popDetail(place, key),
    replace: (page) => replaceDetail(place, key, page),
  };
}

/** Whether a tab's route (its segments under the tab's group) is a page the detail's stack stands, as an agent's or a pull request's. */
export function isStackedRoute(segments: readonly string[]): boolean {
  const [first, second] = segments;

  return first === TASKS_SEGMENT && Object.values(STACKED_ROUTE).some((head) => head === second);
}

/**
 * Whether a stacked page's route stands aside for its tab's split view. In a
 * window wide enough for three columns it pushes its page over the detail
 * of its own tab's place and pops itself off the router's stack, so a link,
 * a notification, or a press outside the detail lands where a press in the
 * detail would, as `useHandToSplit` hands a thread or a task to its list.
 * Nothing is handed while `page` is none. Note that the page is pushed once
 * however often the route draws, since the router pops it a few renders
 * after the push.
 */
export function useHandToDetail(page: PushedPage | undefined): boolean {
  const router = useRouter();
  const handing = useThreeColumns();
  const own = useOwnTab();
  const place = placeOfRoute(own) ?? SIDEBAR_PLACE.TASKS;
  const handed = useRef(false);

  useEffect(() => {
    if (!handing || page === undefined || handed.current) return;
    handed.current = true;
    pushDetail(place, page);
    router.dismissTo(placeRoute(place));
  }, [handing, page, place, router]);

  return handing;
}

/** How wide the window stands, which says whether a place's detail stands a stack of its own. */
export type StackLayout = { readonly threeColumns: boolean; readonly regular: boolean };

/**
 * Whether a place's detail stands its own stack in a window this wide:
 * every place's beside the app sidebar, and in a two-column window the
 * places whose root draws a split view (the Inbox and Tasks; Search's
 * results stand alone there).
 */
function standsStack(layout: StackLayout, place: SidebarPlace): boolean {
  return layout.threeColumns || (layout.regular && place !== SIDEBAR_PLACE.SEARCH);
}

/**
 * Keeps the page in front as the window narrows past where its place's
 * detail stands a stack, as Mail keeps the open message across a fold or a
 * rotation: the top page of the place standing is pushed onto its tab's
 * router stack, over the row its list keeps picked, and each place whose
 * stack no longer stands is let go. A turn from landscape to portrait keeps
 * the Inbox's and Tasks' pages in their column, since the two-column split
 * view stands them too. Note that only the top page is pushed, because Back
 * from it then lands on the row it was opened from rather than on each page
 * under it.
 */
export function useStackToRoutes(layout: StackLayout, place: SidebarPlace | undefined): void {
  const router = useRouter();
  const was = useRef(layout);
  const standing = useRef(place);

  // Note that the place is read through a ref the commit writes, so a tab's switch alone narrows nothing.
  useEffect(() => {
    standing.current = place;
  }, [place]);

  useEffect(() => {
    const before = was.current;
    was.current = layout;

    const shown = standing.current;
    const top = shown === undefined ? undefined : stackOf(shown).pages.at(-1);

    const pushes =
      shown !== undefined &&
      top !== undefined &&
      standsStack(before, shown) &&
      !standsStack(layout, shown);

    for (const each of Object.values(SIDEBAR_PLACE)) {
      if (standsStack(before, each) && !standsStack(layout, each)) clearDetail(each);
    }

    if (pushes) router.push(routeOf(top.page, PLACE_TAB[shown]));
  }, [layout.threeColumns, layout.regular, router]);
}
