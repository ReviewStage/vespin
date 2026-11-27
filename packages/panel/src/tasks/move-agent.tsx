import {
  type MovedAgent,
  moveDetail,
  movePlaces,
  TO_THE_CLOUD,
} from "@repo/features/agent-move-model";
import {
  AGENT_MACHINE,
  type AgentAttachment,
  type AgentRunsOnRequest,
} from "@repo/features/agent-wire";
import { machineName } from "@repo/features/machine-name";
import type { MacOffer } from "@repo/features/models-wire";
import { agentStillWriting, RUNS_ON_WORDS } from "@repo/features/task-agents-model";
import { EXPERIMENT } from "@repo/settings";
import { GLYPH } from "@repo/ui/icons";
import { useQuery } from "@tanstack/react-query";
import { commandHead, PANEL_COMMAND } from "../command-items.js";
import type { MenuAction, MenuSubmenu } from "../desktop/action-menu.js";
import { useDevicePresence } from "../device-presence.js";
import { useThisMac } from "../machine-name.js";
import { appStateQuery, selectExperiment } from "../use-app-state.js";
import { deviceMark } from "./runs-on.js";
import type { AgentsControl } from "./use-agents.js";

/**
 * move-agent.tsx -- an agent moved between the cloud and the member's own devices: its menu's Move to ›, and its message box's place chip, which move it in the same agent; and Move to cloud, which continues an agent its Mac could not run in a new one there.
 *
 * Move to and the place chip move the agent itself (`use-agents.ts`'s
 * `onMove`, the service's `coder-host/move.ts`): it keeps its id, its tab,
 * its transcript, its branch and pull request, and only where it runs
 * changes, the transcript marking where it moved. A cloud agent's work, what
 * it had not committed included, is copied to a branch it is told to fetch;
 * an agent on a device brings only what it pushed, which each place says
 * under its name, and its folder stays on that device. A refusal is said in
 * a toast. Move to lists Cloud, then each device the member registered, by
 * what every list of machines calls it, its glyph wearing its standing's dot
 * (`runs-on.tsx`), less the place the agent runs now, or the cloud alone for
 * an agent on a device the service did not name; a device that takes no
 * agent now is listed dimmed, saying why. It stands only where the agent
 * is not archived and nothing archived is drawn. On an agent still writing,
 * a move stops it first as Stop does, and moves it only once the Stop took,
 * so its session ends on a whole step; it then waits at the new place for
 * the member's next message, as any stopped agent does. Each place says so,
 * and a Stop refused or with nothing to stop yet moves nothing, its toast
 * saying why. Note that it also stands only where the control lists the
 * agent, its task's or its own page's, because a surface drawing agents of
 * other tasks, such as a person's page, hands the open task's control.
 *
 * Move to cloud (`useMoveToCloud`) is a continue onto a new agent in the
 * cloud (`use-agents.ts`'s `continueAgent` with a `runsOn`), carrying on the
 * message its Mac did not take, since it serves an agent whose Mac went
 * offline or could not start it, which an in-place move could not stop
 * first.
 */

/**
 * Whether the member has Move agents on (`EXPERIMENT.MOVE_AGENTS`), which
 * Move to › and the place chip's menu stand behind. Note that Move to cloud
 * (`useMoveToCloud`) stands without it, because it is how an agent whose Mac
 * went offline or could not start it goes on at all.
 */
function useMoveAgentsOn(): boolean {
  return (
    useQuery({ ...appStateQuery, select: selectExperiment(EXPERIMENT.MOVE_AGENTS) }).data === true
  );
}

/** No devices, held steady for a member with none, or while the menu offers no move. */
const NO_DEVICES: readonly MacOffer[] = [];

/**
 * The agents a move is out for in this window, from its Stop to its
 * continue's answer. Note that a second pick meanwhile is dropped, because
 * each place's continue takes its own key, so two picks would start two
 * agents; it is the window's alone, since every surface offering a move
 * shares it.
 */
const MOVING = new Set<string>();

/** What Move to reads of the control: where a continue could start, the agents it lists, the member's devices, the move, and the Stop a move of an agent still writing presses first. */
type MoveDoors = Pick<
  AgentsControl,
  "agents" | "continueAgent" | "macs" | "onUnarchive" | "onStop" | "onMove"
>;

/** Whether the agent offers a move at all, on the terms the header says. */
function useMoveOffered(agent: MovedAgent | undefined, agents: MoveDoors): boolean {
  return (
    agent !== undefined &&
    agents.onUnarchive === undefined &&
    agents.agents?.some((each) => each.id === agent.id) === true &&
    agent.archivedAt === undefined
  );
}

/** A message a move carries on as the continued agent's first: one its own machine did not take. */
export interface MoveCarry {
  readonly words: string;
  readonly attachments: readonly AgentAttachment[];
}

/** The agent continued at a place, stopped first where it still writes, and left as it was where the Stop did not take, which says why in its toast, or where a move of it is already out (`MOVING`). */
function movedBy(
  agent: MovedAgent,
  {
    continueAgent,
    onStop,
  }: Pick<MoveDoors, "onStop"> & { continueAgent: NonNullable<MoveDoors["continueAgent"]> },
): (runsOn: AgentRunsOnRequest, carry?: MoveCarry) => Promise<void> {
  const writing = agentStillWriting(agent.status);

  return async (runsOn, carry) => {
    if (MOVING.has(agent.id)) return;
    MOVING.add(agent.id);

    try {
      if (writing && !(await onStop(agent.id))) return;
      await continueAgent(agent.id, carry?.words, carry?.attachments ?? [], runsOn);
    } finally {
      MOVING.delete(agent.id);
    }
  };
}

/** The agent moved in place to a place, stopped first where it still writes, and left as it was where the Stop did not take, which says why in its toast, or where a move of it is already out (`MOVING`). */
function movedInPlace(
  agent: MovedAgent,
  { onMove, onStop }: Pick<MoveDoors, "onMove" | "onStop">,
): (runsOn: AgentRunsOnRequest) => Promise<void> {
  const writing = agentStillWriting(agent.status);

  return async (runsOn) => {
    if (MOVING.has(agent.id)) return;
    MOVING.add(agent.id);

    try {
      if (writing && !(await onStop(agent.id))) return;
      await onMove(agent.id, runsOn);
    } finally {
      MOVING.delete(agent.id);
    }
  };
}

/**
 * The agent moved to the cloud, as Move to's Cloud does, for a surface that
 * offers that move alone, such as a launch its Mac could not start, or its
 * Mac gone offline, the message the Mac did not take carried on where one
 * is handed; none where Move to would not offer the cloud: no move offered,
 * or an agent already in the cloud.
 */
export function useMoveToCloud(
  agent: MovedAgent,
  agents: MoveDoors,
): ((carry?: MoveCarry) => void) | undefined {
  const offered = useMoveOffered(agent, agents);
  const { continueAgent } = agents;

  if (!offered || continueAgent === undefined || agent.machine !== AGENT_MACHINE.DEVICE)
    return undefined;
  const move = movedBy(agent, { continueAgent, onStop: agents.onStop });

  return (carry) => void move(TO_THE_CLOUD, carry);
}

/** What an agent's place chip moves it by: the member's devices, the move to a place, and what each other place says under its name. */
export interface PlaceMove {
  readonly devices: readonly MacOffer[];
  readonly moveTo: (runsOn: AgentRunsOnRequest) => void;
  /** Whether the agent runs on a device, so a move takes only what it pushed. */
  readonly pushedOnly: boolean;
  /** What the chip's menu says under each place but the agent's own (`moveDetail`); none where it says nothing. */
  readonly detail: string | undefined;
}

/**
 * The move an agent's place chip offers, on the terms Move to › offers one
 * (`useMoveOffered`): the member's devices and the move that carries
 * the agent to a place picked, or none where no move is offered or the
 * agent is not read yet, and none while Move agents is off. Note that it stands though the member has no
 * device, since the chip then says where one is added, rather than taking
 * no press.
 */
export function useMovePlace(
  agent: MovedAgent | undefined,
  agents: MoveDoors,
): PlaceMove | undefined {
  const on = useMoveAgentsOn();
  const offered = useMoveOffered(agent, agents) && on;

  if (agent === undefined || !offered) return undefined;
  const move = movedInPlace(agent, agents);

  return {
    devices: agents.macs ?? NO_DEVICES,
    moveTo: (runsOn) => void move(runsOn),
    pushedOnly: agent.machine === AGENT_MACHINE.DEVICE,
    detail: moveDetail(agent),
  };
}

/** The agent's Move to ›, the places it may move to, or none where it offers no move, Move agents is off, or it has nowhere to go. */
export function useMoveToEntry(agent: MovedAgent, agents: MoveDoors): MenuSubmenu | undefined {
  const on = useMoveAgentsOn();
  const offered = useMoveOffered(agent, agents) && on;
  const devices = (offered ? agents.macs : undefined) ?? NO_DEVICES;
  // Note that the beats are read only while a device is listed, so a member with none reads nothing.
  const book = useDevicePresence(devices.length > 0);
  const thisMac = useThisMac();

  if (!offered) return undefined;
  const said = moveDetail(agent);
  const move = movedInPlace(agent, agents);
  const moveTo = (runsOn: AgentRunsOnRequest) => () => void move(runsOn);
  const places = movePlaces(agent, devices);

  const cloud: MenuAction[] = places.cloud
    ? [
        {
          label: RUNS_ON_WORDS.CLOUD,
          icon: <GLYPH.CLOUD />,
          detail: said,
          onSelect: moveTo(TO_THE_CLOUD),
        },
      ]
    : [];

  const items = [
    ...cloud,
    ...places.devices.map((device): MenuAction => {
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
