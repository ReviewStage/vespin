/**
 * use-system-activity.ts -- the app tied into the system as native apps are: the screen standing advertised for Handoff, the member's tasks and Inbox threads held in Spotlight, and a continued activity or a tapped item opened on its screen.
 *
 * Each thread, task, agent, and pull request screen advertises its activity
 * while it is the one in front (`useScreenActivity`), named by its vespin.dev
 * page (`@repo/features/ios-system-activity`), so the member's Mac or another
 * iPhone or iPad picks it up. While an account is signed in, the chosen
 * workspace's tasks and threads stand in the app's Spotlight index, each
 * change to the lists sent alone and the whole index made anew once a launch
 * so nothing a closed app missed stays; a sign-out empties it, and choosing
 * another workspace lets the last one's items go. What the system hands back,
 * an activity another device handed over or an item tapped in Spotlight,
 * opens through the same routing a link takes, once an account is signed in,
 * and a link the app draws no screen for opens in Safari.
 */

import {
  type ContinuedActivity,
  type IosActivity,
  iosContinuedRouteOf,
  type SpotlightItem,
  spotlightChanges,
  spotlightItems,
} from "@repo/features/ios-system-activity";
import type { Workspace } from "@repo/features/workspace-wire";
import {
  selectInboxGroupsIn,
  selectInboxReader,
  selectTasks,
  selectWorkspaces,
} from "@repo/host/app-state-reads";
import { useQuery } from "@tanstack/react-query";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { openInSafari } from "../open-link.js";
import { useTasksWorkspace } from "../tasks/use-tasks.js";
import { systemActivityModule } from "./system-activity-module.js";

/** Nothing read or waiting yet. */
const NONE: readonly never[] = [];

/** Says on the console what the system did not take; the next change tries again. */
function refused(what: string): (error: unknown) => void {
  return (error) => console.error(`${what} did not reach the system.`, error);
}

/**
 * Advertises the activity `of` builds over the account's workspaces for
 * Handoff while its screen is the one in front, and takes it back as the
 * screen goes or another stands over it; nothing while `of` builds none, as
 * before the screen has read what it shows.
 */
export function useScreenActivity(
  of: (workspaces: readonly Workspace[]) => IosActivity | undefined,
): void {
  const { data: workspaces = NONE } = useQuery({ ...appStateQuery, select: selectWorkspaces });
  const activity = of(workspaces);
  const title = activity?.title;
  const webpageUrl = activity?.webpageUrl;
  const pullRequest = activity?.pullRequest;
  useFocusEffect(
    useCallback(() => {
      const module = systemActivityModule;

      if (module === null || title === undefined || webpageUrl === undefined) return undefined;
      module
        .setCurrent({ title, webpageUrl, ...(pullRequest !== undefined && { pullRequest }) })
        .catch(refused("The screen's activity"));

      // Note that the activity is taken back by its page, so a screen going after the next one stood never takes back the next one's.
      return () => {
        module.clearCurrent(webpageUrl).catch(refused("The screen's activity"));
      };
    }, [title, webpageUrl, pullRequest]),
  );
}

/** The chosen workspace's tasks and Inbox threads as Spotlight finds them; none before the workspace is read. */
function useSpotlightItems(): readonly SpotlightItem[] {
  const workspace = useTasksWorkspace();
  const { data: view } = useQuery({ ...appStateQuery, select: selectTasks });
  const tasks = view?.tasks ?? NONE;

  const { data: groups = NONE } = useQuery({
    ...appStateQuery,
    select: selectInboxGroupsIn(workspace?.id),
  });

  const { data: readerId } = useQuery({ ...appStateQuery, select: selectInboxReader });

  return useMemo(() => {
    if (workspace === undefined) return NONE;
    const threads = groups.flatMap(({ holder, items }) => items.map((item) => ({ holder, item })));

    return spotlightItems({ workspace, tasks, threads, readerId });
  }, [workspace, tasks, groups, readerId]);
}

/** Holds the app's Spotlight index to the chosen workspace's lists while an account is signed in, and empties it once none is. */
function useSpotlightIndex(signedIn: boolean): void {
  const items = useSpotlightItems();
  // What the index holds as far as this launch knows: none until it is first made anew, and null once emptied for no account.
  const indexed = useRef<Map<string, SpotlightItem> | null | undefined>(undefined);
  // Note that each change waits on the last, so an item removed is never added back by a change sent before it.
  const sent = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    const module = systemActivityModule;

    if (module === null) return;

    const send = (change: () => Promise<void>) => {
      sent.current = sent.current.then(change).catch(refused("The Spotlight index"));
    };

    // Note that a launch with no account empties the index too, since one signed out while the app was closed left its items.
    if (!signedIn) {
      if (indexed.current === null) return;
      indexed.current = null;
      send(() => module.removeAll());

      return;
    }

    const held = indexed.current;
    indexed.current = new Map(items.map((item) => [item.id, item]));

    if (held === undefined || held === null) {
      send(() => module.removeAll().then(() => module.index(items)));

      return;
    }

    const { index, remove } = spotlightChanges(held, items);

    if (remove.length > 0) send(() => module.remove(remove));

    if (index.length > 0) send(() => module.index(index));
  }, [signedIn, items]);
}

/** Opens each continued activity or tapped item on its screen once an account is signed in, or in Safari where the app draws none. */
function useContinuedActivities(signedIn: boolean): void {
  const router = useRouter();
  const [waiting, setWaiting] = useState<readonly ContinuedActivity[]>(NONE);
  useEffect(() => {
    if (systemActivityModule === null) return undefined;

    const subscription = systemActivityModule.addListener("onContinue", (continued) =>
      setWaiting((held) => [...held, continued]),
    );

    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (!signedIn || waiting.length === 0) return;
    // Note that the waiting are let go first, so a later render never opens one twice.
    setWaiting(NONE);

    for (const continued of waiting) {
      const route = iosContinuedRouteOf(continued);

      if (route !== undefined) router.push(route);
      else if (continued.link.startsWith("https://")) openInSafari(continued.link);
    }
  }, [signedIn, waiting, router]);
}

/** Spotlight held to the member's lists and what the system hands back opened, for as long as the app stands. */
export function useSystemActivity(signedIn: boolean): void {
  useSpotlightIndex(signedIn);
  useContinuedActivities(signedIn);
}
