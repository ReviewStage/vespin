// detail-stack.ts -- the pages each place pushes over its detail inside the detail's own column, in a window wide enough for three columns, as Mail opens a message's related pages beside its list with a Back there.

import { useRouter } from "expo-router";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import { placeRoot } from "./place-columns.js";
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

/** A place's pushed pages, oldest first, and the detail they were pushed over, by its root's key (`PlaceColumns`' `root`). */
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
  const over = placeRoot(place);
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

/** A place's stack, live as it is pushed and popped. */
export function useDetailStack(place: SidebarPlace): PlaceStack {
  return useSyncExternalStore(subscribe, () => stackOf(place));
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
