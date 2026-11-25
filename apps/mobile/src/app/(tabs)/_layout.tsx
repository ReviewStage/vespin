// _layout.tsx -- the system tab bar: labeled glass tabs for Inbox with its count, Tasks, Automations, and search, and over them the way back to a voice call standing; no Inbox while the member turned it off; a sidebar the system draws in a regular window, which an iPad folds away rather than moving to the top, and hidden in a compact window over a conversation or while the Inbox stands in Select mode.

import {
  IOS_TAB,
  iosRouteAgent,
  iosRouteHidesTabs,
  iosTabOfGroup,
} from "@repo/features/ios-app-links";
import {
  CallAccessory,
  GLYPH,
  useColors,
  useWindowSizeClass,
  WINDOW_SIZE_CLASS,
} from "@repo/ui-native";
import { useQuickActionRouting } from "expo-quick-actions/router";
import { usePathname, useSegments } from "expo-router";
import { NativeTabs } from "expo-router/native-tabs";
import { useEffect, useState } from "react";
import { useAccountFiles } from "../../account-files.js";
import { useInboxChoosingOn } from "../../inbox/inbox-choosing.js";
import { useInboxShown, useKeepInboxShown } from "../../inbox/inbox-shown.js";
import { useInboxBadge } from "../../inbox/use-inbox.js";
import { useMemberPicturesFollow } from "../../member-pictures.js";
import { PAD_IDIOM } from "../../screens/app-sidebar.js";
import { useNewTaskAfterSetup } from "../../setup/setup-place.js";
import { useSidebarChoiceLapse } from "../../sidebar-shown.js";
import { useTabSurfaceOpen } from "../../surface-open.js";
import { useKeepStandingTab } from "../../tab-route.js";
import { useStandingCallCard } from "../../voice-call.js";

/**
 * The way back to a call standing, in the tab bar's bottom accessory, full
 * over the bar and inline beside it once it has shrunk as a list scrolled.
 * Note that the system draws a copy for each placement, so it reads the
 * call from the provider rather than holding any of it. None stands while
 * `shown`, the agent whose page is in front, is the call's own.
 */
function CallWayBack({ shown }: { readonly shown: string | undefined }) {
  const placement = NativeTabs.BottomAccessory.usePlacement();
  const standing = useStandingCallCard(shown);

  if (standing === undefined) return null;

  return (
    <CallAccessory call={standing.card} inline={placement === "inline"} onOpen={standing.open} />
  );
}

/**
 * Whether the Inbox's own list stands in front, by the route's segments
 * (`(tabs)`, `(inbox)`, `inbox`, `[id]`): its root, or a thread of its own,
 * which a regular window hands straight back to the split view
 * (`useHandToSplit`), rather than a page pushed over it on its stack, such
 * as a thread's task; while a sheet such as New task or Settings stands
 * over the tabs, as it stood under the sheet.
 */
function useInboxListStands(segments: readonly string[]): boolean {
  const [, group, first, ...rest] = segments;
  const tab = iosTabOfGroup(group);
  const stands = tab === IOS_TAB.INBOX && first === tab && rest.length <= 1;
  const [kept, keep] = useState(stands);

  useEffect(() => {
    if (tab !== undefined) keep(stands);
  }, [tab, stands]);

  return tab === undefined ? kept : stands;
}

// Note that nothing here draws the bar: the system draws it in Liquid Glass
// and minimizes it as a list scrolls down, and, on iOS 26 alone, floats it at the top of a
// portrait iPad. Every tab keeps its label in any window, as Apple's own
// apps do, since a bar of icons alone read as empty. The selected tab is tinted in the brand's copper,
// and the Inbox carries the panel's count of what waits on you, hidden at
// none, its fill the attention fill, the light copper in either theme, since
// the system's white figures read at under 3:1 on the dark theme's accent,
// counted on the same threads the Inbox lists. Search is the system's search
// tab (`role="search"`), which the system stands on its own round glass at the
// bar's trailing end. Note that the bar holds no round + for New task, which
// held that round slot on iOS 27 and pushed Search in among the tabs, where
// four labeled tabs left the Inbox's count under the selected tab's glass
// (the developer, Nov 24, 2026); New task is the compose button on every tab
// root's bar instead (`useComposeAction`), as Mail and Messages stand it.
//
// The bar is `sidebarAdaptable` everywhere, as Apple's tab sidebar guidance
// has it: folded, iOS 27 stands the Duo's tabs as a glass rail on the outer
// display, unfolded the bar becomes a sidebar rail, and on an iPad the
// system draws its own tab sidebar. Note that an iPad prefers the sidebar
// (`preferredPlacement`, iOS 27), so hiding it folds it away rather than
// moving the tabs into a floating bar over the page, which the developer ruled out
// (Nov 23, 2026); its placement is read by the device's idiom (`PAD_IDIOM`),
// so nothing mounts again as the window turns or resizes. Each tab's root stands its own
// list beside its detail in a regular window (`SplitView`), and Tasks keeps
// Pinned, Following, and the member's sections as groups atop its list.
// Tabs stay mounted across a fold, a rotation, or a resize, so each keeps
// the open thread or task.
// Each tab carries an id of its own (`inbox-tab`, `tasks-tab`, `automations-tab`, `search-tab`),
// since a list's title, a back button, and a split view's search field
// share their names, and a flow taps a tab by it.
//
// The Inbox stands only while the member keeps it on (the account's `inbox`
// preference), since with it off their agents post no threads, so the bar
// and a regular window's sidebar hold no Inbox and no count, and the router
// stands Tasks, the first tab left, wherever a route named the Inbox's own
// stack. Note that the bar standing another set of tabs mounts every tab
// again, as a + coming or going would, which happens only as the choice
// itself changes, since the host's first document, read before anything is
// drawn, carries it.
export default function TabsLayout() {
  const colors = useColors();
  const inboxShown = useInboxShown();
  useKeepInboxShown(inboxShown);
  const waiting = useInboxBadge();
  // The members of the workspace the phone works in, whose pictures every face reads, followed once for every tab.
  useMemberPicturesFollow();
  // The pictures and files kept for another account let go as this one signs in, however it came to.
  useAccountFiles();
  useSidebarChoiceLapse();
  // New task over the app setup's Finish just let in, where the workspace reaches a repository.
  useNewTaskAfterSetup();
  // A Home Screen quick action, the one that woke the app included, opens the route its `href` names, once the tabs stand, so a signed-out launch never acts on one.
  useQuickActionRouting();
  const iconOnly = useWindowSizeClass() === WINDOW_SIZE_CLASS.COMPACT;
  const pathname = usePathname();
  const conversation = iosRouteHidesTabs(pathname);
  const segments: readonly string[] = useSegments();
  const inboxListStands = useInboxListStands(segments);
  // Each tab counted as it comes to stand in front, which this layout hears anyway, rather than once as its list mounts.
  useTabSurfaceOpen(iosTabOfGroup(segments[1]));
  // The tab standing, which a press names a route on (`useOnTab`), kept here since this layout hears every route anyway.
  useKeepStandingTab();
  // Note that the call's own agent's page holds the call's presses in its composer, so the way back stands aside there rather than repeat them.
  const shownAgent = iosRouteAgent(pathname);
  const calling = useStandingCallCard(shownAgent) !== undefined;
  // Note that the Inbox's Select mode hides the bar only while the Inbox's own list stands, so a link that opens another place never leaves the bar hidden over it.
  const choosing = useInboxChoosingOn() && inboxListStands;

  return (
    <NativeTabs
      hidden={iconOnly && (conversation || choosing)}
      minimizeBehavior="onScrollDown"
      sidebarAdaptable
      {...(PAD_IDIOM ? { preferredPlacement: "sidebar" } : {})}
      tintColor={colors.ACCENT}
      badgeBackgroundColor={colors.ATTENTION_FILL}
      badgeTextColor={colors.ON_ACCENT}
    >
      {/* Note that the accessory stands only while a call does, since the system keeps its room over the bar whatever it holds. */}
      {calling ? (
        <NativeTabs.BottomAccessory>
          <CallWayBack shown={shownAgent} />
        </NativeTabs.BottomAccessory>
      ) : null}
      <NativeTabs.Trigger
        name="(inbox)"
        hidden={!inboxShown}
        accessibilityLabel="Inbox"
        testID="inbox-tab"
      >
        <NativeTabs.Trigger.Icon xcasset={GLYPH.INBOX} />
        <NativeTabs.Trigger.Label>Inbox</NativeTabs.Trigger.Label>
        {/* Note that the badge is left out at none rather than marked hidden, since NativeTabs draws a badge that holds a value whatever its hidden says. */}
        {waiting === 0 ? null : (
          <NativeTabs.Trigger.Badge>{String(waiting)}</NativeTabs.Trigger.Badge>
        )}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(tasks)" accessibilityLabel="Tasks" testID="tasks-tab">
        <NativeTabs.Trigger.Icon xcasset={GLYPH.TASK} />
        <NativeTabs.Trigger.Label>Tasks</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger
        name="(automations)"
        accessibilityLabel="Automations"
        testID="automations-tab"
      >
        <NativeTabs.Trigger.Icon xcasset={GLYPH.AUTOMATION} />
        <NativeTabs.Trigger.Label>Automations</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger
        name="(search)"
        role="search"
        accessibilityLabel="Search"
        testID="search-tab"
      >
        {/* Note that Search keeps the system's magnifier, since a search tab is iOS's own chrome. */}
        <NativeTabs.Trigger.Icon sf="magnifyingglass" />
        <NativeTabs.Trigger.Label>Search</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
