// thread-panel.tsx -- an iPad's open thread of a Manager's chat: beside the chat in the system split view's inspector while the split view stands expanded, and pushed as its own page once it collapses, the thread and its draft kept across.

import { iosTabOfGroup } from "@repo/features/ios-app-links";
import { WINDOW_SIZE_CLASS, windowSizeClass } from "@repo/ui-native";
import {
  closePanelThread,
  collapseThreadPanel,
  expandThreadPanel,
  openPanelThread,
  type PanelThread,
  type StandingPage,
  type ThreadPageRoute,
  type ThreadPanelState,
  threadPanelStart,
} from "@repo/ui-native/thread-panel-model";
import { useIsFocused, usePathname, useRouter, useSegments } from "expo-router";
import {
  createContext,
  type ReactNode,
  type RefObject,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Dimensions } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ManagerThread } from "./screens/manager-thread-screens.js";
import { APP_SIDEBAR } from "./sidebar-shown.js";
import { OwnTabContext, tabGroupOf, useOnOwnTab, useOwnTab } from "./tab-route.js";

/** A Manager chat's thread page, as a compact window pushes it. */
const THREAD_ROUTE = "/tasks/agent/[id]/thread/[root]";

/** No page standing yet, before the router names one. */
const NO_PAGE: StandingPage = { pathname: "", tab: undefined };

type ThreadPanel = {
  readonly open: PanelThread | undefined;
  readonly show: (thread: PanelThread) => void;
  readonly close: () => void;
};

const ThreadPanelContext = createContext<ThreadPanel | undefined>(undefined);

/** What the root's split view takes from the panel: whether its inspector stands, and the events that move a thread between it and a pushed page. */
type InspectorProps = {
  readonly showInspector: boolean;
  readonly onInspectorHide: () => void;
  readonly onCollapse: () => void;
  readonly onExpand: () => void;
};

const InspectorPropsContext = createContext<InspectorProps | undefined>(undefined);

/** Whether the split view starts collapsed, as the window's size class says, until its own events take over. */
function collapsedAtStart(): boolean {
  const { width, height } = Dimensions.get("window");

  return windowSizeClass(width, height) === WINDOW_SIZE_CLASS.COMPACT;
}

/**
 * Keeps the page standing in front for the panel to read as the split view
 * expands. Note that it reads the route here, in a part that draws nothing,
 * because reading it in the provider would draw every column again on every
 * push.
 */
function StandingPageKeeper({ into }: { readonly into: RefObject<StandingPage> }) {
  const pathname = usePathname();
  const tab = iosTabOfGroup(tabGroupOf(useSegments()));

  useEffect(() => {
    into.current = { pathname, tab };
  }, [into, pathname, tab]);

  return null;
}

/**
 * Holds the iPad's open thread above the root's split view, so the chat that
 * opens it and the inspector that draws it read one value. The split view
 * says when it collapses and expands, and `thread-panel-model.ts` decides
 * where the thread then stands: in the inspector while it is expanded, and
 * pushed over its chat once it collapses, since a collapsed split view would
 * stand its inspector as a sheet; this carries out what it decides. The
 * draft in the thread's box is kept by the thread either way
 * (`agents/composer-drafts.ts`). Note that the split view starts as the window's size
 * class says, as UIKit's does, until its first event.
 */
export function ThreadPanelProvider({ children }: { readonly children: ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState(() => threadPanelStart(collapsedAtStart()));
  // Note that the state is read at an event from a ref, written with each step, since the split view's handlers are made once.
  const now = useRef(state);
  const standing = useRef(NO_PAGE);

  const step = useCallback(
    (next: ThreadPanelState, push: ThreadPageRoute | undefined) => {
      now.current = next;
      setState(next);

      if (push !== undefined) router.push({ pathname: push.pathname, params: { ...push.params } });
    },
    [router],
  );

  const show = useCallback(
    (thread: PanelThread) => {
      const next = openPanelThread(now.current, thread);
      step(next.state, next.push);
    },
    [step],
  );

  const close = useCallback(() => step(closePanelThread(now.current), undefined), [step]);

  const onCollapse = useCallback(() => {
    const next = collapseThreadPanel(now.current);
    step(next.state, next.push);
  }, [step]);

  const onExpand = useCallback(() => {
    const next = expandThreadPanel(now.current, standing.current);

    if (next.pop) router.back();
    step(next.state, undefined);
  }, [router, step]);

  const panel = useMemo(() => ({ open: state.open, show, close }), [state.open, show, close]);

  const inspector = useMemo(
    () => ({
      showInspector: !state.collapsed && state.open !== undefined,
      onInspectorHide: close,
      onCollapse,
      onExpand,
    }),
    [state, close, onCollapse, onExpand],
  );

  return (
    <ThreadPanelContext value={panel}>
      <InspectorPropsContext value={inspector}>
        <StandingPageKeeper into={standing} />
        {children}
      </InspectorPropsContext>
    </ThreadPanelContext>
  );
}

/** The root split view's inspector props, from `ThreadPanelProvider`. */
export function useInspectorProps(): InspectorProps | undefined {
  return use(InspectorPropsContext);
}

/**
 * The inspector's content: the open thread, on the tab its chat stands on,
 * so a page it opens is pushed there, its safe area measured in its own
 * column, as expo-router measures each column's; nothing while none is
 * open. Note that it is keyed by the thread, so opening another one draws it
 * afresh, its own draft and scroll with it.
 */
export function ThreadPanel() {
  const open = use(ThreadPanelContext)?.open;

  if (open === undefined) return null;

  return (
    <SafeAreaProvider>
      <OwnTabContext value={open.tab}>
        <ManagerThread key={open.root} id={open.agentId} root={open.root} />
      </OwnTabContext>
    </SafeAreaProvider>
  );
}

/**
 * Opens a thread of the agent's chat: on an iPad through the panel, beside
 * the chat in the inspector while the split view stands expanded, in place
 * of any thread open there, or pushed over the chat while it stands
 * collapsed; elsewhere pushed over the chat on its own tab, as a compact
 * window always pushes it.
 */
export function useOpenChatThread(agentId: string): (root: string) => void {
  const panel = use(ThreadPanelContext);
  const router = useRouter();
  const onOwnTab = useOnOwnTab();
  const tab = useOwnTab();

  return useCallback(
    (root: string) => {
      if (APP_SIDEBAR && panel !== undefined) {
        panel.show({ agentId, root, tab });

        return;
      }

      router.push({ pathname: onOwnTab(THREAD_ROUTE), params: { id: agentId, root } });
    },
    [panel, router, onOwnTab, tab, agentId],
  );
}

/**
 * The thread the agent's chat has open in the inspector, and how to close
 * it, for the chat's bar to offer the inspector's toggle, as an iPad's own
 * apps stand one in the content's toolbar. Note that the thread closes once
 * the chat stops standing in front, as when another page is picked, so the
 * inspector never stands beside a page it does not belong to.
 */
export function useChatThreadPanel(agentId: string): {
  readonly open: boolean;
  readonly close: () => void;
} {
  const panel = use(ThreadPanelContext);
  const focused = useIsFocused();
  const open = panel?.open?.agentId === agentId;
  const close = panel?.close ?? noClose;
  const wasFocused = useRef(focused);
  const openNow = useRef(open);

  useEffect(() => {
    openNow.current = open;
  }, [open]);

  // Note that only the chat's losing the front closes it, not its standing behind, because a thread handed back as the window widens opens while its chat comes forward again.
  useEffect(() => {
    const lost = wasFocused.current && !focused;
    wasFocused.current = focused;

    if (lost && openNow.current) close();
  }, [focused, close]);

  // A chat that goes, as when another row is picked, takes its thread with it.
  useEffect(
    () => () => {
      if (openNow.current) close();
    },
    [close],
  );

  return useMemo(() => ({ open, close }), [open, close]);
}

/** Closes nothing, where no panel stands. */
function noClose(): void {}
