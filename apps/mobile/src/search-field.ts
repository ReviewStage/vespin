// search-field.ts -- the Stack's search field refilled with a tab's words when it stands again, so a rotation or a fold that swaps a tab's layout keeps what was typed.

import { useEffect, useRef } from "react";
import type { SearchBarCommands } from "react-native-screens";

/**
 * A ref for the Stack's search field that refills it, as it first stands,
 * with the words the tab already holds. Note that a tab's root screen holds
 * its words above the swap between its stack and split layouts, so they
 * outlive a rotation or a fold; the system's field starts empty each time it
 * is drawn, so it is told them once rather than left blank over a filtered
 * list.
 */
export function useRefilledSearchField(text: string) {
  const field = useRef<SearchBarCommands>(null);
  const held = useRef(text);
  useEffect(() => {
    if (held.current !== "") field.current?.setText(held.current);
  }, []);
  return field;
}
