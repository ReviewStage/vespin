// launch-phases.ts -- what a launch found of the lists kept on the phone, and how long its host took to stand, noted as the host starts and stands, for `app:ready` to count beside its own time.

import { PRODUCT_KEPT_STORE, type ProductKeptStore } from "@repo/features/analytics";
import { ENTITY_STORE_FILE_NAME } from "@repo/host";
import { File } from "expo-file-system";
import { hostStateRoot } from "./host/device-seams.js";

/** React Native's own startup marks, which its `performance` holds beside the web's and its types leave out. */
interface StartupPerformance {
  readonly rnStartupTiming?: { readonly startTime?: number | null };
}

/** Whether the lists' file stood in the host's folder as this launch's host started; none before it starts. */
let keptBefore: boolean | undefined;

/** What this launch's host found of the kept lists once it stood, and how long after the launch's start it stood; none before it stands. */
let stood: { readonly keptStore: ProductKeptStore; readonly ms: number | undefined } | undefined;

/** Whether the host's kept lists (`entities.sealed`) stand in its folder now; no where the file can't be read for any reason. */
function keptFileStands(): boolean {
  try {
    return new File(`file://${hostStateRoot()}`, ENTITY_STORE_FILE_NAME).exists;
  } catch {
    return false;
  }
}

/**
 * The time since React Native's own start of this launch, in milliseconds, or
 * none where the runtime keeps no start. Note that the start is
 * `APP_STARTUP_START`, which React Native marks just before Hermes runs the
 * bundle, so the native launch before it isn't in the time.
 */
export function sinceLaunch(): number | undefined {
  // Note that React Native's startup timing is read inside a guard, since a runtime that keeps none throws on the read.
  try {
    // SAFETY: React Native's `performance` holds `rnStartupTiming` (react-native/src/private/webapis/performance/Performance.js); every member is read as optional.
    const start = (performance as Performance & StartupPerformance).rnStartupTiming?.startTime;

    return start === null || start === undefined ? undefined : performance.now() - start;
  } catch {
    return undefined;
  }
}

/** Notes, as the host starts, whether the kept lists' file stands, which the host deletes as it opens where the build no longer reads its rows. */
export function noteHostStarting(): void {
  keptBefore = keptFileStands();
  stood = undefined;
}

/**
 * Notes, once the host stood, how long it took and what it found of the kept
 * lists: kept where the file stood before and still does, since the host
 * opens it before it stands; dropped where the host deleted it as it opened;
 * none where there was no file to open.
 */
export function noteHostStood(): void {
  const after = keptFileStands();

  const keptStore =
    keptBefore !== true
      ? PRODUCT_KEPT_STORE.NONE
      : after
        ? PRODUCT_KEPT_STORE.KEPT
        : PRODUCT_KEPT_STORE.DROPPED;

  stood = { keptStore, ms: sinceLaunch() };
}

/** What this launch's host found and how long it took to stand, once it stood; none before. */
export function launchStood(): typeof stood {
  return stood;
}
