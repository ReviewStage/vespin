// thread-panel-model.ts -- where an iPad's open thread of a Manager's chat stands as its split view collapses and expands: beside the chat in the inspector while expanded, pushed over the chat as its own page while collapsed.

import { type IosTab, iosRouteOnTab } from "@repo/features/ios-app-links";

/** A Manager chat's thread page, as a tab's stack names it. */
const THREAD_ROUTE = "/tasks/agent/[id]/thread/[root]";

/** The segments of a thread page's address, the agent's id and the root standing in their places. */
const THREAD_ADDRESS = ["tasks", "agent", undefined, "thread", undefined] as const;

/** A thread of a Manager's chat: the Manager's, its root, and the tab its chat stands on, which a page opened from it is pushed on. */
export type PanelThread = {
  readonly agentId: string;
  readonly root: string;
  readonly tab: IosTab | undefined;
};

/** The route that pushes a thread as its own page: its pathname on the chat's tab, and its params. */
export type ThreadPageRoute = {
  readonly pathname: string;
  readonly params: { readonly id: string; readonly root: string };
};

/** The thread standing in the inspector, if any, and whether the split view stands collapsed. */
export type ThreadPanelState = {
  readonly open: PanelThread | undefined;
  readonly collapsed: boolean;
};

/** A step's next state, and the thread page to push over the chat where it hands the thread to one. */
export type ThreadPanelStep = {
  readonly state: ThreadPanelState;
  readonly push: ThreadPageRoute | undefined;
};

/** The page standing in front as the split view expands: its address (`usePathname`'s, no groups) and the tab it stands on. */
export type StandingPage = { readonly pathname: string; readonly tab: IosTab | undefined };

/** A step on from `state` that only expands: its next state, and whether the thread page standing is popped back into the inspector. */
export type ThreadPanelExpand = { readonly state: ThreadPanelState; readonly pop: boolean };

/** The route that pushes `thread` as its own page, on its chat's tab. */
function pageRouteOf(thread: PanelThread): ThreadPageRoute {
  return {
    pathname: iosRouteOnTab(THREAD_ROUTE, thread.tab),
    params: { id: thread.agentId, root: thread.root },
  };
}

/** The thread a page's address names, where it is a thread page; none for any other page. */
function threadOfPage(page: StandingPage): PanelThread | undefined {
  const parts = page.pathname.split("/").filter((part) => part !== "");

  const isThread =
    parts.length === THREAD_ADDRESS.length &&
    THREAD_ADDRESS.every((part, at) => part === undefined || part === parts[at]);

  const [, , agentId, , root] = parts;

  if (!isThread || agentId === undefined || root === undefined) return undefined;

  return {
    agentId: decodeURIComponent(agentId),
    root: decodeURIComponent(root),
    tab: page.tab,
  };
}

/** No thread open, the split view collapsed or not as it starts. */
export function threadPanelStart(collapsed: boolean): ThreadPanelState {
  return { open: undefined, collapsed };
}

/**
 * Opens `thread`: in the inspector while the split view stands expanded,
 * in place of any thread open there; pushed over its chat while it stands
 * collapsed, as a compact window always pushes it.
 */
export function openPanelThread(state: ThreadPanelState, thread: PanelThread): ThreadPanelStep {
  if (state.collapsed) return { state, push: pageRouteOf(thread) };

  return { state: { ...state, open: thread }, push: undefined };
}

/** Closes the inspector's thread, as its toggle in the chat's bar does or as the system hides it. */
export function closePanelThread(state: ThreadPanelState): ThreadPanelState {
  return { ...state, open: undefined };
}

/**
 * The split view collapses: a thread open in the inspector is pushed over
 * its chat as its own page, since a collapsed split view would stand its
 * inspector as a sheet. Its draft goes with it, kept by its Manager and
 * root wherever the thread stands.
 */
export function collapseThreadPanel(state: ThreadPanelState): ThreadPanelStep {
  const push = state.open === undefined ? undefined : pageRouteOf(state.open);

  return { state: { open: undefined, collapsed: true }, push };
}

/**
 * The split view expands: a thread page standing in front, pushed while it
 * stood collapsed, is popped off its chat and its thread stands in the
 * inspector beside it, its draft with it; any other page stays.
 */
export function expandThreadPanel(
  state: ThreadPanelState,
  standing: StandingPage,
): ThreadPanelExpand {
  const thread = threadOfPage(standing);

  if (thread === undefined) return { state: { ...state, collapsed: false }, pop: false };

  return { state: { open: thread, collapsed: false }, pop: true };
}
