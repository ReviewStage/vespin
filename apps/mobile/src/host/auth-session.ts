/**
 * auth-session.ts -- the phone's authentication session as the host's consent opens it, and an integration's sign-in: `ASWebAuthenticationSession` through `expo-web-browser`, caught on the app's universal-link callback.
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

/** How long a sign-in sheet is given to fail before it counts as shown: the native session refuses at once where another stands or no window can hold it. */
const SHEET_SHOWN_MS = 500;

/**
 * An integration's sign-in in the same authentication sheet, over the app
 * rather than in Safari, closed as it lands on `landing`, the service's page
 * a settled sign-in comes back to. Note that the open answers as the sheet
 * stands, not as it closes: the window hears how the sign-in went from the
 * account's integrations as they move, and offers Cancel while it waits, as
 * the panel's row does; a sheet the person closes leaves the sign-in to that
 * Cancel or to its wait running out. A sheet that refuses to open at once
 * rejects, so the host answers the sign-in not opened.
 */
export function openSignInSheet(url: string, landing: string): Promise<void> {
  const session = openAuthSessionAsync(url, landing, {
    preferEphemeralSession: false,
    preferUniversalLinks: true,
  });

  session.catch((cause: unknown) => console.error("The sign-in sheet did not open.", cause));

  return Promise.race([
    session.then(() => undefined),
    new Promise<void>((shown) => setTimeout(shown, SHEET_SHOWN_MS)),
  ]);
}
