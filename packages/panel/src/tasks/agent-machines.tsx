import { DEVICE_PLATFORM } from "@repo/features/device-agent-wire";
import { machineName } from "@repo/features/machine-name";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import type { DefaultMachine, WorkspaceToolsAnswer } from "@repo/features/workspace-tools-wire";
import { ACT_KIND } from "@repo/host/acts";
import {
  Badge,
  GAP,
  Inline,
  type MenuLastLine,
  type MenuRow,
  STATUS_TONE,
  SUBMENU_WIDTH,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import { personActor } from "@repo/ui/actor-model";
import { GLYPH } from "@repo/ui/icons";
import { ReplayWords } from "@repo/ui/session-replay-marks";
import {
  type Mutation,
  mutationOptions,
  useMutation,
  useMutationState,
  useQuery,
} from "@tanstack/react-query";
import { useMemo } from "react";
import { type ActResult, type ActVariables, toastActFailure } from "../act.js";
import { actMutation } from "../act-mutations.js";
import { ACTOR_SIZE, ActorMark } from "../actor-ref.js";
import { workspaceToolsQuery } from "../live-reads.js";
import { useThisMac } from "../machine-name.js";
import { useMemberDirectory } from "../member-directory.js";
import { showToast } from "../toast.js";
import { MachineGlyph } from "./workspace-machines.js";

/**
 * agent-machines.tsx -- the machines an agent may run terminal commands and computer use on: their list in its place chip's popover, and the machine a call still unanswered names.
 *
 * The agent's tools as the service answers them (`LIVE_READ.WORKSPACE_TOOLS`)
 * say where a call naming no machine would go now (`runOnMac.machine`), and
 * the machines a call may name: those of the people who let the task's
 * agents use theirs, online or not. Note that the agent itself runs
 * elsewhere, in its sandbox or on its own device, and reaches these only
 * for a call, so the popover lists them apart from where it runs, under
 * "It can also run commands on", rather than as a second place, and names
 * the default as the machine a call naming none goes to, not the only one.
 * A default that went offline stays the default and says so; a call to it
 * is refused with the reason. A pick sets the agent's default on the
 * service, which answers the agent's tools as they then stand. A local
 * agent with no default marks none, since a call naming no machine would go
 * to the one it runs on, whose own shell runs it. An agent offered no
 * `run_on_mac` lists none.
 */

/** The All row's id, which no machine's id is. */
const ALL_MACHINES_ROW = "all-machines";

/** What the machine list says: its heading, each machine's uses and end, the All row, and the line under the list. */
const MACHINE_LIST_WORDS = {
  HEADING: "It can also run commands on",
  USES_MAC: "Terminal · Computer use",
  USES_OTHER: "Terminal",
  DEFAULT: "Default",
  OFFLINE: "Offline",
  all: (count: number) => `All ${count} machines`,
  more: (count: number) => `${count} more`,
  NOTE: "It chooses a machine per command. Pick a machine to make it the default.",
  REFUSED: "The default machine could not be changed.",
} as const;

/** The agent's tools as the window holds them; none before they are read, and for no agent. */
function useAgentTools(agentId: string | undefined): WorkspaceToolsAnswer | undefined {
  return useQuery(workspaceToolsQuery(agentId)).data;
}

/** A machine a call still unanswered names, by its id and name. */
export interface CallRouteMachine {
  readonly id: string;
  readonly name: string;
}

/** The machine a call still unanswered goes to, given the id of the machine it names, none where it names none; none where the window cannot tell. */
export type CallRoute = (named: string | undefined) => CallRouteMachine | undefined;

/**
 * Where a call the agent makes now goes, as the service routes it
 * (`machine-routing.ts`): the machine it names, found among those the agent
 * may use, or else the one a call naming none goes to now. A call naming a
 * machine the agent's tools do not list goes unnamed until it answers,
 * rather than naming the default it does not go to.
 */
function callRouteOf(tools: WorkspaceToolsAnswer | undefined): CallRoute {
  const routed = tools?.runOnMac?.machine;
  const machines = tools?.machines ?? [];

  return (named) => {
    const machine = named === undefined ? routed : machines.find((listed) => listed.id === named);

    return machine === undefined ? undefined : { id: machine.id, name: machine.name };
  };
}

/** Where a call the agent makes now goes (`callRouteOf`), the same door while the agent's tools stand as they were. */
export function useCallRoute(agentId: string | undefined): CallRoute {
  const tools = useAgentTools(agentId);

  return useMemo(() => callRouteOf(tools), [tools]);
}

/**
 * The agent's default machine set on the service, as a mutation of the row's
 * own: each refusal or failure said in a toast, as the mutation's options
 * hear every call, a choice a later one replaced among them.
 */
function defaultMachineMutation(agentId: string) {
  return mutationOptions({
    ...actMutation(ACT_KIND.AGENTS_SET_DEFAULT_MACHINE),
    onSuccess: (answer) => {
      if (!("failure" in answer)) return;
      showToast({
        replayUnmasked: true,
        words: MACHINE_LIST_WORDS.REFUSED,
        tone: STATUS_TONE.DANGER,
        failure: { surface: FAILURE_SURFACE.ACT, cause: answer, about: { agentId } },
      });
    },
    onError: (cause) =>
      toastActFailure({
        surface: FAILURE_SURFACE.ACT,
        act: ACT_KIND.AGENTS_SET_DEFAULT_MACHINE,
        cause,
        about: { agentId },
      }),
  });
}

/** A pick of the agent's default machine, as its act asks it. */
type DefaultMachinePick = ActVariables<typeof ACT_KIND.AGENTS_SET_DEFAULT_MACHINE>;

/** A pick as the window's mutations hold it: what it asked, whether it is still out, and when it was made. */
interface PickState {
  readonly pick: DefaultMachinePick | undefined;
  readonly out: boolean;
  readonly at: number;
}

/**
 * The machine the agent's newest pick set its default to while that pick is
 * still out, read from the window's mutations (`useMutationState`), as the
 * Optimistic Updates guide reads another component's, so every surface
 * drawing the agent's row draws the pick, one mounted since among them.
 * None once the newest pick answered, so the default the service holds
 * stands then, whatever an older pick still out asked for.
 */
function usePickedMachine(agentId: string): string | undefined {
  const picks = useMutationState<
    PickState,
    Mutation<ActResult<typeof ACT_KIND.AGENTS_SET_DEFAULT_MACHINE>, Error, DefaultMachinePick>
  >({
    filters: { mutationKey: actMutation(ACT_KIND.AGENTS_SET_DEFAULT_MACHINE).mutationKey },
    select: (mutation) => ({
      pick: mutation.state.variables,
      out: mutation.state.status === "pending",
      at: mutation.state.submittedAt,
    }),
  });

  const newest = picks
    .filter((each) => each.pick?.agentId === agentId)
    .reduce<PickState | undefined>(
      (latest, each) => (latest === undefined || each.at >= latest.at ? each : latest),
      undefined,
    );

  return newest?.out === true ? newest.pick?.machineId : undefined;
}

/** The value a row of the place popover ends in, muted: a teammate's face where the machine is theirs, then its name. */
export function MachineValue({
  name,
  face,
}: {
  name: string;
  face: React.ReactNode;
}): React.JSX.Element {
  const words = (
    <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
      <ReplayWords masked>{name}</ReplayWords>
    </Text>
  );

  if (face === undefined) return words;

  return (
    <Inline gap={GAP.ICON} wrap={false}>
      {face}
      {words}
    </Inline>
  );
}

/** How many machines the popover lists before the rest fold into the All row, which it draws only where it would fold two or more, since a row folding one is no shorter than that one. */
const MACHINES_LISTED = 3;

/** What the agent may do on a machine, by its platform: computer use only on a Mac, since only the desktop app ships its helper, and terminal commands alone where an older service names no platform. */
function machineUses(machine: DefaultMachine): string {
  return machine.platform === DEVICE_PLATFORM.DARWIN
    ? MACHINE_LIST_WORDS.USES_MAC
    : MACHINE_LIST_WORDS.USES_OTHER;
}

/** The machines the popover lists first: the default, then those online now, each kept in the order the service answers them, the one that listened last first. */
function machinesFirst(
  machines: readonly DefaultMachine[],
  chosenId: string | undefined,
): readonly DefaultMachine[] {
  const rank = (machine: DefaultMachine) => (machine.id === chosenId ? 0 : machine.online ? 1 : 2);

  return [...machines].sort((one, other) => rank(one) - rank(other));
}

/** The machines an agent may run commands on, as its place popover lists them: the rows under their heading, what a pick does, and the line that says so. */
export interface ReachableMachines {
  readonly rows: readonly MenuRow[];
  readonly onPick: (id: string) => void;
  readonly lastLine: MenuLastLine;
}

/**
 * The machines an agent may run commands on, as its place popover lists
 * them under "It can also run commands on"; none for an agent offered no
 * `run_on_mac`, before its tools are read, or where it may reach no machine.
 * Each row names the machine with its glyph and dot, a teammate's face
 * before it, what the agent may do there under it, and at its end Default
 * where a call naming no machine goes there, else Offline where it did not
 * listen lately. The first few stand in the popover (`machinesFirst`), and
 * the rest fold into an All row whose submenu lists every one, the default
 * checked. A pick of a machine, in either, sets the agent's default, drawn
 * from the press while the service has yet to answer (`usePickedMachine`).
 */
export function useReachableMachines(agentId: string): ReachableMachines | undefined {
  const tools = useAgentTools(agentId);
  const { mutate: setDefault } = useMutation(defaultMachineMutation(agentId));
  const pickedId = usePickedMachine(agentId);
  const thisMac = useThisMac();
  const { members, readerId, former } = useMemberDirectory();
  const machines: readonly DefaultMachine[] = tools?.machines ?? [];

  if (tools?.runOnMac === undefined || machines.length === 0) return undefined;
  const chosenId = pickedId ?? tools.runOnMac.machine?.id;
  const listed = machines.map((machine) => ({ deviceId: machine.id, name: machine.name }));

  const nameOf = (machine: DefaultMachine) =>
    machineName({ deviceId: machine.id, name: machine.name }, listed, thisMac);

  // Note that only a teammate's machine wears its owner's face, since the reader's own needs no saying whose it is.
  const faceOf = (owner: DefaultMachine["owner"]) =>
    owner.userId === readerId ? undefined : (
      <ActorMark actor={personActor(owner, members, readerId, former)} size={ACTOR_SIZE.INLINE} />
    );

  const endOf = (machine: DefaultMachine) => {
    if (machine.id === chosenId) return <Badge>{MACHINE_LIST_WORDS.DEFAULT}</Badge>;

    return machine.online ? undefined : (
      <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
        {MACHINE_LIST_WORDS.OFFLINE}
      </Text>
    );
  };

  const rowOf = (machine: DefaultMachine): MenuRow => ({
    id: machine.id,
    label: nameOf(machine),
    icon: <MachineGlyph machine={machine} />,
    before: faceOf(machine.owner),
    detail: machineUses(machine),
    detailUnder: true,
    end: endOf(machine),
    section: MACHINE_LIST_WORDS.HEADING,
    replayMasked: true,
  });

  const pick = (machineId: string) => {
    if (machineId !== chosenId) setDefault({ agentId, machineId });
  };

  const ordered = machinesFirst(machines, chosenId);
  const listing = ordered.length <= MACHINES_LISTED + 1 ? ordered.length : MACHINES_LISTED;
  const shown = ordered.slice(0, listing).map(rowOf);
  const folded = ordered.length - listing;

  const all: readonly MenuRow[] =
    folded <= 0
      ? []
      : [
          {
            id: ALL_MACHINES_ROW,
            label: MACHINE_LIST_WORDS.all(ordered.length),
            icon: <GLYPH.MORE aria-hidden="true" />,
            end: (
              <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                {MACHINE_LIST_WORDS.more(folded)}
              </Text>
            ),
            section: MACHINE_LIST_WORDS.HEADING,
            submenu: {
              label: MACHINE_LIST_WORDS.HEADING,
              heading: MACHINE_LIST_WORDS.HEADING,
              rows: ordered.map((machine) => ({
                ...rowOf(machine),
                end: undefined,
                section: undefined,
              })),
              value: chosenId,
              width: SUBMENU_WIDTH.WIDE,
              onPick: pick,
            },
          },
        ];

  return {
    rows: [...shown, ...all],
    onPick: (id) => {
      // Note that a press on the All row opens its submenu rather than picking, so only a machine's id sets the default.
      if (machines.some((machine) => machine.id === id)) pick(id);
    },
    lastLine: { words: MACHINE_LIST_WORDS.NOTE },
  };
}
