import { githubRepositoryFullNameSchema } from "@repo/features/link-grammar";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { readingWords } from "@repo/features/words";
import { managesWorkspace } from "@repo/features/workspace-role";
import {
  WORKSPACE_SANDBOX_SETUP_BOUNDS,
  type WorkspaceSandboxSetupAnswer,
} from "@repo/features/workspace-sandbox-setup-wire";
import type { Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import {
  BUTTON_VARIANT,
  Button,
  CONFIRM_LOSS,
  ConfirmDialog,
  DIALOG_SIZE,
  DIALOG_TONE,
  Dialog,
  DialogActions,
  FormField,
  PlusIcon,
  SETTINGS_SKELETON_CONTROL,
  SettingsLine,
  type SettingsRowSkeletonShape,
  SettingsRowsSkeleton,
  SettingsSection,
  Stack,
  TEXT_FIELD_FONT,
  TextArea,
  TextField,
  TrashIcon,
  useConfirmDialog,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import {
  type QueryClient,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Schema } from "effect";
import { useState } from "react";
import { actFailureWords, askAct, sendAct } from "../act.js";
import { useConfirmAct } from "../confirm-act.js";
import { useFormDialog } from "../desktop/use-form-dialog.js";
import { confirmFailure } from "../failure-report.js";
import { QUERY_ROOT } from "../query-keys.js";
import { ReadFailed, replayMaskedError } from "./marks.js";
import { MenuRow } from "./menu-row.js";
import { shownWorkspace } from "./settings-rows.js";
import type { WorkspaceSettingsControl } from "./workspace-page.js";

/**
 * cloud-setup-page.tsx -- Settings › Cloud setup: how the workspace's cloud agent sandboxes are set up, its install script and each repository's setup script, saved by its owners and admins.
 *
 * As Conductor Cloud's Cloud computer settings keep them. The install script
 * runs once per build of each of the workspace's repositories' base
 * snapshots, with `sudo`, so what it installs is in every new sandbox; a
 * repository's setup script runs once in each new agent sandbox of it, after
 * its checkout, with the workspace's environment variables. Every member reads
 * both, each script drawn under its row; an owner or admin adds, edits, and
 * removes them, a removal asking first. Each save answers the setup as it then
 * stands, which the page draws at once.
 */

/** A script's row while the setup is read. */
const SCRIPT_ROW_SKELETON: SettingsRowSkeletonShape = {
  described: false,
  controls: [],
  end: [SETTINGS_SKELETON_CONTROL.MORE],
};

/** The most lines a script stands at under its row before it scrolls. */
const SHOWN_SCRIPT_LINES = 8;

/** The lines the edit dialog's script stands at. */
const EDITED_SCRIPT_LINES = 14;

/** Whether a repository is one the service takes, so Save waits for one it would not refuse by shape. */
const isRepository = Schema.is(githubRepositoryFullNameSchema);

const ACCEPTED: ActionResult = { status: ACTION_RESULT_STATUS.ACCEPTED };

function rejected(error: unknown): ActionResult {
  return { status: ACTION_RESULT_STATUS.REJECTED, reason: actFailureWords(error) };
}

/** Which script a save names: the workspace's install script, or a repository's setup script. */
type ScriptTarget = { readonly repository?: undefined } | { readonly repository: string };

/** The workspace's sandbox setup, read as the page opens and on Try again. */
function setupQuery(workspaceId: string) {
  return queryOptions({
    queryKey: [QUERY_ROOT.WORKSPACE_SANDBOX_SETUP, workspaceId],
    queryFn: () => askAct(ACT_KIND.WORKSPACE_SANDBOX_SETUP_READ, { workspaceId }),
    retry: false,
  });
}

/** A save's answer drawn over the page, a read still under way canceled first so its older setup cannot land over it. */
async function drawAnswer(
  queries: QueryClient,
  workspaceId: string,
  answer: WorkspaceSandboxSetupAnswer,
): Promise<void> {
  const { queryKey } = setupQuery(workspaceId);
  await queries.cancelQueries({ queryKey, exact: true });
  queries.setQueryData(queryKey, answer);
}

/** A save of the script named, an empty one removing it, its answer drawn over the page at once. */
function useSaveScript(workspaceId: string) {
  const queries = useQueryClient();
  return useMutation({
    mutationFn: ({ target, script }: { target: ScriptTarget; script: string }) =>
      target.repository === undefined
        ? sendAct(ACT_KIND.WORKSPACE_INSTALL_SCRIPT_PUT, { workspaceId, script })
        : sendAct(ACT_KIND.WORKSPACE_REPOSITORY_SETUP_PUT, {
            workspaceId,
            repository: target.repository,
            script,
          }),
    onSuccess: (answer) => drawAnswer(queries, workspaceId, answer),
  });
}

/**
 * The script editor: the install script where `adding` is false and no
 * repository is named, a repository's setup script where one is, or a new
 * setup script with its repository typed in where `adding` is true.
 */
function useScriptDialog(
  workspaceId: string,
  shape: { readonly title: string; readonly repository?: string; readonly adding?: boolean },
  saved: string,
) {
  const [typedRepository, setTypedRepository] = useState("");
  const [script, setScript] = useState(saved);
  const saving = useSaveScript(workspaceId);
  const repository = shape.adding === true ? typedRepository.trim() : shape.repository;
  const target: ScriptTarget = repository === undefined ? {} : { repository };
  const act = useConfirmAct(saving, {
    send: () => saving.mutateAsync({ target, script }),
    answered: () => ACCEPTED,
    failed: rejected,
  });
  const confirm = useConfirmDialog(
    { subject: true, surfaceOpen: true },
    act,
    confirmFailure(FAILURE_SURFACE.WORKSPACE_SANDBOX_SETUP_SAVE),
  );
  const form = useFormDialog(
    confirm,
    (repository === undefined || isRepository(repository)) &&
      script.trim() !== "" &&
      script.length <= WORKSPACE_SANDBOX_SETUP_BOUNDS.MAX_SCRIPT_CHARS,
  );
  const dialog = (
    <Dialog
      open={form.open}
      size={DIALOG_SIZE.WIDE}
      title={shape.title}
      replayUnmasked
      titleReplayMasked={shape.repository !== undefined}
      busy={form.settling}
      refused={form.refusal !== undefined}
      onDismiss={form.dismiss}
      onExited={() => {
        setTypedRepository("");
        setScript(saved);
      }}
      actions={
        <DialogActions
          onCancel={form.dismiss}
          act={{ verb: "Save", tone: DIALOG_TONE.PRIMARY, running: "Saving", ...form.act }}
        />
      }
    >
      <Stack>
        {shape.adding === true ? (
          <FormField label="Repository">
            {(control) => (
              <ReplayMask>
                <TextField
                  field={control}
                  autoCorrect={false}
                  spellCheck={false}
                  placeholder="acme/app"
                  disabled={form.settling}
                  value={typedRepository}
                  onChange={setTypedRepository}
                />
              </ReplayMask>
            )}
          </FormField>
        ) : null}
        <FormField
          label="Script"
          description={
            repository === undefined
              ? "Bash, run with sudo from /workspace."
              : "Bash, run from the repository's checkout."
          }
          error={replayMaskedError(form.refusal)}
        >
          {(control) => (
            <ReplayMask>
              <TextArea
                field={control}
                font={TEXT_FIELD_FONT.MONO}
                rows={EDITED_SCRIPT_LINES}
                spellCheck={false}
                placeholder={
                  repository === undefined
                    ? "sudo apt-get install -y postgresql-client"
                    : "pnpm install\ndocker compose pull"
                }
                disabled={form.settling}
                value={script}
                onChange={setScript}
              />
            </ReplayMask>
          )}
        </FormField>
      </Stack>
    </Dialog>
  );
  return { ask: confirm.ask, dialog };
}

/** A saved script drawn under its row, read-only, as tall as its lines up to `SHOWN_SCRIPT_LINES`. */
function ShownScript({ label, script }: { label: string; script: string }): React.JSX.Element {
  return (
    <ReplayMask>
      <TextArea
        label={label}
        font={TEXT_FIELD_FONT.MONO}
        rows={Math.min(script.split("\n").length, SHOWN_SCRIPT_LINES)}
        readOnly
        value={script}
        onChange={() => undefined}
      />
    </ReplayMask>
  );
}

/** One script's row: its name and the script under it, and for an owner or admin a ⋯ with Edit and Remove. */
function ScriptRow({
  workspaceId,
  name,
  repository,
  script,
  manages,
}: {
  workspaceId: string;
  name: string;
  repository?: string;
  script: string;
  manages: boolean;
}): React.JSX.Element {
  const editing = useScriptDialog(
    workspaceId,
    { title: `Edit ${name}`, ...(repository === undefined ? undefined : { repository }) },
    script,
  );
  const saving = useSaveScript(workspaceId);
  const removeAct = useConfirmAct(saving, {
    send: () =>
      saving.mutateAsync({ target: repository === undefined ? {} : { repository }, script: "" }),
    answered: () => ACCEPTED,
    failed: rejected,
  });
  const removal = useConfirmDialog(
    { subject: true, surfaceOpen: true },
    removeAct,
    confirmFailure(FAILURE_SURFACE.WORKSPACE_SANDBOX_SETUP_SAVE),
  );
  const actions = manages
    ? [
        { label: "Edit", icon: <GLYPH.RENAME />, onSelect: editing.ask },
        { label: "Remove", icon: <TrashIcon />, danger: true, onSelect: removal.ask },
      ]
    : [];
  return (
    <>
      <MenuRow
        thing={name}
        actions={actions}
        row={{
          label: repository === undefined ? name : <ReplayMask>{name}</ReplayMask>,
          below: <ShownScript label={name} script={script} />,
        }}
      />
      {manages ? (
        <>
          {editing.dialog}
          <ConfirmDialog
            open
            confirm={removal}
            question={{
              title: `Remove ${name}?`,
              verb: "Remove",
              running: "Removing",
              loss: CONFIRM_LOSS.AFFECTS_OTHERS,
              replayUnmasked: true,
              titleReplayMasked: repository !== undefined,
            }}
          />
        </>
      ) : null}
    </>
  );
}

/** The page over one workspace: its install script, then each repository's setup script. */
function ShownCloudSetup({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const manages = managesWorkspace(workspace);
  const setup = useQuery(setupQuery(workspace.id));
  const addInstall = useScriptDialog(workspace.id, { title: "Add install script" }, "");
  const addSetup = useScriptDialog(workspace.id, { title: "Add setup script", adding: true }, "");
  const answer = setup.data;
  const read = setup.isError ? (
    <ReadFailed
      line="The cloud setup could not be read."
      surface={FAILURE_SURFACE.WORKSPACE_SANDBOX_SETUP_READ}
      onRetry={() => void setup.refetch()}
    />
  ) : answer === undefined ? (
    <SettingsRowsSkeleton label={readingWords("the cloud setup")} rows={[SCRIPT_ROW_SKELETON]} />
  ) : undefined;
  return (
    <>
      <SettingsSection
        title="Install software"
        caption="Runs with sudo each time a repository's snapshot is built, so what it installs is in every new agent sandbox."
        action={
          manages && answer !== undefined && answer.install === null ? (
            <Button variant={BUTTON_VARIANT.OUTLINE} icon={<PlusIcon />} onClick={addInstall.ask}>
              Add script
            </Button>
          ) : undefined
        }
      >
        {read ??
          (answer?.install == null ? (
            <SettingsLine>No install script yet.</SettingsLine>
          ) : (
            <ScriptRow
              workspaceId={workspace.id}
              name="Install script"
              script={answer.install.script}
              manages={manages}
            />
          ))}
      </SettingsSection>
      <SettingsSection
        title="Setup scripts"
        caption="Run once in each new agent sandbox of their repository, after its checkout, with the workspace's environment variables."
        action={
          manages ? (
            <Button variant={BUTTON_VARIANT.OUTLINE} icon={<PlusIcon />} onClick={addSetup.ask}>
              Add script
            </Button>
          ) : undefined
        }
      >
        {read ??
          (answer === undefined || answer.setups.length === 0 ? (
            <SettingsLine>No setup scripts yet.</SettingsLine>
          ) : (
            answer.setups.map((each) => (
              <ScriptRow
                key={each.repository.toLowerCase()}
                workspaceId={workspace.id}
                name={each.repository}
                repository={each.repository}
                script={each.script}
                manages={manages}
              />
            ))
          ))}
      </SettingsSection>
      {manages ? (
        <>
          {addInstall.dialog}
          {addSetup.dialog}
        </>
      ) : null}
    </>
  );
}

/** Settings › Cloud setup over the workspace the sidebar lists, or why there is none to show; signed in, as Settings draws it. */
export function CloudSetupPage({
  control,
}: {
  /** The account's workspaces, drawn while it is signed in. */
  control: WorkspaceSettingsControl | undefined;
}): React.JSX.Element | null {
  if (control === undefined) return null;
  const workspace = shownWorkspace(control);
  if (workspace === undefined) {
    return control.listFailed ? (
      <SettingsSection>
        <ReadFailed
          line="Your workspaces could not be read."
          surface={FAILURE_SURFACE.WORKSPACES_READ}
          onRetry={control.onRetryList}
        />
      </SettingsSection>
    ) : (
      <SettingsRowsSkeleton label={readingWords("the cloud setup")} rows={[SCRIPT_ROW_SKELETON]} />
    );
  }
  // Keyed to the workspace, so another one listed reads its own setup and asks nothing left over.
  return <ShownCloudSetup key={workspace.id} workspace={workspace} />;
}
