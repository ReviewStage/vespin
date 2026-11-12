/**
 * link-landings.ts -- the link place a page loaded at its address, or landed on by the browser, opens, as a link to it opens (`link-places.ts`).
 */

import type { ReadLink } from "@repo/features/link-grammar";
import { type HistoryLocation, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { landedLinkOf } from "./link-places.js";
import { savesStep } from "./window-steps.js";

/**
 * Opens the link place the router's history lands on, through `open`, as a
 * link to it opens: a page loaded at its address, or the browser landing on
 * an entry holding no step the window saved, once each. An entry holding a
 * step opens nothing, since going to it stands what it saved.
 */
export function useLinkDestinationLandings(open: (link: ReadLink) => void): void {
  const router = useRouter();
  const { history } = router;
  const location = useSyncExternalStore(history.subscribe, () => history.location);
  const landed = useRef<HistoryLocation | undefined>(undefined);
  useEffect(() => {
    if (landed.current === location || savesStep(location)) return;
    landed.current = location;
    const routed = landedLinkOf(router, location);

    if (routed !== undefined) open(routed.link);
  }, [router, location, open]);
}
