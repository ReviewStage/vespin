// session.e2e.ts -- a fresh member signed in through the local sign-in holds a session the service reads as theirs.

import { expect, test } from "../support/signed-in.js";

/**
 * The regression this catches: the session cookie the local sign-in sets
 * failing to reach the service, or Better Auth failing to read it, so no
 * signed-in journey could run. It reads the session as the web app does
 * (`/api/auth/get-session`), on the browser context's own cookies.
 */
test("a signed-in member's session is read as theirs", async ({ context, signedIn }) => {
  const session = await context.request.get("/api/auth/get-session");

  expect(session.ok()).toBe(true);
  expect(await session.json()).toMatchObject({
    user: { id: signedIn.userId, email: signedIn.email },
  });
});
