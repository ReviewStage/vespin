// page-shown.ts -- counts how long a page an agent showed took to read and to draw, once an open, on rungs, as `page:shown`, with where its version came from and whether it was the first page since launch.

import {
  PRODUCT_OPEN_ORDER,
  PRODUCT_PAGE_VERSION,
  PRODUCT_SURFACE_EVENT,
  productOpenMilliseconds,
} from "@repo/features/analytics";
import Constants from "expo-constants";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useHostCount } from "./host/host-provider.js";

/** The build number this build was released as (`CFBundleVersion`), which an open is read beside; none where the build names none. */
const BUILD_NUMBER = Constants.expoConfig?.ios?.buildNumber;

/** Whether a page has been counted shown since this launch, so the first, which starts WebKit cold, is told from the rest. */
let pageShownBefore = false;

/**
 * Counts, once a screen, the time from the page screen's first render, which
 * the press that pushed it starts in the same task, to its HTML in hand and
 * to its web view's first load ending, each on a rung of
 * `productOpenMilliseconds`, as `page:shown` with whether the opener named
 * its version or the screen waited on the task's pages for the newest, and
 * whether it was the first page since launch: never which page, task, or
 * agent, and never a time itself. `read` is told as the HTML lands and
 * `shown` as the page has drawn; a page whose read failed, or that draws
 * after the app left the front, counts nothing, since its time would hold a
 * wait nobody sat through.
 */
export function usePageShownCount(versionNamed: boolean, read: boolean): () => void {
  const count = useHostCount();
  const [renderedAt] = useState(() => performance.now());
  const readAt = useRef<number | undefined>(undefined);
  const counted = useRef(false);

  useEffect(() => {
    if (read) readAt.current ??= performance.now();
  }, [read]);

  return useCallback(() => {
    if (counted.current || readAt.current === undefined) return;
    counted.current = true;

    if (AppState.currentState !== "active") return;
    const order = pageShownBefore ? PRODUCT_OPEN_ORDER.LATER : PRODUCT_OPEN_ORDER.FIRST;
    pageShownBefore = true;

    count(PRODUCT_SURFACE_EVENT.PAGE_SHOWN, {
      read_ms: productOpenMilliseconds(readAt.current - renderedAt),
      shown_ms: productOpenMilliseconds(performance.now() - renderedAt),
      page_version: versionNamed ? PRODUCT_PAGE_VERSION.NAMED : PRODUCT_PAGE_VERSION.NEWEST,
      open_order: order,
      ...(BUILD_NUMBER === undefined ? undefined : { app_build: BUILD_NUMBER }),
    });
  }, [count, renderedAt, versionNamed]);
}
