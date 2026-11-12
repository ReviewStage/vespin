// +native-intent.tsx -- each incoming link routed before expo-router reads it: a vespin.dev link to the tab and item that draw it, one the app leaves to the web out to Safari.

import { iosAppRouteOf } from "@repo/features/ios-app-links";
import { readShownLink } from "@repo/features/link-grammar";
import { openURL } from "expo-linking";

/** Where a launch with nothing to route opens: the Inbox, through the root's own redirect. */
const HOME = "/";

/**
 * The route for `path`, which is the whole address that opened the app: a
 * vespin.dev link the app draws (`@repo/features/ios-app-links`) to its
 * route; one it leaves to the web opened in Safari, which the association
 * never hands back, and the app left where it was; anything else, such as a
 * `vespin://` route of the app's own, as it came. Note that nothing here may
 * throw, since expo-router reads a throw as the app's failure to launch.
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

    if (read === undefined) return path;
    const route = "workspace" in read ? iosAppRouteOf(read.place) : undefined;

    if (route !== undefined) return route;
    openURL(path).catch((error: unknown) => console.error("The link did not open.", error));

    return initial ? HOME : null;
  } catch (error) {
    console.error("The link could not be read.", error);

    return initial ? HOME : null;
  }
}
