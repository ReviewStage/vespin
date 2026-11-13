// +native-intent.tsx -- each incoming link routed before expo-router reads it: a vespin.dev link to the tab and item that draw it, one the app leaves to the web out to Safari.

import {
  iosAppRouteOf,
  iosHostConnectCode,
  iosRouteOnTab,
  iosRouteTab,
} from "@repo/features/ios-app-links";
import { readShownLink } from "@repo/features/link-grammar";
import { openURL } from "expo-linking";
import { handHostConnect } from "../host-connect-link.js";

/** Where a launch with nothing to route opens: the Inbox, through the root's own redirect. */
const HOME = "/";

/** A web address, as a universal link or a page handed off from another device arrives; anything else is a route of the app's own. */
const WEB_ADDRESS = /^https?:\/\//iu;

/** A scheme's prefix on a route of the app's own, as the widget and the Live Activity open them (`vespin://tasks/agent/<id>`). */
const SCHEME_PREFIX = /^[a-z][a-z0-9+.-]*:\/\//iu;

/**
 * A route of the app's own named on its own tab, a task's on Tasks' stack
 * and a thread's on the Inbox's, since every tab mounts both and the router
 * would otherwise pick one by name; any other path as it came.
 */
function onOwnTab(path: string): string {
  const route = `/${path.replace(SCHEME_PREFIX, "").replace(/^\/+/u, "")}`;

  return iosRouteTab(route) === undefined ? path : iosRouteOnTab(route, undefined);
}

/**
 * The route for `path`, which is the whole address that opened the app: a
 * vespin.dev link the app draws (`@repo/features/ios-app-links`) to its
 * route; any other web address opened in Safari, and the app left where it
 * was; anything else, such as a `vespin://` route of the app's own, as it
 * came. A thread's, a task's, or an agent's route opens on its own tab. Note that a universal link reaches the app only for a page it draws,
 * but a page another device hands off reaches it for any page of the host,
 * since the association's `activitycontinuation` claims the whole domain,
 * so a page no link names goes to Safari too, never to expo-router, which
 * would draw no screen for it. A machine's pairing link hands its code to
 * Settings › Machines, which opens on it once the app stands signed in
 * (`host-connect-link.ts`), and the app stays where it was. Nothing here may throw, since expo-router
 * reads a throw as the app's failure to launch.
 */
export function redirectSystemPath({
  path,
  initial,
}: {
  readonly path: string;
  readonly initial: boolean;
}): string | null {
  try {
    const code = iosHostConnectCode(path);

    if (code !== undefined) {
      handHostConnect(code);

      return initial ? HOME : null;
    }

    const read = readShownLink(path);

    if (read === undefined && !WEB_ADDRESS.test(path)) return onOwnTab(path);

    const route =
      read !== undefined && "workspace" in read
        ? iosAppRouteOf(read.place, read.workspace)
        : undefined;

    if (route !== undefined) return onOwnTab(route);
    openURL(path).catch((cause: unknown) => console.error("The link did not open.", cause));

    return initial ? HOME : null;
  } catch (error) {
    console.error("The link could not be read.", error);

    return initial ? HOME : null;
  }
}
