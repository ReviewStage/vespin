// index.tsx -- the app's root URL, which opens on the Inbox tab, or, in a window wide enough for three columns, on the place its sidebar last picked; or on the agent a launch names (`-agent <id>`), or on its pull request (`-pullRequest <number>`).

import {
  iosAgentRoute,
  iosAppRouteOf,
  iosPullRequestRoute,
  iosRouteOnTab,
} from "@repo/features/ios-app-links";
import { LINK_DESTINATION } from "@repo/features/link-grammar";
import { useThreeColumns } from "@repo/ui-native";
import { Redirect } from "expo-router";
import { launchAgent, launchPullRequest } from "../host/launch-arguments.js";
import { placeOfRoute, placeRoute } from "../screens/app-sidebar.js";
import { keptSidebarPlace } from "../sidebar-pick.js";

/**
 * Where the launch opens: the agent it names, or that agent's pull request
 * by its number; else, where the app sidebar stands, the place it last
 * picked, as Mail opens on the mailbox last read; else the Inbox. An agent
 * and its pull request open on Tasks' stack.
 */
function launchHref(threeColumns: boolean): string {
  const agent = launchAgent();

  if (agent === undefined) {
    const kept = threeColumns ? placeOfRoute(keptSidebarPlace()) : undefined;

    return kept === undefined ? iosAppRouteOf({ kind: LINK_DESTINATION.INBOX }) : placeRoute(kept);
  }

  const number = launchPullRequest();

  const route = number === undefined ? iosAgentRoute(agent) : iosPullRequestRoute(agent, number);

  return iosRouteOnTab(route, undefined);
}

export default function RootIndex() {
  return <Redirect href={launchHref(useThreeColumns())} />;
}
