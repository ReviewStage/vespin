import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync, randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { readPushDeviceStatus, registerPushDevice } from "@repo/database/models/push-device-store";
import { user } from "@repo/database/schemas/auth";
import { getTestDB } from "@repo/database/testing";
import { PUSH_ENVIRONMENT } from "@repo/features/push-device-wire";
import { ConfigProvider, Effect, Layer, Option } from "effect";
import { TestClock } from "effect/testing";
import { recordingApnsTransport } from "../testing/apns-fake.js";
import {
  APNS_DELIVERY,
  APNS_ENVIRONMENT,
  APNS_HOST,
  APNS_PRIORITY,
  APNS_PUSH_TYPE,
  type ApnsAnswer,
  type ApnsNotification,
  type ApnsRequest,
  ApnsSender,
  ApnsTransportFailure,
  apnsSenderFromEnvironment,
} from "./apns.js";

/**
 * The APNs sender against a fake transport: a push is one POST to the
 * gateway the token belongs to, under a provider token Apple can verify
 * against the key, with the headers Apple routes by; the provider token is
 * reused inside Apple's window and signed afresh past it; a token Apple says
 * is gone is deleted and any other refusal or failure leaves it, keeping
 * Apple's reason on the phone's row until a push reaches Apple; and a
 * deployment without its key, or with one that is not a key, sends nothing.
 * The key is made here at run time, never committed. Synthetic accounts,
 * tokens, and words throughout.
 */

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const PRIVATE_KEY_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const CREDENTIALS = {
  [APNS_ENVIRONMENT.KEY_ID]: "KEY1234567",
  [APNS_ENVIRONMENT.TEAM_ID]: "TEAM123456",
  // As a dashboard paste flattens it, which the sender restores.
  [APNS_ENVIRONMENT.PRIVATE_KEY]: PRIVATE_KEY_PEM.replaceAll("\n", "\\n"),
  [APNS_ENVIRONMENT.BUNDLE_ID]: "dev.vespin.ios",
} as const;

/** A device token as Apple spells one, 32 bytes of hex, synthetic. */
const token = () => randomUUID().replaceAll("-", "").repeat(2);

const OK: ApnsAnswer = { status: 200, body: "" };

const refusal = (status: number, reason: string): ApnsAnswer => ({
  status,
  body: JSON.stringify({ reason }),
});

/** The sender built over the variables given and the transport answering as scripted. */
function sender(
  variables: Record<string, string>,
  answer: (request: ApnsRequest) => ApnsAnswer | ApnsTransportFailure = () => OK,
) {
  const transport = recordingApnsTransport(answer);
  const layer = apnsSenderFromEnvironment.pipe(
    Layer.provide(
      Layer.merge(transport.layer, ConfigProvider.layer(ConfigProvider.fromUnknown(variables))),
    ),
  );
  return { layer, transport };
}

function notification(overrides: Partial<ApnsNotification> = {}): ApnsNotification {
  return {
    device: {
      token: token(),
      environment: PUSH_ENVIRONMENT.SANDBOX,
      bundleId: CREDENTIALS[APNS_ENVIRONMENT.BUNDLE_ID],
    },
    pushType: APNS_PUSH_TYPE.ALERT,
    payload: { aps: { alert: { title: "Fix the flaky test", body: "Needs your answer" } } },
    ...overrides,
  };
}

const send = (sent: ApnsNotification) =>
  Effect.gen(function* () {
    const apns = yield* ApnsSender;
    return yield* apns.send(sent);
  });

/** A JWT's segment as the JSON it carries. */
function decodeSegment(segment: string): unknown {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

/**
 * ECDSA signs with a fresh random nonce, so two tokens over the same claims
 * never match byte for byte; what a test can hold a token to is that Apple's
 * side of the key accepts it.
 */
function verifiesUnderPublicKey(jwt: string): boolean {
  const [header, claims, signature] = jwt.split(".");
  if (!header || !claims || !signature) return false;
  return createVerify("SHA256")
    .update(`${header}.${claims}`)
    .verify({ key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"));
}

/** The provider token a request was sent under. */
function providerTokenOf(request: ApnsRequest): string {
  const authorization = request.headers.authorization ?? "";
  assert.ok(authorization.startsWith("bearer "), "sent under a bearer");
  return authorization.slice("bearer ".length);
}

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  return id;
});

it.layer(getTestDB())("the APNs sender", (it) => {
  it.effect(
    "a push is one POST to the token's gateway under a provider token Apple can verify, with the headers Apple routes by",
    () =>
      Effect.gen(function* () {
        const { layer, transport } = sender(CREDENTIALS);
        const alert = notification({ collapseId: "ask:abc" });
        const wake = notification({
          device: { ...alert.device, environment: PUSH_ENVIRONMENT.PRODUCTION },
          pushType: APNS_PUSH_TYPE.BACKGROUND,
          payload: { aps: { "content-available": 1 } },
        });
        const activity = notification({
          pushType: APNS_PUSH_TYPE.LIVE_ACTIVITY,
          priority: APNS_PRIORITY.CONSERVE_POWER,
          expiration: 1_800_000_600,
        });
        const delivered = yield* Effect.all([send(alert), send(wake), send(activity)]).pipe(
          Effect.provide(layer),
        );
        assert.deepEqual(delivered, [
          APNS_DELIVERY.DELIVERED,
          APNS_DELIVERY.DELIVERED,
          APNS_DELIVERY.DELIVERED,
        ]);

        const [first, second, third] = transport.sent;
        assert.ok(first && second && third);
        assert.equal(first.host, APNS_HOST[PUSH_ENVIRONMENT.SANDBOX]);
        assert.equal(first.path, `/3/device/${alert.device.token}`);
        assert.equal(first.body, JSON.stringify(alert.payload));
        const { authorization, ...routing } = first.headers;
        assert.deepEqual(routing, {
          "apns-topic": "dev.vespin.ios",
          "apns-push-type": "alert",
          "apns-priority": "10",
          "apns-expiration": "0",
          "content-type": "application/json",
          "apns-collapse-id": "ask:abc",
        });
        assert.ok(authorization);

        const jwt = providerTokenOf(first);
        const [header, claims] = jwt.split(".");
        assert.ok(header && claims);
        assert.deepEqual(decodeSegment(header), { alg: "ES256", kid: "KEY1234567" });
        assert.deepEqual(decodeSegment(claims), { iss: "TEAM123456", iat: 0 });
        assert.ok(verifiesUnderPublicKey(jwt), "Apple's side of the key accepts it");

        assert.equal(second.host, APNS_HOST[PUSH_ENVIRONMENT.PRODUCTION]);
        assert.equal(second.headers["apns-push-type"], "background");
        assert.equal(second.headers["apns-priority"], "5", "a background push conserves power");
        assert.equal(second.headers["apns-topic"], "dev.vespin.ios");
        assert.equal(second.headers["apns-collapse-id"], undefined);

        assert.equal(third.headers["apns-push-type"], "liveactivity");
        assert.equal(third.headers["apns-topic"], "dev.vespin.ios.push-type.liveactivity");
        assert.equal(third.headers["apns-priority"], "5");
        assert.equal(third.headers["apns-expiration"], "1800000600");
      }),
  );

  it.effect("the provider token is reused inside Apple's window and signed afresh past it", () =>
    Effect.gen(function* () {
      const { layer, transport } = sender(CREDENTIALS);
      yield* Effect.gen(function* () {
        yield* send(notification());
        yield* TestClock.adjust("49 minutes");
        yield* send(notification());
        yield* TestClock.adjust("2 minutes");
        yield* send(notification());
      }).pipe(Effect.provide(layer));

      const tokens = transport.sent.map(providerTokenOf);
      assert.equal(tokens[0], tokens[1], "inside the window the token is the same");
      assert.notEqual(tokens[1], tokens[2], "past it a fresh one is signed");
      const [, claims] = (tokens[2] ?? "").split(".");
      assert.ok(claims);
      assert.deepEqual(decodeSegment(claims), { iss: "TEAM123456", iat: 51 * 60 });
      assert.ok(verifiesUnderPublicKey(tokens[2] ?? ""));
    }),
  );

  it.effect(
    "a token Apple says is gone is deleted, any other refusal or failure leaves it standing with Apple's reason, and a delivery clears the reason",
    () =>
      Effect.gen(function* () {
        const account = yield* openAccount;
        const answers: (ApnsAnswer | ApnsTransportFailure)[] = [
          { status: 410, body: JSON.stringify({ reason: "Unregistered", timestamp: 1 }) },
          refusal(400, "BadDeviceToken"),
          refusal(400, "BadCollapseId"),
          refusal(403, "InvalidProviderToken"),
          refusal(429, "TooManyRequests"),
          { status: 503, body: "" },
          new ApnsTransportFailure({ errorName: "ERR_HTTP2_STREAM_CANCEL" }),
          OK,
        ];
        const { layer } = sender(CREDENTIALS, () => {
          const answer = answers.shift();
          assert.ok(answer, "an answer is scripted");
          return answer;
        });
        const phone = { ...notification().device, environment: PUSH_ENVIRONMENT.PRODUCTION };
        const pushed = (sent: ApnsNotification) =>
          Effect.gen(function* () {
            yield* registerPushDevice(account, phone);
            const delivery = yield* send(sent);
            const standing = yield* readPushDeviceStatus(account, phone);
            return [delivery, Option.getOrUndefined(standing)?.failureReason] as const;
          });

        const outcomes = yield* Effect.forEach(
          answers.map(() => notification({ device: phone })),
          pushed,
        ).pipe(Effect.provide(layer));
        assert.deepEqual(outcomes, [
          [APNS_DELIVERY.TOKEN_GONE, undefined],
          [APNS_DELIVERY.TOKEN_GONE, undefined],
          [APNS_DELIVERY.REFUSED, "BadCollapseId"],
          [APNS_DELIVERY.REFUSED, "InvalidProviderToken"],
          [APNS_DELIVERY.FAILED, "TooManyRequests"],
          [APNS_DELIVERY.FAILED, "503"],
          [APNS_DELIVERY.FAILED, "NoAnswer"],
          [APNS_DELIVERY.DELIVERED, null],
        ]);
      }),
  );

  it.effect(
    "without its key, or with one that is not a key, the sender answers unavailable and sends nothing, and a phone of another app is refused unsent",
    () =>
      Effect.gen(function* () {
        for (const name of Object.values(APNS_ENVIRONMENT)) {
          const { layer, transport } = sender({ ...CREDENTIALS, [name]: " " });
          assert.equal(
            yield* send(notification()).pipe(Effect.provide(layer)),
            APNS_DELIVERY.UNAVAILABLE,
            name,
          );
          assert.deepEqual(transport.sent, []);
        }
        const unreadable = sender({ ...CREDENTIALS, [APNS_ENVIRONMENT.PRIVATE_KEY]: "not a key" });
        assert.equal(
          yield* send(notification()).pipe(Effect.provide(unreadable.layer)),
          APNS_DELIVERY.UNAVAILABLE,
        );
        assert.deepEqual(unreadable.transport.sent, []);

        const { layer, transport } = sender(CREDENTIALS);
        const another = notification();
        assert.equal(
          yield* send({
            ...another,
            device: { ...another.device, bundleId: "dev.vespin.ios.dev" },
          }).pipe(Effect.provide(layer)),
          APNS_DELIVERY.REFUSED,
        );
        assert.deepEqual(transport.sent, []);
      }),
  );
});
