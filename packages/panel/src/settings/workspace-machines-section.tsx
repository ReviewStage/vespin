import { MACHINE_NETWORK } from "@repo/features/device-agent-wire";
import { MACHINE_NAME_MAX_CHARS } from "@repo/features/host-wire";
import {
  removeWorkspaceMachineQuestion,
  WORKSPACE_MACHINES_WORDS,
} from "@repo/features/machines-settings-words";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { ACT_UNREACHED_WORDS, readFailedWords, readingWords } from "@repo/features/words";
import {
  type WorkspaceMachineDoneView,
  type WorkspaceMachineLine,
  workspaceMachineStanding,
} from "@repo/features/workspace-machine-view";
import { managesWorkspace } from "@repo/features/workspace-role";
import type { Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import {
  CONFIRM_LOSS,
  ConfirmDialog,
  RenamableName,
  SETTINGS_SKELETON_CONTROL,
  SettingsLine,
  type SettingsRowSkeletonLayout,
  SettingsRowsSkeleton,
  SettingsSection,
  STATUS_TONE,
  useConfirmDialog,
} from "@repo/ui";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { type InlineRename, type RenameWrite, useInlineRename } from "@repo/ui/use-inline-rename";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { actMutation } from "../act-mutations.js";
import { useConfirmAct } from "../confirm-act.js";
import { confirmFailure } from "../failure-report.js";
import { workspaceOwnedMachinesQuery, workspaceOwnedMachinesRetryMutation } from "../live-reads.js";
import { renameWrite } from "../rename-write.js";
import { showToast } from "../toast.js";
import { MachineMark, MachineStandingLine } from "./machine-standing.js";
import { ReadFailed } from "./marks.js";
import { MenuRow } from "./menu-row.js";
import { SECTION, settingsSectionHead } from "./settings-sections.js";

/**
 * workspace-machines-section.tsx -- Settings › Machines' list of the machines the workspace Settings shows owns, which every member's agents may run on, each in a VM of its own: each with its platform, architecture, and where it stands, renamed and removed by the workspace's owners and admins.
 *
 * A workspace's machine is a Linux server or a Mac an owner or an admin
 * connected to the workspace, picking it rather than Just me as they
 * approved its pairing (`host-connect-dialog.tsx`), so it is connected
 * through Add a machine as a member's own is. Every member reads the list,
 * followed live while the page stands (`LIVE_READ.WORKSPACE_MACHINES`):
 * each row leads with the machine's platform's glyph wearing its standing's
 * dot, as the member's own machines' rows do (`MachineMark`), and says what
 * it is, its architecture, since an agent runs on its machine's own, and
 * whether its agents may reach the network it stands on. Where it stands is
 * read off its own row (`workspaceMachineStanding`), since the window's
 * presence read names the member's own devices alone.
 *
 * An owner or an admin renames a machine by pressing its name or from its
 * ⋯ (`RenamableName`), drawn at once, and removes it from its ⋯ after
 * asking, since that stops every member's agents on it; the list draws it
 * gone the moment Remove is asked, so the question stands over the section
 * rather than its row. A member who is neither reads the list alone.
 */

/** The row that stands while the machines are read: a machine with its ⋯. */
const SKELETON: readonly SettingsRowSkeletonLayout[] = [
  { described: true, controls: [], end: [SETTINGS_SKELETON_CONTROL.MORE] },
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
  reason: WORKSPACE_MACHINES_WORDS.REMOVE_FAILED,
};

/** The machine Remove was asked of, in the workspace it was asked in. */
interface RemoveAsked {
  readonly workspaceId: string;
  readonly machine: WorkspaceMachineLine;
}

/** Whether a rename or a remove was refused. */
function refusedAnswer(answer: WorkspaceMachineDoneView): boolean {
  return "failure" in answer;
}

/**
 * The renames of the workspace's machines, one row's at a time; a refusal
 * reopens the row's field over the name asked and says so in a toast.
 */
function useMachineRenames(workspaceId: string): RenameWrite {
  const renaming = useMutation(actMutation(ACT_KIND.WORKSPACE_OWNED_MACHINE_RENAME));

  return renameWrite(renaming, {
    ask: (id, name) => ({ workspaceId, id, name }),
    asked: ({ id, name }) => ({ subjectId: id, name }),
    refused: refusedAnswer,
    onRefused: (answer) =>
      showToast({
        words: WORKSPACE_MACHINES_WORDS.RENAME_FAILED,
        replayUnmasked: true,
        tone: STATUS_TONE.DANGER,
        failure: { surface: FAILURE_SURFACE.WORKSPACE_MACHINE_RENAME, cause: answer },
      }),
  });
}

/** What a machine's line says of the networks its agents may reach: only where that is its private network too, since the open internet is every machine's. */
function networkWords(machine: WorkspaceMachineLine): string | undefined {
  return machine.network === MACHINE_NETWORK.PRIVATE_ALLOWED
    ? WORKSPACE_MACHINES_WORDS.PRIVATE_NETWORK
    : undefined;
}

/** One of the workspace's machines: its mark, its name, renamed in place by an owner or an admin, what it is and where it stands, and its ⋯ holding Rename and Remove for them. */
function WorkspaceMachineRow({
  machine,
  manages,
  renames,
  onRemove,
  locked,
}: {
  machine: WorkspaceMachineLine;
  /** Whether the reader owns or admins the workspace, who alone renames and removes its machines. */
  manages: boolean;
  renames: RenameWrite;
  onRemove: () => void;
  /** Whether a removal is out, which every Remove waits out. */
  locked: boolean;
}): React.JSX.Element {
  const rename: InlineRename = useInlineRename(machine.id, renames);
  const standing = workspaceMachineStanding(machine);
  const name = rename.asked ?? machine.name;

  return (
    <MenuRow
      thing={name}
      actions={
        manages
          ? [
              { label: WORKSPACE_MACHINES_WORDS.RENAME, onSelect: rename.begin },
              {
                label: WORKSPACE_MACHINES_WORDS.REMOVE,
                danger: true,
                disabled: locked,
                onSelect: onRemove,
              },
            ]
          : []
      }
      row={{
        leading: <MachineMark platform={machine.platform} standing={standing} />,
        label: (
          <RenamableName
            value={name}
            label={WORKSPACE_MACHINES_WORDS.NAME}
            editing={rename.editing}
            onBegin={manages ? rename.begin : undefined}
            maxLength={MACHINE_NAME_MAX_CHARS}
            onEnd={({ value }) => rename.end(value === machine.name ? undefined : value)}
          >
            <ReplayMask>{name}</ReplayMask>
          </RenamableName>
        ),
        editing: rename.editing,
        description: (
          <MachineStandingLine
            standing={standing}
            platform={machine.platform}
            arch={machine.arch}
            more={networkWords(machine)}
          />
        ),
      }}
    />
  );
}

/** Remove for one of the workspace's machines: the question it asks first, and what pressing Remove asks. */
function useWorkspaceMachineRemove(workspaceId: string) {
  const { mutateAsync: sendRemove, ...removingWrite } = useMutation(
    actMutation(ACT_KIND.WORKSPACE_OWNED_MACHINE_REMOVE),
  );

  const [asked, setAsked] = useState<RemoveAsked | undefined>(undefined);

  const removingAct = useConfirmAct(removingWrite, {
    send: () =>
      asked === undefined
        ? Promise.resolve()
        : sendRemove({ workspaceId: asked.workspaceId, id: asked.machine.id }),
    answered: (answer) => (refusedAnswer(answer) ? REMOVE_REFUSED : ACCEPTED),
    failed: () => UNREACHED,
    refusedFirst: () => (asked === undefined ? REMOVE_REFUSED : undefined),
  });

  // Note that a question asked in one workspace does not outlive Settings moving to another.
  const removing = useConfirmDialog(
    { subject: asked !== undefined && asked.workspaceId === workspaceId, surfaceOpen: true },
    removingAct,
    confirmFailure(FAILURE_SURFACE.WORKSPACE_MACHINE_REMOVE),
  );

  return {
    ask: (machine: WorkspaceMachineLine) => {
      setAsked({ workspaceId, machine });
      removing.ask();
    },
    busy: removing.busy,
    dialog: (
      <ConfirmDialog
        open
        confirm={removing}
        question={{
          ...removeWorkspaceMachineQuestion(asked?.machine.name ?? ""),
          loss: CONFIRM_LOSS.IRREVERSIBLE,
          replayUnmasked: true,
          titleReplayMasked: true,
        }}
      />
    ),
  };
}

/** The machines one workspace owns, as Settings › Machines lists them under the member's own. */
function WorkspaceMachinesList({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const read = useQuery(workspaceOwnedMachinesQuery(workspace.id));
  const retry = useMutation(workspaceOwnedMachinesRetryMutation());
  const manages = managesWorkspace(workspace);
  const renames = useMachineRenames(workspace.id);
  const remove = useWorkspaceMachineRemove(workspace.id);
  const machines = read.data;

  return (
    <>
      <SettingsSection
        {...settingsSectionHead(SECTION.WORKSPACE_MACHINES, { workspace })}
        caption={WORKSPACE_MACHINES_WORDS.CAPTION}
      >
        {machines === undefined ? (
          read.isError ? (
            <ReadFailed
              line={readFailedWords("this workspace's machines")}
              surface={FAILURE_SURFACE.WORKSPACE_MACHINES_READ}
              about={{ workspaceId: workspace.id }}
              onRetry={() => retry.mutate({ workspaceId: workspace.id })}
            />
          ) : (
            <SettingsRowsSkeleton
              label={readingWords("this workspace's machines")}
              rows={SKELETON}
            />
          )
        ) : machines.length === 0 ? (
          <SettingsLine>
            {manages ? WORKSPACE_MACHINES_WORDS.NONE_MANAGED : WORKSPACE_MACHINES_WORDS.NONE}
          </SettingsLine>
        ) : (
          machines.map((machine) => (
            <WorkspaceMachineRow
              key={machine.id}
              machine={machine}
              manages={manages}
              renames={renames}
              onRemove={() => remove.ask(machine)}
              locked={remove.busy}
            />
          ))
        )}
      </SettingsSection>
      {remove.dialog}
    </>
  );
}

/** The machines the workspace Settings shows owns, on Settings › Machines; nothing signed out, or where Settings shows no workspace. */
export function WorkspaceMachinesSection({
  signedIn,
  workspace,
}: {
  signedIn: boolean;
  workspace: Workspace | undefined;
}): React.JSX.Element | null {
  if (!signedIn || workspace === undefined) return null;

  return <WorkspaceMachinesList key={workspace.id} workspace={workspace} />;
}
