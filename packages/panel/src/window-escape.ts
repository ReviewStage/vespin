/**
 * window-escape.ts -- the window's Escape, which closes the nearest thing open and never steps through the history.
 *
 * A menu, a dialog, a peek, and a field answer their own Escapes and keep
 * them, so they are the nearest layers and never reach the window. What the
 * window closes past them, nearest first: a sign-in waiting on the browser,
 * a standing selection of rows or cards, Settings, a description's version
 * history, a side panel filling the window, a Manager's thread open beside
 * its chat, then an agent's threads back to its transcript. Each is an app command its surface offers only while it
 * stands (`app-commands.ts`), so a page that offers none of them takes no
 * Escape at all. Back and Forward are ⌘[ and ⌘], the toolbar's arrows, the
 * mouse's buttons, and the swipe, never Escape.
 */

import { APP_COMMAND, type AppCommand } from "@repo/settings/shortcuts";
import { isComposingKey } from "@repo/ui/composing-key";
import { useEffect } from "react";
import { runAppCommand } from "./app-commands.js";

/**
 * The commands Escape runs past what took it, nearest first. Note that a
 * selection comes before Settings and the version history, because those
 * take the window and draw no list behind them that could hold one.
 */
const ESCAPE_LAYERS: readonly AppCommand[] = [
  APP_COMMAND.CLEAR_SELECTION,
  APP_COMMAND.EXIT_SETTINGS,
  APP_COMMAND.EXIT_VERSION_HISTORY,
  APP_COMMAND.EXIT_FULL_SCREEN,
  APP_COMMAND.CLOSE_THREAD,
  APP_COMMAND.EXIT_AGENT_THREADS,
];

/** Installs the window's Escape; `cancelSignIn` withdraws a sign-in waiting on the browser, while one waits. */
export function useWindowEscape(cancelSignIn: (() => void) | undefined): void {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      // Note that a field or a layer that took the press has answered it, and an input method's Escape is never the window's.
      if (event.key !== "Escape" || isComposingKey(event) || event.defaultPrevented) return;

      // A gate waiting on the browser withdraws the sign-in, as its Cancel does.
      if (cancelSignIn !== undefined) {
        cancelSignIn();

        return;
      }

      // Otherwise the nearest layer that stands closes, and only that one.
      ESCAPE_LAYERS.some((command) => runAppCommand(command));
    };

    window.addEventListener("keydown", handleKey);

    return () => window.removeEventListener("keydown", handleKey);
  }, [cancelSignIn]);
}
