/**
 * automations-order.ts -- how the Automations tab orders each owner's automations, as its View options chose it, kept on this device across launches, as the panel keeps the list's order on each Mac (`app.automationsOrder`).
 *
 * The order is held in memory and kept in the app's `NSUserDefaults`
 * through React Native's `Settings` for the next launch, as the Tasks tab's
 * view is (`tree-view.ts`), and every screen reading it hears a choice as it
 * is made.
 */

import {
  AUTOMATIONS_ORDER,
  type AutomationsOrder,
  DEFAULT_AUTOMATIONS_ORDER,
} from "@repo/features/automation-list-model";
import { heldValue, useHeldValue } from "@repo/ui-native";
import { useCallback } from "react";
import { Settings } from "react-native";

/** The defaults key the order is kept under. */
const ORDER_KEY = "automationsOrder";

/** The order kept at launch, the default where none was kept or what was kept is no order this build knows. */
function launchOrder(): AutomationsOrder {
  const kept: unknown = Settings.get(ORDER_KEY);

  return (
    Object.values(AUTOMATIONS_ORDER).find((order) => order === kept) ?? DEFAULT_AUTOMATIONS_ORDER
  );
}

/** The order as the device holds it now, held here rather than read back from `Settings`, whose copy lands on the native side only later (`tree-view.ts`). */
const order = heldValue<AutomationsOrder>(launchOrder());

/** The list's order and the choice of another, which is kept and heard by every screen reading it. */
export interface AutomationsOrderControl {
  readonly order: AutomationsOrder;
  readonly setOrder: (next: AutomationsOrder) => void;
}

/** The list's order as the device keeps it, and the door that orders it another way. */
export function useAutomationsOrder(): AutomationsOrderControl {
  const kept = useHeldValue(order);

  const setOrder = useCallback((next: AutomationsOrder) => {
    Settings.set({ [ORDER_KEY]: next });
    order.set(next);
  }, []);

  return { order: kept, setOrder };
}
