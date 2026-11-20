// index.tsx -- the app's root URL, which opens on the Inbox tab, or Tasks while the Inbox is off, or on the agent a launch names (`-agent <id>`), or on its pull request (`-pullRequest <number>`), or on the pill field's scratch page (`-pillField true`).

import {
  iosAgentRoute,
  iosAppRouteOf,
  iosPullRequestRoute,
  iosRouteOnTab,
} from "@repo/features/ios-app-links";
import { LINK_DESTINATION } from "@repo/features/link-grammar";
import { Redirect } from "expo-router";
import { launchAgent, launchPillField, launchPullRequest } from "../host/launch-arguments.js";
import { useInboxShown } from "../inbox/inbox-shown.js";

/** The pill field's scratch page, which a flow shoots the field on. */
const PILL_FIELD_ROUTE = "/pill-field";

/**
 * Where the launch opens: the agent it names, or that agent's pull request
 * by its number; else the Inbox, or Tasks while the Inbox is off
 * (`inboxShown`). An agent and its pull request open on Tasks' stack, over
 * the Tasks list.
 */
function launchHref(inboxShown: boolean): string {
  if (launchPillField()) return PILL_FIELD_ROUTE;
  const agent = launchAgent();

  if (agent === undefined) {
    return iosAppRouteOf({ kind: inboxShown ? LINK_DESTINATION.INBOX : LINK_DESTINATION.BOARD });
  }

  const number = launchPullRequest();

  const route = number === undefined ? iosAgentRoute(agent) : iosPullRequestRoute(agent, number);

  return iosRouteOnTab(route, undefined);
}

export default function RootIndex() {
  // Note that the redirect stands the tab's anchored root under the page it opens, as a link's push does, because a redirect is a navigation the stack's anchor alone never fills, so a launch onto an agent or its pull request had no Back.
  return <Redirect href={launchHref(useInboxShown())} withAnchor />;
}
