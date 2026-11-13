/**
 * workspace-tools.ts -- which machine an agent's `run_on_mac` goes to, whose it is, and whether it would run there now, as its composer reads it.
 *
 * The machine is the one a call naming none would be routed to now
 * (`machine-routing.ts`), and its owner; where a call would go to the
 * account's Macs from before machines claimed, the owner alone
 * (`machineOwnerOf`). `run_on_mac` is answered off where a call would be
 * refused now. An agent the catalog offers no `run_on_mac`
 * (`tool-catalog/catalog.ts`), one on a device, is answered nothing.
 */

import type { Agent } from "@repo/database/models/agent-store";
import { machineOwnerOf } from "@repo/database/models/machine-command-store";
import { readAccountNames } from "@repo/database/models/workspace-store";
import type { ConversationTarget } from "@repo/database/models/writer";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import { MACHINE_COMMAND_KIND } from "@repo/features/machine-command-wire";
import { RUN_ON_MAC_OFF, type RunOnMacStanding } from "@repo/features/workspace-tools-wire";
import { Effect, Option } from "effect";
import { routedCall } from "./machine-command.js";
import { MACHINE_ROUTE } from "./machine-routing.js";
import { offers } from "./tool-catalog/catalog.js";
import { standingOfAgent } from "./tool-catalog/gates.js";

/** Whose Mac the agent's `run_on_mac` runs on and whether it would run there now; nothing where the agent is offered none. */
export function runOnMacStanding(agent: Agent, target: ConversationTarget) {
  return Effect.gen(function* () {
    if (!offers(yield* standingOfAgent(Option.some(agent)), AGENT_TOOL.RUN_ON_MAC)) {
      return undefined;
    }

    const route = yield* routedCall(target, MACHINE_COMMAND_KIND.SHELL, undefined);

    const machine = route.kind === MACHINE_ROUTE.ACCOUNT ? undefined : route.machine;

    if (machine !== undefined) {
      const named = { id: machine.id, name: machine.name };
      const on = route.kind === MACHINE_ROUTE.MACHINE;

      const standing: RunOnMacStanding = on
        ? { on, owner: machine.owner, machine: named }
        : { on, reason: RUN_ON_MAC_OFF.MAC_AWAY, owner: machine.owner, machine: named };

      return standing;
    }

    // Note that a call to the account's Macs from before machines claimed, or to none, names the member alone.
    const userId = yield* machineOwnerOf(target);
    const owner = { userId, name: (yield* readAccountNames([userId])).get(userId) ?? "" };

    const standing: RunOnMacStanding =
      route.kind === MACHINE_ROUTE.ACCOUNT
        ? { on: true, owner }
        : { on: false, reason: RUN_ON_MAC_OFF.MAC_AWAY, owner };

    return standing;
  });
}
