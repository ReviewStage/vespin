// open-link.ts -- a link the app draws opened where it goes: on the app's own screen where it draws one, and in Safari otherwise.

import { iosAppRouteOfAddress, iosHostConnectCode } from "@repo/features/ios-app-links";
import { openURL } from "expo-linking";
import { useRouter } from "expo-router";
import { useTaskListCollections } from "./host/host-provider.js";
import { handHostConnect } from "./host-connect-link.js";
import { useOnTab } from "./tab-route.js";

/** Opens an address in Safari, saying on the console where it could not. */
export function openInSafari(address: string): void {
  openURL(address).catch((cause: unknown) => console.error("The address did not open.", cause));
}

/**
 * Opens an address a link, a chip, or a row names: a vespin.dev place the
 * app draws, or a pull request one of the member's agents opened, on the
 * app's own screen (`@repo/features/ios-app-links`); anything else, a pull
 * request's diff among it, in Safari. A machine's pairing link opens
 * Settings › Machines on its code, which asks before anything is sent.
 */
export function useOpenLink(): (address: string) => void {
  const router = useRouter();
  const onTab = useOnTab();

  const { agentPullRequests } = useTaskListCollections();

  return (address) => {
    const code = iosHostConnectCode(address);

    if (code !== undefined) {
      handHostConnect(code);

      return;
    }

    // Note that the pull requests are read as the link opens, so no screen drawing a link is drawn again as they move.
    const route = iosAppRouteOfAddress(address, agentPullRequests.toArray);

    if (route === undefined) openInSafari(address);
    else router.push(onTab(route));
  };
}
