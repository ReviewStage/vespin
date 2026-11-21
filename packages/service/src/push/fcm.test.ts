import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync, randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { readPushDeviceStatus, registerPushDevice } from "@repo/database/models/push-device-store";
import { user } from "@repo/database/schemas/auth";
import { getTestDB } from "@repo/database/testing";
import { PUSH_ENVIRONMENT, PUSH_PROVIDER } from "@repo/features/push-device-wire";
import type { WireValue } from "@repo/wire";
import { jsonResponse, type RecordedRequest, recordingHttpClient } from "@repo/wire/testing";
import { ConfigProvider, Effect, Layer, Option, Predicate } from "effect";
import { TestClock } from "effect/testing";
import {
  FCM_DELIVERY,
  FCM_ENDPOINT,
  FCM_ENVIRONMENT,
  FCM_PRIORITY,
  type FcmNotification,
  FcmSender,
  fcmSenderFromEnvironment,
} from "./fcm.js";

/**
 * The FCM sender against a fake HTTP client: a push exchanges a JWT the
 * service account's key signs, which Google can verify, for an access token,
 * and sends one POST to the project's `messages:send` under it, the phone's
 * token added to the message; the access token is reused inside its hour
 * and exchanged afresh past it; a token Google says is gone is deleted and
 * any other refusal or failure leaves it, keeping Google's reason on the
 * phone's row until a push reaches Google; and a deployment without its
 * service account, or with one that holds no key, sends nothing. The key is
 * made here at run time, never committed. Synthetic accounts, tokens, and
 * words throughout.
 */

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PRIVATE_KEY_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const SERVICE_ACCOUNT = {
  type: "service_account",
  project_id: "vespin-test",
  client_email: "push@vespin-test.iam.gserviceaccount.com",
  private_key: PRIVATE_KEY_PEM,
};

const VARIABLES = { [FCM_ENVIRONMENT.SERVICE_ACCOUNT]: JSON.stringify(SERVICE_ACCOUNT) };

const SEND_URL = `${FCM_ENDPOINT.ORIGIN}/v1/projects/vespin-test/messages:send`;

/** A registration token as FCM spells one, synthetic. */
const token = () => `${randomUUID()}:APA91b${randomUUID().replaceAll("-", "_")}`;

/** What a scripted answer to a send may be: Google's status and error code, or a transport that never answered. */
type SendAnswer = Response | "no answer";

const refusal = (status: number, errorStatus: string, errorCode?: string) =>
  jsonResponse(
    {
      error: {
        code: status,
        message: "Synthetic refusal.",
        status: errorStatus,
        details:
          errorCode === undefined
            ? []
            : [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode }],
      },
    },
    status,
  );

const ACCESS_TOKEN = { access_token: "ya29.synthetic", expires_in: 3599, token_type: "Bearer" };

/** The text a request was sent with, however the client handed it to fetch. */
function sentText(request: RecordedRequest): string {
  const { body } = request.init;

  if (body instanceof Uint8Array) return new TextDecoder().decode(body);

  return Predicate.isString(body) ? body : "";
}

/** The sender built over the variables given, Google's token endpoint answering `exchanged` and its send endpoint each of `answers` in turn. */
function sender(
  variables: Record<string, string>,
  answers: SendAnswer[] = [],
  exchanged: () => Response = () => jsonResponse(ACCESS_TOKEN),
) {
  const google = recordingHttpClient((request) => {
    if (request.url === FCM_ENDPOINT.TOKEN) return exchanged();
    const answer = answers.shift() ?? jsonResponse({ name: "projects/vespin-test/messages/1" });

    if (answer === "no answer") throw new Error("connection reset");

    return answer;
  });

  const layer = fcmSenderFromEnvironment.pipe(
    Layer.provide(
      Layer.merge(google.layer, ConfigProvider.layer(ConfigProvider.fromUnknown(variables))),
    ),
  );

  const sends = () => google.requests.filter((request) => request.url === SEND_URL);
  const exchanges = () => google.requests.filter((request) => request.url === FCM_ENDPOINT.TOKEN);

  return { layer, sends, exchanges };
}

function notification(overrides: Partial<FcmNotification> = {}): FcmNotification {
  return {
    device: { token: token(), environment: PUSH_ENVIRONMENT.PRODUCTION },
    message: {
      data: { kind: "ask", itemId: "item-1" },
      notification: { title: "Fix the flaky test", body: "Needs your answer" },
      android: { priority: FCM_PRIORITY.HIGH, collapse_key: "item-1", ttl: "0s" },
    },
    ...overrides,
  };
}

const send = (sent: FcmNotification) =>
  Effect.gen(function* () {
    const fcm = yield* FcmSender;

    return yield* fcm.send(sent);
  });

/** A JWT's segment as the JSON it carries. */
function decodeSegment(segment: string): WireValue {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

/** Whether Google's side of the key accepts the JWT's signature. */
function verifiesUnderPublicKey(jwt: string): boolean {
  const [header, claims, signature] = jwt.split(".");

  if (!header || !claims || !signature) return false;

  return createVerify("RSA-SHA256")
    .update(`${header}.${claims}`)
    .verify(publicKey, Buffer.from(signature, "base64url"));
}

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });

  return id;
});

it.layer(getTestDB())("the FCM sender", (it) => {
  it.effect(
    "a push exchanges a JWT Google can verify for an access token and sends one POST to the project under it, the phone's token added to the message",
    () =>
      Effect.gen(function* () {
        const { layer, sends, exchanges } = sender(VARIABLES);
        const sent = notification();

        assert.equal(yield* send(sent).pipe(Effect.provide(layer)), FCM_DELIVERY.DELIVERED);

        const [exchange] = exchanges();
        assert.ok(exchange);
        const form = new URLSearchParams(sentText(exchange));
        assert.equal(form.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
        const assertion = form.get("assertion") ?? "";
        const [header, claims] = assertion.split(".");
        assert.ok(header && claims);
        assert.deepEqual(decodeSegment(header), { alg: "RS256", typ: "JWT" });
        assert.deepEqual(decodeSegment(claims), {
          iss: SERVICE_ACCOUNT.client_email,
          scope: "https://www.googleapis.com/auth/firebase.messaging",
          aud: FCM_ENDPOINT.TOKEN,
          iat: 0,
          exp: 3600,
        });
        assert.ok(verifiesUnderPublicKey(assertion), "Google's side of the key accepts it");

        const [message] = sends();
        assert.ok(message);
        assert.equal(message.method, "POST");
        assert.equal(message.authorization, "Bearer ya29.synthetic");
        assert.deepEqual(JSON.parse(sentText(message)), {
          message: { ...sent.message, token: sent.device.token },
        });
      }),
  );

  it.effect("the access token is reused inside its hour and exchanged afresh past it", () =>
    Effect.gen(function* () {
      const { layer, sends, exchanges } = sender(VARIABLES);
      yield* Effect.gen(function* () {
        yield* send(notification());
        yield* TestClock.adjust("49 minutes");
        yield* send(notification());
        yield* TestClock.adjust("2 minutes");
        yield* send(notification());
      }).pipe(Effect.provide(layer));

      assert.equal(sends().length, 3);
      assert.equal(exchanges().length, 2, "one exchange inside the window, a fresh one past it");
      const fresh = exchanges()[1];
      assert.ok(fresh);
      const [, claims] = (new URLSearchParams(sentText(fresh)).get("assertion") ?? "").split(".");
      assert.ok(claims);
      assert.deepEqual(decodeSegment(claims), {
        iss: SERVICE_ACCOUNT.client_email,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: FCM_ENDPOINT.TOKEN,
        iat: 51 * 60,
        exp: 51 * 60 + 3600,
      });
    }),
  );

  it.effect("an access token Google says lives briefly is exchanged afresh before it lapses", () =>
    Effect.gen(function* () {
      const brief = { ...ACCESS_TOKEN, expires_in: 900 };
      const { layer, exchanges } = sender(VARIABLES, [], () => jsonResponse(brief));
      yield* Effect.gen(function* () {
        yield* send(notification());
        yield* TestClock.adjust("4 minutes");
        yield* send(notification());
        yield* TestClock.adjust("2 minutes");
        yield* send(notification());
      }).pipe(Effect.provide(layer));

      assert.equal(exchanges().length, 2, "reused for five minutes, ten before its fifteen end");
    }),
  );

  it.effect(
    "a token Google says is gone is deleted, any other refusal or failure leaves it standing with Google's reason, and a delivery clears the reason",
    () =>
      Effect.gen(function* () {
        const account = yield* openAccount;

        const answers: SendAnswer[] = [
          new Response("Not Found", { status: 404 }),
          refusal(404, "NOT_FOUND", "UNREGISTERED"),
          refusal(400, "INVALID_ARGUMENT", "INVALID_ARGUMENT"),
          refusal(403, "PERMISSION_DENIED", "SENDER_ID_MISMATCH"),
          refusal(429, "RESOURCE_EXHAUSTED", "QUOTA_EXCEEDED"),
          new Response("", { status: 503 }),
          "no answer",
          jsonResponse({ name: "projects/vespin-test/messages/2" }),
        ];

        const outcomesCount = answers.length;
        const { layer } = sender(VARIABLES, answers);

        const phone = {
          token: token(),
          environment: PUSH_ENVIRONMENT.PRODUCTION,
          bundleId: "dev.vespin.android",
          provider: PUSH_PROVIDER.FCM,
        };

        const pushed = Effect.gen(function* () {
          yield* registerPushDevice(account, phone);
          const delivery = yield* send(notification({ device: phone }));
          const standing = yield* readPushDeviceStatus(account, phone);

          return [delivery, Option.getOrUndefined(standing)?.failureReason] as const;
        });

        const outcomes = yield* Effect.forEach(
          Array.from({ length: outcomesCount }),
          () => pushed,
        ).pipe(Effect.provide(layer));

        assert.deepEqual(outcomes, [
          [FCM_DELIVERY.FAILED, "404"],
          [FCM_DELIVERY.TOKEN_GONE, undefined],
          [FCM_DELIVERY.REFUSED, "INVALID_ARGUMENT"],
          [FCM_DELIVERY.REFUSED, "SENDER_ID_MISMATCH"],
          [FCM_DELIVERY.FAILED, "QUOTA_EXCEEDED"],
          [FCM_DELIVERY.FAILED, "503"],
          [FCM_DELIVERY.FAILED, "NoAnswer"],
          [FCM_DELIVERY.DELIVERED, null],
        ]);
      }),
  );

  it.effect(
    "without its service account, or with one that holds no key, or with a key Google refuses, nothing is sent",
    () =>
      Effect.gen(function* () {
        for (const variables of [
          {},
          { [FCM_ENVIRONMENT.SERVICE_ACCOUNT]: " " },
          { [FCM_ENVIRONMENT.SERVICE_ACCOUNT]: "not json" },
          {
            [FCM_ENVIRONMENT.SERVICE_ACCOUNT]: JSON.stringify({
              ...SERVICE_ACCOUNT,
              private_key: "not a key",
            }),
          },
        ]) {
          const { layer, sends, exchanges } = sender(variables);
          assert.equal(
            yield* send(notification()).pipe(Effect.provide(layer)),
            FCM_DELIVERY.UNAVAILABLE,
          );
          assert.deepEqual([...exchanges(), ...sends()], []);
        }

        const revoked = sender(VARIABLES, [], () =>
          jsonResponse({ error: "invalid_grant", error_description: "Invalid JWT." }, 400),
        );

        assert.equal(
          yield* send(notification()).pipe(Effect.provide(revoked.layer)),
          FCM_DELIVERY.REFUSED,
        );
        assert.deepEqual(revoked.sends(), []);
      }),
  );
});
