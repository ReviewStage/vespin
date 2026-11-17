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

/**
 * An integration's sign-in in the same authentication sheet, over the app
 * rather than in Safari, closed as it lands on `landing`, the service's page
 * a settled sign-in comes back to. The open answers as the sheet closes, as
 * `openAuthSessionAsync` resolves: landed (`success`), closed by the person
 * (`cancel`), or closed by the app (`dismiss`). Each answers opened, because
 * the window hears how the sign-in went from the account's integrations as
 * they move, and a sheet closed early leaves the sign-in to the window's
 * Cancel or to its wait running out, as the panel's row does. A sheet that
 * refuses to open rejects, so the host answers the sign-in not opened.
 */
export async function openSignInSheet(url: string, landing: string): Promise<void> {
  await openAuthSessionAsync(url, landing, {
    preferEphemeralSession: false,
    preferUniversalLinks: true,
  }).catch((cause: unknown) => {
    console.error("The sign-in sheet did not open.", cause);
    throw cause;
  });
}

/**
 * A connection's install in the authentication sheet, answering only once the
 * sheet closes, whether it landed on `landing` or the person closed it, so
 * the screen that opened it reads again what the install changed, such as
 * the repositories GitHub's App was given on an installation that already
 * stood, which no other read moves. A sheet that refuses to open rejects.
 */
export function openSheetUntilClosed(url: string, landing: string): Promise<void> {
  return openAuthSessionAsync(url, landing, {
    preferEphemeralSession: false,
    preferUniversalLinks: true,
  }).then(() => undefined);
}
