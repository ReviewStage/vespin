/**
 * merge-queue-route.ts -- the Merge queue page as the router stands it: whether it stands, the pull request its address marks, and the navigation that opens and leaves it.
 *
 * The page is a routed place (`panel-router.tsx`) under the workspace its
 * address names, at `/<workspace>/merge-queue`, read from the address
 * alone; a pull request's Queued opens it with that pull request marked, by
 * its GitHub address in `?pr=`. Opening the page already standing on the
 * same mark moves nothing, as pressing the place standing always has.
 */

import { EXPERIMENT } from "@repo/settings";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useRoutedExits } from "./places/routed-exits.js";
import { ROUTED_PLACE, useWindowPlace } from "./places/routed-places.js";
import { pathUnder, useRouteAccess } from "./route-gates.js";
import { appStateQuery, selectExperiment } from "./use-app-state.js";

/** Whether the account's Merge queue experiment is on, read off its settings. */
const selectMergeQueueOn = selectExperiment(EXPERIMENT.MERGE_QUEUE);

/** The Merge queue page as the router stands it. */
export interface MergeQueueRoute {
  readonly open: boolean;
  /** The address step of the workspace whose page stands, while it does. */
  readonly standingIn: string | undefined;
  /** The GitHub address of the pull request the page was opened for, which its row marks; none where it was opened for none. */
  readonly marked: string | undefined;
  /** Opens the page under the workspace whose address step is `workspace`, marking the pull request at `pullRequest` where one is named. */
  readonly onOpen: (workspace: string, pullRequest?: string) => void;
  readonly onClose: () => void;
  /** Stands the page under `workspace` in the step's place, as another workspace listed under it does. */
  readonly onTurn: (workspace: string) => void;
}

/** Whether the account has the Merge queue experiment on, which every door to the page and its row ask; off while its settings are unread. */
export function useMergeQueueOn(): boolean {
  return useQuery({ ...appStateQuery, select: selectMergeQueueOn }).data === true;
}

/** The Merge queue page as the router stands it, left by the window's routed exit, and kept standing by its stay where a door asks for the page standing. */
export function useMergeQueueRoute(): MergeQueueRoute {
  const router = useRouter();
  const navigate = useNavigate();
  const exits = useRoutedExits();
  const here = useWindowPlace();
  const open = here.place === ROUTED_PLACE.MERGE_QUEUE;
  const standingIn = open ? here.params.workspace : undefined;
  const marked = open ? here.search.pr : undefined;

  const onOpen = (workspace: string, pullRequest?: string) => {
    if (standingIn === workspace && marked === pullRequest) {
      exits.stay();

      return;
    }

    void navigate({
      to: "/$workspace/merge-queue",
      params: { workspace },
      search: pullRequest === undefined ? {} : { pr: pullRequest },
    });
  };

  const onTurn = (workspace: string) => {
    if (standingIn === undefined || standingIn === workspace) return;
    const { pathname } = router.history.location;
    void navigate({ href: pathUnder(pathname, workspace), replace: true });
  };

  return { open, standingIn, marked, onOpen, onClose: () => exits.leave(), onTurn };
}

/**
 * Opens the listed workspace's Merge queue page with the pull request at
 * `pullRequest`, its GitHub address, marked: for a pull request's own place,
 * its Pull request tab's pill, which holds no Tasks tab. None while the
 * experiment is off, no workspace is listed, or no router stands, as in a
 * test of the tab alone.
 */
export function useMergeQueueOpener(): ((pullRequest: string) => void) | undefined {
  const on = useMergeQueueOn();
  const router = useRouter({ warn: false });
  const { listed } = useRouteAccess();

  if (!on || router === undefined || router === null || listed === undefined) return undefined;

  return (pullRequest) =>
    void router.navigate({
      to: "/$workspace/merge-queue",
      params: { workspace: listed },
      search: { pr: pullRequest },
    });
}
