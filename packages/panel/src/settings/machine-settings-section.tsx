import { signedInAccountId } from "@repo/credentials/snapshot";
import type { HostDoneAnswerView, MachineChangeParams } from "@repo/features/agent-view";
import { DEVICE_STANDING } from "@repo/features/agent-wire";
import { DEVICE_PLATFORM } from "@repo/features/device-agent-wire";
import {
  MACHINE_COMMAND_MODE_LIST,
  type MachineCommandMode,
} from "@repo/features/machine-command-wire";
import type { MachineLine } from "@repo/features/machine-live";
import type { ListedMachine } from "@repo/features/machine-name";
import {
  MACHINE_SETTINGS_WORDS,
  MACHINES_WORDS,
  removeCommandMachineQuestion,
} from "@repo/features/machines-settings-words";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { ACT_UNREACHED_WORDS } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import { EXPERIMENT, MACHINE_COMMAND_MODE_LABEL } from "@repo/settings";
import {
  CONFIRM_LOSS,
  ComputerUseIcon,
  ConfirmDialog,
  SETTINGS_ROW_INDENT,
  SettingsRowMark,
  SettingsRowsFold,
  TerminalIcon,
  useConfirmDialog,
} from "@repo/ui";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { actMutation } from "../act-mutations.js";
import { useConfirmAct } from "../confirm-act.js";
import { confirmFailure } from "../failure-report.js";
import { machinesQuery, machinesRetryMutation } from "../live-reads.js";
import { useAllowedApps } from "../tasks/mac-apps.js";
import { appStateQuery, selectAccount, selectExperiment } from "../use-app-state.js";
import { type AllowedApp, AllowedAppList } from "./allowed-app-row.js";
import { type MachineAgentFacts, MachineMark, MachineStandingLine } from "./machine-standing.js";
import { MenuRow } from "./menu-row.js";
import { refusalToast, rowWrite, type SettingRefusal } from "./row-write.js";
import { SelectRow } from "./select-row.js";
import { SwitchRow } from "./switch-row.js";

/**
 * machine-settings-section.tsx -- each of the member's machines' own say over agents, as Settings › Machines draws it under that machine's row: its terminal commands, whether agents may use its apps, and the apps they use unasked; and Remove for a machine that runs no agents.
 *
 * Every machine whose app joined holds these (`LIVE_READ.MACHINES`), changed
 * from any device or the web: each change is the machine's own, kept by the
 * service, drawn at once, and taken by the machine as it lands, or as it
 * next joins where it is offline. Each row is the one Settings draws the
 * same thing with elsewhere: the mode's picker and the switch as every
 * setting's (`SelectRow`, `SwitchRow`), and the apps as Always allowed
 * commands are listed (`allowed-app-row.tsx`). The apps are drawn only where
 * the reader has Computer use on.
 *
 * A machine that runs no agents is listed by its own row here
 * (`CommandMachineRow`), led by whether its app listens now, and can be
 * removed after asking, as a wiped app state leaves one behind; a host is
 * removed as a host is, which also takes it off its box, and This Mac is
 * never offered one, since it would join again at once.
 */

const ACCEPTED: ActionResult = { status: ACTION_RESULT_STATUS.ACCEPTED };

/** A call that got no answer, said in the dialog that asked. */
const UNREACHED: ActionResult = {
  status: ACTION_RESULT_STATUS.REJECTED,
  reason: ACT_UNREACHED_WORDS,
};

/** A remove the service answered with a refusal, said in the dialog that asked. */
const REMOVE_REFUSED: ActionResult = {
  status: ACTION_RESULT_STATUS.REJECTED,
  reason: MACHINES_WORDS.REMOVE_FAILED,
};

/** The command modes as the picker offers them, from least freedom to most, in This Mac's own words. */
const MODE_OPTIONS = MACHINE_COMMAND_MODE_LIST.map((mode) => ({
  value: mode,
  label: MACHINE_COMMAND_MODE_LABEL[mode],
}));

/** A command mode picked by its token; none for one the picker never offered. */
function modeOf(raw: string): MachineCommandMode | undefined {
  return MACHINE_COMMAND_MODE_LIST.find((mode) => mode === raw);
}

/** Why the service refused a machine's change, where it did. */
function changeRefused(answer: HostDoneAnswerView): string | undefined {
  return "failure" in answer ? MACHINE_SETTINGS_WORDS.CHANGE_FAILED : undefined;
}

/** What a machine lets agents do, as its folded row says it under its name; none for a machine whose app never joined, which holds no settings. */
export function machineAgentFacts(
  machine: MachineLine,
  apps: ReadonlyMap<string, AllowedApp> | undefined,
): MachineAgentFacts | undefined {
  const settings = machine.settings;

  if (settings === undefined) return undefined;
  const commands = MACHINE_COMMAND_MODE_LABEL[settings.commandMode];

  // Note that computer use is said only where the reader has it on, as its rows are drawn only there.
  if (apps === undefined) return { commands };
  const count = settings.alwaysAllowedApps.length;

  return {
    commands,
    apps:
      settings.computerUse === false
        ? MACHINE_SETTINGS_WORDS.APPS_OFF
        : count === 0
          ? MACHINE_SETTINGS_WORDS.APPS_ON
          : MACHINE_SETTINGS_WORDS.appsAllowed(count),
  };
}

/** A machine as the list of machines names it (`machineName`). */
export function machineListedOf(machine: MachineLine): ListedMachine {
  return {
    deviceId: machine.id,
    name: machine.name,
    machineId: machine.machineId,
    model: machine.model,
  };
}

/** The machine Remove was asked of, by the account it was asked under, and what the list called it then. */
interface RemoveAsked {
  readonly accountId: string | undefined;
  readonly machine: MachineLine;
  readonly label: string;
}

/**
 * One machine's own settings for agents, inset under its row: how agents'
 * terminal commands run there, and, where the reader has Computer use on,
 * whether agents may use its apps and the apps they use unasked. Nothing
 * for a machine whose app never joined, which holds none.
 */
export function MachineAgentRows({
  machine,
  apps,
}: {
  machine: MachineLine;
  /** How the machine names and draws its apps, by the app they are allowed by; none where Computer use is off, which draws no apps. */
  apps: ReadonlyMap<string, AllowedApp> | undefined;
}): React.JSX.Element | null {
  const commands = useMutation(actMutation(ACT_KIND.MACHINES_CHANGE));

  // Note that a switch puts itself back where its write is refused, and a toast says why, as every setting's switch does.
  const appsSwitch = useMutation({
    ...actMutation(ACT_KIND.MACHINES_CHANGE),
    onSettled: refusalToast(changeRefused),
  });

  const { mutateAsync: sendRemoveApp } = useMutation(actMutation(ACT_KIND.MACHINES_CHANGE));
  const settings = machine.settings;

  if (settings === undefined) return null;
  const { id } = machine;
  // Note that a switch a desktop older than it never carried up stands on, as that desktop's own setting starts.
  const appsOn = settings.computerUse !== false;

  const removeApp = async (bundleId: string): Promise<SettingRefusal | undefined> => {
    const answer = await sendRemoveApp({ id, removeApp: bundleId });
    const words = changeRefused(answer);

    return words === undefined ? undefined : { words, cause: answer };
  };

  return (
    <>
      <SelectRow
        indent={SETTINGS_ROW_INDENT.MARK}
        leading={
          <SettingsRowMark>
            <TerminalIcon />
          </SettingsRowMark>
        }
        label={MACHINE_SETTINGS_WORDS.COMMANDS}
        labelReplayUnmasked
        value={settings.commandMode}
        options={MODE_OPTIONS}
        parse={modeOf}
        write={rowWrite(commands, {
          ask: (commandMode: MachineCommandMode): MachineChangeParams => ({ id, commandMode }),
          refused: changeRefused,
          drawn: (asked) => asked.commandMode ?? settings.commandMode,
        })}
      />
      {apps === undefined ? null : (
        <SettingsRowsFold
          room={false}
          label={MACHINE_SETTINGS_WORDS.ALLOWED_APPS}
          rows={
            appsOn && settings.alwaysAllowedApps.length > 0 ? (
              <AllowedAppList
                indent={SETTINGS_ROW_INDENT.MARK_TWICE}
                apps={settings.alwaysAllowedApps.map(
                  (bundleId) => apps.get(bundleId) ?? { bundleId, name: bundleId },
                )}
                onRemove={removeApp}
              />
            ) : undefined
          }
          head={(chevron) => (
            <SwitchRow
              indent={SETTINGS_ROW_INDENT.MARK}
              leading={
                <SettingsRowMark>
                  <ComputerUseIcon />
                </SettingsRowMark>
              }
              label={MACHINE_SETTINGS_WORDS.APPS}
              labelReplayUnmasked
              detail={
                appsOn && settings.alwaysAllowedApps.length > 0
                  ? MACHINE_SETTINGS_WORDS.appsAllowed(settings.alwaysAllowedApps.length)
                  : undefined
              }
              checked={appsOn}
              before={chevron}
              write={rowWrite(appsSwitch, {
                ask: (computerUse: boolean): MachineChangeParams => ({ id, computerUse }),
                refused: changeRefused,
                drawn: (asked) => asked.computerUse ?? appsOn,
              })}
            />
          )}
        />
      )}
    </>
  );
}

/** A machine that runs no agents, on the list of machines: its mark, what the list calls it, whether its app listens now, and its ⋯ holding Remove. */
export function CommandMachineRow({
  machine,
  label,
  facts,
  chevron,
  onRemove,
  locked,
}: {
  machine: MachineLine;
  /** What the list calls the machine (`machineName`). */
  label: string;
  /** What it lets agents do (`machineAgentFacts`). */
  facts: MachineAgentFacts | undefined;
  /** The chevron of its settings' fold, before its ⋯. */
  chevron: React.ReactNode;
  onRemove: () => void;
  /** Whether a removal is out, which every Remove waits out. */
  locked: boolean;
}): React.JSX.Element {
  const standing = machine.listening ? DEVICE_STANDING.ONLINE : DEVICE_STANDING.OFFLINE;
  const platform = machine.platform ?? DEVICE_PLATFORM.DARWIN;

  return (
    <MenuRow
      thing={label}
      actions={[
        { label: MACHINES_WORDS.REMOVE, danger: true, disabled: locked, onSelect: onRemove },
      ]}
      row={{
        leading: <MachineMark platform={platform} standing={standing} />,
        label: <ReplayMask>{label}</ReplayMask>,
        description: <MachineStandingLine standing={standing} platform={platform} facts={facts} />,
        control: chevron,
      }}
    />
  );
}

/** The account's machines with their own settings, as the machines read holds them, and how each draws the apps it allows. */
export interface MachineSettingsRead {
  /** Every machine of the account's not removed; none before the read answers or where it failed. */
  readonly machines: readonly MachineLine[] | undefined;
  /** How the machine of the id names and draws its apps; none where Computer use is off, which draws no apps. */
  readonly appsOf: (id: string) => ReadonlyMap<string, AllowedApp> | undefined;
  /** Whether the read failed, which the list says under its rows. */
  readonly failed: boolean;
  /** Reads the machines again after a failure. */
  readonly retry: () => void;
}

/** The account's machines with their own settings for agents, read while `signedIn`. */
export function useMachineSettings(signedIn: boolean): MachineSettingsRead {
  const accountId = signedInAccountId(useQuery({ ...appStateQuery, select: selectAccount }).data);
  const read = useQuery(machinesQuery(signedIn ? accountId : undefined));
  const retry = useMutation(machinesRetryMutation());

  const computerUse =
    useQuery({ ...appStateQuery, select: selectExperiment(EXPERIMENT.COMPUTER_USE) }).data === true;

  const allowed = useAllowedApps(signedIn);

  /** How each machine names and draws the apps it allows, by machine and then app. */
  const looks = new Map(
    allowed.machines.map((each) => [
      each.deviceId,
      new Map<string, AllowedApp>(
        (each.looks ?? []).map((look) => [
          look.app,
          { bundleId: look.app, name: look.name, iconPng: look.iconPng },
        ]),
      ),
    ]),
  );

  return {
    machines: read.data,
    appsOf: (id) => (computerUse ? (looks.get(id) ?? new Map()) : undefined),
    failed: read.isError,
    retry: () => retry.mutate(),
  };
}

/** Remove for a machine that runs no agents: the question it asks first, and what pressing Remove asks. */
export interface MachineRemove {
  readonly ask: (machine: MachineLine, label: string) => void;
  /** Whether a removal is out, which every Remove waits out. */
  readonly busy: boolean;
  readonly dialog: React.JSX.Element;
}

/**
 * Remove for a machine that runs no agents, asked first over the section
 * rather than its row, because the host draws a removal gone the moment it
 * is asked, so the row is gone before a refusal comes back to be said.
 */
export function useMachineRemove(): MachineRemove {
  const accountId = signedInAccountId(useQuery({ ...appStateQuery, select: selectAccount }).data);

  const { mutateAsync: sendRemove, ...removingWrite } = useMutation(
    actMutation(ACT_KIND.MACHINES_REMOVE),
  );

  const [asked, setAsked] = useState<RemoveAsked | undefined>(undefined);

  const removingAct = useConfirmAct(removingWrite, {
    send: () => (asked === undefined ? Promise.resolve() : sendRemove({ id: asked.machine.id })),
    answered: (answer) => ("failure" in answer ? REMOVE_REFUSED : ACCEPTED),
    failed: () => UNREACHED,
    refusedFirst: () => (asked === undefined ? REMOVE_REFUSED : undefined),
  });

  const removing = useConfirmDialog(
    { subject: asked !== undefined && asked.accountId === accountId, surfaceOpen: true },
    removingAct,
    confirmFailure(FAILURE_SURFACE.MACHINE_REMOVE),
  );

  return {
    ask: (machine, label) => {
      setAsked({ accountId, machine, label });
      removing.ask();
    },
    busy: removing.busy,
    dialog: (
      <ConfirmDialog
        open
        confirm={removing}
        question={{
          ...removeCommandMachineQuestion(asked?.label ?? ""),
          loss: CONFIRM_LOSS.IRREVERSIBLE,
          replayUnmasked: true,
          titleReplayMasked: true,
        }}
      />
    ),
  };
}
