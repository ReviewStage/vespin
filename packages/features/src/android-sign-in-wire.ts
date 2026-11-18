/**
 * android-sign-in-wire.ts -- where the Android phone's OAuth sign-in returns: an App Link on the home host, spelled once for the service that registers it and the app that catches it.
 *
 * The Android phone signs in as a public PKCE client
 * (`FIRST_PARTY_OAUTH_CLIENT_ID.ANDROID`) in a Custom Tab, whose return is
 * an HTTPS App Link the app claims with `autoVerify`, so Android opens it in
 * the app only where the host's Digital Asset Links file names the app's
 * package and signing certificate (`@repo/service/auth/android-asset-links`).
 * The service registers exactly this address on the client's row, and the
 * app names the same one on its authorization and token requests, so the two
 * cannot disagree. It is production's address on every deployment, as the
 * iPhone's is (`ios-sign-in-wire.ts`), because the app is verified against
 * the home host alone.
 *
 * A custom URL scheme is not used: any app on the phone may claim one, so a
 * code sent through it could land in another app, where a verified App Link
 * returns only to the app whose certificate the host names.
 */

import { LINK_ORIGIN } from "./link-home.js";

/** The callback's path on the home host, which the app's verified App Link catches. */
export const ANDROID_OAUTH_CALLBACK_PATH = "/android/oauth/callback";

/** The one redirect the Android phone's client registers, and the one it may send. */
export const ANDROID_OAUTH_CALLBACK_URL = `${LINK_ORIGIN}${ANDROID_OAUTH_CALLBACK_PATH}`;
