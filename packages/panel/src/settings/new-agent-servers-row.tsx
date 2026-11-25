/**
 * new-agent-servers-row.tsx -- Settings › Agents' MCP servers row under New agents: which of the account's connected MCP servers its new agents start with.
 *
 * Every server is on for a new agent until the account switches it off
 * here, so a member who keeps a large integration connected need not hand
 * every agent its tools. The row is the one an automation picks its run's
 * servers with (`../tasks/servers-row.tsx`): a field chip saying how many
 * are on, which opens the agent box's own popover, and the few that differ
 * named under its label. The account's choice is one stored value, the servers it switched
 * off (`APP_SETTING_SCHEMA.newAgentServersOff`), which a new agent's box
 * opens with and the service starts an agent on where its Start names no
 * list; an agent's own switches change that agent alone. Each switch asks
 * for the whole list as the newest press left it, so two quick presses
 * never undo each other, and a refusal is said in a toast as the switch
 * goes back.
 */

import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import {
  APP_SETTING_SCHEMA,
  type AppSettingField,
  isNewAgentServersOffJson,
  newAgentServersOffFrom,
  newAgentServersOffJsonOf,
  type SettingsRowsInput,
} from "@repo/settings";
import type { UnparsedWireValue } from "@repo/wire";
import { OwnServersRow } from "../tasks/servers-row.js";
import { useSettingRowWrite, useSettledWrite } from "./row-write.js";

/** The stored list as the row reads it: none where nothing is stored. */
function storedList(value: UnparsedWireValue): string | undefined {
  return isNewAgentServersOffJson(value) ? value : undefined;
}

/** The MCP servers row of New agents, over the settings as the window holds them. */
export function NewAgentServersRow({ view }: { view: SettingsRowsInput }): React.JSX.Element {
  const stored = storedList(view.settings.newAgentServersOff);

  const write = useSettingRowWrite<AppSettingField, string>(
    APP_SETTING_SCHEMA.newAgentServersOff.field,
    (list) => list,
    (value) => storedList(value) ?? "",
    true,
  );

  // Note that the row draws the list the newest press asked for, while it is out, rather than what is stored.
  const latest = write.ahead?.value ?? stored;
  useSettledWrite(write, stored);

  return (
    <OwnServersRow
      disabled={newAgentServersOffFrom(latest)}
      onSwitch={(off) => {
        const list = newAgentServersOffJsonOf(off);

        // Note that a list past an agent's own bounds is never written, so no new agent starts on one its answer would refuse.
        if (list !== undefined) write.run(list);
      }}
      readFailure={FAILURE_SURFACE.INTEGRATIONS_READ}
    />
  );
}
