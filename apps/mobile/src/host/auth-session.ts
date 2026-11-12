/**
 * auth-session.ts -- the phone's authentication session as the host's consent opens it: `ASWebAuthenticationSession` through `expo-web-browser`, caught on the app's universal-link callback.
 *
 * `@repo/credentials`' `authSessionConsent` words the trip and reads the
 * address the sheet caught; this only shows the page and hands that address
 * back. The callback is an HTTPS address on the home host
 * (`IOS_OAUTH_CALLBACK_URL`), which iOS 17.4 and later catch by host and
 * path for an app whose associated domains name the host (`app.config.ts`'s
 * `webcredentials:` and `applinks:`), so `preferUniversalLinks` is asked for.
 * The session shares Safari's cookies rather than an ephemeral one, so a
 * person already signed in to Google or GitHub there is not asked again.
 */

import { AUTH_SESSION_END, type AuthSession } from "@repo/credentials";
import { dismissAuthSession, openAuthSessionAsync } from "expo-web-browser";

export const webAuthSession: AuthSession = {
  open: async (url, callbackUrl) => {
    const result = await openAuthSessionAsync(url, callbackUrl, {
      preferEphemeralSession: false,
      preferUniversalLinks: true,
    });

    return result.type === "success"
      ? { end: AUTH_SESSION_END.REDIRECTED, url: result.url }
      : { end: AUTH_SESSION_END.CLOSED };
  },
  dismiss: () => {
    dismissAuthSession();
  },
};
