// index.tsx -- Settings' main list, as iOS's own Settings stands: the account at its head pushing to Account, the workspace the app works in pushing to Workspace, notifications and when this phone takes them, Agents, About, and the pages still kept on vespin.dev.

import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { PRODUCT_SURFACE } from "@repo/features/analytics";
import { LINK_DESTINATION, linkOf } from "@repo/features/link-grammar";
import { LINK_HOME, LINK_ORIGIN, LINK_PAGE } from "@repo/features/link-home";
import { PRODUCT_NAME } from "@repo/features/product-name";
import {
  PUSH_NOTIFY_CHOICES,
  PUSH_NOTIFY_FOOTER,
  pushStandingText,
} from "@repo/features/push-device-model";
import { SOCIAL_PROVIDER_LABEL } from "@repo/features/sign-in-provider";
import { selectAccount, selectWorkspaces } from "@repo/host/app-state-reads";
import { CONTACT_MAILTO } from "@repo/host/contract";
import {
  SETTINGS_PAGE_TITLE,
  SETTINGS_VIEW,
  type SettingsView,
} from "@repo/settings/settings-views";
import {
  AccountRow,
  ActionRow,
  ListSection,
  PickRows,
  PUSH_ROW_GOES,
  PushRow,
  Screen,
  SettingsForm,
  useColors,
  ValueRow,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import Constants from "expo-constants";
import { Stack, useRouter } from "expo-router";
import { openBrowserAsync } from "expo-web-browser";
import { useChosenWorkspace } from "../../chosen-workspace.js";
import { appStateQuery } from "../../host/app-state-query.js";
import {
  NOTIFICATION_STANDING,
  openNotificationSettings,
  useNotificationPermission,
} from "../../notification-permission.js";
import { openInSafari } from "../../open-link.js";
import {
  isPushNotify,
  notificationsAllowed,
  useFixtureRun,
  usePushDeviceKey,
  usePushDeviceStanding,
} from "../../push-device.js";
import { SETTINGS_ROUTE } from "../../settings-button.js";
import { useSurfaceOpen } from "../../surface-open.js";

export { ScreenBoundary as ErrorBoundary } from "../../screen-boundary.js";

/** What Notifications reads once the phone lets the app notify, until the service says how its pushes fare. */
const NOTIFICATIONS_ON = "On";

/** The step toward allowing them, where one is left: the system's prompt, or iOS's Settings after a refusal. */
const NOTIFICATION_STEP = {
  [NOTIFICATION_STANDING.REFUSED]: "Open iOS Settings",
  [NOTIFICATION_STANDING.UNASKED]: "Turn on notifications",
} as const;

/**
 * The pages still kept on vespin.dev, in the panel's order, each opened in
 * Safari under the chosen workspace, where the member is signed in, until
 * the app draws them itself. This Mac's, its sounds, its updates, the
 * command, and Appearance are left off the phone by design, since the phone
 * has none of them and follows the system's light and dark.
 */
const WEB_PAGES = [
  SETTINGS_VIEW.ENVIRONMENT,
  SETTINGS_VIEW.MEMORY,
  SETTINGS_VIEW.HOSTS,
  SETTINGS_VIEW.INTEGRATIONS,
  SETTINGS_VIEW.MCP,
  SETTINGS_VIEW.SKILLS,
  SETTINGS_VIEW.EXPERIMENTAL,
] as const satisfies readonly SettingsView[];

/** This build's version and build number, as iOS's own About names an app's: "1.4.0 (212)". */
function buildWords(): string {
  const version = Constants.expoConfig?.version ?? "";
  const build = Constants.expoConfig?.ios?.buildNumber;
  return build === undefined ? version : `${version} (${build})`;
}

/** Opens one of our public pages, the changelog or the docs, in the app's own Safari sheet, tinted copper, so the member stays in Settings. */
function openInSheet(address: string, tint: string): void {
  openBrowserAsync(address, { controlsColor: tint }).catch((error: unknown) =>
    console.error("The page did not open.", error),
  );
}

export default function SettingsScreen() {
  const colors = useColors();
  const router = useRouter();
  useSurfaceOpen(PRODUCT_SURFACE.SETTINGS);
  const { data: account } = useQuery({ ...appStateQuery, select: selectAccount });
  const { data: workspaces = [] } = useQuery({ ...appStateQuery, select: selectWorkspaces });
  const { chosen } = useChosenWorkspace(workspaces);
  const notifications = useNotificationPermission();
  const device = usePushDeviceKey();
  const push = usePushDeviceStanding(device);
  const fixture = useFixtureRun();
  const allowed = notificationsAllowed(fixture, notifications.standing);
  // A page kept on the web, under the chosen workspace, opens in Safari, where the member is signed in.
  const onWeb = (page: SettingsView) =>
    openInSafari(
      chosen === undefined
        ? LINK_ORIGIN
        : linkOf({ kind: LINK_DESTINATION.SETTINGS, page }, chosen.slug ?? chosen.id),
    );
  return (
    <>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button onPress={() => router.back()}>Done</Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Screen>
        <SettingsForm>
          {account?.status === ACCOUNT_STATUS.SIGNED_IN ? (
            <ListSection>
              <AccountRow
                name={account.name ?? account.email}
                email={account.email}
                picture={account.pictureUrl}
                detail={`Signed in with ${SOCIAL_PROVIDER_LABEL[account.provider]}`}
                onPress={() => router.push(SETTINGS_ROUTE.ACCOUNT)}
              />
            </ListSection>
          ) : null}
          {chosen === undefined ? null : (
            <ListSection title={SETTINGS_PAGE_TITLE[SETTINGS_VIEW.WORKSPACE]}>
              <PushRow
                label={chosen.name}
                goes={PUSH_ROW_GOES.PAGE}
                onPress={() => router.push(SETTINGS_ROUTE.WORKSPACE)}
                testId="settings-workspace"
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
              <PushRow
                label="Open iOS notification settings"
                goes={PUSH_ROW_GOES.OUT}
                onPress={openNotificationSettings}
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
                options={PUSH_NOTIFY_CHOICES}
                picked={push.standing.notify}
                onPick={(id) => {
                  if (isPushNotify(id)) push.choose(id);
                }}
              />
            </ListSection>
          )}
          <ListSection>
            <PushRow
              label={SETTINGS_PAGE_TITLE[SETTINGS_VIEW.AGENTS]}
              symbol="sparkles"
              goes={PUSH_ROW_GOES.PAGE}
              onPress={() => router.push(SETTINGS_ROUTE.AGENTS)}
            />
          </ListSection>
          <ListSection title="About">
            <ValueRow label="Version" value={buildWords()} />
            <PushRow
              label="What's new"
              goes={PUSH_ROW_GOES.OUT}
              onPress={() => openInSheet(LINK_PAGE.CHANGELOG, colors.TEXT)}
            />
            <PushRow
              label="Help"
              goes={PUSH_ROW_GOES.OUT}
              onPress={() => openInSheet(LINK_PAGE.DOCS, colors.TEXT)}
            />
            <PushRow
              label="Send feedback"
              goes={PUSH_ROW_GOES.OUT}
              onPress={() => openInSafari(CONTACT_MAILTO)}
            />
          </ListSection>
          <ListSection
            title={`More on ${LINK_HOME.HOST}`}
            footer={`These pages of ${PRODUCT_NAME}'s settings open in Safari.`}
          >
            {WEB_PAGES.map((page) => (
              <PushRow
                key={page}
                label={SETTINGS_PAGE_TITLE[page]}
                goes={PUSH_ROW_GOES.OUT}
                onPress={() => onWeb(page)}
              />
            ))}
          </ListSection>
        </SettingsForm>
      </Screen>
    </>
  );
}
