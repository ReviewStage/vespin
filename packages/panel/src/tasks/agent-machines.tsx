import { machineName } from "@repo/features/machine-name";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import type { DefaultMachine, WorkspaceToolsAnswer } from "@repo/features/workspace-tools-wire";
import { ACT_KIND } from "@repo/host/acts";
import {
  GAP,
  Inline,
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
 * agent-machines.tsx -- the machine an agent's terminal commands and computer use go to: its Default machine row in its place chip's popover, and the machine a call still unanswered names.
 *
 * The agent's tools as the service answers them (`LIVE_READ.WORKSPACE_TOOLS`)
 * say where a call naming no machine would go now (`runOnMac.machine`), and
 * the machines its default may be set to: those of the people who let the
 * task's agents use theirs, online or not. The Default machine row names
 * the machine a call would go to as its submenu draws it, its glyph's dot
 * green while it listened lately and gray while it did not, so a default
 * that went offline stays the default and says so; a call to it is refused
 * with the reason. Its submenu, under the one heading that says what it is
 * for, lists each machine with the same dot and its owner's face, an offline one
 * still picked, since it may come back, and a pick sets the agent's default
 * on the service, which answers the agent's tools as they then stand. A
 * local agent with no default reads None, since a call naming no machine
 * would go to the one it runs on, whose own shell runs it. An agent
 * offered no `run_on_mac` has no such row.
 */

/** The Default machine row's id, which no place's id is. */
const DEFAULT_MACHINE_ROW = "default-machine";

/** What the Default machine row and its submenu say. */
const DEFAULT_MACHINE_WORDS = {
  LABEL: "Commands run on",
  /** What the row says under its label of an agent that runs apart from the machine, as a cloud agent does; computer use only on a Mac, since only the desktop app ships its helper. */
  APART: `${PRODUCT_NAME} there runs its terminal commands, and on a Mac its computer use too. If that machine goes offline, the agent keeps running.`,
  HEADING: "Commands run here",
  NONE: "None",
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
        words: DEFAULT_MACHINE_WORDS.REFUSED,
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

/** The value a row of the place popover ends in, muted: a teammate's face where the machine is theirs, then its name; or None, for the Default machine row with none. */
export function MachineValue({
  name,
  face,
}: {
  name: string | undefined;
  face: React.ReactNode;
}): React.JSX.Element {
  const words = (
    <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
      {name === undefined ? DEFAULT_MACHINE_WORDS.NONE : <ReplayWords masked>{name}</ReplayWords>}
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

/**
 * The Default machine row of the agent's place popover, as the module
 * says; none for an agent offered no `run_on_mac`, or before its tools are
 * read. A pick is drawn as the default from the press, while the service
 * has yet to answer (`usePickedMachine`). Note that a machine none of the list names, as
 * the owner's from before machines were named, is named as the answer
 * names it.
 */
export function useDefaultMachineRow(
  agentId: string,
  /** Whether the agent runs apart from the machine its commands go to, as a cloud agent does, so it keeps running while that machine is offline. */
  apart = false,
): MenuRow | undefined {
  const tools = useAgentTools(agentId);
  const { mutate: setDefault } = useMutation(defaultMachineMutation(agentId));
  const pickedId = usePickedMachine(agentId);
  const thisMac = useThisMac();
  const { members, readerId, former } = useMemberDirectory();
  const standing = tools?.runOnMac;

  if (standing === undefined) return undefined;
  const machines: readonly DefaultMachine[] = tools?.machines ?? [];
  const listed = machines.map((machine) => ({ deviceId: machine.id, name: machine.name }));

  const nameOf = (machine: { readonly id: string; readonly name: string }) =>
    machineName({ deviceId: machine.id, name: machine.name }, listed, thisMac);

  const picked = machines.find((machine) => machine.id === pickedId);

  const chosen = picked ?? standing.machine;
  const owner = picked?.owner ?? standing.owner;
  const online = machines.find((machine) => machine.id === chosen?.id)?.online ?? standing.on;

  // Note that only a teammate's machine wears its owner's face, since the reader's own needs no saying whose it is.
  const faceOf = (owner: DefaultMachine["owner"]) =>
    owner.userId === readerId ? undefined : (
      <ActorMark actor={personActor(owner, members, readerId, former)} size={ACTOR_SIZE.INLINE} />
    );

  return {
    id: DEFAULT_MACHINE_ROW,
    label: DEFAULT_MACHINE_WORDS.LABEL,
    icon:
      chosen === undefined ? (
        <GLYPH.DESKTOP aria-hidden="true" />
      ) : (
        <MachineGlyph machine={{ online }} />
      ),
    end: (
      <MachineValue
        name={chosen === undefined ? undefined : nameOf(chosen)}
        face={chosen === undefined ? undefined : faceOf(owner)}
      />
    ),
    // Note that the line under the label stands only for a cloud agent, which keeps running without the machine.
    detail: apart && chosen !== undefined ? DEFAULT_MACHINE_WORDS.APART : undefined,
    detailUnder: true,
    submenu:
      machines.length === 0
        ? undefined
        : {
            label: DEFAULT_MACHINE_WORDS.HEADING,
            heading: DEFAULT_MACHINE_WORDS.HEADING,
            rows: machines.map(
              (machine): MenuRow => ({
                id: machine.id,
                label: nameOf(machine),
                icon: <MachineGlyph machine={machine} />,
                before: faceOf(machine.owner),
                replayMasked: true,
              }),
            ),
            value: chosen?.id,
            width: SUBMENU_WIDTH.WIDE,
            onPick: (machineId) => {
              if (machineId !== chosen?.id) setDefault({ agentId, machineId });
            },
          },
  };
}
