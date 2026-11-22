// open-link.ts -- a link the app draws opened where it goes: on the app's own screen where it draws one, and in Safari otherwise.

import { iosAppRouteOfAddress, iosHostConnectCode } from "@repo/features/ios-app-links";
import { openURL } from "expo-linking";
import { useRouter } from "expo-router";
import { handHostConnect } from "./host-connect-link.js";
import { useOnTab } from "./tab-route.js";

/**
 * Where a link to one of the app's own screens opens: pushed over the screen
 * it was pressed on, or, from a page inside a sheet over the tabs (Settings),
 * on the tabs under the sheet, closing it. Note that a push from inside a
 * sheet pushes the tabs anew over it, which an iPhone draws inside the sheet.
 */
export const LINK_OPENS = {
  OVER: "over",
  OUT_OF_SHEET: "out-of-sheet",
} as const;

export type LinkOpens = (typeof LINK_OPENS)[keyof typeof LINK_OPENS];

/** Opens an address in Safari, saying on the console where it could not. */
export function openInSafari(address: string): void {
  openURL(address).catch((cause: unknown) => console.error("The address did not open.", cause));
}

/**
 * Opens an address a link, a chip, or a row names: a vespin.dev place the
 * app draws, or, where the link stands in a workspace, a pull request on
 * GitHub, on the app's own screen by its repository and number, whoever
 * opened it (`@repo/features/ios-app-links`); anything else, a pull
 * request's diff and one named where no workspace is at hand among it, in
 * Safari. A machine's pairing link opens Settings › Machines on its code,
 * which asks before anything is sent. A screen opens where `opens` says.
 */
export function useOpenLink(
  workspaceId?: string | undefined,
  opens: LinkOpens = LINK_OPENS.OVER,
): (address: string) => void {
  const router = useRouter();
  const onTab = useOnTab();

  return (address) => {
    const code = iosHostConnectCode(address);

    if (code !== undefined) {
      handHostConnect(code);

      return;
    }

    const route = iosAppRouteOfAddress(address, workspaceId);

    if (route === undefined) openInSafari(address);
    else if (opens === LINK_OPENS.OUT_OF_SHEET) router.dismissTo(onTab(route));
    else router.push(onTab(route));
  };
}
