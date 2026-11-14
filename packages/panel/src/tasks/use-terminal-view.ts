import {
  TERMINAL_STATE,
  type TerminalAction,
  type TerminalState,
} from "@repo/features/terminal-model";
import { useQuery } from "@tanstack/react-query";
import { Store, useSelector } from "@tanstack/react-store";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { useSideBundles } from "../bundle-loader.js";
import type { TerminalFind } from "../terminal/contract.js";
import type { TerminalSession } from "./terminal-session.js";
import { useOpenLink } from "./use-open-link.js";

/**
 * use-terminal-view.ts -- a terminal session as a tab draws it: its screen shown in the tab's box while the tab is shown, where it stands, and the bar's action.
 *
 * The session outlives the tab's drawing (`terminal-session.ts`), so a tab
 * hidden takes the screen out of its box and nothing more, and one shown
 * again puts the same screen back.
 */

/** A terminal as its tab draws it. */
export interface TerminalView {
  readonly state: TerminalState;
  /** Whether the terminal bundle failed to load, so there is no screen to draw on. */
  readonly failed: boolean;
  /** Imports the terminal bundle again, where it failed to load. */
  readonly retryBundle: () => void;
  /** The find over the screen's scrollback, once there is a screen. */
  readonly find: TerminalFind | undefined;
  /** The box the screen is shown in. */
  readonly screen: (element: HTMLDivElement | null) => void;
  readonly onAction: (action: TerminalAction) => void;
}

/** Where a tab with no terminal yet stands. */
const NO_TERMINAL = new Store<TerminalState>({ kind: TERMINAL_STATE.CONNECTING });

export function useTerminalView(
  session: TerminalSession | undefined,
  shown: boolean,
): TerminalView {
  const openLink = useOpenLink();
  // Note that the module itself is held, not the result around it, which is a new value each render.
  const { terminal } = useSideBundles();
  const loaded = useQuery(terminal);
  const retryBundle = () => void loaded.refetch();
  const module = loaded.data;
  const state = useSelector(session?.states ?? NO_TERMINAL);
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [find, setFind] = useState<TerminalFind | undefined>(undefined);

  // The screen opens links through the opener the tab was drawn with last.
  useLayoutEffect(() => {
    if (session !== undefined) session.openLink = openLink;
  });

  // The screen stands in the tab's box while the tab is shown, and takes the keyboard as it is.
  useEffect(() => {
    if (session === undefined || !shown || module === undefined || element === null) return;
    session.show(module, element);
    session.screen?.focus();
    setFind(session.screen?.find);

    return () => session.hide();
  }, [session, shown, module, element]);

  const onAction = useCallback((action: TerminalAction) => session?.act(action), [session]);

  return {
    state,
    failed: loaded.isError,
    retryBundle,
    find,
    screen: setElement,
    onAction,
  };
}
