// tab-drawn.ts -- counts a tab's first switch since launch from the tap that chose it, once a launch, as `tab:drawn`: how long until JavaScript heard the switch, until the tab's first frame, and until its rows' frame, each on a rung, and the tab's kind; never what it shows, and never a time itself.

import {
  PRODUCT_SURFACE_EVENT,
  type ProductSurface,
  productOpenMilliseconds,
} from "@repo/features/analytics";
import Constants from "expo-constants";
import { useIsFocused } from "expo-router";
import { useLayoutEffect, useRef } from "react";
import { AppState } from "react-native";
import { useHostCount } from "./host/host-provider.js";

/** The build number this build was released as (`CFBundleVersion`), which a switch is read beside; none where the build names none. */
const BUILD_NUMBER = Constants.expoConfig?.ios?.buildNumber;

/** How long before the tab heard it came forward the touch that chose it may have ended; one earlier chose nothing here. */
const TAP_WITHIN_MS = 3000;

/** The input entries a tap ends with, as React Native's event timing names them. */
const TAP_ENDS: ReadonlySet<string> = new Set(["touchend", "pointerup", "click"]);

/** The least wait event timing tells of, in milliseconds: the spec's floor, so a switch slow enough to matter is always heard. */
const EVENT_TIMING_FLOOR_MS = 16;

/** When the latest tap ended, on the performance clock, as the touch itself was stamped where it landed; none before one has. */
let lastTapAt: number | undefined;

/** The tabs counted, or let go uncounted, since this launch, each once. */
const settledTabs = new Set<ProductSurface>();

/** The Event Timing spec's own option, the least wait an event's entry is kept for, which TypeScript's DOM lib leaves out. */
interface EventTimingInit extends PerformanceObserverInit {
  readonly durationThreshold?: number;
}

/** The taps watched for: every input entry the floor keeps, from the bundle's start. */
const EVENT_WATCH: EventTimingInit = {
  type: "event",
  buffered: true,
  durationThreshold: EVENT_TIMING_FLOOR_MS,
};

/** A switch being timed: when its tap ended, when JavaScript first rendered the tab in front, and when its first frame drew. */
interface Switching {
  readonly tapAt: number;
  readonly heardAt: number;
  startAt: number | undefined;
}

// Note that taps are heard from the bundle's start, since event timing stamps each touch as it landed, before JavaScript runs anything for it, which is what lets a switch be timed from the finger rather than from when JavaScript heard it.
const tapWatch = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    if (TAP_ENDS.has(entry.name)) lastTapAt = Math.max(lastTapAt ?? 0, entry.startTime);
  }
});

tapWatch.observe(EVENT_WATCH);

/**
 * Counts, once a launch, the first time the tab `surface` comes forward
 * from a tap: from the tap's end to JavaScript's first render of the tab in
 * front (`busy_ms`, the native side's switch before JavaScript heard it), to
 * the frame after that render's commit (`start_ms`, the switch drawn), and
 * to the frame after the commit that first holds `rowsShown` (`stand_ms`,
 * its rows drawn), each on a rung of `productOpenMilliseconds`, as
 * `tab:drawn`. A tab that comes forward with no tap just before it, such as
 * the one a launch opens on, counts nothing, and so does one whose rows
 * stand after the app left the front, since its time would hold a wait
 * nobody sat through.
 */
export function useTabDrawnCount(surface: ProductSurface, rowsShown: boolean): void {
  const count = useHostCount();
  const inFront = useIsFocused();
  // Note that the render's own start is kept, so the commit that first stands the tab in front knows when JavaScript heard the switch.
  const renderedAt = performance.now();
  const switching = useRef<Switching | undefined>(undefined);

  useLayoutEffect(() => {
    if (!inFront || settledTabs.has(surface)) return;
    settledTabs.add(surface);
    const tapAt = lastTapAt;

    if (tapAt === undefined || renderedAt - tapAt > TAP_WITHIN_MS) return;
    const timing: Switching = { tapAt, heardAt: renderedAt, startAt: undefined };
    switching.current = timing;
    requestAnimationFrame(() => {
      timing.startAt = performance.now();
    });
  }, [inFront, surface, renderedAt]);

  useLayoutEffect(() => {
    const timing = switching.current;

    if (timing === undefined || !rowsShown) return;
    switching.current = undefined;
    requestAnimationFrame(() => {
      if (AppState.currentState !== "active") return;
      const standAt = performance.now();

      // Note that where the rows stood in the very commit that switched, the first frame is theirs too.
      count(PRODUCT_SURFACE_EVENT.TAB_DRAWN, {
        surface,
        busy_ms: productOpenMilliseconds(timing.heardAt - timing.tapAt),
        start_ms: productOpenMilliseconds((timing.startAt ?? standAt) - timing.tapAt),
        stand_ms: productOpenMilliseconds(standAt - timing.tapAt),
        ...(BUILD_NUMBER === undefined ? undefined : { app_build: BUILD_NUMBER }),
      });
    });
  }, [count, surface, rowsShown]);
}
