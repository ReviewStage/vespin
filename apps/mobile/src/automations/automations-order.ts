/**
 * automations-order.ts -- how the Automations tab orders each owner's automations, as its View options chose it, the account's own choice, so the phone orders them as every other device does.
 *
 * The order is one of the account's view choices
 * (`VIEW_CHOICE_KEY.AUTOMATIONS_ORDER`, read through `../view-choices.ts`),
 * kept once for the account, as the panel's Automations page reads it. A
 * choice made here is drawn at once over the host's read, and an account
 * with none kept orders them as `DEFAULT_AUTOMATIONS_ORDER` does. The order
 * an earlier build kept in this device's `NSUserDefaults` moves up to the
 * account once (`useDeviceKeptMovedUp`).
 */

import {
  type AutomationsOrder,
  DEFAULT_AUTOMATIONS_ORDER,
} from "@repo/features/automation-list-model";
import { VIEW_CHOICE, VIEW_CHOICE_KEY } from "@repo/features/view-choice-wire";
import { Option } from "effect";
import { deviceKept, useDeviceKeptMovedUp, useViewChoice } from "../view-choices.js";

/** What an order that did not keep says in the failure notice. */
const ORDER_REFUSED = "Couldn't change how automations are ordered.";

/** The order an earlier build kept on this device, read once a launch: none where none was kept or what was kept is no order this build knows. */
const KEPT_ORDER = deviceKept(
  "automationsOrder",
  VIEW_CHOICE[VIEW_CHOICE_KEY.AUTOMATIONS_ORDER].schema,
);

/** The list's order and the choice of another, which is kept on the account and heard by every screen reading it. */
export interface AutomationsOrderControl {
  readonly order: AutomationsOrder;
  readonly setOrder: (next: AutomationsOrder) => void;
}

/** The list's order as the account keeps it, and the door that orders it another way. */
export function useAutomationsOrder(): AutomationsOrderControl {
  const choice = useViewChoice(VIEW_CHOICE_KEY.AUTOMATIONS_ORDER, null, ORDER_REFUSED);
  useDeviceKeptMovedUp(choice, KEPT_ORDER);

  return {
    order: Option.getOrElse(choice.value, () => DEFAULT_AUTOMATIONS_ORDER),
    setOrder: choice.choose,
  };
}
