import { DEVICE_STANDING } from "@repo/features/agent-wire";
import { machineName } from "@repo/features/machine-name";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import type { DefaultMachine, WorkspaceToolsAnswer } from "@repo/features/workspace-tools-wire";
import { ACT_KIND } from "@repo/host/acts";
import {
  type MenuRow,
  STATUS_TONE,
  StatusWords,
  SUBMENU_WIDTH,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  VisuallyHidden,
} from "@repo/ui";
import { personActor } from "@repo/ui/actor-model";
import { GLYPH } from "@repo/ui/icons";
import { ReplayWords } from "@repo/ui/session-replay-marks";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { askAct, toastActFailure } from "../act.js";
import { ACTOR_SIZE, ActorMark } from "../actor-ref.js";
import { workspaceToolsQuery } from "../live-reads.js";
import { useThisMac } from "../machine-name.js";
import { useMemberDirectory } from "../member-directory.js";
import { showToast } from "../toast.js";
import { DeviceStandingGlyph } from "./runs-on.js";

/**
 * agent-machines.tsx -- the machine an agent's terminal commands and computer use go to: its Default machine row in the Cloud chip's popover, and the machine a call still unanswered names.
 *
 * The agent's tools as the service answers them (`LIVE_READ.WORKSPACE_TOOLS`)
 * say where a call naming no machine would go now (`runOnMac.machine`), and
 * the machines its default may be set to: those of the people who let the
 * task's agents use theirs, online or not. The Default machine row names
 * the machine a call would go to, its dot green while it listened lately
 * and gray while it did not, so a default that went offline stays the
 * default and says so; a call to it is refused with the reason. Its submenu
 * lists each machine with the same dot and its owner's face, an offline one
 * still picked, since it may come back, and a pick sets the agent's default
 * on the service, which answers the agent's tools as they then stand. An
 * agent offered no `run_on_mac`, one on a device, has no such row.
 */

/** The Default machine row's id, which no place's id is. */
const DEFAULT_MACHINE_ROW = "default-machine";

/** What the Default machine row and its submenu say. */
const DEFAULT_MACHINE_WORDS = {
  LABEL: "Default machine",
  HEADING: "Terminal commands and computer use go here",
  NOTE: "Machines of followers who let agents use them",
  NONE: "None",
  OFFLINE: "Offline",
  REFUSED: "The default machine could not be changed.",
} as const;

/** The agent's tools as the window holds them; none before they are read, and for no agent. */
function useAgentTools(agentId: string | undefined): WorkspaceToolsAnswer | undefined {
  return useQuery(workspaceToolsQuery(agentId)).data;
}

/** The machine a call the agent makes now would go to, by its id and name, the same object while neither moved; none where the service names none. */
export function useRoutedMachine(
  agentId: string | undefined,
): { readonly id: string; readonly name: string } | undefined {
  const machine = useAgentTools(agentId)?.runOnMac?.machine;
  const id = machine?.id;
  const name = machine?.name;

  return useMemo(
    () => (id === undefined || name === undefined ? undefined : { id, name }),
    [id, name],
  );
}

/** The agent's default machine set on the service, a refusal said in a toast. */
function setDefaultMachine(agentId: string, machineId: string): void {
  void askAct(ACT_KIND.AGENTS_SET_DEFAULT_MACHINE, { agentId, machineId }).then(
    (answer) => {
      if (!("failure" in answer)) return;
      showToast({
        replayUnmasked: true,
        words: DEFAULT_MACHINE_WORDS.REFUSED,
        tone: STATUS_TONE.DANGER,
        failure: { surface: FAILURE_SURFACE.ACT, cause: answer, about: { agentId } },
      });
    },
    (cause: unknown) =>
      toastActFailure({
        surface: FAILURE_SURFACE.ACT,
        act: ACT_KIND.AGENTS_SET_DEFAULT_MACHINE,
        cause,
        about: { agentId },
      }),
  );
}

/** The value the row ends in: the machine's name led by its dot, "Offline" told to a reader where it is gray, or None. */
function DefaultValue({
  name,
  online,
}: {
  name: string | undefined;
  online: boolean;
}): React.JSX.Element {
  if (name === undefined) {
    return (
      <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
        {DEFAULT_MACHINE_WORDS.NONE}
      </Text>
    );
  }

  return (
    <ReplayWords masked>
      <StatusWords tone={online ? STATUS_TONE.COMPLETE : STATUS_TONE.NEUTRAL}>{name}</StatusWords>
      {online ? null : <VisuallyHidden>{`, ${DEFAULT_MACHINE_WORDS.OFFLINE}`}</VisuallyHidden>}
    </ReplayWords>
  );
}

/**
 * The Default machine row of the agent's place popover, as the module
 * says; none for an agent offered no `run_on_mac`, or before its tools are
 * read. Note that a machine none of the list names, as the owner's from
 * before machines were named, is named as the answer names it.
 */
export function useDefaultMachineRow(agentId: string): MenuRow | undefined {
  const tools = useAgentTools(agentId);
  const thisMac = useThisMac();
  const { members, readerId, former } = useMemberDirectory();
  const standing = tools?.runOnMac;

  if (standing === undefined) return undefined;
  const machines: readonly DefaultMachine[] = tools?.machines ?? [];
  const listed = machines.map((machine) => ({ deviceId: machine.id, name: machine.name }));

  const nameOf = (machine: { readonly id: string; readonly name: string }) =>
    machineName({ deviceId: machine.id, name: machine.name }, listed, thisMac);

  const chosen = standing.machine;
  const online = machines.find((machine) => machine.id === chosen?.id)?.online ?? standing.on;

  return {
    id: DEFAULT_MACHINE_ROW,
    label: DEFAULT_MACHINE_WORDS.LABEL,
    icon: <GLYPH.DESKTOP aria-hidden="true" />,
    end: <DefaultValue name={chosen === undefined ? undefined : nameOf(chosen)} online={online} />,
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
                icon: (
                  <DeviceStandingGlyph
                    device={undefined}
                    standing={machine.online ? DEVICE_STANDING.ONLINE : DEVICE_STANDING.OFFLINE}
                  />
                ),
                end: (
                  <ActorMark
                    actor={personActor(machine.owner, members, readerId, former)}
                    size={ACTOR_SIZE.MARK}
                  />
                ),
                replayMasked: true,
              }),
            ),
            value: chosen?.id,
            note: DEFAULT_MACHINE_WORDS.NOTE,
            width: SUBMENU_WIDTH.WIDE,
            onPick: (machineId) => {
              if (machineId !== chosen?.id) setDefaultMachine(agentId, machineId);
            },
          },
  };
}
