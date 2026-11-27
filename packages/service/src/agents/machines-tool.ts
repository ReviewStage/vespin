/**
 * machines-tool.ts -- `list_machines`: the places a start may run an agent on, and the machines the Mac tools may reach, so a caller names one rather than learning them from a refusal.
 *
 * Two lists, each read by the rule its own call keeps. `runsOn` is where
 * `start_agent` may run an agent: the cloud, and each Mac and host of the
 * member the call acts for, the agent's starter or the member the MCP
 * server admitted, as a start's runsOn reads them (`devicesSeenSince`),
 * each with the runsOn to pass and whether it beat lately
 * (`MAC_PRESENCE.FRESH_MS`). Note that only that member's own devices are
 * read, since a start runs on no one else's.
 *
 * `macTools`, for a coding agent alone, is where `run_on_mac` and
 * `computer` may go from its conversation: the machines `routeOf` would
 * consider, its task's assignee's (or, where it has none, its starter's)
 * and those of the followers who let the task's agents use theirs, or a
 * Manager's own followers (`defaultMachinesOf`), each with whether it listened lately, its command
 * mode, and whether it lets agents use its apps. A member is listed none,
 * since the member MCP server has no Mac tools.
 */

import { devicesSeenSince } from "@repo/database/models/device-store";
import { commandMachinesOf } from "@repo/database/models/machine-command-store";
import type { ConversationTarget } from "@repo/database/models/writer";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import { AGENT_MACHINE, MAC_PRESENCE } from "@repo/features/agent-wire";
import { DEVICE_PLATFORM } from "@repo/features/device-agent-wire";
import { Clock, Effect, Result, Schema } from "effect";
import { ACTION_RESULT_STATUS, type UnparsedWireValue, type WireRecord } from "../core.js";
import { agentToolRejected, orStoreRefusal } from "./agent-tools.js";
import { defaultMachinesOf } from "./machine-routing.js";

/** What kind of machine a device is, as the list names it. */
const MACHINE_KIND = {
  MAC: "mac",
  HOST: "host",
} as const;

/** Whether a machine lets agents use its apps: on, off, or left to the Mac, whose app never carried its switch up. */
const COMPUTER_USE = {
  ON: "on",
  OFF: "off",
  ASKS_THE_MAC: "decided-on-the-mac",
} as const;

const LIST_MACHINES_REFUSAL = {
  UNREADABLE: "Not listed: list_machines takes no input; call it with {}.",
} as const;

const LIST_MACHINES_INPUT = Schema.Struct({});

const readAsked = Schema.decodeUnknownResult(LIST_MACHINES_INPUT);

/** The tool as every coding agent is offered it, and the member MCP server in its own words. */
export const LIST_MACHINES_TOOL = {
  name: AGENT_TOOL.LIST_MACHINES,
  description:
    "List the machines you may name: runsOn, each place " +
    `${AGENT_TOOL.START_AGENT} may run an agent, the cloud and each Mac and host of the member ` +
    "who started you, by id and name, with the runsOn value to pass as it stands and whether it " +
    `is online; and macTools, each machine ${AGENT_TOOL.RUN_ON_MAC} and ${AGENT_TOOL.COMPUTER} ` +
    "may reach from this conversation (your task's assignee's, or your starter's where it has " +
    "none, and those of followers of your task, or of you where you are a Manager, who let its " +
    "agents use theirs), by id, name, and owner, " +
    "with whether it is online, its command mode (never, ask, or always), and whether it lets " +
    "agents use its apps (on, off, or decided-on-the-mac). Those tools take no machine: they go " +
    "to this agent's machine, which a member picks in its composer, or else to the default of " +
    "your task's assignee (your starter's where it has none).",
  inputSchema: LIST_MACHINES_INPUT,
} as const;

/** The member MCP server's words: the places a start may run, with no Mac tools to name. */
export const MEMBER_LIST_MACHINES_DESCRIPTION =
  `List the places ${AGENT_TOOL.START_AGENT} may run the member's agents (runsOn): the cloud and ` +
  "each of the member's own Macs and hosts, by id and name, with the runsOn value to pass as it " +
  "stands and whether it is online. The machines are the member's own, the same in every workspace.";

/** A machine's apps switch as the list names it, none where its app never carried it up. */
function computerUseOf(switched: boolean | null) {
  if (switched === null) return COMPUTER_USE.ASKS_THE_MAC;

  return switched ? COMPUTER_USE.ON : COMPUTER_USE.OFF;
}

/** The places a start may run an agent for the member given: the cloud first, then each of their devices, the latest seen first. */
const runsOnOf = (userId: string) =>
  Effect.gen(function* () {
    const devices = yield* devicesSeenSince(userId, new Date(0));
    const now = yield* Clock.currentTimeMillis;

    return [
      { runsOn: { machine: AGENT_MACHINE.VERCEL }, name: "Cloud", online: true },
      ...devices.map((device) => ({
        runsOn: { machine: AGENT_MACHINE.DEVICE, deviceId: device.id },
        id: device.id,
        name: device.name,
        kind: device.platform === DEVICE_PLATFORM.DARWIN ? MACHINE_KIND.MAC : MACHINE_KIND.HOST,
        online: device.lastSeenAt.getTime() >= now - MAC_PRESENCE.FRESH_MS,
      })),
    ];
  });

/** The machines the Mac tools may reach from the conversation given, with each one's settings for agents. */
const macToolsOf = (target: ConversationTarget) =>
  Effect.gen(function* () {
    const listed = yield* defaultMachinesOf(target);
    const owners = [...new Set(listed.map((machine) => machine.owner.userId))];
    const settings = new Map((yield* commandMachinesOf(owners)).map((row) => [row.id, row]));

    return listed.map((machine) => {
      const row = settings.get(machine.id);

      return {
        id: machine.id,
        name: machine.name,
        owner: machine.owner,
        online: machine.online,
        commandMode: row?.commandMode ?? null,
        computer: computerUseOf(row?.computerUse ?? null),
      };
    });
  });

/** One call of `list_machines` by a coding agent: where a start may run, as its starter's, and where its Mac tools may go. */
export function runAgentListMachines(
  starterId: string,
  target: ConversationTarget,
  input: UnparsedWireValue,
) {
  if (Result.isFailure(readAsked(input))) {
    return Effect.succeed(agentToolRejected(LIST_MACHINES_REFUSAL.UNREADABLE));
  }

  return orStoreRefusal(
    Effect.gen(function* () {
      const answer: WireRecord = {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        runsOn: yield* runsOnOf(starterId),
        macTools: yield* macToolsOf(target),
      };

      return answer;
    }),
  );
}

/** One call of `list_machines` through the member MCP server: where a start may run the member's agents. */
export function runMemberListMachines(userId: string) {
  return orStoreRefusal(
    Effect.map(
      runsOnOf(userId),
      (runsOn): WireRecord => ({ status: ACTION_RESULT_STATUS.ACCEPTED, runsOn }),
    ),
  );
}
