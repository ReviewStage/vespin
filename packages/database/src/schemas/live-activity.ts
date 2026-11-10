import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { pushDevice } from "./push-device.js";

/**
 * live-activity.ts -- the one Live Activity a phone shows for its member's running agents: the tokens ActivityKit handed the phone for it, and what the service last pushed it.
 *
 * One row per phone (`push_device`), made once the iOS app registers a token
 * for it (`@repo/features/live-activity-wire`): the push-to-start token
 * ActivityKit hands the app for the activity's type, and the update token of
 * the activity that stands on the phone. The service push-to-starts an
 * activity when the member's first agent begins a turn and stamps
 * `started_at`, pushes updates to it while their agents run, and ends it
 * once none does (`packages/service/src/push/live-activities.ts`), clearing
 * the update token and the stamp. `sent_at` and `sent_state` are the last
 * push and the content state it carried, which the service's throttle and
 * its skip of an unchanged state read. Refreshes of one member overlap, so
 * every write the service makes is held to what it read: a push-to-start
 * claims the start by stamping `started_at` where it still stands as read,
 * and only the refresh that claimed it sends; a start Apple took stamps
 * `sent_at` with that same instant, so a claim whose `sent_at` is older and
 * that holds no update token is a start not yet confirmed. A token Apple
 * says is gone is cleared where the row still holds it, and the app clears
 * the update token itself once the activity ends on the phone. `swept_at`
 * is when the scheduled sweep last took the row, so it comes round to every
 * row in turn. The row belongs to the phone, whose account it reads
 * through `push_device`, and leaves with it; a phone that moves to another
 * account leaves its row behind.
 */
export const liveActivity = pgTable("live_activity", {
  pushDeviceId: uuid("push_device_id")
    .primaryKey()
    .references(() => pushDevice.id, { onDelete: "cascade" }),
  /** The push-to-start token ActivityKit handed the phone, in lower-case hex; null before the app registers one or once Apple says it is gone. */
  startToken: text("start_token"),
  /** The update token of the activity standing on the phone, in lower-case hex; null while none stands. */
  activityToken: text("activity_token"),
  /** When the service push-to-started the activity that stands, or the app first registered its update token; null while none stands. */
  startedAt: timestamptz("started_at"),
  /** When the service last pushed the phone's activity; null before the first. */
  sentAt: timestamptz("sent_at"),
  /** The content state the last push carried, as its JSON; null where the next push must carry the state whatever it is. */
  sentState: text("sent_state"),
  /** When the scheduled sweep last took the phone's activity to refresh; null before the first. */
  sweptAt: timestamptz("swept_at"),
});
