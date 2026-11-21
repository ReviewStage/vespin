import { Schema as EffectSchema } from "effect";

/**
 * push-device-wire.ts -- a phone registered for pushes, as the iOS and Android apps register and unregister it: its device token, the push service the token belongs to, the gateway, and the app it was issued to.
 *
 * The iOS app registers the raw device token Apple hands it, never a push
 * service's own, so what a notification says goes only to Apple; the
 * Android app registers the FCM registration token Google hands it, so what
 * a notification says goes only to Google (`PUSH_PROVIDER`). A register
 * that names no provider is Apple's, as every released iOS app's is. It
 * registers on every start, idempotently, under the account signed in, so a
 * token an account registered earlier moves to the one signed in now; it
 * unregisters on sign-out. `POST /api/account/push-devices` registers and
 * `POST /api/account/push-devices/unregister` unregisters, each with the
 * token in its body, never in its address, so no token lands in a request
 * log; `/status` reads the phone's "Notify me" and how its pushes fared, and
 * `/notify` sets the choice, the same way. The phone's table is apart from the `device` table of the Macs and
 * Linux hosts that run local agents, which hold no push token.
 */

/**
 * Which of Apple's two push gateways a token belongs to. A build run from
 * Xcode registers with the sandbox gateway and one from TestFlight or the App
 * Store with production; the phone knows which it is, and a token sent to the
 * wrong gateway is refused, so the registration says.
 */
export const PUSH_ENVIRONMENT = {
  SANDBOX: "sandbox",
  PRODUCTION: "production",
} as const;

export type PushEnvironment = (typeof PUSH_ENVIRONMENT)[keyof typeof PUSH_ENVIRONMENT];

export const pushEnvironmentSchema = EffectSchema.Literals(Object.values(PUSH_ENVIRONMENT));

/**
 * The push service a phone's token belongs to: Apple's for the iPhone and
 * iPad app, Firebase Cloud Messaging for the Android app. FCM has one
 * gateway, so an Android phone registers as production and its sender reads
 * no environment.
 */
export const PUSH_PROVIDER = {
  APNS: "apns",
  FCM: "fcm",
} as const;

export type PushProvider = (typeof PUSH_PROVIDER)[keyof typeof PUSH_PROVIDER];

export const pushProviderSchema = EffectSchema.Literals(Object.values(PUSH_PROVIDER));

const PUSH_DEVICE_BOUNDS = {
  /** The fewest characters a token may be: Apple's is 32 bytes of hex today, and says not to assume its length, so only a token far shorter than that is refused. */
  MIN_TOKEN_CHARS: 32,
  /** The most hex characters an APNs token may be, with room for Apple to lengthen it. */
  MAX_APNS_TOKEN_CHARS: 512,
  /** The most characters an FCM registration token may be: about 160 today, and Google sets no bound, so with room to grow inside a request's body. */
  MAX_FCM_TOKEN_CHARS: 1_024,
  /** The most characters a bundle id or an Android package name may be: a reverse-DNS name. */
  MAX_BUNDLE_ID_CHARS: 255,
} as const;

/** A device token as Apple hands it to the app and the app spells it: hex, in either case; the service keeps it in lower case. */
const APNS_TOKEN_PATTERN = /^[0-9a-fA-F]+$/;

/** A registration token as FCM hands it to the app: URL-safe base64 words joined by a colon, case-sensitive, kept as sent. */
const FCM_TOKEN_PATTERN = /^[A-Za-z0-9_:-]+$/;

/** A bundle id as Apple spells one: letters, digits, hyphens, and periods. */
const BUNDLE_ID_PATTERN = /^[A-Za-z0-9.-]+$/;

/** An Android package name as Google spells one: segments of letters, digits, and underscores, joined by periods. */
const ANDROID_PACKAGE_PATTERN = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;

/** A device token as Apple spells one, which a Live Activity's tokens are too (`live-activity-wire.ts`). */
export const apnsTokenSchema = EffectSchema.String.check(
  EffectSchema.isMinLength(PUSH_DEVICE_BOUNDS.MIN_TOKEN_CHARS),
  EffectSchema.isMaxLength(PUSH_DEVICE_BOUNDS.MAX_APNS_TOKEN_CHARS),
  EffectSchema.isPattern(APNS_TOKEN_PATTERN),
);

const fcmTokenSchema = EffectSchema.String.check(
  EffectSchema.isMinLength(PUSH_DEVICE_BOUNDS.MIN_TOKEN_CHARS),
  EffectSchema.isMaxLength(PUSH_DEVICE_BOUNDS.MAX_FCM_TOKEN_CHARS),
  EffectSchema.isPattern(FCM_TOKEN_PATTERN),
);

/** A token of either service, as an unregister, a read, or a "Notify me" names the phone by; an APNs token's hex is the narrower spelling of the two. */
export const pushDeviceTokenSchema = fcmTokenSchema;

const pushDeviceBundleIdSchema = EffectSchema.String.check(
  EffectSchema.isMinLength(1),
  EffectSchema.isMaxLength(PUSH_DEVICE_BOUNDS.MAX_BUNDLE_ID_CHARS),
  EffectSchema.isPattern(BUNDLE_ID_PATTERN),
);

const androidPackageSchema = EffectSchema.String.check(
  EffectSchema.isMaxLength(PUSH_DEVICE_BOUNDS.MAX_BUNDLE_ID_CHARS),
  EffectSchema.isPattern(ANDROID_PACKAGE_PATTERN),
);

/** An iPhone's or iPad's register: its APNs token, the gateway the token belongs to, and the app Apple issued it to; the provider may go unsaid, as every released iOS app leaves it. */
const apnsRegisterRequestSchema = EffectSchema.Struct({
  token: apnsTokenSchema,
  environment: pushEnvironmentSchema,
  bundleId: pushDeviceBundleIdSchema,
  provider: EffectSchema.optionalKey(EffectSchema.Literal(PUSH_PROVIDER.APNS)),
});

/** An Android phone's register: its FCM registration token, production as its gateway, FCM's one, so a token is one row, and its app's package name. */
const fcmRegisterRequestSchema = EffectSchema.Struct({
  token: fcmTokenSchema,
  environment: EffectSchema.Literal(PUSH_ENVIRONMENT.PRODUCTION),
  bundleId: androidPackageSchema,
  provider: EffectSchema.Literal(PUSH_PROVIDER.FCM),
});

/** Registering the phone (POST): an iPhone's APNs token or an Android phone's FCM token, each with its gateway and its app. */
export const pushDeviceRegisterRequestSchema = EffectSchema.Union([
  apnsRegisterRequestSchema,
  fcmRegisterRequestSchema,
]);

/**
 * A token as the service keeps it: an APNs token's hex in lower case,
 * however the app spelled it, so one token is one row; an FCM token as sent,
 * since its case is part of it.
 */
export function storedPushToken(token: string): string {
  return APNS_TOKEN_PATTERN.test(token) ? token.toLowerCase() : token;
}

/** Unregistering the phone (POST to `/unregister`): the token and its gateway; one the account does not hold is passed over. */
export const pushDeviceUnregisterRequestSchema = EffectSchema.Struct({
  token: pushDeviceTokenSchema,
  environment: pushEnvironmentSchema,
});

/**
 * When a phone takes a push, as its Settings' "Notify me" says: away, the
 * default, holds an alert while the member is at a desktop or web client
 * (`presence-wire.ts`) and sends it once they walk away with the thing still
 * waiting; always sends it whatever they are doing; never sends nothing at
 * all, the background push that clears a settled thread among it. A
 * device-level switch, not a switch per kind of news.
 */
export const PUSH_NOTIFY = {
  AWAY: "away",
  ALWAYS: "always",
  NEVER: "never",
} as const;

export type PushNotify = (typeof PUSH_NOTIFY)[keyof typeof PUSH_NOTIFY];

export const pushNotifySchema = EffectSchema.Literals(Object.values(PUSH_NOTIFY));

/** Reading the phone's standing (POST to `/status`): its token and gateway, as an unregister names them. */
export const pushDeviceStatusRequestSchema = pushDeviceUnregisterRequestSchema;

/** Setting the phone's "Notify me" (POST to `/notify`): its token and gateway, and the choice. */
export const pushDeviceNotifyRequestSchema = EffectSchema.Struct({
  token: pushDeviceTokenSchema,
  environment: pushEnvironmentSchema,
  notify: pushNotifySchema,
});

/** The most characters of a failure's reason the service keeps: Apple's and FCM's reasons are a word, such as `BadTopic` or `UNREGISTERED`. */
export const PUSH_FAILURE_REASON_MAX_CHARS = 120;

/**
 * Why a push failed where its service gave no reason of its own: it never
 * answered, or the deployment holds no key for it, so nothing was sent.
 * Apple's own reasons (`TooManyRequests`, `BadTopic`, …) and FCM's
 * (`UNREGISTERED`, `QUOTA_EXCEEDED`, …) are carried as each spells them.
 */
export const PUSH_FAILURE_REASON = {
  NO_ANSWER: "NoAnswer",
  UNCONFIGURED: "Unconfigured",
  OTHER_APP: "OtherApp",
} as const;

/**
 * The phone's standing, as its Settings shows it beside "Notify me": the
 * choice, when a push last reached Apple, and, while its pushes fail, since
 * when and Apple's reason for the latest; instants in epoch milliseconds. A
 * push that reaches Apple ends a failing run, and a failing run keeps the
 * instant it began through every later failure.
 */
export const pushDeviceStatusAnswerSchema = EffectSchema.Struct({
  notify: pushNotifySchema,
  lastDeliveredAt: EffectSchema.NullOr(EffectSchema.Number),
  failingSince: EffectSchema.NullOr(EffectSchema.Number),
  failureReason: EffectSchema.NullOr(EffectSchema.String),
});

export type PushDeviceStatusAnswer = typeof pushDeviceStatusAnswerSchema.Type;

/** What a register or an unregister answers once it is done: nothing a phone needs to read. */
export const pushDeviceDoneAnswerSchema = EffectSchema.Struct({
  done: EffectSchema.Literal(true),
});

export type PushDeviceDoneAnswer = typeof pushDeviceDoneAnswerSchema.Type;
