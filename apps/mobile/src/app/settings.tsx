// settings.tsx -- the app's Settings, a SwiftUI Form in a sheet: the account, the workspace the app works in, notifications and when this phone takes them, Manage on vespin.dev for the rest of the settings, and Sign out.

import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { PRODUCT_SURFACE } from "@repo/features/analytics";
import { LINK_DESTINATION, linkOf } from "@repo/features/link-grammar";
import { LINK_ORIGIN } from "@repo/features/link-home";
import { PRODUCT_NAME } from "@repo/features/product-name";
import {
  PUSH_NOTIFY_CHOICES,
  PUSH_NOTIFY_FOOTER,
  pushStandingText,
} from "@repo/features/push-device-model";
import { SOCIAL_PROVIDER_LABEL } from "@repo/features/sign-in-provider";
import { ACT_KIND } from "@repo/host/acts";
import { selectAccount, selectWorkspaces } from "@repo/host/app-state-reads";
import {
  AccountRow,
  ActionRow,
  BAR_TITLE,
  ListSection,
  PickRows,
  Screen,
  SettingsForm,
  useColors,
  ValueRow,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { openURL } from "expo-linking";
import { Stack, useRouter } from "expo-router";
import { useRef } from "react";
import { useChosenWorkspace } from "../chosen-workspace.js";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import { NOTIFICATION_STANDING, useNotificationPermission } from "../notification-permission.js";
import { clearAccountNotifications } from "../notifications.js";
import {
  isPushNotify,
  notificationsAllowed,
  unregisterPushDevice,
  useFixtureRun,
  usePushDeviceKey,
  usePushDeviceStanding,
} from "../push-device.js";
import { useSurfaceOpen } from "../surface-open.js";

export { ScreenBoundary as ErrorBoundary } from "../screen-boundary.js";

/** What Notifications reads once the phone lets the app notify, until the service says how its pushes fare. */
const NOTIFICATIONS_ON = "On";

/** The step toward allowing them, where one is left: the system's prompt, or iOS's Settings after a refusal. */
const NOTIFICATION_STEP = {
  [NOTIFICATION_STANDING.REFUSED]: "Open iOS Settings",
  [NOTIFICATION_STANDING.UNASKED]: "Turn on notifications",
} as const;

function opened(url: string): void {
  openURL(url).catch((error: unknown) => console.error("The address did not open.", error));
}

export default function SettingsScreen() {
  const colors = useColors();
  const router = useRouter();
  const acts = useHostActs();
  useSurfaceOpen(PRODUCT_SURFACE.SETTINGS);
  const { data: account } = useQuery({ ...appStateQuery, select: selectAccount });
  const { data: workspaces = [] } = useQuery({ ...appStateQuery, select: selectWorkspaces });
  const { chosen, choose } = useChosenWorkspace(workspaces);
  const notifications = useNotificationPermission();
  const device = usePushDeviceKey();
  const push = usePushDeviceStanding(device);
  const fixture = useFixtureRun();
  const allowed = notificationsAllowed(fixture, notifications.standing);
  // The rest of the settings, under the chosen workspace, open in Safari, since the app draws no web view.
  const manage =
    chosen === undefined
      ? LINK_ORIGIN
      : linkOf({ kind: LINK_DESTINATION.SETTINGS }, chosen.slug ?? chosen.id);
  // Whether a sign-out is under way, so a press while it runs starts no second one.
  const signingOut = useRef(false);
  // Note that the phone is unregistered first, while the account's credential still stands, so no push of the account reaches a phone signed out of it; the unregister's own deadline bounds the wait.
  const signOut = () => {
    if (signingOut.current) return;
    signingOut.current = true;
    unregisterPushDevice(acts, fixture)
      .then(() => acts[ACT_KIND.ACCOUNT_SIGN_OUT]())
      .then(() => clearAccountNotifications())
      .catch((error: unknown) => console.error("The sign-out did not finish.", error))
      .finally(() => {
        signingOut.current = false;
      });
  };
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "Settings",
          headerTintColor: colors.ACCENT,
          headerTitleStyle: { ...BAR_TITLE.SCREEN, color: colors.TEXT },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.SIDEBAR },
        }}
      />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button onPress={() => router.back()}>Done</Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Screen>
        <SettingsForm>
          {account?.status === ACCOUNT_STATUS.SIGNED_IN ? (
            <ListSection title="Account">
              <AccountRow
                name={account.name ?? account.email}
                email={account.email}
                picture={account.pictureUrl}
                detail={`Signed in with ${SOCIAL_PROVIDER_LABEL[account.provider]}`}
              />
            </ListSection>
          ) : null}
          {workspaces.length === 0 ? null : (
            <ListSection title="Workspace">
              <PickRows
                label="Workspace"
                options={workspaces.map(({ id, name }) => ({ id, label: name }))}
                picked={chosen?.id}
                onPick={choose}
              />
            </ListSection>
          )}
          {/* Note that Notifications reads one state: how the phone's pushes fare once it lets the app notify, and only the step toward letting it until then. */}
          {allowed ? (
            <ListSection title="Notifications">
              <ValueRow
                label="Notifications"
                value={
                  push.standing === undefined ? NOTIFICATIONS_ON : pushStandingText(push.standing)
                }
              />
            </ListSection>
          ) : notifications.standing === NOTIFICATION_STANDING.REFUSED ||
            notifications.standing === NOTIFICATION_STANDING.UNASKED ? (
            <ListSection title="Notifications">
              <ActionRow
                label={NOTIFICATION_STEP[notifications.standing]}
                onPress={notifications.allow}
              />
            </ListSection>
          ) : null}
          {!allowed || push.standing === undefined ? null : (
            <ListSection title="Notify me" footer={PUSH_NOTIFY_FOOTER}>
              <PickRows
                label="Notify me"
                options={PUSH_NOTIFY_CHOICES}
                picked={push.standing.notify}
                onPick={(id) => {
                  if (isPushNotify(id)) push.choose(id);
                }}
              />
            </ListSection>
          )}
          <ListSection
            footer={`Members, connections, and the rest of ${PRODUCT_NAME}'s settings open in Safari.`}
          >
            <ActionRow
              label="Manage on vespin.dev"
              symbol="safari"
              onPress={() => opened(manage)}
            />
          </ListSection>
          <ListSection>
            <ActionRow label="Sign out" destructive onPress={signOut} />
          </ListSection>
        </SettingsForm>
      </Screen>
    </>
  );
}
