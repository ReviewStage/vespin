// index.tsx -- the app's root URL, which opens on the Inbox tab, or on the agent a launch names (`-agent <id>`), or on its pull request (`-pullRequest <number>`).

import { iosAgentRoute, iosAppRouteOf, iosPullRequestRoute } from "@repo/features/ios-app-links";
import { LINK_DESTINATION } from "@repo/features/link-grammar";
import { Redirect } from "expo-router";
import { launchAgent, launchPullRequest } from "../host/launch-arguments.js";

/** Where the launch opens: the Inbox, or the agent it names, or that agent's pull request by its number. */
function launchHref(): string {
  const agent = launchAgent();

  if (agent === undefined) return iosAppRouteOf({ kind: LINK_DESTINATION.INBOX });
  const number = launchPullRequest();

  return number === undefined ? iosAgentRoute(agent) : iosPullRequestRoute(agent, number);
}

export default function RootIndex() {
  return <Redirect href={launchHref()} />;
}
