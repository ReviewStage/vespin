/**
 * apns.ts -- one push to a phone through Apple's Push Notification service, under the deployment's APNs key.
 *
 * The sender is the one door to a phone: the tasks that decide when to push
 * (an Inbox ask, a post, a failed run) compose a notification and hand it
 * here, and this module addresses it, signs for it, and reads Apple's
 * answer. A notification names the phone (`PushDeviceAddress`, a row of
 * `push_device`), its push type (`APNS_PUSH_TYPE`: an alert the phone
 * shows, a background wake, or a Live Activity update), the JSON Apple
 * delivers, composed whole by the caller as Apple documents it, and the
 * routing Apple reads off the headers: a collapse id that replaces an
 * earlier notification still on the lock screen, a priority
 * (`APNS_PRIORITY`), and when Apple stops trying to deliver
 * (`APNS_EXPIRATION`).
 *
 * The request is one HTTP/2 POST to `/3/device/<token>` on the gateway the
 * token belongs to (`APNS_HOST`, by the phone's `environment`), under a
 * provider token: an ES256 JWT signed with the deployment's `.p8` key, its
 * key id in the header and the team id and issue time in the claims
 * (https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns).
 * Apple refuses a token older than an hour and throttles one refreshed more
 * often than every twenty minutes, so one is reused for fifty minutes
 * (`APNS_PROVIDER_TOKEN_LIFETIME`). The topic is the deployment's app
 * (`APNS_BUNDLE_ID`), with Apple's suffix for a Live Activity; a phone
 * registered under another app is not pushed, since Apple would refuse the
 * topic for its token, and is answered as refused without a send.
 *
 * What Apple answers is one of `APNS_DELIVERY`. A token Apple says is gone,
 * a 410, or `Unregistered` or `BadDeviceToken` as its reason, is deleted
 * from `push_device` (`deletePushDeviceToken`), because the phone will never
 * take another push on it; a refusal of the request itself, a 400 or a 403
 * with any other reason, is this deployment's key, topic, or payload and no
 * retry will help; anything else, Apple's 429 and 5xx and a transport that
 * never answered, is a failure the caller may retry. The transport is a
 * service of its own (`ApnsTransport`): Node's HTTP/2 client in production
 * (`apns-http2.ts`), and a fake in a test.
 *
 * What became of each send is kept on the phone's row, so a push that fails
 * quietly shows in the phone's Settings rather than in a log alone: one Apple
 * took stamps the phone delivered and ends any failing run, and any other but
 * a gone token, a deployment without the key among them, keeps when the run
 * began and Apple's reason, or ours where Apple gave none
 * (`PUSH_FAILURE_REASON`). A record that would not land is logged, since
 * Apple's answer stands either way.
 *
 * The key travels sealed from the environment (`APNS_ENVIRONMENT`) into
 * the signer and nowhere else, a provider token is held sealed and revealed
 * into the authorization header alone, and a log line names a status and
 * Apple's reason, never a token, a payload, or a key. With any of its four
 * variables unset, the sender answers unavailable and sends nothing, as the
 * sweep does without `CRON_SECRET`.
 */

import { createPrivateKey, createSign, type KeyObject } from "node:crypto";
import type { DatabaseServices } from "@repo/database/core/query";
import {
  deletePushDeviceToken,
  recordPushDelivered,
  recordPushFailed,
} from "@repo/database/models/push-device-store";
import {
  PUSH_ENVIRONMENT,
  PUSH_FAILURE_REASON,
  type PushEnvironment,
} from "@repo/features/push-device-wire";
import { isRecord, text, unparsedWire } from "@repo/wire";
import {
  Clock,
  Config,
  Context,
  Data,
  Duration,
  Effect,
  Layer,
  Option,
  Redacted,
  Ref,
  Result,
} from "effect";
import { present } from "../environment.js";

/** The deployment's variables the sender is read from: the APNs key's id, the team that owns it, the key itself as its `.p8` PEM, and the app the pushes are for. */
export const APNS_ENVIRONMENT = {
  KEY_ID: "APNS_KEY_ID",
  TEAM_ID: "APNS_TEAM_ID",
  /** The PEM of the `.p8` key; one whose newlines a dashboard paste flattened to `\n` is read all the same. */
  PRIVATE_KEY: "APNS_PRIVATE_KEY",
  BUNDLE_ID: "APNS_BUNDLE_ID",
} as const;

/** Apple's two gateways, one per token environment. */
export const APNS_HOST = {
  [PUSH_ENVIRONMENT.PRODUCTION]: "api.push.apple.com",
  [PUSH_ENVIRONMENT.SANDBOX]: "api.sandbox.push.apple.com",
} as const satisfies Record<PushEnvironment, string>;

/** The push types this sender sends, as Apple names them in `apns-push-type`. */
export const APNS_PUSH_TYPE = {
  /** A notification the phone shows, with a sound or a badge. */
  ALERT: "alert",
  /** A silent wake of the app, with `content-available` in its `aps`, which Apple takes at priority 5 alone. */
  BACKGROUND: "background",
  /** A Live Activity's update or end, on the app's Live Activity topic. */
  LIVE_ACTIVITY: "liveactivity",
} as const;

export type ApnsPushType = (typeof APNS_PUSH_TYPE)[keyof typeof APNS_PUSH_TYPE];

/** The priorities Apple takes in `apns-priority`. */
export const APNS_PRIORITY = {
  /** Delivered at once. */
  IMMEDIATE: 10,
  /** Delivered when the phone's power allows; the one priority a background push may ask for. */
  CONSERVE_POWER: 5,
  /** Delivered when the phone's power and the app's budget allow. */
  PRIORITIZE_POWER: 1,
} as const;

export type ApnsPriority = (typeof APNS_PRIORITY)[keyof typeof APNS_PRIORITY];

/** The priority a push type is sent at where its caller names none. */
const DEFAULT_PRIORITY = {
  [APNS_PUSH_TYPE.ALERT]: APNS_PRIORITY.IMMEDIATE,
  [APNS_PUSH_TYPE.BACKGROUND]: APNS_PRIORITY.CONSERVE_POWER,
  [APNS_PUSH_TYPE.LIVE_ACTIVITY]: APNS_PRIORITY.IMMEDIATE,
} as const satisfies Record<ApnsPushType, ApnsPriority>;

export const APNS_EXPIRATION = {
  /** Apple tries once, now, and keeps nothing for a phone that is off. */
  NOW_OR_NEVER: 0,
} as const;

/** Apple's suffix on the app's bundle id for a Live Activity's topic. */
const LIVE_ACTIVITY_TOPIC_SUFFIX = ".push-type.liveactivity";

/**
 * How long one provider token is reused before a fresh one is signed. Apple
 * refuses a token older than an hour and throttles one refreshed more often
 * than every twenty minutes; fifty minutes sits inside both.
 */
export const APNS_PROVIDER_TOKEN_LIFETIME = Duration.minutes(50);

/** The longest one send waits on Apple before it is counted failed. */
export const APNS_REQUEST_TIMEOUT = Duration.seconds(10);

/** Apple's reasons for a token no notification will ever reach again, beside a 410. */
const TOKEN_GONE_REASONS: ReadonlySet<string> = new Set(["Unregistered", "BadDeviceToken"]);

/** What became of one send. */
export const APNS_DELIVERY = {
  /** Apple took it. */
  DELIVERED: "delivered",
  /** Apple said the phone will never take another push on this token, and its row is deleted. */
  TOKEN_GONE: "token-gone",
  /** Apple refused the request, this deployment's key, topic, or payload, or the phone is another app's; no retry will help. */
  REFUSED: "refused",
  /** Apple did not take it this time, or never answered; the caller may retry. */
  FAILED: "failed",
  /** The deployment holds no APNs key, so nothing was sent. */
  UNAVAILABLE: "unavailable",
} as const;

export type ApnsDelivery = (typeof APNS_DELIVERY)[keyof typeof APNS_DELIVERY];

/** The phone a push is addressed to: a `push_device` row's token, gateway, and app. */
export interface PushDeviceAddress {
  readonly token: string;
  readonly environment: PushEnvironment;
  readonly bundleId: string;
}

/** What a Live Activity push does to the activity, as its `aps.event` names it. */
export const APNS_LIVE_ACTIVITY_EVENT = {
  /** A push-to-start, sent to the phone's push-to-start token. */
  START: "start",
  UPDATE: "update",
  END: "end",
} as const;

export type ApnsLiveActivityEvent =
  (typeof APNS_LIVE_ACTIVITY_EVENT)[keyof typeof APNS_LIVE_ACTIVITY_EVENT];

/** The `aps` dictionary Apple reads, as far as the service writes it; instants in seconds since the epoch, as Apple reads them. */
export interface ApnsAps {
  readonly alert?: { readonly title: string; readonly body?: string };
  readonly badge?: number;
  readonly sound?: string;
  readonly category?: string;
  readonly "thread-id"?: string;
  readonly "mutable-content"?: 1;
  readonly "content-available"?: 1;
  /** When a Live Activity's push was composed, which ActivityKit orders its pushes by. */
  readonly timestamp?: number;
  readonly event?: ApnsLiveActivityEvent;
  /** A Live Activity's content state, as its widget decodes it. */
  readonly "content-state"?: Readonly<Record<string, unknown>>;
  /** When a Live Activity's content is out of date unless a later push says otherwise. */
  readonly "stale-date"?: number;
  /** When an ended Live Activity leaves the lock screen. */
  readonly "dismissal-date"?: number;
  /** A push-to-start's activity type, as the app's Swift names it, and its static attributes. */
  readonly "attributes-type"?: string;
  readonly attributes?: Readonly<Record<string, unknown>>;
}

/** The JSON Apple delivers: its `aps`, and the app's own keys at the top level. */
export interface ApnsPayload {
  readonly aps: ApnsAps;
  readonly [key: string]: unknown;
}

/** One notification to one phone: who, what kind, what Apple delivers, and how Apple routes it. */
export interface ApnsNotification {
  readonly device: PushDeviceAddress;
  readonly pushType: ApnsPushType;
  /** The JSON Apple delivers, `aps` and the app's own keys at its top level, as Apple documents it; nothing is added to it here. */
  readonly payload: ApnsPayload;
  /** Later notifications with the same id replace earlier ones still on the lock screen. */
  readonly collapseId?: string;
  /** How soon Apple delivers; the push type's own default where unset (`DEFAULT_PRIORITY`). */
  readonly priority?: ApnsPriority;
  /** When Apple stops trying to deliver, in seconds since the epoch; `APNS_EXPIRATION.NOW_OR_NEVER` where unset. */
  readonly expiration?: number;
}

interface ApnsSenderValues {
  /** Sends one notification and answers what became of it; never fails, since a push is the caller's best effort. */
  readonly send: (
    notification: ApnsNotification,
  ) => Effect.Effect<ApnsDelivery, never, DatabaseServices>;
}

/** The deployment's sender of pushes. Read optionally, so a runtime without the key sends nothing. */
export class ApnsSender extends Context.Service<ApnsSender, ApnsSenderValues>()("ApnsSender") {}

/** One HTTP/2 POST to a gateway, as the transport sends it. */
export interface ApnsRequest {
  readonly host: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** What a gateway answered: its status, and its body, JSON with Apple's `reason` where it refused. */
export interface ApnsAnswer {
  readonly status: number;
  readonly body: string;
}

/** A request Apple never answered; the error's name alone travels, since its words could quote the request. */
export class ApnsTransportFailure extends Data.TaggedError("ApnsTransportFailure")<{
  readonly errorName: string | undefined;
}> {}

interface ApnsTransportValues {
  readonly send: (request: ApnsRequest) => Effect.Effect<ApnsAnswer, ApnsTransportFailure>;
}

/** The one seam between the sender and the network: Node's HTTP/2 client in production, a fake in a test. */
export class ApnsTransport extends Context.Service<ApnsTransport, ApnsTransportValues>()(
  "ApnsTransport",
) {}

/** The deployment's APNs credential, once every part of it is read. */
interface ApnsCredentials {
  readonly keyId: string;
  readonly teamId: string;
  readonly signingKey: KeyObject;
  readonly bundleId: string;
}

/** A provider token, and when it was signed. */
interface ProviderToken {
  readonly value: Redacted.Redacted;
  readonly issuedAt: number;
}

/** What the build says once where a variable is unset, by the variables' names alone. */
function unsetMessage(missing: readonly string[]): string {
  return `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set, so no push is sent to a phone.`;
}

/** The key as the environment holds it, with the newlines a dashboard paste may have flattened to `\n` restored; none where it is not a key. */
function signingKeyOf(pem: string): KeyObject | undefined {
  const parsed = Result.try(() => createPrivateKey(pem.replaceAll("\\n", "\n")));

  return Result.isSuccess(parsed) ? parsed.success : undefined;
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

/**
 * The ES256 provider token Apple authenticates a request with: the key id
 * in the header, the team id and issue time in the claims, and the raw
 * `r || s` signature JOSE expects rather than the DER a signer emits by
 * default.
 */
function signProviderToken(credentials: ApnsCredentials, nowMs: number): Redacted.Redacted {
  const header = base64url(JSON.stringify({ alg: "ES256", kid: credentials.keyId }));

  const claims = base64url(
    JSON.stringify({ iss: credentials.teamId, iat: Math.floor(nowMs / 1000) }),
  );

  const signature = createSign("SHA256")
    .update(`${header}.${claims}`)
    .end()
    .sign({ key: credentials.signingKey, dsaEncoding: "ieee-p1363" });

  return Redacted.make(`${header}.${claims}.${base64url(signature)}`);
}

/** Apple's reason, where the body carries one; nothing else of the body is read. */
function reasonOf(body: string): string | undefined {
  const parsed = Result.try(() => JSON.parse(body));

  if (Result.isFailure(parsed)) return undefined;
  const wire = unparsedWire(parsed.success);

  return isRecord(wire) ? text(wire.reason) : undefined;
}

/** The topic Apple routes a push type by: the app, or its Live Activity topic. */
function topicOf(bundleId: string, pushType: ApnsPushType): string {
  return pushType === APNS_PUSH_TYPE.LIVE_ACTIVITY
    ? `${bundleId}${LIVE_ACTIVITY_TOPIC_SUFFIX}`
    : bundleId;
}

/** The headers Apple routes one notification by, under the provider token. */
function headersOf(
  notification: ApnsNotification,
  bundleId: string,
  providerToken: Redacted.Redacted,
): Readonly<Record<string, string>> {
  return {
    authorization: `bearer ${Redacted.value(providerToken)}`,
    "apns-topic": topicOf(bundleId, notification.pushType),
    "apns-push-type": notification.pushType,
    "apns-priority": String(notification.priority ?? DEFAULT_PRIORITY[notification.pushType]),
    "apns-expiration": String(notification.expiration ?? APNS_EXPIRATION.NOW_OR_NEVER),
    "content-type": "application/json",
    ...(notification.collapseId === undefined
      ? undefined
      : { "apns-collapse-id": notification.collapseId }),
  };
}

/** A record of what became of a send, run past Apple's answer: one that would not land is logged, and the delivery answered all the same. */
function recorded(
  record: Effect.Effect<void, unknown, DatabaseServices>,
  delivery: ApnsDelivery,
): Effect.Effect<ApnsDelivery, never, DatabaseServices> {
  return record.pipe(
    Effect.catch((failure) => Effect.logWarning("a push's outcome was not recorded", failure)),
    Effect.as(delivery),
  );
}

/** A send that did not reach the phone, kept on its row with the reason. */
function failed(
  device: PushDeviceAddress,
  delivery: ApnsDelivery,
  reason: string,
): Effect.Effect<ApnsDelivery, never, DatabaseServices> {
  return recorded(recordPushFailed(device, reason), delivery);
}

/** The sender that sends nothing: a deployment without the key, which each phone's row says. */
const unavailableSender: ApnsSenderValues = {
  send: ({ device }) => failed(device, APNS_DELIVERY.UNAVAILABLE, PUSH_FAILURE_REASON.UNCONFIGURED),
};

/** The sender under the credential, over the transport, reusing one provider token inside its lifetime. */
const apnsSender = Effect.fnUntraced(function* (
  credentials: ApnsCredentials,
  transport: ApnsTransportValues,
): Effect.fn.Return<ApnsSenderValues> {
  const held = yield* Ref.make<ProviderToken | undefined>(undefined);

  /** The provider token to send under: the one held while it is inside its lifetime, or a fresh one. */
  const providerToken = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const standing = yield* Ref.get(held);

    if (
      standing !== undefined &&
      now - standing.issuedAt < Duration.toMillis(APNS_PROVIDER_TOKEN_LIFETIME)
    ) {
      return standing.value;
    }

    const signed = { value: signProviderToken(credentials, now), issuedAt: now };
    yield* Ref.set(held, signed);

    return signed.value;
  });

  /** A token Apple says is gone, deleted; a store that would not is logged, since Apple's answer stands either way. */
  const tokenGone = (device: PushDeviceAddress) =>
    deletePushDeviceToken(device).pipe(
      Effect.catch((failure) => Effect.logWarning("a gone push token was not deleted", failure)),
      Effect.as(APNS_DELIVERY.TOKEN_GONE),
    );

  const send = Effect.fn("web/apnsSend")(function* (
    notification: ApnsNotification,
  ): Effect.fn.Return<ApnsDelivery, never, DatabaseServices> {
    const { device } = notification;

    if (device.bundleId !== credentials.bundleId) {
      // Note that a phone of another app is refused here, because Apple would refuse the topic for its token.
      yield* Effect.logWarning("a push to a phone of another app was not sent");

      return yield* failed(device, APNS_DELIVERY.REFUSED, PUSH_FAILURE_REASON.OTHER_APP);
    }

    const token = yield* providerToken;

    const answered = yield* transport
      .send({
        host: APNS_HOST[device.environment],
        path: `/3/device/${device.token}`,
        headers: headersOf(notification, credentials.bundleId, token),
        body: JSON.stringify(notification.payload),
      })
      .pipe(Effect.result);

    if (Result.isFailure(answered)) {
      yield* Effect.logWarning(
        `a push did not reach Apple: ${answered.failure.errorName ?? "no answer"}`,
      );

      return yield* failed(device, APNS_DELIVERY.FAILED, PUSH_FAILURE_REASON.NO_ANSWER);
    }

    const { status, body } = answered.success;

    if (status === 200) {
      return yield* recorded(recordPushDelivered(device), APNS_DELIVERY.DELIVERED);
    }

    const reason = reasonOf(body);

    if (status === 410 || (reason !== undefined && TOKEN_GONE_REASONS.has(reason))) {
      return yield* tokenGone(device);
    }

    // Note that the status and Apple's reason alone are logged, because the request carries the token and the notification's words.
    yield* Effect.logWarning(
      `a push was answered ${status}${reason === undefined ? "" : ` ${reason}`}`,
    );

    return yield* failed(
      device,
      status === 400 || status === 403 ? APNS_DELIVERY.REFUSED : APNS_DELIVERY.FAILED,
      reason ?? String(status),
    );
  });

  return { send };
});

/**
 * The sender under the deployment's key, once the environment names every
 * part of it, read as the services are built; one that sends nothing
 * otherwise, saying so once by the variables' names.
 */
export const apnsSenderFromEnvironment: Layer.Layer<ApnsSender, never, ApnsTransport> =
  Layer.effect(
    ApnsSender,
    Effect.gen(function* () {
      const read = yield* Config.all({
        keyId: Config.option(Config.String(APNS_ENVIRONMENT.KEY_ID)),
        teamId: Config.option(Config.String(APNS_ENVIRONMENT.TEAM_ID)),
        privateKey: Config.option(Config.Redacted(APNS_ENVIRONMENT.PRIVATE_KEY)),
        bundleId: Config.option(Config.String(APNS_ENVIRONMENT.BUNDLE_ID)),
      }).pipe(
        Effect.orElseSucceed(() => ({
          keyId: Option.none(),
          teamId: Option.none(),
          privateKey: Option.none(),
          bundleId: Option.none(),
        })),
      );

      const keyId = present(read.keyId);
      const teamId = present(read.teamId);
      const pem = present(Option.map(read.privateKey, Redacted.value));
      const bundleId = present(read.bundleId);

      const missing = [
        [APNS_ENVIRONMENT.KEY_ID, keyId],
        [APNS_ENVIRONMENT.TEAM_ID, teamId],
        [APNS_ENVIRONMENT.PRIVATE_KEY, pem],
        [APNS_ENVIRONMENT.BUNDLE_ID, bundleId],
      ] as const;

      const unset = missing.filter(([, value]) => value === undefined).map(([name]) => name);

      if (
        unset.length > 0 ||
        keyId === undefined ||
        teamId === undefined ||
        pem === undefined ||
        bundleId === undefined
      ) {
        yield* Effect.logWarning(unsetMessage(unset));

        return unavailableSender;
      }

      const signingKey = signingKeyOf(pem);

      if (signingKey === undefined) {
        // The fault names the variable alone, never a byte of its value.
        yield* Effect.logError(
          `${APNS_ENVIRONMENT.PRIVATE_KEY} is not a private key, so no push is sent to a phone.`,
        );

        return unavailableSender;
      }

      const transport = yield* ApnsTransport;

      return yield* apnsSender({ keyId, teamId, signingKey, bundleId }, transport);
    }),
  );
