// index.tsx -- Settings' main list, as iOS's own Settings stands and grouped as the panel's Settings sidebar groups its pages: the account at its head pushing to Account; Workspace, headed by the workspace the app works in pushing to its page, then its Cloud environment opening on vespin.dev and its Memory; Account, with Notifications pushing to its own page, Agents, Machines, Integrations, MCP, and Skills; and About with Send feedback.

import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { PRODUCT_SURFACE } from "@repo/features/analytics";
import { FEEDBACK_WORDS } from "@repo/features/feedback";
import { LINK_DESTINATION, linkOf } from "@repo/features/link-grammar";
import { LINK_ORIGIN, LINK_PAGE } from "@repo/features/link-home";
import { MCP_CLIENTS_WORDS } from "@repo/features/mcp-clients-words";
import {
  PUSH_NOTIFICATIONS_STATE,
  PUSH_NOTIFICATIONS_TITLE,
  pushNotifyLabel,
} from "@repo/features/push-device-model";
import { SOCIAL_PROVIDER_LABEL } from "@repo/features/sign-in-provider";
import { WORKSPACE_ROLE_WORDS } from "@repo/features/workspace-role";
import { selectAccount, selectWorkspaces } from "@repo/host/app-state-reads";
import { CONTACT_MAILTO } from "@repo/host/contract";
import {
  SETTINGS_PAGE_GROUP,
  SETTINGS_PAGE_GROUP_HEADING,
  SETTINGS_PAGE_TITLE,
  SETTINGS_VIEW,
} from "@repo/settings/settings-views";
import {
  AccountRow,
  GLYPH,
  ListSection,
  PUSH_ROW_GOES,
  PushRow,
  Screen,
  SettingsForm,
  useColors,
  ValueRow,
  WorkspaceRow,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import Constants from "expo-constants";
import { Stack, useRouter } from "expo-router";
import { openBrowserAsync } from "expo-web-browser";
import { useChosenWorkspace } from "../../chosen-workspace.js";
import { appStateQuery } from "../../host/app-state-query.js";
import { NOTIFICATION_STANDING, useNotificationPermission } from "../../notification-permission.js";
import { openInSafari } from "../../open-link.js";
import {
  notificationsAllowed,
  useFixtureRun,
  usePushDeviceKey,
  usePushDeviceStanding,
} from "../../push-device.js";
import { SETTINGS_ROUTE } from "../../settings-button.js";
import { useSurfaceOpen } from "../../surface-open.js";
import { selectPhotos, switcherWorkspace } from "../../workspace-switcher.js";

export { ScreenBoundary as ErrorBoundary } from "../../screen-boundary.js";

/** What the row that writes the team a mail is called, as the panel's Help menu names it. */
const CONTACT_WORDS = { EMAIL: "Email" } as const;

/** This build's version and build number, as iOS's own About names an app's: "1.4.0 (212)". */
function buildWords(): string {
  const version = Constants.expoConfig?.version ?? "";
  const build = Constants.expoConfig?.ios?.buildNumber;

  return build === undefined ? version : `${version} (${build})`;
}

/** Opens one of our public pages, the changelog or the docs, in the app's own Safari sheet, tinted copper, so the member stays in Settings. */
function openInSheet(address: string, tint: string): void {
  openBrowserAsync(address, { controlsColor: tint }).catch((cause: unknown) =>
    console.error("The page did not open.", cause),
  );
}

export default function SettingsScreen() {
  const colors = useColors();
  const router = useRouter();
  useSurfaceOpen(PRODUCT_SURFACE.SETTINGS);
  const { data: account } = useQuery({ ...appStateQuery, select: selectAccount });
  const { data: workspaces = [] } = useQuery({ ...appStateQuery, select: selectWorkspaces });
  const { chosen } = useChosenWorkspace(workspaces);
  const { data: photos } = useQuery({ ...appStateQuery, select: selectPhotos });
  const notifications = useNotificationPermission();
  const device = usePushDeviceKey();
  const push = usePushDeviceStanding(device);
  const fixture = useFixtureRun();
  const allowed = notificationsAllowed(fixture, notifications.standing);

  // Note that Notifications is offered once the phone has a say in it: allowed, refused, or not yet asked.
  const notificationsShown =
    allowed ||
    notifications.standing === NOTIFICATION_STANDING.REFUSED ||
    notifications.standing === NOTIFICATION_STANDING.UNASKED;

  // What the row reads at its end: when the phone takes them once it may, as the Settings app's rows say an app's choice.
  const notificationsDetail = !allowed
    ? PUSH_NOTIFICATIONS_STATE.OFF
    : push.standing === undefined
      ? PUSH_NOTIFICATIONS_STATE.ON
      : pushNotifyLabel(push.standing.notify);

  // Cloud environment stays on the web, its scripts and secrets no work for a phone, and opens in Safari under the chosen workspace, where the member is signed in.
  const openCloudEnvironment = () =>
    openInSafari(
      chosen === undefined
        ? LINK_ORIGIN
        : linkOf(
            { kind: LINK_DESTINATION.SETTINGS, page: SETTINGS_VIEW.ENVIRONMENT },
            chosen.slug ?? chosen.id,
          ),
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
            <ListSection title={SETTINGS_PAGE_GROUP_HEADING[SETTINGS_PAGE_GROUP.WORKSPACE]}>
              <WorkspaceRow
                workspace={switcherWorkspace(chosen, false, photos)}
                role={WORKSPACE_ROLE_WORDS[chosen.role]}
                onPress={() => router.push(SETTINGS_ROUTE.WORKSPACE)}
                testId="settings-workspace"
              />
              <PushRow
                label={SETTINGS_PAGE_TITLE[SETTINGS_VIEW.ENVIRONMENT]}
                symbol={GLYPH.CLOUD_ENVIRONMENT}
                goes={PUSH_ROW_GOES.OUT}
                onPress={openCloudEnvironment}
              />
              <PushRow
                label={SETTINGS_PAGE_TITLE[SETTINGS_VIEW.MEMORY]}
                symbol={GLYPH.MEMORY}
                goes={PUSH_ROW_GOES.PAGE}
                onPress={() => router.push(SETTINGS_ROUTE.MEMORY)}
              />
            </ListSection>
          )}
          {/* Note that the account's pages stand in the panel's order, Notifications in the place of its Preferences page, which holds the desktop's notifications. */}
          <ListSection title={SETTINGS_PAGE_GROUP_HEADING[SETTINGS_PAGE_GROUP.ACCOUNT]}>
            {notificationsShown ? (
              <PushRow
                label={PUSH_NOTIFICATIONS_TITLE}
                symbol={GLYPH.NOTIFICATIONS}
                detail={notificationsDetail}
                goes={PUSH_ROW_GOES.PAGE}
                onPress={() => router.push(SETTINGS_ROUTE.NOTIFICATIONS)}
                testId="settings-notifications"
              />
            ) : null}
            <PushRow
              label={SETTINGS_PAGE_TITLE[SETTINGS_VIEW.AGENTS]}
              symbol={GLYPH.AGENT}
              goes={PUSH_ROW_GOES.PAGE}
              onPress={() => router.push(SETTINGS_ROUTE.AGENTS)}
            />
            <PushRow
              label={SETTINGS_PAGE_TITLE[SETTINGS_VIEW.HOSTS]}
              symbol={GLYPH.HOST}
              goes={PUSH_ROW_GOES.PAGE}
              onPress={() => router.push(SETTINGS_ROUTE.MACHINES)}
            />
            <PushRow
              label={SETTINGS_PAGE_TITLE[SETTINGS_VIEW.INTEGRATIONS]}
              symbol={GLYPH.PLUG}
              goes={PUSH_ROW_GOES.PAGE}
              onPress={() => router.push(SETTINGS_ROUTE.INTEGRATIONS)}
            />
            <PushRow
              label={MCP_CLIENTS_WORDS.TITLE}
              symbol={GLYPH.MCP_CLIENTS}
              goes={PUSH_ROW_GOES.PAGE}
              onPress={() => router.push(SETTINGS_ROUTE.MCP)}
            />
            {chosen === undefined ? null : (
              <PushRow
                label={SETTINGS_PAGE_TITLE[SETTINGS_VIEW.SKILLS]}
                symbol={GLYPH.SKILL}
                goes={PUSH_ROW_GOES.PAGE}
                onPress={() => router.push(SETTINGS_ROUTE.SKILLS)}
              />
            )}
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
              label={FEEDBACK_WORDS.TITLE}
              goes={PUSH_ROW_GOES.PAGE}
              onPress={() => router.push(SETTINGS_ROUTE.FEEDBACK)}
            />
            <PushRow
              label={CONTACT_WORDS.EMAIL}
              goes={PUSH_ROW_GOES.OUT}
              onPress={() => openInSafari(CONTACT_MAILTO)}
            />
          </ListSection>
        </SettingsForm>
      </Screen>
    </>
  );
}
