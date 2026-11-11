import { it } from "@effect/vitest";
import { recordingHttpClient } from "@repo/wire/testing";
import { Effect } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { expect } from "vitest";
import {
  CLIENT_PLATFORM,
  clientNamedOnService,
  HOSTED_API_VERSION,
  presentedClient,
} from "./client-identity.js";

it.effect(
  "a named client sends its platform, version, and API version to the service's origin and nothing to another, and the service reads them back",
  () =>
    Effect.gen(function* () {
      const recording = recordingHttpClient(() => new Response("{}"));
      const http = yield* Effect.provide(HttpClient.HttpClient, recording.layer);
      const named = clientNamedOnService(
        http,
        { platform: CLIENT_PLATFORM.IOS, version: "0.1.0" },
        "https://app.test/",
      );
      yield* named.execute(HttpClientRequest.get("https://app.test/api/account/access"));
      yield* named.execute(HttpClientRequest.get("https://api.github.com/user"));
      const [service, other] = recording.requests;
      expect(presentedClient(service?.headers ?? new Headers())).toEqual({
        platform: CLIENT_PLATFORM.IOS,
        version: "0.1.0",
        apiVersion: HOSTED_API_VERSION,
      });
      expect(presentedClient(other?.headers ?? new Headers())).toBeUndefined();
      expect(
        presentedClient(
          new Headers({ "vespin-client": `ios/${"9".repeat(65)}`, "vespin-api-version": "1" }),
        ),
      ).toBeUndefined();
    }),
);
