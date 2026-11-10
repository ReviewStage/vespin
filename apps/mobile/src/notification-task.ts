/**
 * notification-task.ts -- the delivered notifications of a thread removed, and the background task that removes them once the service says the thread settled.
 *
 * Once a thread settles anywhere, the service sends a background push naming
 * it (`PUSH_KIND.SETTLED`, `@repo/features/inbox-push-wire`), with the
 * member's Inbox count as its badge, which iOS sets on its own. iOS wakes the
 * app for it (`remote-notification`, `app.config.ts`), and `expo-task-manager`
 * runs this module's task, foreground or background, which removes every
 * notification still shown for that thread. A notification is matched by the
 * thread its payload names rather than by its request's identifier, so it is
 * found however iOS named it. The task is defined when this module loads,
 * which the app's entry (`index.ts`) does before anything else, since a
 * background launch loads the bundle for the task alone.
 */

import { inboxPushOf, PUSH_KIND } from "@repo/features/inbox-push-wire";
import {
  BackgroundNotificationTaskResult,
  dismissNotificationAsync,
  getPresentedNotificationsAsync,
  type NotificationTaskPayload,
  registerTaskAsync,
} from "expo-notifications";
import { defineTask } from "expo-task-manager";

/** The background task's name, as `expo-task-manager` registers it. */
const SETTLED_PUSH_TASK = "inbox-settled-push";

/** Removes every notification still shown for the thread `itemId`. */
export function dismissThreadNotifications(itemId: string): Promise<void> {
  return getPresentedNotificationsAsync()
    .then((presented) =>
      Promise.all(
        presented
          .filter((notification) => {
            const push = inboxPushOf(notification.request.content.data);
            return push !== undefined && "itemId" in push && push.itemId === itemId;
          })
          .map((notification) => dismissNotificationAsync(notification.request.identifier)),
      ),
    )
    .then(() => undefined);
}

/** The thread a background push says settled, or none for any other payload, such as a tap's response. */
function settledItemOf(payload: NotificationTaskPayload): string | undefined {
  if ("actionIdentifier" in payload) return undefined;
  const push = inboxPushOf(payload.data);
  return push?.kind === PUSH_KIND.SETTLED ? push.itemId : undefined;
}

defineTask<NotificationTaskPayload>(SETTLED_PUSH_TASK, ({ data, error }) => {
  if (error !== null && error !== undefined) {
    console.error("The background push could not be read.", error);
    return Promise.resolve(BackgroundNotificationTaskResult.Failed);
  }
  const itemId = settledItemOf(data);
  if (itemId === undefined) return Promise.resolve(BackgroundNotificationTaskResult.NoData);
  return dismissThreadNotifications(itemId).then(
    () => BackgroundNotificationTaskResult.NewData,
    (failure: unknown) => {
      console.error("The settled thread's notification was not removed.", failure);
      return BackgroundNotificationTaskResult.Failed;
    },
  );
});

registerTaskAsync(SETTLED_PUSH_TASK).catch((error: unknown) =>
  console.error("The settled push task was not registered.", error),
);
