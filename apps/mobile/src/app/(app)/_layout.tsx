// _layout.tsx -- the app's screens under the root: the tabs, Settings, the New task and New agent sheets, an agent's model sheet, and a task's Task relation sheet once an account is signed in, or setup in their place while the account owes it, the sign-in screen until then, and the update screen in front of both while the service refuses this build; on an iPad, the detail of the system's split view beside its sidebar.

import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { SETUP_GATE } from "@repo/settings";
import {
  BAR_TITLE,
  ElevatedGround,
  FailureNoticeLayer,
  NO_GROUND,
  useColors,
  useWindowSizeClass,
  WINDOW_SIZE_CLASS,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { Stack, useIsFocused } from "expo-router";
import type { ReactElement, ReactNode } from "react";
import { useComposerDraftsSignOut } from "../../agents/composer-drafts.js";
import { MachineAsks } from "../../agents/machine-asks.js";
import { useAppNotReadyCount } from "../../app-ready.js";
import { useCrashReports } from "../../crash-reports.js";
import { appStateQuery } from "../../host/app-state-query.js";
import { useHostConnectLink } from "../../host-connect-link.js";
import { useInboxWidget } from "../../inbox-widget/use-inbox-widget.js";
import { useLaunchLoadCount } from "../../launch-load.js";
import { useLiveActivity } from "../../live-activity/use-live-activity.js";
import { MenuCommands } from "../../menu-commands/menu-commands.js";
import { useNewTaskDraftsSignOut } from "../../new-task-draft.js";
import { useInboxNotifications } from "../../notifications.js";
import { usePushRegistration } from "../../push-device.js";
import { useRecentOpenedSignOut } from "../../search/recent-opened.js";
import { useSetupGate } from "../../setup/use-setup-gate.js";
import { useShareSheet } from "../../share-sheet.js";
import { SHORT_SHEET_DETENTS } from "../../sheet-stack.js";
import { useSystemActivity } from "../../system-activity/use-system-activity.js";
import { useNoticeForAccount, useOfflineNotice } from "../../use-write.js";

/** The routes the root stack presents as sheets over the app. */
const SHEET_ROUTE = {
  SETTINGS: "settings",
  START_TASK: "start-task",
  START_AGENT: "start-agent",
  AGENT_PORTS: "agent-ports",
  TASK_RELATION: "task-relation",
  MOVE_TASK: "move-task",
  EDIT_DESCRIPTION: "edit-description",
  TASK_FOLLOWING: "task-following",
  ADD_FOLLOWER: "add-follower",
  NEW_WORKSPACE: "new-workspace",
  NEW_MANAGER: "new-manager",
  MANAGER_SETTINGS: "manager-settings",
  AGENT_KEY: "agent-key",
  CHATGPT_SIGN_IN: "chatgpt-sign-in",
  VARIABLE_VALUE: "variable-value",
  AUTOMATION_EDITOR: "automation-editor",
} as const;

/** The sheets, each drawn on the lifted ground in dark. */
const LIFTED_SHEETS: ReadonlySet<string> = new Set(Object.values(SHEET_ROUTE));

/** The presentations that stand a screen in a sheet over the root, which would hide a notice drawn there. */
const SHEET_PRESENTATIONS: ReadonlySet<string | undefined> = new Set([
  "modal",
  "formSheet",
  "fullScreenModal",
]);

/** The pages that start work over the whole window as a new conversation does, rather than as a sheet: New agent. */
const START_PAGE: ReadonlySet<string> = new Set([SHEET_ROUTE.START_AGENT]);

/** A sheet's place for the failure notice, which holds the notice only while the sheet is in front, so a page opened over it, as a notification opens one, shows its own refusals. Note that a screen's layout draws inside its screen's navigation, so `useIsFocused` reads the sheet's own focus. */
function SheetNoticeLayer({ children }: { readonly children: ReactNode }) {
  return <FailureNoticeLayer inFront={useIsFocused()}>{children}</FailureNoticeLayer>;
}

/**
 * A root screen, wrapped in a place of its own for the failure notice where it
 * stands as a sheet, so a notice shows over the sheet rather than behind it,
 * and drawn on the lifted ground where it is one of the app's sheets, since
 * every sheet stands over the window it was opened from, as a card on an
 * iPhone and a form sheet on an iPad, and iOS lifts what it presents in dark;
 * the app's own pages keep the plain ground. A short sheet at half height in a
 * compact window (`sheetAllowedDetents`) stands on iOS's own Liquid Glass
 * alone, so it isn't lifted.
 */
function screenLayout({
  route,
  options,
  children,
}: {
  readonly route: { readonly name: string };
  readonly options: {
    readonly presentation?: string | undefined;
    readonly sheetAllowedDetents?: unknown;
  };
  readonly children: ReactElement;
}): ReactElement {
  const placed = SHEET_PRESENTATIONS.has(options.presentation) ? (
    <SheetNoticeLayer>{children}</SheetNoticeLayer>
  ) : (
    children
  );

  const lifted =
    LIFTED_SHEETS.has(route.name) &&
    !START_PAGE.has(route.name) &&
    options.sheetAllowedDetents === undefined;

  return lifted ? <ElevatedGround>{placed}</ElevatedGround> : placed;
}

/**
 * The screens, each behind the account's standing: the tabs, Settings, and
 * the sheets that start a task or an agent or change an agent's model while an account is signed in, and the sign-in screen otherwise, so a
 * sign-out anywhere, Settings' or a refused renewal's, lands on it and a
 * sign-in lands on the Inbox, or on setup while the account owes it
 * (`use-setup-gate.ts`), which stands alone in the tabs' place until it is
 * finished, with only the sheets its steps open. A fixture run stands signed in as its
 * profile's account. While the service refuses this build as older than it
 * serves (`network.updateNeeded`), the update screen stands in front of
 * both, signed in or not, since every call either would make is refused;
 * the screens come back at the service's next answer of another status.
 * While an account is signed in, the phone registers itself for its pushes
 * once a launch (`push-device.ts`), a tapped
 * notification opens its thread (`notifications.ts`), a Stop pressed on
 * the Live Activity of its running agents goes through the host
 * (`live-activity/`), the Inbox widget's snapshot follows its Inbox
 * (`inbox-widget/`), its crash reports name it (`crash-reports.ts`), its
 * tasks and threads stand in Spotlight, and a Spotlight item tapped or a
 * screen handed over from another device opens (`system-activity/`). The
 * iPad's menu bar acts on whatever stands in front, its account's commands
 * enabled while one is signed in (`menu-commands/`), and the share sheet's
 * snapshot is kept current and its draft opens New task (`share-sheet.ts`),
 * and a machine's pairing link opens Settings › Machines on its code
 * (`host-connect-link.ts`).
 * Over every screen stands the one notice of a write that did not go
 * (`use-write.ts`), which lets its offline word go once the service answers,
 * and every word with its Try again once the account it was said for is gone;
 * while a sheet stands, it stands in the sheet on top (`screenLayout`).
 */
export default function GuardedScreens() {
  const { data: signedIn = false } = useQuery({
    ...appStateQuery,
    select: (state) => state.account.status === ACCOUNT_STATUS.SIGNED_IN,
  });

  const { data: updateNeeded = false } = useQuery({
    ...appStateQuery,
    select: (state) => state.network.updateNeeded === true,
  });

  useAppNotReadyCount(signedIn && !updateNeeded);
  useLaunchLoadCount();
  usePushRegistration(signedIn);
  useInboxNotifications(signedIn);
  useLiveActivity(signedIn);
  useInboxWidget(signedIn);
  useSystemActivity(signedIn);
  useRecentOpenedSignOut(signedIn);
  useComposerDraftsSignOut(signedIn);
  useNewTaskDraftsSignOut(signedIn);
  useCrashReports();
  useOfflineNotice();
  useNoticeForAccount();
  useShareSheet(updateNeeded);
  useHostConnectLink(signedIn && !updateNeeded);
  const app = signedIn && !updateNeeded;
  const gate = useSetupGate(app);

  // Note that every sheet opens as a form sheet in a regular window, centered over the split view as iPad's own apps open theirs (Mail's compose, Reminders' new list), rather than across the whole screen, and as the modal sheet in a compact one.
  const regular = useWindowSizeClass() === WINDOW_SIZE_CLASS.REGULAR;
  const colors = useColors();
  const sheetPresentation = regular ? "formSheet" : "modal";

  // Note that a short sheet, a list to pick from or a few rows, opens at half height with its grabber in a compact window, and pulls up to full, as Maps' and Mail's short sheets do; a regular window's form sheet keeps its own size.
  const shortSheet = regular
    ? { presentation: "formSheet" as const }
    : {
        presentation: "formSheet" as const,
        sheetAllowedDetents: SHORT_SHEET_DETENTS,
        sheetGrabberVisible: true,
        // Note that the route under the sheet's own stack paints no ground, so at half height the sheet's glass shows through to its screen, which paints none there either (`useSheetAtHalf`).
        contentStyle: { backgroundColor: NO_GROUND },
      };

  return (
    <>
      <MenuCommands signedIn={signedIn && !updateNeeded} />
      {/* An ask one of the developer's machines holds for an agent, over whatever screen stands. */}
      <MachineAsks signedIn={signedIn && !updateNeeded} />
      {/* Note that every sheet's bar takes the ink here as its default, so a sheet that sets no ink of its own never stands its title in the system's black on the dark ground; a sheet's own options still win, key by key. */}
      <Stack
        screenOptions={{
          headerShown: false,
          headerTintColor: colors.TEXT,
          headerTitleStyle: { ...BAR_TITLE.SCREEN, color: colors.TEXT },
          headerShadowVisible: false,
        }}
        screenLayout={screenLayout}
      >
        <Stack.Protected guard={app && gate === SETUP_GATE.NONE}>
          <Stack.Screen name="index" />
          {/* Note that the tabs stand at once, with no push, because the launch reaches them by the index route's redirect, which the stack animated as a push: the Inbox's list was laid out again on every frame of the slide, holding the splash and the first frame about 1.5 s on a cold launch; a sign-in reaches them the same way, and a link opens inside them, so nothing else ever slid them in. */}
          <Stack.Screen name="(tabs)" options={{ animation: "none" }} />
          {/* Note that each sheet's title is named here as well as on its screen, so it never reads the route's name. */}
          <Stack.Screen
            name={SHEET_ROUTE.SETTINGS}
            options={{ presentation: sheetPresentation, title: "Settings" }}
          />
          {/* Note that New task opens as a sheet at its full height, as Mail's compose does, so a swipe down closes it, held while it holds a draft, which its ✕ and the swipe ask about first (Discard draft or Save draft); New agent opens over the whole window in every window, as Messages, ChatGPT and Claude open a new conversation, on the page's plain ground, its composer docked on the keyboard. */}
          <Stack.Screen
            name={SHEET_ROUTE.START_TASK}
            options={{ presentation: sheetPresentation, title: "New task" }}
          />
          <Stack.Screen
            name={SHEET_ROUTE.START_AGENT}
            options={{ presentation: "fullScreenModal", title: "New agent" }}
          />
          <Stack.Screen
            name={SHEET_ROUTE.AGENT_PORTS}
            options={{ ...shortSheet, title: "Ports" }}
          />
          <Stack.Screen
            name={SHEET_ROUTE.TASK_RELATION}
            options={{ presentation: sheetPresentation, title: "Task relation" }}
          />
          <Stack.Screen
            name={SHEET_ROUTE.MOVE_TASK}
            options={{ ...shortSheet, title: "Move to workspace" }}
          />
          {/* Note that Edit description opens whole and can't be swiped away while it holds words not saved (`useKeptWords`), as GitHub's issue editor stands. */}
          <Stack.Screen
            name={SHEET_ROUTE.EDIT_DESCRIPTION}
            options={{ presentation: sheetPresentation, title: "Edit description" }}
          />
          <Stack.Screen
            name={SHEET_ROUTE.TASK_FOLLOWING}
            options={{ ...shortSheet, title: "Followers" }}
          />
          <Stack.Screen
            name={SHEET_ROUTE.ADD_FOLLOWER}
            options={{ presentation: sheetPresentation, title: "Add a follower" }}
          />
          <Stack.Screen
            name={SHEET_ROUTE.NEW_WORKSPACE}
            options={{ presentation: sheetPresentation, title: "New workspace" }}
          />
          <Stack.Screen
            name={SHEET_ROUTE.NEW_MANAGER}
            options={{ presentation: sheetPresentation, title: "New Manager" }}
          />
          <Stack.Screen
            name={SHEET_ROUTE.MANAGER_SETTINGS}
            options={{ presentation: sheetPresentation, title: "Manager settings" }}
          />
          {/* Note that New automation and an automation's Edit open whole and can't be swiped away while they hold a change not saved (`useKeptWords`), as Edit description stands. */}
          <Stack.Screen
            name={SHEET_ROUTE.AUTOMATION_EDITOR}
            options={{ presentation: sheetPresentation, title: "Automation" }}
          />
          <Stack.Screen
            name={SHEET_ROUTE.VARIABLE_VALUE}
            options={{ ...shortSheet, title: "Add variable" }}
          />
          {/* Note that the pill field's scratch page is reached only by a launch that asks for it (`-pillField true`), which a flow shoots the field on. */}
          <Stack.Screen name="pill-field" options={{ headerShown: true, title: "Pill field" }} />
        </Stack.Protected>
        {/* Note that setup stands with no push, in the tabs' place, as the tabs do, since nothing slides it in. */}
        <Stack.Protected guard={app && gate !== SETUP_GATE.NONE}>
          <Stack.Screen name="setup" options={{ animation: "none", gestureEnabled: false }} />
        </Stack.Protected>
        {/* The sheets setup's Connect an agent opens, as Settings › Agents does. */}
        <Stack.Protected guard={app}>
          <Stack.Screen
            name={SHEET_ROUTE.AGENT_KEY}
            options={{ presentation: sheetPresentation, title: "Agent key" }}
          />
          <Stack.Screen
            name={SHEET_ROUTE.CHATGPT_SIGN_IN}
            options={{ presentation: sheetPresentation, title: "Codex plan" }}
          />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn && !updateNeeded}>
          <Stack.Screen name="sign-in" />
        </Stack.Protected>
        <Stack.Protected guard={updateNeeded}>
          <Stack.Screen name="update-needed" options={{ gestureEnabled: false }} />
        </Stack.Protected>
      </Stack>
    </>
  );
}
