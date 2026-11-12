// +native-intent.tsx -- each incoming link routed before expo-router reads it: a vespin.dev link to the tab and item that draw it, one the app leaves to the web out to Safari.

import { iosAppRouteOf } from "@repo/features/ios-app-links";
import { readShownLink } from "@repo/features/link-grammar";
import { openURL } from "expo-linking";

/** Where a launch with nothing to route opens: the Inbox, through the root's own redirect. */
const HOME = "/";

/** A web address, as a universal link or a page handed off from another device arrives; anything else is a route of the app's own. */
const WEB_ADDRESS = /^https?:\/\//iu;

/**
 * The route for `path`, which is the whole address that opened the app: a
 * vespin.dev link the app draws (`@repo/features/ios-app-links`) to its
 * route; any other web address opened in Safari, and the app left where it
 * was; anything else, such as a `vespin://` route of the app's own, as it
 * came. Note that a universal link reaches the app only for a page it draws,
 * but a page another device hands off reaches it for any page of the host,
 * since the association's `activitycontinuation` claims the whole domain,
 * so a page no link names goes to Safari too, never to expo-router, which
 * would draw no screen for it. Nothing here may throw, since expo-router
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
    const read = readShownLink(path);

    if (read === undefined && !WEB_ADDRESS.test(path)) return path;
    const route = read !== undefined && "workspace" in read ? iosAppRouteOf(read.place) : undefined;

    if (route !== undefined) return route;
    openURL(path).catch((cause: unknown) => console.error("The link did not open.", cause));

    return initial ? HOME : null;
  } catch (error) {
    console.error("The link could not be read.", error);

    return initial ? HOME : null;
  }
}
