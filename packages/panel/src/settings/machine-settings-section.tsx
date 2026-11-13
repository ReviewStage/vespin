import { signedInAccountId } from "@repo/credentials/snapshot";
import type { HostDoneAnswerView, MachineChangeParams } from "@repo/features/agent-view";
import { DEVICE_STANDING } from "@repo/features/agent-wire";
import { DEVICE_PLATFORM } from "@repo/features/device-agent-wire";
import {
  MACHINE_COMMAND_MODE_LIST,
  type MachineCommandMode,
} from "@repo/features/machine-command-wire";
import type { MachineLine } from "@repo/features/machine-live";
import {
  isThisMac,
  type ListedMachine,
  machineName,
  type ThisMac,
} from "@repo/features/machine-name";
import {
  MACHINE_SETTINGS_WORDS,
  MACHINES_WORDS,
  removeCommandMachineQuestion,
} from "@repo/features/machines-settings-words";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { ACT_UNREACHED_WORDS, readFailedWords, readingWords } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import { EXPERIMENT, MACHINE_COMMAND_MODE_LABEL } from "@repo/settings";
import {
  CONFIRM_LOSS,
  ConfirmDialog,
  SETTINGS_ROW_INDENT,
  SETTINGS_SKELETON_CONTROL,
  SettingsLine,
  type SettingsRowSkeletonLayout,
  SettingsRowsSkeleton,
  SettingsSection,
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
import { useThisMac } from "../machine-name.js";
import { useAllowedApps } from "../tasks/mac-apps.js";
import { appStateQuery, selectAccount, selectExperiment } from "../use-app-state.js";
import { type AllowedApp, AllowedAppRow } from "./allowed-app-row.js";
import { MachineMark, MachineStandingLine } from "./machine-standing.js";
import { ReadFailed } from "./marks.js";
import { MenuRow } from "./menu-row.js";
import { refusalToast, rowWrite, type SettingRefusal } from "./row-write.js";
import { SelectRow } from "./select-row.js";
import { SECTION, settingsSectionHead } from "./settings-sections.js";
import { SwitchRow } from "./switch-row.js";

/**
 * machine-settings-section.tsx -- Settings › Machines' What agents may do: each of the member's machines with its own say over agents' terminal commands and apps, changed from any device or the web.
 *
 * Every machine whose app joined is listed (`LIVE_READ.MACHINES`), each
 * named as every list of machines names it (`machine-name.ts`), This Mac
 * among them, and led by its platform's glyph and whether its app listens
 * now, Online or Offline, after the dot Runs on draws. Under it stand its
 * settings, inset as its parts: how agents' terminal commands run there,
 * and, where the reader has Computer use on, whether agents may use its
 * apps and the apps they use unasked, each by its icon where the machine
 * drew one, with a Remove. Each row is the one Settings draws the same
 * thing with elsewhere: the machine's mark and line as Your machines draws
 * them (`machine-standing.tsx`), the mode's picker and the switch as every
 * setting's (`SelectRow`, `SwitchRow`), and each app as This Mac lists it
 * (`allowed-app-row.tsx`). Each change is the machine's own, kept by the
 * service, drawn at once, and taken by the machine as it lands, or as it
 * next joins where it is offline; This Mac's own page edits the same values.
 *
 * A machine that runs no agents can be removed here, after asking, as a
 * wiped app state leaves one behind; a host is removed from Your machines
 * above, which also takes it off its box, and This Mac is never offered
 * one, since it would join again at once.
 */

/** The rows that stand while the machines are read: a machine, then its commands. */
const MACHINES_SKELETON: readonly SettingsRowSkeletonLayout[] = [
  { described: true, controls: [], end: [SETTINGS_SKELETON_CONTROL.MORE] },
  { described: false, controls: [SETTINGS_SKELETON_CONTROL.SELECT] },
];

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

/** A machine as the list of machines names it (`machineName`). */
function listedOf(machine: MachineLine): ListedMachine {
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

/** One machine: its row, with Remove where it may be removed here, and its settings inset under it, each written as its row writes a setting. */
function MachineRows({
  machine,
  label,
  apps,
  removable,
  onRemove,
  locked,
}: {
  machine: MachineLine;
  /** What the list calls the machine (`machineName`). */
  label: string;
  /** How the machine names and draws its apps, by the app they are allowed by; none where Computer use is off, which draws no apps. */
  apps: ReadonlyMap<string, AllowedApp> | undefined;
  removable: boolean;
  onRemove: () => void;
  /** Whether a removal is out, which every Remove waits out. */
  locked: boolean;
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
      <MenuRow
        thing={label}
        actions={
          removable
            ? [
                {
                  label: MACHINES_WORDS.REMOVE,
                  danger: true,
                  disabled: locked,
                  onSelect: onRemove,
                },
              ]
            : []
        }
        row={{
          leading: <MachineMark platform={machine.platform ?? DEVICE_PLATFORM.DARWIN} />,
          label: <ReplayMask>{label}</ReplayMask>,
          description: (
            <MachineStandingLine
              standing={machine.listening ? DEVICE_STANDING.ONLINE : DEVICE_STANDING.OFFLINE}
              platform={machine.platform ?? DEVICE_PLATFORM.DARWIN}
            />
          ),
        }}
      />
      <SelectRow
        indent={SETTINGS_ROW_INDENT.MARK}
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
        <>
          <SwitchRow
            indent={SETTINGS_ROW_INDENT.MARK}
            label={MACHINE_SETTINGS_WORDS.APPS}
            labelReplayUnmasked
            detail={MACHINE_SETTINGS_WORDS.APPS_DETAIL}
            checked={appsOn}
            write={rowWrite(appsSwitch, {
              ask: (computerUse: boolean): MachineChangeParams => ({ id, computerUse }),
              refused: changeRefused,
              drawn: (asked) => asked.computerUse ?? appsOn,
            })}
          />
          {appsOn
            ? settings.alwaysAllowedApps.map((bundleId) => (
                <AllowedAppRow
                  key={bundleId}
                  indent={SETTINGS_ROW_INDENT.MARK}
                  app={apps.get(bundleId) ?? { bundleId, name: bundleId }}
                  onRemove={removeApp}
                />
              ))
            : null}
        </>
      )}
    </>
  );
}

/** Each machine's own settings for agents, as the account's machines read holds them, or why they cannot be drawn. */
export function MachineSettingsSection({
  signedIn,
}: {
  signedIn: boolean;
}): React.JSX.Element | null {
  const accountId = signedInAccountId(useQuery({ ...appStateQuery, select: selectAccount }).data);
  const read = useQuery(machinesQuery(signedIn ? accountId : undefined));
  const retry = useMutation(machinesRetryMutation());
  const thisMac = useThisMac();

  const computerUse =
    useQuery({ ...appStateQuery, select: selectExperiment(EXPERIMENT.COMPUTER_USE) }).data === true;

  const allowed = useAllowedApps(signedIn);

  const { mutateAsync: sendRemove, ...removingWrite } = useMutation(
    actMutation(ACT_KIND.MACHINES_REMOVE),
  );

  // Note that Remove asks over the section rather than its row, because the host draws a removal gone the moment it is asked, so the row is gone before a refusal comes back to be said.
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

  const machines = read.data?.filter((machine) => machine.settings !== undefined);
  const naming: ThisMac = thisMac;
  const listed = machines?.map(listedOf) ?? [];

  /** How each machine names and draws the apps it allows, by machine and then app; none while Computer use is off. */
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

  // Note that This Mac stands first, as Your machines draws it.
  const ordered = [...(machines ?? [])].sort(
    (one, other) =>
      Number(isThisMac(listedOf(other), naming)) - Number(isThisMac(listedOf(one), naming)),
  );

  // Note that signed out Your machines says so, and this section stands down.
  if (!signedIn) return null;

  return (
    <>
      <SettingsSection
        {...settingsSectionHead(SECTION.MACHINE_SETTINGS)}
        caption={MACHINE_SETTINGS_WORDS.CAPTION}
      >
        {machines !== undefined ? (
          ordered.length === 0 ? (
            <SettingsLine>{MACHINE_SETTINGS_WORDS.NONE}</SettingsLine>
          ) : (
            ordered.map((machine) => {
              const label = machineName(listedOf(machine), listed, naming);
              const own = isThisMac(listedOf(machine), naming);

              return (
                <MachineRows
                  key={machine.id}
                  machine={machine}
                  label={label}
                  apps={computerUse ? (looks.get(machine.id) ?? new Map()) : undefined}
                  removable={!machine.host && !own}
                  onRemove={() => {
                    setAsked({ accountId, machine, label });
                    removing.ask();
                  }}
                  locked={removing.busy}
                />
              );
            })
          )
        ) : read.isError ? (
          <ReadFailed
            line={readFailedWords("each machine's settings")}
            surface={FAILURE_SURFACE.MACHINES_READ}
            onRetry={() => retry.mutate()}
          />
        ) : (
          <SettingsRowsSkeleton
            label={readingWords("each machine's settings")}
            rows={MACHINES_SKELETON}
          />
        )}
      </SettingsSection>
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
    </>
  );
}
