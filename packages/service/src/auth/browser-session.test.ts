import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import {
  readAccountAccess,
  readAccountCreatedAt,
  readAccountPreferences,
  writeAccountPreferences,
} from "@repo/database/models/account-store";
import { user } from "@repo/database/schemas/auth";
import { getTestDB } from "@repo/database/testing";
import { HTTP_METHOD } from "@repo/wire";
import { noNetwork } from "@repo/wire/testing";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { Clock, Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/sql";
import { afterEach, beforeEach, vi } from "vitest";
import { accountProcedures } from "../accounts/account-procedures.js";
import { accountFastOffer } from "../agents/coder-host/agent-runtime-choice.js";
import { HostedEnvironment, type HostedEnvironmentValues } from "../environment.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { modelCatalogOf } from "../providers/model-catalog.js";
import { hostedAnswer } from "../testing/hosted-route.js";
import { CONNECTOR_ASKED_NOTHING, integrationConnectOf } from "../testing/integration-connect.js";
import { SESSION_COOKIE_CACHE } from "./auth-policy.js";
import { requestUserId } from "./bearer.js";
import { browserSessionUserId } from "./browser-session.js";
import { answeredWithSessionCookies, SESSION_COOKIE_FRESH_MS } from "./session-cookies.js";

/**
 * A browser's session read in process answers the browser as Better Auth's
 * own `/get-session` would: a hosted answer carries the cookies Better Auth
 * set as it read the session, its cookie cache and, once a day, the session
 * cookie it extended, and is then never kept by a shared cache. Better Auth
 * stands configured with the deployment's cookie cache over an in-memory
 * store, its clock set; the route is the account's access, over the test's
 * database. A read with nowhere to hand cookies leaves the extension for a
 * read that can, and an answer that leaves late carries no cookie at all.
 * Synthetic accounts throughout.
 */

const ORIGIN = "https://app.test";
const NOW = new Date("2026-11-26T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60_000;

/** When a session last extended two days ago runs out: five days on. */
const DUE_EXPIRY = NOW.getTime() + 5 * DAY_MS;

/** The lifetime Better Auth gives a session, and so its cookie, when it mints or extends one: seven days. */
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

const NO_ENVIRONMENT: HostedEnvironmentValues = {
  posthogPersonalApiKey: undefined,
  posthogProjectId: undefined,
  posthogApiHost: undefined,
  posthogProjectApiKey: undefined,
  posthogIngestHost: undefined,
  posthogDistinctIdKey: undefined,
  cronSecret: undefined,
  githubWebhookSecret: undefined,
  providerKeyEncryptionKeys: undefined,
  titleAnthropicApiKey: undefined,
  previewApiKeys: {},
};

/** What the test reaches into of a session the store holds: when it runs out. */
interface StoredSession {
  expiresAt: Date;
}

/** A Better Auth with the deployment's cookie cache, over a store the test reaches into. */
function sessionAuth() {
  const sessions: StoredSession[] = [];

  const store = {
    user: [],
    session: sessions,
    account: [],
    verification: [],
  };

  const auth = betterAuth({
    baseURL: ORIGIN,
    secret: "browser-session-test-secret-of-enough-length",
    database: memoryAdapter(store),
    emailAndPassword: { enabled: true },
    session: SESSION_COOKIE_CACHE,
  });

  return { auth, store };
}

/** The session cookie alone, as a browser whose cookie cache has run out sends it. */
function sessionCookieOf(setCookies: readonly string[]): string {
  const sessionCookie = setCookies.find((cookie) => cookie.includes("session_token="));
  assert.ok(sessionCookie, "signing up set a session cookie");

  return sessionCookie.split(";")[0] ?? "";
}

/** A member signed up in Better Auth and in the test's database, whose session is due its daily extension, and the session cookie alone a browser sends. */
const signedUpDueExtension = () =>
  Effect.gen(function* () {
    const { auth, store } = sessionAuth();
    const email = `member-${randomUUID()}@app.test`;

    const signedUp = yield* Effect.promise(() =>
      auth.api.signUpEmail({
        body: { name: "Test User", email, password: "a-long-test-password" },
        returnHeaders: true,
      }),
    );

    const userId = signedUp.response.user.id;
    yield* (yield* Database).insert(user).values({ id: userId, name: "Test User", email });

    // The session was last extended two days ago, past the day Better Auth waits before extending it again.
    const [session] = store.session;
    assert.ok(session, "signing up stored a session");
    session.expiresAt = new Date(DUE_EXPIRY);

    return { auth, session, userId, cookie: sessionCookieOf(signedUp.headers.getSetCookie()) };
  });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

it.layer(getTestDB())("a browser's session read", (it) => {
  it.effect(
    "hands the hosted answer the session cookie Better Auth extended, and keeps it from shared caches",
    () =>
      Effect.gen(function* () {
        const { auth, cookie } = yield* signedUpDueExtension();

        const procedures = accountProcedures({
          resolveUserId: (incoming) =>
            requestUserId(
              incoming,
              () => Effect.die("a browser's request names no bearer"),
              browserSessionUserId(auth.api),
            ),
          readPreferences: readAccountPreferences,
          readCreatedAt: readAccountCreatedAt,
          readAccess: readAccountAccess,
          accountFastOffer,
          writePreferences: writeAccountPreferences,
        });

        const services = Layer.mergeAll(
          Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
          Layer.succeed(Database, yield* Database),
          Layer.succeed(Clock.Clock, yield* Clock.Clock),
          Layer.succeed(HostedEnvironment, NO_ENVIRONMENT),
          noNetwork,
          modelCatalogOf([]),
          integrationConnectOf(() => CONNECTOR_ASKED_NOTHING),
        );

        const request = new Request(new URL("/api/account/access", ORIGIN), {
          method: HTTP_METHOD.GET,
          headers: { cookie },
        });

        const response = yield* hostedAnswer({ account: procedures }, services, request);
        const setCookies = response.headers.getSetCookie();
        const extended = setCookies.find((cookie) => cookie.includes("session_token="));

        assert.equal(response.status, HOSTED_HTTP_STATUS.OK);
        assert.ok(
          extended?.includes(`Max-Age=${SESSION_MAX_AGE_SECONDS}`),
          "the extended session cookie",
        );
        assert.ok(
          setCookies.some((cookie) => cookie.includes("session_data=")),
          "the cookie cache",
        );
        assert.equal(response.headers.get("cache-control"), "private, no-store");
      }),
  );

  it.effect(
    "with nowhere to hand its cookies, as a held read, a relay, or a plain route, extends nothing",
    () =>
      Effect.gen(function* () {
        const { auth, session, userId, cookie } = yield* signedUpDueExtension();

        const resolved = yield* browserSessionUserId(auth.api)({
          headers: new Headers({ cookie }),
        });

        assert.deepEqual(resolved, Option.some(userId));
        assert.equal(session.expiresAt.getTime(), DUE_EXPIRY, "the session is not extended");
      }),
  );

  it.effect("a late answer carries none of the cookies, so it overwrites no later sign-in", () =>
    Effect.sync(() => {
      const kept = ["better-auth.session_token=stale; Path=/; Max-Age=604800"];

      const late = answeredWithSessionCookies(
        new Response(null),
        kept,
        SESSION_COOKIE_FRESH_MS + 1,
      );

      assert.deepEqual(late.headers.getSetCookie(), []);
    }),
  );
});
