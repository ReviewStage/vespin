// search-field.ts -- the Stack's search field refilled with a tab's words when it stands again, so a rotation or a fold that swaps a tab's layout keeps what was typed.

import { type RefObject, useState } from "react";
import type { SearchBarCommands } from "react-native-screens";

/** A ref that, the first time the field it is handed stands, tells it `text`, and never again, so nothing typed after is overwritten. */
function refillingRef(text: string): RefObject<SearchBarCommands | null> {
  let held = text;
  let field: SearchBarCommands | null = null;
  return {
    get current() {
      return field;
    },
    set current(next) {
      field = next;
      if (next === null || held === "") return;
      next.setText(held);
      held = "";
    },
  };
}

/**
 * A ref for the Stack's search field that refills it, as it first stands,
 * with the words the tab already holds. Note that a tab's root screen holds
 * its words above the swap between its stack and split layouts, so they
 * outlive a rotation or a fold; the system's field starts empty each time it
 * is drawn, so it is told them once rather than left blank over a filtered
 * list. It refills as the field is attached rather than in an effect,
 * because expo-router may attach the field after the screen's own effects
 * ran.
 */
export function useRefilledSearchField(text: string): RefObject<SearchBarCommands | null> {
  const [field] = useState(() => refillingRef(text));
  return field;
}
