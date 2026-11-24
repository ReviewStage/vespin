import { createHmac } from "node:crypto";
import { expect, it } from "@effect/vitest";
import { fakeHttpClientLayer } from "@repo/wire/testing";
import { Effect, Layer, Redacted } from "effect";
import { HostedEnvironment, type HostedEnvironmentValues } from "../environment.js";
import { forgetAnalytics } from "./analytics-erasure.js";

const DISTINCT_ID_KEY = "distinct-id-key";

const ENVIRONMENT: HostedEnvironmentValues = {
  posthogPersonalApiKey: Redacted.make("phx_personal"),
  posthogProjectId: "12345",
  posthogApiHost: undefined,
  posthogProjectApiKey: undefined,
  posthogIngestHost: undefined,
  posthogDistinctIdKey: Redacted.make(DISTINCT_ID_KEY),
  cronSecret: undefined,
  githubWebhookSecret: undefined,
  providerKeyEncryptionKeys: undefined,
  titleAnthropicApiKey: undefined,
  previewApiKeys: {},
};

it.effect(
  "asks PostHog to erase both the account's own id and the hashed id its counts are filed under",
  () => {
    const asked: unknown[] = [];

    const http = fakeHttpClientLayer((_url, init) => {
      asked.push(JSON.parse(String(init.body)));

      return new Response(JSON.stringify({ deletion_errors: [] }), { status: 202 });
    });

    return Effect.gen(function* () {
      yield* forgetAnalytics("user-1");
      expect(asked).toEqual([
        {
          distinct_ids: [
            "user-1",
            createHmac("sha256", DISTINCT_ID_KEY).update("user-1").digest("hex"),
          ],
          delete_events: true,
          delete_recordings: true,
        },
      ]);
    }).pipe(Effect.provide(Layer.merge(http, Layer.succeed(HostedEnvironment, ENVIRONMENT))));
  },
);
