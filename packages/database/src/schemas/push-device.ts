import {
  PUSH_NOTIFY,
  PUSH_PROVIDER,
  type PushEnvironment,
  type PushNotify,
  type PushProvider,
} from "@repo/features/push-device-wire";
import { index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, timestamptz } from "./_helpers.js";
import { user } from "./auth.js";

/**
 * push-device.ts -- one of an account's phones that takes pushes: its device token, the push service and gateway the token belongs to, and the app it was issued to.
 *
 * A phone is the iOS or Android app signed in to the account, which
 * registers the device token Apple or FCM handed it on every start and
 * unregisters it on sign-out (`@repo/features/push-device-wire`); `provider`
 * says whose it is (`PUSH_PROVIDER`), and a row from before Android is
 * Apple's. A token belongs to one phone, so it
 * is one row per gateway: a register under an account that already holds it
 * only stamps `last_seen_at`, and one under another account moves the row
 * to that account, since the phone is now signed in there. Apple's sender
 * (`packages/service/src/push/apns.ts`) addresses the token on the gateway
 * `environment` names, under `bundle_id` as its topic, and FCM's
 * (`packages/service/src/push/fcm.ts`) through the deployment's Firebase
 * project; each deletes the row when its service says the token will never
 * take another push. The row belongs
 * to the account and leaves with it.
 *
 * `notify` is the phone's own "Notify me" (`PUSH_NOTIFY`), which the app's
 * Settings sets and a register leaves alone. What became of its pushes is
 * kept beside it, so a push that fails quietly shows on the phone: when one
 * last reached Apple, and, while they fail, since when and Apple's latest
 * reason; a push that reaches Apple ends the failing run.
 *
 * This table is apart from `device` (`./device.ts`), the Macs and Linux
 * hosts that run local agents, which hold no push token; an older `devices`
 * table with push columns was dropped and is not this one.
 */
export const pushDevice = pgTable(
  "push_device",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The device token as its service handed it to the app: Apple's in lower-case hex, FCM's as sent. */
    token: text("token").notNull(),
    /** The push service the token belongs to (`PUSH_PROVIDER`). */
    provider: text("provider").$type<PushProvider>().notNull().default(PUSH_PROVIDER.APNS),
    /** Which of Apple's gateways the token belongs to (`PUSH_ENVIRONMENT`). */
    environment: text("environment").$type<PushEnvironment>().notNull(),
    /** The app the token was issued to: an iOS bundle id, which an APNs push names as its topic, or an Android package name. */
    bundleId: text("bundle_id").notNull(),
    createdAt: createdAt(),
    /** When the phone last registered. */
    lastSeenAt: timestamptz("last_seen_at").notNull(),
    /** When the phone takes an alert (`PUSH_NOTIFY`): away holds one while the member is at their desk. */
    notify: text("notify").$type<PushNotify>().notNull().default(PUSH_NOTIFY.AWAY),
    /** When a push to the phone last reached Apple; null before the first. */
    lastDeliveredAt: timestamptz("last_delivered_at"),
    /** When the phone's pushes began failing, kept through every later failure; null while they reach Apple. */
    failingSince: timestamptz("failing_since"),
    /** Apple's reason for the latest failure, or ours where Apple gave none (`PUSH_FAILURE_REASON`); null while they reach Apple. */
    failureReason: text("failure_reason"),
  },
  (table) => [
    // A token is one phone on one gateway, whichever account it is registered under.
    uniqueIndex("push_device_environment_token").on(table.environment, table.token),
    // A push reads the account's phones.
    index("push_device_user").on(table.userId),
  ],
);
