import { lazy } from "react";

/**
 * pages-on-demand.ts -- the window's pages split off the bundle every window parses, each a chunk of its own read the first time it is drawn or hinted at.
 *
 * Settings, Admin, the Board, a person's page, the Automations pages, and a
 * version history are the router's lazy routes (`panel-router.tsx`); a Pull
 * request tab is no place, so it is split here through `React.lazy`
 * instead, and drawn under `@repo/ui`'s `LazyBoundary`, whose fallback is
 * its own frame. Its card hanging reads the same chunk early
 * (`prefetchPullRequestTab`), so the press that follows finds it landed.
 */

/** Whether the Pull request tab's module has landed, so its boundary's Reload knows a failed chunk from a failed draw. */
let pullRequestTabLanded = false;

/** The module an agent's Pull request tab is drawn from, read once whether its draw or its card asks first. */
const loadPullRequestTab = () =>
  import("../tasks/agent-pull-request-tab.js").then((loaded) => {
    pullRequestTabLanded = true;

    return loaded;
  });

/** An agent's Pull request tab in a side panel, its Files changed and its merge box among it (`agent-pull-request-tab.tsx`). */
export const PULL_REQUEST_TAB = lazy(() =>
  loadPullRequestTab().then((loaded) => ({ default: loaded.AgentPullRequestTab })),
);

/** Whether the Pull request tab's module has landed (`LazyBoundary`'s `loaded`). */
/** A turn's Changes tab, in the Pull request tab's chunk. */
export const TURN_CHANGES_TAB = lazy(() =>
  loadPullRequestTab().then((loaded) => ({ default: loaded.TurnChangesPane })),
);

export function pullRequestTabLoaded(): boolean {
  return pullRequestTabLanded;
}

/** Starts reading the Pull request tab's chunk; a failure is left to the tab's own draw to say. */
export function prefetchPullRequestTab(): void {
  loadPullRequestTab().catch(() => undefined);
}
