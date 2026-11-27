// notifications.tsx -- Settings' Notifications page, as iOS apps keep theirs: whether notifications are on, when this phone takes them ("Notify me"), and iOS's own notification settings; or, while they are off, that they are and the step toward turning them on.

import {
  PUSH_NOTIFICATIONS_STATE,
  PUSH_NOTIFY_CHOICES,
  PUSH_NOTIFY_FOOTER,
  PUSH_NOTIFY_TITLE,
} from "@repo/features/push-device-model";
import {
  ActionRow,
  ListSection,
  PickRows,
  PUSH_ROW_GOES,
  PushRow,
  SCREEN_GROUND,
  Screen,
  SettingsForm,
  ValueRow,
} from "@repo/ui-native";
import {
  NOTIFICATION_STANDING,
  openNotificationSettings,
  useNotificationPermission,
} from "../../../notification-permission.js";
import {
  isPushNotify,
  notificationsAllowed,
  useFixtureRun,
  usePushDeviceKey,
  usePushDeviceStanding,
} from "../../../push-device.js";

export { ScreenBoundary as ErrorBoundary } from "../../../screen-boundary.js";

/** What the row that says whether the app may notify is named, as an app's own settings name iOS's permission. */
const NOTIFICATIONS_LABEL = "Notifications";

/** What the page says while iOS lets the app notify none, over the step that turns them on. */
const NOTIFICATIONS_OFF = "Notifications are off.";

/** The step toward allowing them, where one is left: the system's prompt, or iOS's Settings after a refusal. */
const NOTIFICATION_STEP = {
  [NOTIFICATION_STANDING.REFUSED]: "Open iOS Settings",
  [NOTIFICATION_STANDING.UNASKED]: "Turn on notifications",
} as const;

/**
 * The page: once the phone lets the app notify, that notifications are on,
 * Notify me's choices under their footer once the phone is registered, and
 * iOS's own notification settings; until then, that they are off and the one
 * step toward turning them on. Note that it says the permission's state, as
 * iOS apps do, never how the service's pushes fared, which is a delivery
 * diagnostic for the service's own records and not the reader's to act on.
 */
export default function NotificationsScreen() {
  const notifications = useNotificationPermission();
  const device = usePushDeviceKey();
  const push = usePushDeviceStanding(device);
  const fixture = useFixtureRun();
  const allowed = notificationsAllowed(fixture, notifications.standing);

  return (
    <Screen ground={SCREEN_GROUND.GROUPED}>
      <SettingsForm>
        {allowed ? (
          <ListSection>
            <ValueRow label={NOTIFICATIONS_LABEL} value={PUSH_NOTIFICATIONS_STATE.ON} />
          </ListSection>
        ) : notifications.standing === NOTIFICATION_STANDING.REFUSED ? (
          // Note that once iOS has refused, the one way on is its own Settings, so the row leaves the app as Open iOS notification settings does, with the arrow out.
          <ListSection footer={NOTIFICATIONS_OFF}>
            <PushRow
              label={NOTIFICATION_STEP[notifications.standing]}
              goes={PUSH_ROW_GOES.OUT}
              onPress={notifications.allow}
            />
          </ListSection>
        ) : notifications.standing === NOTIFICATION_STANDING.UNASKED ? (
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
