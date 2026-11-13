// notifications.tsx -- Settings' Notifications page, as iOS's own Settings keeps an app's: how this phone's pushes fare, when it takes them ("Notify me"), and iOS's own notification settings; or, until the phone lets the app notify, the step toward letting it.

import {
  PUSH_NOTIFICATIONS_STATE,
  PUSH_NOTIFY_CHOICES,
  PUSH_NOTIFY_FOOTER,
  PUSH_NOTIFY_TITLE,
  pushStandingText,
} from "@repo/features/push-device-model";
import {
  ActionRow,
  ListSection,
  PickRows,
  PUSH_ROW_GOES,
  PushRow,
  Screen,
  SettingsForm,
  ValueRow,
} from "@repo/ui-native";
import {
  NOTIFICATION_STANDING,
  openNotificationSettings,
  useNotificationPermission,
} from "../../notification-permission.js";
import {
  isPushNotify,
  notificationsAllowed,
  useFixtureRun,
  usePushDeviceKey,
  usePushDeviceStanding,
} from "../../push-device.js";

export { ScreenBoundary as ErrorBoundary } from "../../screen-boundary.js";

/** What the row that says how the phone's pushes fare is named, under the page's own title. */
const NOTIFICATIONS_STATUS = "Status";

/** The step toward allowing them, where one is left: the system's prompt, or iOS's Settings after a refusal. */
const NOTIFICATION_STEP = {
  [NOTIFICATION_STANDING.REFUSED]: "Open iOS Settings",
  [NOTIFICATION_STANDING.UNASKED]: "Turn on notifications",
} as const;

/**
 * The page: once the phone lets the app notify, Status (how its pushes fare,
 * as the service reads them), Notify me's choices under their footer once
 * the phone is registered, and iOS's own notification settings; until then,
 * the one step toward letting it.
 */
export default function NotificationsScreen() {
  const notifications = useNotificationPermission();
  const device = usePushDeviceKey();
  const push = usePushDeviceStanding(device);
  const fixture = useFixtureRun();
  const allowed = notificationsAllowed(fixture, notifications.standing);

  return (
    <Screen>
      <SettingsForm>
        {allowed ? (
          <ListSection>
            <ValueRow
              label={NOTIFICATIONS_STATUS}
              value={
                push.standing === undefined
                  ? PUSH_NOTIFICATIONS_STATE.ON
                  : pushStandingText(push.standing)
              }
            />
          </ListSection>
        ) : notifications.standing === NOTIFICATION_STANDING.REFUSED ||
          notifications.standing === NOTIFICATION_STANDING.UNASKED ? (
          <ListSection>
            <ActionRow
              label={NOTIFICATION_STEP[notifications.standing]}
              onPress={notifications.allow}
            />
          </ListSection>
        ) : null}
        {!allowed || push.standing === undefined ? null : (
          <ListSection title={PUSH_NOTIFY_TITLE} footer={PUSH_NOTIFY_FOOTER}>
            <PickRows
              options={PUSH_NOTIFY_CHOICES}
              picked={push.standing.notify}
              onPick={(id) => {
                if (isPushNotify(id)) push.choose(id);
              }}
            />
          </ListSection>
        )}
        {allowed ? (
          <ListSection>
            <PushRow
              label="Open iOS notification settings"
              goes={PUSH_ROW_GOES.OUT}
              onPress={openNotificationSettings}
            />
          </ListSection>
        ) : null}
      </SettingsForm>
    </Screen>
  );
}
