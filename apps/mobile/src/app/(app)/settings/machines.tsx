// machines.tsx -- Settings' Machines page: the account's machines, each by its name, where it stands, and what it is, and Remove, asked first, then the machines the chosen workspace owns, renamed and removed by its owners and admins, as the panel's Machines page offers them; a machine is added from the machine itself, so the phone offers no Add, and a machine's pairing link opens its question here (`machine-connect.tsx`).

import { signedInAccountId } from "@repo/credentials/snapshot";
import { DEVICE_STANDING } from "@repo/features/agent-wire";
import {
  DEVICE_PLATFORM,
  type DevicePlatform,
  MACHINE_NETWORK,
} from "@repo/features/device-agent-wire";
import { DEVICE_PLATFORM_NAME } from "@repo/features/device-platform";
import type { HostLine } from "@repo/features/host-live";
import { HOST_UNINSTALL_COMMAND, MACHINE_NAME_MAX_CHARS } from "@repo/features/host-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import { type ListedMachine, machineName } from "@repo/features/machine-name";
import {
  hostStanding,
  MACHINE_STANDING_WORDS,
  MACHINES_WORDS,
  nextCallInLapse,
  removeMachineQuestion,
  removeWorkspaceMachineQuestion,
  WORKSPACE_MACHINES_WORDS,
} from "@repo/features/machines-settings-words";
import { readFailedWords, readingWords } from "@repo/features/words";
import {
  type WorkspaceMachineLine,
  workspaceMachineStanding,
} from "@repo/features/workspace-machine-view";
import { managesWorkspace } from "@repo/features/workspace-role";
import type { Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { selectAccount, selectWorkspaces } from "@repo/host/app-state-reads";
import {
  askForName,
  ConfirmAsk,
  EmptyState,
  FailedReadRow,
  GLYPH,
  ListSection,
  LoadingRow,
  NoteRow,
  SCREEN_GROUND,
  Screen,
  SettingsForm,
  TRY_AGAIN_WORDS,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { useChosenWorkspace } from "../../../chosen-workspace.js";
import { appStateQuery } from "../../../host/app-state-query.js";
import { useHostActs } from "../../../host/host-provider.js";
import { useLiveFollow } from "../../../host/live-follow.js";
import { PLATFORM_SYMBOL } from "../../../machine-symbol.js";
import { useWrite } from "../../../use-write.js";
import { useWorkspaceMachines } from "../../../workspace-machines.js";

export { ScreenBoundary as ErrorBoundary } from "../../../screen-boundary.js";

/** What the page says while it reads the machines, and where the read failed, as the panel names them. */
const READ_WORDS = {
  READING: readingWords("your machines"),
  FAILED: readFailedWords("your machines"),
} as const;

/** What the shared section says while it reads the workspace's machines, and where the read failed, as the panel names them. */
const SHARED_READ_WORDS = {
  READING: readingWords("this workspace's machines"),
  FAILED: readFailedWords("this workspace's machines"),
} as const;

/** What the rename's alert is titled. */
const RENAME_TITLE = "Rename machine";

/** A machine Remove was asked of: the host, what it is called, and whether it reads offline, which hears it only once it is online again. */
interface RemoveAsked {
  readonly host: HostLine;
  readonly label: string;
  readonly offline: boolean;
}

/** The account's machines the host holds, as a `select`; none until read. */
function heldHosts(accountId: string) {
  return (state: AppStateSnapshot) => state[LIVE_READ.HOSTS][accountId];
}

/** A host as the list of machines names it. */
function machineOf(host: HostLine): ListedMachine {
  return { deviceId: host.id, name: host.name, machineId: host.machineId, model: host.model };
}

/** A machine's platform; a Linux server where the service named none, as one older than platforms listed only those. */
function platformOf(machine: { readonly platform?: DevicePlatform | undefined }): DevicePlatform {
  return machine.platform ?? DEVICE_PLATFORM.LINUX;
}

/** The quiet line under a machine's name: where it stands, such as Online, its platform standing above it on a line of its own rather than joined to it. */
function machineLine(host: HostLine, now: number): string {
  return MACHINE_STANDING_WORDS[hostStanding(host, now)];
}

/** What a workspace's machine is, under its name: its platform, and its architecture where it is said, since an agent runs on its machine's own. */
function sharedDetail(machine: WorkspaceMachineLine): string {
  const platform = DEVICE_PLATFORM_NAME[platformOf(machine)];

  return machine.arch === undefined ? platform : `${platform} · ${machine.arch}`;
}

/** The quiet line under a workspace's machine: where it stands, told off its own row, and that its agents reach its private network where they may. */
function sharedLine(machine: WorkspaceMachineLine): string {
  const standing = MACHINE_STANDING_WORDS[workspaceMachineStanding(machine)];

  return machine.network === MACHINE_NETWORK.PRIVATE_ALLOWED
    ? `${standing} · ${WORKSPACE_MACHINES_WORDS.PRIVATE_NETWORK}`
    : standing;
}

/** What Remove asks, and for a machine that reads offline the command that removes it by hand. */
function removeMessage(asked: RemoveAsked | undefined): string {
  const { body } = removeMachineQuestion(asked?.label ?? "");

  return asked?.offline === true
    ? `${body}\n\n${MACHINES_WORDS.REMOVED_OFFLINE}\n\n${HOST_UNINSTALL_COMMAND}`
    : body;
}

export default function MachinesScreen() {
  const { data: account } = useQuery({ ...appStateQuery, select: selectAccount });
  const { data: workspaces = [] } = useQuery({ ...appStateQuery, select: selectWorkspaces });
  const { chosen } = useChosenWorkspace(workspaces);
  const accountId = account === undefined ? undefined : signedInAccountId(account);

  if (accountId === undefined) return null;

  return <MachinesPage key={accountId} accountId={accountId} workspace={chosen} />;
}

/**
 * The page: the member's own machines, then, under them, the machines the
 * workspace the phone works in owns, as the panel stands its shared section
 * under the member's own (`workspace-machines-section.tsx`). Where neither
 * lists any, the page says the member has none.
 */
function MachinesPage({
  accountId,
  workspace,
}: {
  readonly accountId: string;
  readonly workspace: Workspace | undefined;
}) {
  const acts = useHostActs();
  const write = useWrite();
  const [asked, setAsked] = useState<RemoveAsked | undefined>(undefined);
  useLiveFollow(accountId, () => acts[ACT_KIND.HOSTS_FOLLOW]());

  const { data: held } = useQuery({
    ...appStateQuery,
    select: useCallback(heldHosts(accountId), [accountId]),
  });

  const hosts = held?.rows?.hosts;
  const listed = (hosts ?? []).map(machineOf);
  const now = Date.now();
  // Note that a machine that has not called in reads failed once its wait runs out, which no read moves, so the page draws again then.
  const [, setLapsed] = useState(0);
  const lapse = hosts === undefined ? undefined : nextCallInLapse(hosts, now);
  useEffect(() => {
    if (lapse === undefined) return;
    const wait = setTimeout(() => setLapsed((each) => each + 1), Math.max(0, lapse - Date.now()));

    return () => clearTimeout(wait);
  }, [lapse]);
  const question = removeMachineQuestion(asked?.label ?? "");
  const shared = useWorkspaceMachines(workspace?.id);
  // Note that the page says the member has no machines only once the workspace's are read and it owns none too, or where no workspace stands.
  const sharedNone = workspace === undefined || shared.machines?.length === 0;

  const body =
    hosts === undefined ? (
      held?.failed === true ? (
        <EmptyState
          title={READ_WORDS.FAILED}
          symbol={GLYPH.FAILED}
          retry={() =>
            void acts[ACT_KIND.HOSTS_RETRY]().catch((cause: unknown) =>
              console.error("Reading the machines again did not go.", cause),
            )
          }
        />
      ) : (
        <EmptyState title={READ_WORDS.READING} symbol={GLYPH.HOST} loading />
      )
    ) : hosts.length === 0 && sharedNone ? (
      <EmptyState title={MACHINES_WORDS.NONE} symbol={GLYPH.HOST} />
    ) : (
      <SettingsForm>
        <ListSection
          title={workspace === undefined ? undefined : MACHINES_WORDS.TITLE}
          footer={hosts.length === 0 ? MACHINES_WORDS.NONE : undefined}
        >
          {[...hosts]
            .sort((one, other) => one.name.localeCompare(other.name))
            .map((host) => {
              const label = machineName(machineOf(host), listed, undefined);

              return (
                <NoteRow
                  key={host.id}
                  symbol={PLATFORM_SYMBOL[platformOf(host)]}
                  words={label}
                  detail={DEVICE_PLATFORM_NAME[platformOf(host)]}
                  line={machineLine(host, now)}
                  remove={{
                    label: MACHINES_WORDS.REMOVE,
                    onPress: () =>
                      setAsked({
                        host,
                        label,
                        offline:
                          host.away === true || hostStanding(host, now) === DEVICE_STANDING.OFFLINE,
                      }),
                  }}
                />
              );
            })}
        </ListSection>
        {workspace === undefined ? null : (
          <SharedMachines key={workspace.id} workspace={workspace} read={shared} />
        )}
      </SettingsForm>
    );

  return (
    <>
      <Screen ground={SCREEN_GROUND.GROUPED}>{body}</Screen>
      <ConfirmAsk
        title={question.title}
        message={removeMessage(asked)}
        act={question.verb}
        destructive
        presented={asked !== undefined}
        onDismiss={() => setAsked(undefined)}
        onAct={() => {
          if (asked === undefined) return;
          const { id } = asked.host;
          setAsked(undefined);
          void write(() => acts[ACT_KIND.HOSTS_REMOVE]({ id }), {
            refused: (answer) => ("failure" in answer ? MACHINES_WORDS.REMOVE_FAILED : undefined),
            retry: true,
          });
        }}
      />
    </>
  );
}

/** A workspace's machine Remove was asked of, in the workspace it was asked in. */
interface SharedRemoveAsked {
  readonly workspaceId: string;
  readonly machine: WorkspaceMachineLine;
}

/**
 * The machines `workspace` owns, which every member's agents may run on,
 * each in a VM of its own, as the panel lists them under the member's own:
 * each by its name, what it is and its architecture, where it stands, told
 * off its own row, and whether its agents reach its private network. An
 * owner or an admin renames one in the system's name alert, drawn at once,
 * and removes one after asking, since that stops every member's agents on
 * it; a member who is neither reads the list alone. A refusal of either is
 * said in the one failure notice, with Try again.
 */
function SharedMachines({
  workspace,
  read,
}: {
  readonly workspace: Workspace;
  readonly read: ReturnType<typeof useWorkspaceMachines>;
}) {
  const acts = useHostActs();
  const write = useWrite();
  const manages = managesWorkspace(workspace);
  const workspaceId = workspace.id;
  const [asked, setAsked] = useState<SharedRemoveAsked | undefined>(undefined);
  const { machines } = read;
  const question = removeWorkspaceMachineQuestion(asked?.machine.name ?? "");

  const rename = (machine: WorkspaceMachineLine) =>
    askForName({
      title: RENAME_TITLE,
      act: WORKSPACE_MACHINES_WORDS.RENAME,
      name: machine.name,
      // Note that a name past what the service keeps is cut to it, as the panel's field takes no more.
      onName: (typed) =>
        void write(
          () =>
            acts[ACT_KIND.WORKSPACE_OWNED_MACHINE_RENAME]({
              workspaceId,
              id: machine.id,
              name: typed.slice(0, MACHINE_NAME_MAX_CHARS),
            }),
          {
            refused: (answer) =>
              "failure" in answer ? WORKSPACE_MACHINES_WORDS.RENAME_FAILED : undefined,
            retry: true,
          },
        ),
    });

  return (
    <>
      <ListSection
        title={`${WORKSPACE_MACHINES_WORDS.TITLE_LEAD}${workspace.name}`}
        footer={
          machines?.length === 0
            ? manages
              ? WORKSPACE_MACHINES_WORDS.NONE_MANAGED
              : WORKSPACE_MACHINES_WORDS.NONE
            : WORKSPACE_MACHINES_WORDS.CAPTION
        }
      >
        {machines === undefined ? (
          read.failed ? (
            <FailedReadRow
              label={SHARED_READ_WORDS.FAILED}
              act={TRY_AGAIN_WORDS}
              onPress={read.retry}
            />
          ) : (
            <LoadingRow words={SHARED_READ_WORDS.READING} />
          )
        ) : (
          machines.map((machine) => (
            <NoteRow
              key={machine.id}
              symbol={PLATFORM_SYMBOL[platformOf(machine)]}
              words={machine.name}
              detail={sharedDetail(machine)}
              line={sharedLine(machine)}
              edit={
                manages
                  ? { label: WORKSPACE_MACHINES_WORDS.RENAME, onPress: () => rename(machine) }
                  : undefined
              }
              remove={
                manages
                  ? {
                      label: WORKSPACE_MACHINES_WORDS.REMOVE,
                      onPress: () => setAsked({ workspaceId, machine }),
                    }
                  : undefined
              }
            />
          ))
        )}
      </ListSection>
      <ConfirmAsk
        title={question.title}
        message={question.body}
        act={question.verb}
        destructive
        presented={asked !== undefined}
        onDismiss={() => setAsked(undefined)}
        onAct={() => {
          if (asked === undefined) return;
          const { machine } = asked;
          setAsked(undefined);
          void write(
            () =>
              acts[ACT_KIND.WORKSPACE_OWNED_MACHINE_REMOVE]({
                workspaceId: asked.workspaceId,
                id: machine.id,
              }),
            {
              refused: (answer) =>
                "failure" in answer ? WORKSPACE_MACHINES_WORDS.REMOVE_FAILED : undefined,
              retry: true,
            },
          );
        }}
      />
    </>
  );
}
