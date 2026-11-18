/**
 * fcm.ts -- one push to an Android phone through Firebase Cloud Messaging's HTTP v1 API, under the deployment's Firebase service account.
 *
 * FCM is the Android twin of `apns.ts`: the tasks that decide when to push
 * compose a notification and hand it here, and this module addresses it,
 * signs for it, and reads Google's answer. A notification names the phone
 * (`FcmDeviceAddress`, a `push_device` row whose provider is FCM) and the
 * message Google delivers, composed whole by the caller as the HTTP v1 API
 * documents it (`FcmMessage`); this module adds only the phone's token.
 *
 * The request is one POST to `/v1/projects/<project>/messages:send` on
 * `fcm.googleapis.com`, under an OAuth 2.0 access token
 * (https://firebase.google.com/docs/cloud-messaging/send/v1-api). The token
 * comes from Google's token endpoint for a JWT the service account's
 * RS256 key signs, scoped to messaging alone
 * (https://developers.google.com/identity/protocols/oauth2/service-account#httprest);
 * Google issues one for an hour, so one is reused for fifty minutes
 * (`FCM_ACCESS_TOKEN_LIFETIME`), or until ten minutes before Google says it
 * expires where that is sooner, and one Google refuses as expired is
 * dropped so the next send exchanges afresh. FCM has one gateway, so the
 * phone's `environment` is read only as half of its row's key. FCM routes
 * a token to whatever app of the Firebase project it was issued to, so no
 * package is checked here, unlike Apple's topic.
 *
 * What Google answers is one of `FCM_DELIVERY`, the same outcomes as
 * Apple's. A token Google says is gone, `UNREGISTERED` (its 404), is
 * deleted from `push_device`; a 404 naming no FCM error is not, since it
 * says the request missed rather than that the phone left. Note that `INVALID_ARGUMENT` is left
 * standing, though Google's guide deletes on it too, because it also
 * answers a payload of ours it refused, and a bad payload would then delete
 * every phone it was sent to. A refusal of the request itself (a 400 or a
 * 403, such as `SENDER_ID_MISMATCH` or `THIRD_PARTY_AUTH_ERROR`, or the
 * token endpoint refusing the key) is this deployment's and no retry will
 * help; anything else, Google's 429 and 5xx, an expired access token, and a
 * transport that never answered, is a failure the caller may retry. The
 * transport is the runtime's `HttpClient`: the platform's fetch in
 * production, a fake in a test.
 *
 * What became of each send is kept on the phone's row as Apple's is: a
 * delivery stamps it and ends a failing run, and any other outcome but a
 * gone token keeps when the run began and Google's reason (`errorCode`, else
 * its `status`), or ours where Google gave none (`PUSH_FAILURE_REASON`).
 *
 * The service account travels sealed from the environment
 * (`FCM_ENVIRONMENT`) into the signer and nowhere else, an access token is
 * held sealed and revealed into the authorization header alone, and a log
 * line names a status and Google's reason, never a token, a message, or a
 * key. With the variable unset, or holding no service account, the sender
 * answers unavailable and sends nothing, as Apple's does without its key.
 */

import { createPrivateKey, createSign, type KeyObject } from "node:crypto";
import type { DatabaseServices } from "@repo/database/core/query";
import {
  deletePushDeviceToken,
  recordPushDelivered,
  recordPushFailed,
} from "@repo/database/models/push-device-store";
import { PUSH_FAILURE_REASON, type PushEnvironment } from "@repo/features/push-device-wire";
import {
  Clock,
  Config,
  Context,
  Duration,
  Effect,
  Layer,
  Option,
  Redacted,
  Ref,
  Result,
  Schema,
} from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { present } from "../environment.js";

/** The deployment's variable the sender is read from: the Firebase service account's JSON key, as the Firebase console downloads it. */
export const FCM_ENVIRONMENT = {
  SERVICE_ACCOUNT: "FCM_SERVICE_ACCOUNT",
} as const;

/** Where Google takes a send and a token exchange. */
export const FCM_ENDPOINT = {
  ORIGIN: "https://fcm.googleapis.com",
  /** Google's token endpoint, where a service account's key names none of its own. */
  TOKEN: "https://oauth2.googleapis.com/token",
} as const;

/** The one scope the access token is asked for: sending messages, and nothing else of the project. */
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

/** The grant a signed JWT is exchanged under. */
const JWT_BEARER_GRANT = "urn:ietf:params:oauth:grant-type:jwt-bearer";

/** How long the signed assertion is good for: Google's most, an hour. */
const ASSERTION_LIFETIME_SECONDS = 3_600;

/** How long one access token is reused before a fresh one is exchanged; Google issues one for an hour. */
const FCM_ACCESS_TOKEN_LIFETIME = Duration.minutes(50);

/** How long before Google's own expiry a token is no longer sent, so one is never sent as it lapses. */
const ACCESS_TOKEN_MARGIN_SECONDS = 600;

/** The longest one request to Google is waited on before it is counted failed. */
export const FCM_REQUEST_TIMEOUT = Duration.seconds(10);

/** Google's reason for a token no message will ever reach again. */
const TOKEN_GONE_ERROR_CODE = "UNREGISTERED";

/** What became of one send, as `APNS_DELIVERY` names Apple's. */
export const FCM_DELIVERY = {
  /** Google took it. */
  DELIVERED: "delivered",
  /** Google said the phone will never take another message on this token, and its row is deleted. */
  TOKEN_GONE: "token-gone",
  /** Google refused the request, this deployment's key, project, or message; no retry will help. */
  REFUSED: "refused",
  /** Google did not take it this time, or never answered; the caller may retry. */
  FAILED: "failed",
  /** The deployment holds no service account, so nothing was sent. */
  UNAVAILABLE: "unavailable",
} as const;

export type FcmDelivery = (typeof FCM_DELIVERY)[keyof typeof FCM_DELIVERY];

/** How soon Google delivers, as `android.priority` names it: at once, waking the phone, or when the phone's power allows. */
export const FCM_PRIORITY = {
  HIGH: "HIGH",
  NORMAL: "NORMAL",
} as const;

type FcmPriority = (typeof FCM_PRIORITY)[keyof typeof FCM_PRIORITY];

/** The phone a message is addressed to: a `push_device` row's token, and the gateway half of its key. */
interface FcmDeviceAddress {
  readonly token: string;
  readonly environment: PushEnvironment;
}

/** The notification Android draws for the app while it is not in front, as `android.notification` names its parts. */
interface FcmAndroidNotification {
  /** A later notification with the same tag replaces this one in the shade. */
  readonly tag?: string;
  /** The count the launcher's badge shows. */
  readonly notification_count?: number;
  readonly sound?: string;
}

/** The message Google delivers, as the HTTP v1 API's `Message` names its parts, but the token. */
export interface FcmMessage {
  /** The app's own keys, every value a string, as FCM requires. */
  readonly data?: Readonly<Record<string, string>>;
  /** The words Android shows; a message without it is data alone, for the app to read. */
  readonly notification?: { readonly title: string; readonly body?: string };
  readonly android: {
    readonly priority: FcmPriority;
    /** Later messages with the same key replace earlier ones Google still holds for an offline phone. */
    readonly collapse_key?: string;
    /** How long Google keeps trying, as a duration in seconds such as `"0s"`. */
    readonly ttl?: string;
    readonly notification?: FcmAndroidNotification;
  };
}

/** One message to one phone. */
export interface FcmNotification {
  readonly device: FcmDeviceAddress;
  readonly message: FcmMessage;
}

interface FcmSenderValues {
  /** Sends one message and answers what became of it; never fails, since a push is the caller's best effort. */
  readonly send: (
    notification: FcmNotification,
  ) => Effect.Effect<FcmDelivery, never, DatabaseServices>;
}

/** The deployment's sender of pushes to Android phones. Read optionally, so a runtime without the key sends nothing. */
export class FcmSender extends Context.Service<FcmSender, FcmSenderValues>()("FcmSender") {}

/** The fields of a service account's JSON key the sender reads. */
const ServiceAccountSchema = Schema.Struct({
  project_id: Schema.String,
  client_email: Schema.String,
  private_key: Schema.String,
});

const decodeServiceAccount = Schema.decodeUnknownOption(
  Schema.fromJsonString(ServiceAccountSchema),
);

/** What Google's token endpoint answers: the access token and how long it lives in seconds, or why it refused. */
const TokenAnswerSchema = Schema.Struct({
  access_token: Schema.optionalKey(Schema.String),
  expires_in: Schema.optionalKey(Schema.Number),
  error: Schema.optionalKey(Schema.String),
});

const decodeTokenAnswer = Schema.decodeUnknownOption(Schema.fromJsonString(TokenAnswerSchema));

/** A refusal's body as the HTTP v1 API writes it: its status, and FCM's own error code among its details. */
const ErrorAnswerSchema = Schema.Struct({
  error: Schema.Struct({
    status: Schema.optionalKey(Schema.String),
    details: Schema.optionalKey(
      Schema.Array(Schema.Struct({ errorCode: Schema.optionalKey(Schema.String) })),
    ),
  }),
});

const decodeErrorAnswer = Schema.decodeUnknownOption(Schema.fromJsonString(ErrorAnswerSchema));

/** The deployment's service account, once its key is read. */
interface FcmCredentials {
  readonly projectId: string;
  readonly clientEmail: string;
  readonly signingKey: KeyObject;
}

/** An access token, and when it stops being sent: the sooner of its own expiry, less a margin, and the reuse window. */
interface AccessToken {
  readonly value: Redacted.Redacted;
  readonly staleAt: number;
}

/** What a request to Google came to: its status and body, or none where it never answered. */
type Answered = { readonly status: number; readonly body: string } | undefined;

/** Why a send went no further than the access token: the delivery and the reason the phone's row keeps. */
interface Unsent {
  readonly delivery: FcmDelivery;
  readonly reason: string;
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

/** The service account the variable holds, its key parsed; none where it holds no service account. */
function credentialsOf(json: string): FcmCredentials | undefined {
  const account = Option.getOrUndefined(decodeServiceAccount(json));

  if (account === undefined) return undefined;
  // A key whose newlines a dashboard paste flattened to `\n` is read all the same.
  const parsed = Result.try(() => createPrivateKey(account.private_key.replaceAll("\\n", "\n")));

  if (Result.isFailure(parsed)) return undefined;

  return {
    projectId: account.project_id,
    clientEmail: account.client_email,
    signingKey: parsed.success,
  };
}

/**
 * The RS256 JWT the token endpoint exchanges for an access token: the
 * account as issuer, messaging as its scope, Google's endpoint as its
 * audience. Note that the key file's own `token_uri` is not read, so the
 * assertion is only ever posted to Google.
 */
function signAssertion(credentials: FcmCredentials, nowMs: number): Redacted.Redacted {
  const issuedAt = Math.floor(nowMs / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));

  const claims = base64url(
    JSON.stringify({
      iss: credentials.clientEmail,
      scope: FCM_SCOPE,
      aud: FCM_ENDPOINT.TOKEN,
      iat: issuedAt,
      exp: issuedAt + ASSERTION_LIFETIME_SECONDS,
    }),
  );

  const signature = createSign("RSA-SHA256")
    .update(`${header}.${claims}`)
    .end()
    .sign(credentials.signingKey);

  return Redacted.make(`${header}.${claims}.${base64url(signature)}`);
}

/** Google's reason for a refused send: FCM's own error code, else the status it names; none where the body says neither. */
function reasonOf(body: string): string | undefined {
  const answer = Option.getOrUndefined(decodeErrorAnswer(body));

  if (answer === undefined) return undefined;
  const code = answer.error.details?.find((detail) => detail.errorCode !== undefined)?.errorCode;

  return code ?? answer.error.status;
}

/** A record of what became of a send, run past Google's answer: one that would not land is logged, and the delivery answered all the same. */
function recorded(
  record: Effect.Effect<void, unknown, DatabaseServices>,
  delivery: FcmDelivery,
): Effect.Effect<FcmDelivery, never, DatabaseServices> {
  return record.pipe(
    Effect.catch((failure) => Effect.logWarning("a push's outcome was not recorded", failure)),
    Effect.as(delivery),
  );
}

/** A send that did not reach the phone, kept on its row with the reason. */
function failed(
  device: FcmDeviceAddress,
  delivery: FcmDelivery,
  reason: string,
): Effect.Effect<FcmDelivery, never, DatabaseServices> {
  return recorded(recordPushFailed(device, reason), delivery);
}

/** The sender that sends nothing: a deployment without the service account, which each phone's row says. */
const unavailableSender: FcmSenderValues = {
  send: ({ device }) => failed(device, FCM_DELIVERY.UNAVAILABLE, PUSH_FAILURE_REASON.UNCONFIGURED),
};

/** The sender under the service account, over the client, reusing one access token inside its lifetime. */
const fcmSender = Effect.fnUntraced(function* (
  credentials: FcmCredentials,
  client: HttpClient.HttpClient,
): Effect.fn.Return<FcmSenderValues> {
  const held = yield* Ref.make<AccessToken | undefined>(undefined);

  /** One request to Google, answered with its status and body; none where it never answered in time. Note that the failure's cause is dropped unread, since it may quote the request. */
  const post = (request: HttpClientRequest.HttpClientRequest) =>
    client.execute(request).pipe(
      Effect.flatMap((response) =>
        Effect.map(response.text, (body): Answered => ({ status: response.status, body })),
      ),
      Effect.timeout(FCM_REQUEST_TIMEOUT),
      Effect.orElseSucceed((): Answered => undefined),
    );

  /** An access token exchanged for a freshly signed assertion, held for reuse; why not, where Google refused or never answered. */
  const exchange = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;

    const answered = yield* post(
      HttpClientRequest.post(FCM_ENDPOINT.TOKEN).pipe(
        HttpClientRequest.acceptJson,
        HttpClientRequest.bodyUrlParams({
          grant_type: JWT_BEARER_GRANT,
          assertion: Redacted.value(signAssertion(credentials, now)),
        }),
      ),
    );

    if (answered === undefined) {
      return Result.fail<Unsent>({
        delivery: FCM_DELIVERY.FAILED,
        reason: PUSH_FAILURE_REASON.NO_ANSWER,
      });
    }

    const answer = Option.getOrUndefined(decodeTokenAnswer(answered.body));

    if (answered.status === 200 && answer?.access_token !== undefined) {
      const lifetime = Math.min(
        Duration.toMillis(FCM_ACCESS_TOKEN_LIFETIME),
        ((answer.expires_in ?? Number.POSITIVE_INFINITY) - ACCESS_TOKEN_MARGIN_SECONDS) * 1000,
      );

      const token = { value: Redacted.make(answer.access_token), staleAt: now + lifetime };
      yield* Ref.set(held, token);

      return Result.succeed(token);
    }

    // Note that the endpoint's status and its OAuth error word alone are logged, because the request carries the signed assertion.
    yield* Effect.logWarning(
      `an FCM access token was refused ${answered.status} ${answer?.error ?? ""}`.trimEnd(),
    );

    return Result.fail<Unsent>({
      delivery:
        answered.status === 400 || answered.status === 401
          ? FCM_DELIVERY.REFUSED
          : FCM_DELIVERY.FAILED,
      reason: answer?.error ?? String(answered.status),
    });
  });

  /** The access token to send under: the one held while it is inside its lifetime, or a fresh one. */
  const accessToken: Effect.Effect<Result.Result<AccessToken, Unsent>> = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const standing = yield* Ref.get(held);

    if (standing !== undefined && now < standing.staleAt) return Result.succeed(standing);

    return yield* exchange;
  });

  /** A token Google says is gone, deleted; a store that would not is logged, since Google's answer stands either way. */
  const tokenGone = (device: FcmDeviceAddress) =>
    deletePushDeviceToken(device).pipe(
      Effect.catch((failure) => Effect.logWarning("a gone push token was not deleted", failure)),
      Effect.as(FCM_DELIVERY.TOKEN_GONE),
    );

  const send = Effect.fn("web/fcmSend")(function* (
    notification: FcmNotification,
  ): Effect.fn.Return<FcmDelivery, never, DatabaseServices> {
    const { device, message } = notification;
    const token = yield* accessToken;

    if (Result.isFailure(token)) {
      return yield* failed(device, token.failure.delivery, token.failure.reason);
    }

    const answered = yield* post(
      HttpClientRequest.post(
        `${FCM_ENDPOINT.ORIGIN}/v1/projects/${encodeURIComponent(credentials.projectId)}/messages:send`,
      ).pipe(
        HttpClientRequest.bearerToken(Redacted.value(token.success.value)),
        HttpClientRequest.bodyJsonUnsafe({ message: { ...message, token: device.token } }),
      ),
    );

    if (answered === undefined) {
      yield* Effect.logWarning("a push did not reach FCM");

      return yield* failed(device, FCM_DELIVERY.FAILED, PUSH_FAILURE_REASON.NO_ANSWER);
    }

    const { status, body } = answered;

    if (status === 200) {
      return yield* recorded(recordPushDelivered(device), FCM_DELIVERY.DELIVERED);
    }

    const reason = reasonOf(body);

    // Note that a 404 that names no FCM error is left standing, as a fault of the request rather than of the phone.
    if (reason === TOKEN_GONE_ERROR_CODE) return yield* tokenGone(device);

    // Note that an access token Google no longer takes is dropped, so the next send exchanges a fresh one, unless another send already has.
    if (status === 401) {
      yield* Ref.update(held, (standing) => (standing === token.success ? undefined : standing));
    }

    // Note that the status and Google's reason alone are logged, because the request carries the token and the message's words.
    yield* Effect.logWarning(
      `a push was answered ${status}${reason === undefined ? "" : ` ${reason}`} by FCM`,
    );

    return yield* failed(
      device,
      status === 400 || status === 403 ? FCM_DELIVERY.REFUSED : FCM_DELIVERY.FAILED,
      reason ?? String(status),
    );
  });

  return { send };
});

/**
 * The sender under the deployment's service account, once the environment
 * holds one, read as the services are built; one that sends nothing
 * otherwise, saying so once by the variable's name.
 */
export const fcmSenderFromEnvironment: Layer.Layer<FcmSender, never, HttpClient.HttpClient> =
  Layer.effect(
    FcmSender,
    Effect.gen(function* () {
      const read = yield* Config.option(Config.Redacted(FCM_ENVIRONMENT.SERVICE_ACCOUNT)).pipe(
        Effect.orElseSucceed(() => Option.none<Redacted.Redacted>()),
      );

      const json = present(Option.map(read, Redacted.value));

      if (json === undefined) {
        yield* Effect.logWarning(
          `${FCM_ENVIRONMENT.SERVICE_ACCOUNT} is not set, so no push is sent to an Android phone.`,
        );

        return unavailableSender;
      }

      const credentials = credentialsOf(json);

      if (credentials === undefined) {
        // The fault names the variable alone, never a byte of its value.
        yield* Effect.logError(
          `${FCM_ENVIRONMENT.SERVICE_ACCOUNT} is not a service account's key, so no push is sent to an Android phone.`,
        );

        return unavailableSender;
      }

      return yield* fcmSender(credentials, yield* HttpClient.HttpClient);
    }),
  );
