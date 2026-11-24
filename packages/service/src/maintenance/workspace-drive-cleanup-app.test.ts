/**
 * workspace-drive-cleanup-app.test.ts -- the daily workspace drive cleanup as a call reaches it: one that is not the cron's publishes nothing.
 */

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { noDatabase } from "@repo/database/testing/no-database";
import { memorySandbox } from "@repo/sandbox/testing";
import { noNetwork } from "@repo/wire/testing";
import { Effect, Layer, Redacted } from "effect";
import { HttpRouter } from "effect/http";
import { HostedEnvironment, type HostedEnvironmentValues } from "../environment.js";
import { fixtureGitHubApp, overNoGitHub } from "../testing/github-app-fake.js";
import { WORKSPACE_DRIVE_CLEANUP_PATH } from "./maintenance-bounds.js";
import { workspaceDriveCleanupApp } from "./workspace-drive-cleanup-app.js";

const CRON_SECRET = "cron-secret-1";

function environment(cronSecret: string | undefined): HostedEnvironmentValues {
  return {
    posthogPersonalApiKey: undefined,
    posthogProjectId: undefined,
    posthogApiHost: undefined,
    posthogProjectApiKey: undefined,
    posthogIngestHost: undefined,
    posthogDistinctIdKey: undefined,
    cronSecret: cronSecret === undefined ? undefined : Redacted.make(cronSecret),
    githubWebhookSecret: undefined,
    providerKeyEncryptionKeys: undefined,
    titleAnthropicApiKey: undefined,
    previewApiKeys: {},
  };
}

/**
 * The scheduler's call with `bearer`, answered on a deployment whose cron
 * secret is `cronSecret`. The store is none at all, so a cleanup that ran
 * would fail rather than answer the refusal asked for.
 */
const cleanup = (cronSecret: string | undefined, bearer: string) =>
  Effect.gen(function* () {
    const services = Layer.mergeAll(
      noDatabase,
      noNetwork,
      overNoGitHub(fixtureGitHubApp(undefined)),
      memorySandbox().layer,
      Layer.succeed(HostedEnvironment, environment(cronSecret)),
    );

    const { handler, dispose } = HttpRouter.toWebHandler(
      workspaceDriveCleanupApp().pipe(HttpRouter.provideRequest(services)),
      { disableLogger: true },
    );

    const request = new Request(`https://app.test${WORKSPACE_DRIVE_CLEANUP_PATH}`, {
      headers: { authorization: `Bearer ${bearer}` },
    });

    const response = yield* Effect.promise(() => handler(request));
    yield* Effect.promise(() => dispose());

    return response.status;
  });

it.effect("a call to a deployment without its cron secret publishes nothing", () =>
  Effect.gen(function* () {
    assert.equal(yield* cleanup(undefined, "anything"), 503);
  }),
);

it.effect("a call that is not the cron's publishes nothing", () =>
  Effect.gen(function* () {
    assert.equal(yield* cleanup(CRON_SECRET, "not-the-secret"), 401);
  }),
);
