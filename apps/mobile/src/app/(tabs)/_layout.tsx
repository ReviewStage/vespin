// _layout.tsx -- the system tab bar: icon-only glass tabs for Inbox with its count, Tasks, and search, and, on an iPhone, the prominent round + that opens New task, and over it the way back to a voice call standing; no Inbox while the member turned it off; a sidebar the system draws in a regular window, and hidden in a compact window over a conversation or while the Inbox stands in Select mode.

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
import { usePathname, useRouter, useSegments } from "expo-router";
import { NativeTabs } from "expo-router/native-tabs";
import { useEffect, useState } from "react";
import { useInboxChoosingOn } from "../../inbox/inbox-choosing.js";
import { useInboxShown, useKeepInboxShown } from "../../inbox/inbox-shown.js";
import { useInboxBadge } from "../../inbox/use-inbox.js";
import { probeOnce } from "../../launch-probe.js";
import { useMemberPicturesFollow } from "../../member-pictures.js";
import { PLUS_TAB } from "../../screens/app-sidebar.js";
import { useNewTaskAfterSetup } from "../../setup/setup-place.js";
import { useSidebarChoiceLapse } from "../../sidebar-shown.js";
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
// and minimizes it as a list scrolls down, and floats it at the top of a
// portrait iPad. In a compact window its
// tabs are icons alone, their labels hidden through NativeTabs' own `hidden`
// and heard still as each tab's accessibility label; a regular window's
// bar, floating or a rail, keeps them. The selected tab is tinted in the brand's copper,
// and the Inbox carries the panel's count of what waits on you, hidden at
// none, its fill the attention fill, the light copper in either theme, since
// the system's white figures read at under 3:1 on the dark theme's accent,
// counted on the same threads the Inbox lists. Search is the system's search
// tab (`role="search"`), which iOS 26 stands on its own glass at the trailing
// end; iOS 27 gives that place to the one prominent tab, the round +, and
// stands Search last in the bar beside it. The round + opens New task as a
// sheet over whatever tab stands, rather than standing a tab of its own: it
// is held unselectable (`disabled`, which keeps its look and only stops the
// system selecting it), and its press opens the sheet. It stands on an
// iPhone, the Duo folded or open, its rail included, and never on an iPad,
// which stands New task as the compose button leading its detail's or its
// list's bar instead (`useComposeAction`), as Mail does, so a window never
// offers it twice. Note that it reads the device's idiom (`PLUS_TAB`) rather
// than the window, because expo-router keys the tabs' view on the names of
// the tabs that stand: a + hidden by the window would mount every tab again,
// its pages and drafts dropped, on each fold, rotation, or resize.
//
// The bar is `sidebarAdaptable` everywhere, as Apple's tab sidebar guidance
// has it: folded, iOS 27 stands the Duo's tabs as a glass rail on the outer
// display, unfolded the bar becomes a sidebar rail, and on an iPad the
// system draws its own tab sidebar, shown or folded into the floating bar
// by the window, its toggle, and the person. Each tab's root stands its own
// list beside its detail in a regular window (`SplitView`), and Tasks keeps
// Pinned, Following, and the member's sections as groups atop its list.
// Tabs stay mounted across a fold, a rotation, or a resize, so each keeps
// the open thread or task.
// Each tab carries an id of its own (`inbox-tab`, `tasks-tab`, `search-tab`),
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
  probeOnce("tabs-render");
  const colors = useColors();
  const router = useRouter();
  const inboxShown = useInboxShown();
  useKeepInboxShown(inboxShown);
  const waiting = useInboxBadge();
  // The members of the workspace the phone works in, whose pictures every face reads, followed once for every tab.
  useMemberPicturesFollow();
  useSidebarChoiceLapse();
  // New task over the app setup's Finish just let in, where the workspace reaches a repository.
  useNewTaskAfterSetup();
  const iconOnly = useWindowSizeClass() === WINDOW_SIZE_CLASS.COMPACT;
  const pathname = usePathname();
  const conversation = iosRouteHidesTabs(pathname);
  const inboxListStands = useInboxListStands(useSegments());
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
        <NativeTabs.Trigger.Label hidden={iconOnly}>Inbox</NativeTabs.Trigger.Label>
        {/* Note that the badge is left out at none rather than marked hidden, since NativeTabs draws a badge that holds a value whatever its hidden says. */}
        {waiting === 0 ? null : (
          <NativeTabs.Trigger.Badge>{String(waiting)}</NativeTabs.Trigger.Badge>
        )}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(tasks)" accessibilityLabel="Tasks" testID="tasks-tab">
        <NativeTabs.Trigger.Icon xcasset={GLYPH.TASK} />
        <NativeTabs.Trigger.Label hidden={iconOnly}>Tasks</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger
        name="(search)"
        role="search"
        accessibilityLabel="Search"
        testID="search-tab"
      >
        {/* Note that Search keeps the system's magnifier, since a search tab is iOS's own chrome. */}
        <NativeTabs.Trigger.Icon sf="magnifyingglass" />
        <NativeTabs.Trigger.Label hidden={iconOnly}>Search</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger
        name="new-task"
        prominent
        disabled
        hidden={!PLUS_TAB}
        accessibilityLabel="New task"
        listeners={{ tabPress: () => router.push("/start-task") }}
      >
        <NativeTabs.Trigger.Icon xcasset={GLYPH.ADD} />
        <NativeTabs.Trigger.Label hidden={iconOnly}>New task</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
