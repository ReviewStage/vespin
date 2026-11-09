import { Schema as EffectSchema } from "effect";

/**
 * push-device-wire.ts -- a phone registered for pushes, as the iOS app registers and unregisters it: its APNs device token, the gateway the token belongs to, and the app it was issued to.
 *
 * The app registers the raw device token Apple hands it, never a push
 * service's own, so what a notification says goes only to Apple. It
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

export const PUSH_DEVICE_BOUNDS = {
  /** The fewest hex characters a token may be: Apple's is 32 bytes today, and says not to assume its length, so only a token far shorter than that is refused. */
  MIN_TOKEN_CHARS: 32,
  /** The most hex characters a token may be, with room for Apple to lengthen it. */
  MAX_TOKEN_CHARS: 512,
  /** The most characters a bundle id may be: a reverse-DNS name. */
  MAX_BUNDLE_ID_CHARS: 255,
} as const;

/** A device token as Apple hands it to the app and the app spells it: hex, in either case; the service keeps it in lower case. */
const DEVICE_TOKEN_PATTERN = /^[0-9a-fA-F]+$/;

/** A bundle id as Apple spells one: letters, digits, hyphens, and periods. */
const BUNDLE_ID_PATTERN = /^[A-Za-z0-9.-]+$/;

export const pushDeviceTokenSchema = EffectSchema.String.check(
  EffectSchema.isMinLength(PUSH_DEVICE_BOUNDS.MIN_TOKEN_CHARS),
  EffectSchema.isMaxLength(PUSH_DEVICE_BOUNDS.MAX_TOKEN_CHARS),
  EffectSchema.isPattern(DEVICE_TOKEN_PATTERN),
);

export const pushDeviceBundleIdSchema = EffectSchema.String.check(
  EffectSchema.isMinLength(1),
  EffectSchema.isMaxLength(PUSH_DEVICE_BOUNDS.MAX_BUNDLE_ID_CHARS),
  EffectSchema.isPattern(BUNDLE_ID_PATTERN),
);

/** Registering the phone (POST): its token, the gateway the token belongs to, and the app Apple issued it to. */
export const pushDeviceRegisterRequestSchema = EffectSchema.Struct({
  token: pushDeviceTokenSchema,
  environment: pushEnvironmentSchema,
  bundleId: pushDeviceBundleIdSchema,
});

export type PushDeviceRegisterRequest = typeof pushDeviceRegisterRequestSchema.Type;

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

export type PushDeviceStatusRequest = typeof pushDeviceStatusRequestSchema.Type;

/** Setting the phone's "Notify me" (POST to `/notify`): its token and gateway, and the choice. */
export const pushDeviceNotifyRequestSchema = EffectSchema.Struct({
  token: pushDeviceTokenSchema,
  environment: pushEnvironmentSchema,
  notify: pushNotifySchema,
});

export type PushDeviceNotifyRequest = typeof pushDeviceNotifyRequestSchema.Type;

/** The most characters of a failure's reason the service keeps: Apple's reasons are a word, such as `BadTopic`. */
export const PUSH_FAILURE_REASON_MAX_CHARS = 120;

/**
 * Why a push failed where Apple gave no reason of its own: it never answered,
 * or the deployment holds no APNs key, so nothing was sent. Apple's own
 * reasons (`TooManyRequests`, `BadTopic`, …) are carried as Apple spells them.
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

export type PushDeviceUnregisterRequest = typeof pushDeviceUnregisterRequestSchema.Type;

/** What a register or an unregister answers once it is done: nothing a phone needs to read. */
export const pushDeviceDoneAnswerSchema = EffectSchema.Struct({
  done: EffectSchema.Literal(true),
});

export type PushDeviceDoneAnswer = typeof pushDeviceDoneAnswerSchema.Type;
