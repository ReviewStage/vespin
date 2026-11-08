import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { UPDATE_STATUS } from "@repo/settings/update";
import { type ComponentProps, createElement, type ReactElement } from "react";
import { DesktopSidebar } from "../desktop/desktop-sidebar.js";
import { SIDEBAR_OVERLAY } from "../desktop/sidebar-collapse.js";
import { PANEL_TAB } from "../panel-tabs.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { type TestWindowRouter, windowRouter } from "./window-router.js";

/**
 * desktop-sidebar.ts -- the sidebar's props on the Plans tab, open and pinned, signed in, listing what `plans` lists, every other press ignored, and the sidebar drawn with them under a window's router.
 */

const ignore = () => undefined;

export function sidebarProps(tasks: TasksControl): ComponentProps<typeof DesktopSidebar> {
  return {
    sidebar: {
      collapsed: false,
      compact: false,
      overlay: SIDEBAR_OVERLAY.CLOSED,
      width: 264,
      onToggle: ignore,
      onOverlay: ignore,
      onResize: ignore,
      staged: false,
    },
    history: {
      canGoBack: false,
      canGoForward: false,
      onBack: ignore,
      onForward: ignore,
      steps: { back: [], forward: [] },
      onGoTo: ignore,
    },
    tasks: tasks,
    tab: PANEL_TAB.TASKS,
    onTabChange: ignore,
    onPressWithin: ignore,
    account: {
      status: ACCOUNT_STATUS.SIGNED_IN,
      email: "dev@example.com",
      name: "Dev",
      provider: "github",
    },
    updates: {
      update: {
        status: UPDATE_STATUS.IDLE,
        currentVersion: "1.0.0",
        installSupported: true,
        upToDate: true,
      },
      build: { packaged: false },
      onCheck: () => Promise.resolve(),
      onInstall: ignore,
      onMoveToApplications: ignore,
      onOpenLatest: ignore,
    },
    onSignOut: () => Promise.resolve(),
  };
}

/** The sidebar with `props`, under `router`, a window's router standing at `/app` unless one is handed, as the shell draws it under the window's, whose place its rows read and its doors move. */
export function drawnSidebar(
  props: ComponentProps<typeof DesktopSidebar>,
  router: TestWindowRouter = windowRouter(),
): ReactElement {
  return router.provide(createElement(DesktopSidebar, props));
}
