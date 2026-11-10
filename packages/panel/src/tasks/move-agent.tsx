import {
  AGENT_MACHINE,
  type AgentRunsOnRequest,
  type AgentSummary,
} from "@repo/features/agent-wire";
import type { MacOffer } from "@repo/features/models-wire";
import { agentStillWriting, RUNS_ON_WORDS } from "@repo/features/task-agents-model";
import { EXPERIMENT } from "@repo/settings";
import { GLYPH } from "@repo/ui/icons";
import { useQuery } from "@tanstack/react-query";
import { commandHead, PANEL_COMMAND } from "../command-items.js";
import type { MenuAction, MenuSubmenu } from "../desktop/action-menu.js";
import { useDevicePresence } from "../device-presence.js";
import { machineName, useThisMac } from "../machine-name.js";
import { appStateQuery, selectExperiment } from "../use-app-state.js";
import { deviceMark } from "./runs-on.js";
import type { AgentsControl } from "./use-agents.js";

/**
 * move-agent.tsx -- an agent moved between the cloud and the member's own devices: its menu's Move to ›, and its message box's place chip, each of which continues it at the place picked.
 *
 * A move is a continue onto another place (`use-agents.ts`'s
 * `continueAgent` with a `runsOn`), not a mechanism of its own: the service
 * stops the source, replays its transcript into a new agent at the place,
 * named `<title> (continued)`, and copies a cloud source's work, what it had
 * not committed included, to a branch of its own; the new agent's tab opens
 * as a continue's does, and a refusal is said in a toast. An agent on a
 * device brings only what it pushed, which each place says under its name,
 * and its folder stays on that device. Move to lists Cloud, then each device
 * the member registered, by what every list of machines calls it, its glyph
 * wearing its standing's dot (`runs-on.tsx`), less the place the agent runs
 * now, or the cloud alone for an agent on a device the service did not name;
 * a device that takes no agent now is listed dimmed, saying why. It
 * stands only while Bring your own host is on, and only where a Continue is
 * offered: where a Start from the agent could run (`continueAgent`), under
 * nothing archived, on an agent not archived. On an agent still writing, a
 * move stops it first as Stop does, and continues it only once the Stop took,
 * so the session it carries ends on a whole step and the work it copies is
 * done being written; each place says so, and a Stop refused or with
 * nothing to stop yet moves nothing, its toast saying why. Note that it also stands
 * only where the control lists the agent, its task's or its own page's,
 * because a surface drawing agents of other tasks, such as a person's page,
 * hands the open task's control, whose continue would start on that task.
 */

/** What Move to says beyond the places' names. */
export const MOVE_WORDS = {
  PUSHED_ONLY: "Only pushed work comes along",
  STOPS_FIRST: "Stops the agent first",
  STOPS_FIRST_PUSHED_ONLY: "Stops the agent first; only pushed work comes along",
} as const;

/** No devices, held steady for a member with none, or while the menu offers no move. */
const NO_DEVICES: readonly MacOffer[] = [];

/** The cloud, as a move names it. */
const TO_THE_CLOUD: AgentRunsOnRequest = { machine: AGENT_MACHINE.VERCEL };

/** The agent a move is offered on, as Move to reads it. */
type MovedAgent = Pick<AgentSummary, "id" | "status" | "archivedAt" | "machine" | "mac">;

/** What Move to reads of the control: where a continue could start, the agents it lists, the member's devices, and the Stop a move of an agent still writing presses first. */
type MoveDoors = Pick<
  AgentsControl,
  "agents" | "continueAgent" | "macs" | "onUnarchive" | "onStop"
>;

/** Whether the agent offers a move at all, on the terms the header says, the continue that carries it aside. */
function useMoveOffered(agent: MovedAgent, agents: MoveDoors): boolean {
  return (
    useQuery({ ...appStateQuery, select: selectExperiment(EXPERIMENT.BRING_YOUR_OWN_HOST) })
      .data === true &&
    agents.onUnarchive === undefined &&
    agents.agents?.some((each) => each.id === agent.id) === true &&
    agent.archivedAt === undefined
  );
}

/** What each place says under its name: that the agent is stopped first while it writes, and that only pushed work comes along from a device; none where neither holds. */
function placeDetail(agent: MovedAgent): string | undefined {
  const pushedOnly = agent.machine === AGENT_MACHINE.DEVICE;
  if (!agentStillWriting(agent.status)) return pushedOnly ? MOVE_WORDS.PUSHED_ONLY : undefined;
  return pushedOnly ? MOVE_WORDS.STOPS_FIRST_PUSHED_ONLY : MOVE_WORDS.STOPS_FIRST;
}

/** The agent continued at a place, stopped first where it still writes, and left where it as it was where the Stop did not take, which says why in its toast. */
function movedBy(
  agent: MovedAgent,
  {
    continueAgent,
    onStop,
  }: Pick<MoveDoors, "onStop"> & { continueAgent: NonNullable<MoveDoors["continueAgent"]> },
): (runsOn: AgentRunsOnRequest) => Promise<void> {
  const writing = agentStillWriting(agent.status);
  return async (runsOn) => {
    if (writing && !(await onStop(agent.id))) return;
    await continueAgent(agent.id, undefined, [], runsOn);
  };
}

/**
 * The agent moved to the cloud, as Move to's Cloud does, for a surface that
 * offers that move alone, such as a launch its Mac could not start; none
 * where Move to would not offer the cloud: no move offered, or an agent
 * already in the cloud.
 */
export function useMoveToCloud(agent: MovedAgent, agents: MoveDoors): (() => void) | undefined {
  const offered = useMoveOffered(agent, agents);
  const { continueAgent } = agents;
  if (!offered || continueAgent === undefined || agent.machine !== AGENT_MACHINE.DEVICE)
    return undefined;
  const move = movedBy(agent, { continueAgent, onStop: agents.onStop });
  return () => void move(TO_THE_CLOUD);
}

/** What an agent's place chip moves it by: the member's devices, the move to a place, and what each other place says under its name. */
export interface PlaceMove {
  readonly devices: readonly MacOffer[];
  readonly moveTo: (runsOn: AgentRunsOnRequest) => void;
  /** Whether the agent runs on a device, so a move takes only what it pushed. */
  readonly pushedOnly: boolean;
  /** What the chip's menu says under each place but the agent's own (`placeDetail`); none where it says nothing. */
  readonly detail: string | undefined;
}

/**
 * The move an agent's place chip offers, on the terms Move to › offers one
 * (`useMoveOffered`): the member's devices and the continue that carries
 * the agent to a place picked, or none where no move is offered. Note that
 * it stands though the member has no device, since the chip then says where
 * one is added, rather than taking no press.
 */
export function useMovePlace(agent: MovedAgent, agents: MoveDoors): PlaceMove | undefined {
  const { continueAgent } = agents;
  const offered = useMoveOffered(agent, agents);
  if (!offered || continueAgent === undefined) return undefined;
  const move = movedBy(agent, { continueAgent, onStop: agents.onStop });
  return {
    devices: agents.macs ?? NO_DEVICES,
    moveTo: (runsOn) => void move(runsOn),
    pushedOnly: agent.machine === AGENT_MACHINE.DEVICE,
    detail: placeDetail(agent),
  };
}

/** The agent's Move to ›, the places it may move to, or none where it offers no move or has nowhere to go. */
export function useMoveToEntry(agent: MovedAgent, agents: MoveDoors): MenuSubmenu | undefined {
  const { continueAgent } = agents;
  const offered = useMoveOffered(agent, agents);
  const devices = (offered ? agents.macs : undefined) ?? NO_DEVICES;
  // Note that the beats are read only while a device is listed, so a member with none reads nothing.
  const book = useDevicePresence(devices.length > 0);
  const thisMac = useThisMac();
  if (!offered || continueAgent === undefined) return undefined;
  const local = agent.machine === AGENT_MACHINE.DEVICE;
  const said = placeDetail(agent);
  const move = movedBy(agent, { continueAgent, onStop: agents.onStop });
  const moveTo = (runsOn: AgentRunsOnRequest) => () => void move(runsOn);
  const cloud: MenuAction[] = local
    ? [
        {
          label: RUNS_ON_WORDS.CLOUD,
          icon: <GLYPH.CLOUD />,
          detail: said,
          onSelect: moveTo(TO_THE_CLOUD),
        },
      ]
    : [];
  // Note that a local agent whose device the service did not name is offered the cloud alone, because
  // any of the devices listed may be the one it runs on.
  const here = local ? agent.mac?.deviceId : undefined;
  const elsewhere =
    local && here === undefined ? NO_DEVICES : devices.filter((each) => each.deviceId !== here);
  const items = [
    ...cloud,
    ...elsewhere.map((device): MenuAction => {
      const { icon, unready } = deviceMark(device, book);
      return {
        label: machineName(device, devices, thisMac),
        key: device.deviceId,
        icon,
        detail: unready ?? said,
        disabled: unready !== undefined,
        onSelect: moveTo({ machine: AGENT_MACHINE.DEVICE, deviceId: device.deviceId }),
      };
    }),
  ];
  return items.length === 0 ? undefined : { ...commandHead(PANEL_COMMAND.MOVE_AGENT), items };
}
