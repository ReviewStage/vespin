/**
 * android-app-links.ts -- which of the home host's links the Android app claims as verified App Links, the twin of the iPhone's `ios-app-links.ts`.
 *
 * The app declares each pattern in an `autoVerify` intent filter for the
 * home host (`apps/mobile/app.config.ts`), and Android opens a matching
 * link in the app once the host's Digital Asset Links file names it
 * (`@repo/service/auth/android-asset-links`). The paths are the iPhone's
 * (`IOS_APP_LINK_COMPONENTS`), but for the sign-in's return, which is
 * Android's own (`android-sign-in-wire.ts`), and they route to the same
 * screens through the same `iosAppRouteOf`.
 *
 * An intent filter has no exclusion, and an advanced pattern no optional
 * part, so where Apple's list claims a page and then excludes the pages
 * under it, each pattern here names one path segment by `[^/]+` and so
 * stops where the page does, and an agent under its task is a pattern of
 * its own: an agent's or a task's own page is claimed and the web's pages
 * under it are not. Note that
 * `pathAdvancedPattern` is read from Android 12 (API 31) on; an older phone
 * claims none, and opens every link in its browser.
 *
 * It imports nothing, so the app's `app.config.ts` reads it by its source,
 * since Expo's config loader cannot follow this package's `.js` door; its
 * test holds the paths it spells to the wire's own.
 */

/** One path segment, as an advanced pattern names it. */
const SEGMENT = "[^/]+";

/** The paths the home host hands the app, each as an intent filter's `pathAdvancedPattern`. */
export const ANDROID_APP_LINK_PATTERNS: readonly string[] = [
  // The sign-in's return (`ANDROID_OAUTH_CALLBACK_PATH`).
  "/android/oauth/callback",
  // A machine's pairing, which Settings › Machines approves or denies (`HOST_WIRE.CONNECT_PATH`).
  `/connect/${SEGMENT}`,
  // A thread on a task's or an agent's Inbox, the agent under its workspace or its task.
  `/${SEGMENT}/task/${SEGMENT}/inbox/${SEGMENT}`,
  `/${SEGMENT}/agent/${SEGMENT}/inbox/${SEGMENT}`,
  `/${SEGMENT}/task/${SEGMENT}/agent/${SEGMENT}/inbox/${SEGMENT}`,
  // An agent, under its workspace or its task, and a task; not the pages under either.
  `/${SEGMENT}/agent/${SEGMENT}`,
  `/${SEGMENT}/task/${SEGMENT}/agent/${SEGMENT}`,
  `/${SEGMENT}/task/${SEGMENT}`,
  // The task list, the Inbox, and a thread or a task's threads on it.
  `/${SEGMENT}/tasks`,
  `/${SEGMENT}/inbox`,
  `/${SEGMENT}/inbox/.+`,
];
