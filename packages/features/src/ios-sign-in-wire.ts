/**
 * ios-sign-in-wire.ts -- where the iPhone's OAuth sign-in returns: a universal link on the home host, spelled once for the service that registers it and the app that catches it.
 *
 * The iPhone signs in as a public PKCE client (`FIRST_PARTY_OAUTH_CLIENT_ID.IOS`)
 * through `ASWebAuthenticationSession`, whose HTTPS callback catches the
 * authorization's redirect by host and path before any page loads, so long
 * as the host's `apple-app-site-association` names the app
 * (`@repo/service/auth/apple-app-site-association`). The service registers
 * exactly this address on the client's row, and the app names the same one
 * on its authorization and token requests, so the two cannot disagree. It
 * is production's address on every deployment, a Preview's sign-in
 * included, because the app is associated with the home host alone and the
 * session catches the redirect wherever the provider sent it from.
 *
 * A custom URL scheme is not used: any app on the phone may claim one, so a
 * code sent through it could land in another app, where a universal link
 * returns only to the app Apple verified against the host's association.
 */

import { LINK_ORIGIN } from "./link-home.js";

/** The callback's path on the home host, which the association file lets the app catch. */
export const IOS_OAUTH_CALLBACK_PATH = "/ios/oauth/callback";

/** The one redirect the iPhone's client registers, and the one it may send. */
export const IOS_OAUTH_CALLBACK_URL = `${LINK_ORIGIN}${IOS_OAUTH_CALLBACK_PATH}`;
