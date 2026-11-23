// session.e2e.ts -- a fresh member signed in through the local sign-in holds a session the service reads as theirs, and is offered the suite's fake models.

import { FAKE_GATEWAY_CATALOG } from "@repo/service/testing/model-catalog-fake";
import { expect, test } from "../support/signed-in.js";

/**
 * The regressions this catches: the session cookie the local sign-in sets
 * failing to reach the service, or Better Auth failing to read it, so no
 * signed-in journey could run; and the suite's fake model catalog failing
 * to reach the service's runtime, so `/api/models` reads AI Gateway itself,
 * which the no-network guard refuses, and answers unavailable, so no
 * journey could start an agent. It reads both as the web app does
 * (`/api/auth/get-session`, `/api/models`), on the browser context's own
 * cookies.
 */
test("a signed-in member's session is read as theirs", async ({ context, signedIn }) => {
  const session = await context.request.get("/api/auth/get-session");

  expect(session.ok()).toBe(true);
  expect(await session.json()).toMatchObject({
    user: { id: signedIn.userId, email: signedIn.email },
  });

  const models = await context.request.get("/api/models");

  expect(models.ok(), await models.text()).toBe(true);
  expect(await models.json()).toMatchObject({
    models: FAKE_GATEWAY_CATALOG.data.map(({ id }) => expect.objectContaining({ id })),
  });
});
