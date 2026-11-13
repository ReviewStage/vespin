/**
 * notifications.ts -- what the app does with the service's pushes once they are on the phone: the reply typed in place their category offers, a tap or an action opening its thread, and what is cleared on a sign-out.
 *
 * Each alert names its category (`PUSH_CATEGORY`, `@repo/features/inbox-push-wire`):
 * any post offers a reply typed in place, registered here once a launch; a
 * decide's buttons are set for each push by the app's Notification Service
 * Extension (`notification-service/`), since a category's actions are fixed
 * otherwise; a failed run offers none. A tap opens the thread, or a failed
 * run's agent, in whatever state the app stood, a cold launch included, since
 * iOS keeps the response that launched the app (`useLastNotificationResponse`).
 *
 * Note that an action does not answer in the background: `expo-notifications`
 * runs JavaScript for a notification's action only on Android, so on the
 * iPhone each action opens the app on its thread, which sends the option
 * pressed or the words typed as though they were pressed there
 * (`pressFromNotification`), drawn, refused, and buzzed as any send is. A
 * response that lands while no account is signed in waits for one.
 *
 * The badge is the member's Inbox count as each push carries it, which iOS
 * sets on its own; a settled thread's push clears its notification
 * (`notification-task.ts`), and so does opening the thread.
 */

import {
  INBOX_PUSH_ACTION,
  inboxPushOf,
  inboxPushResponseOf,
  PUSH_CATEGORY,
} from "@repo/features/inbox-push-wire";
import {
  clearLastNotificationResponse,
  dismissAllNotificationsAsync,
  type NotificationAction,
  setBadgeCountAsync,
  setNotificationCategoryAsync,
  setNotificationHandler,
  useLastNotificationResponse,
} from "expo-notifications";
import { useRouter } from "expo-router";
import { useEffect } from "react";
import { pressFromNotification } from "./inbox/use-thread-answer.js";
import { useOnTab } from "./tab-route.js";

/** The reply typed in place that any post's alert offers, opening the app on its thread to send it. */
const REPLY_ACTIONS: NotificationAction[] = [
  {
    identifier: INBOX_PUSH_ACTION.REPLY,
    buttonTitle: "Reply",
    textInput: { submitButtonTitle: "Send", placeholder: "Reply" },
    options: { opensAppToForeground: true },
  },
];

// Note that an alert landing while the app is open is still shown, quietly, since it may be about any thread but the one on screen.
setNotificationHandler({
  handleNotification: () =>
    Promise.resolve({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: true,
    }),
});

/**
 * The app's side of its notifications, mounted once over the screens: the
 * reply's category registered, and each tap or action, the one that
 * launched the app among them, opening its route once an account is signed
 * in, with what an action sends held for the thread's box.
 */
export function useInboxNotifications(signedIn: boolean): void {
  const router = useRouter();
  const onTab = useOnTab();
  const response = useLastNotificationResponse();
  useEffect(() => {
    setNotificationCategoryAsync(PUSH_CATEGORY.REPLY, REPLY_ACTIONS).catch((cause: unknown) =>
      console.error("The reply's notification category was not registered.", cause),
    );
  }, []);
  useEffect(() => {
    if (!signedIn || response === undefined || response === null) return;
    // Note that the response is let go first, so a later render never opens it twice.
    clearLastNotificationResponse();

    const opened = inboxPushResponseOf(inboxPushOf(response.notification.request.content.data), {
      actionId: response.actionIdentifier,
      ...(response.userText === undefined ? undefined : { text: response.userText }),
    });

    if (opened === undefined) return;

    if (opened.press !== undefined) pressFromNotification(opened.press);
    router.push(onTab(opened.route));
  }, [signedIn, response, router, onTab]);
}

/** Every notification of the account removed and the badge cleared, as a sign-out does, so nothing of it stays on a phone signed out of it. */
export function clearAccountNotifications(): Promise<void> {
  return Promise.all([dismissAllNotificationsAsync(), setBadgeCountAsync(0)]).then(
    () => undefined,
    (cause: unknown) => console.error("The account's notifications were not cleared.", cause),
  );
}
