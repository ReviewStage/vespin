/**
 * close-chord.ts -- whether a key pressed in a card is Close tab's chord, ⌘W, which puts the card away as Escape does.
 *
 * A card holds every key it hears, so the window's keymap never sees ⌘W
 * pressed in it, and a chord the page does not claim goes on to the menu
 * bar, whose Close tab closes the window when no tab answered. So a card
 * claims ⌘W itself and closes, the nearest layer going as Escape takes it,
 * and the window behind it stays.
 */

import { APP_COMMAND, APP_SHORTCUTS, shortcutMatches } from "@repo/settings/shortcuts";
import { isComposingKey } from "../../composing-key.js";

/** Whether `event` is Close tab's chord, which closes the card it was pressed in; never a key an input method is composing with, which is the method's. */
export function closesCard(event: React.KeyboardEvent): boolean {
  return (
    !isComposingKey(event) && shortcutMatches(APP_SHORTCUTS[APP_COMMAND.CLOSE_TAB].chord, event)
  );
}
