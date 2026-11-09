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
  AVATAR_SIZE,
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  CONFIRM_LOSS,
  CodeEditor,
  ConfirmDialog,
  GAP,
  GlyphSlot,
  Inline,
  PlusIcon,
  POPOVER_ALIGN,
  RepositoryPicture,
  SETTINGS_SKELETON_CONTROL,
  SettingsLine,
  type SettingsRowSkeletonShape,
  SettingsRowsSkeleton,
  SettingsSection,
  TrashIcon,
  useConfirmDialog,
} from "@repo/ui";
import type { ShownError } from "@repo/ui/reported-failure";
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
import { useTypedCodeColoring } from "../code-coloring.js";
import { useConfirmAct } from "../confirm-act.js";
import { confirmFailure, refusalShown } from "../failure-report.js";
import { QUERY_ROOT } from "../query-keys.js";
import { useRepositoryPictures } from "../repository-pictures.js";
import { CHIP_PLACE, RepositoryChip } from "../tasks/repository-chip.js";
import { useRepositoriesIn } from "../tasks/task-repository-menus.js";
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
 * both, each script drawn under its row in Bash's colors; an owner or admin
 * edits each in place, as a file is edited, Discard and Save standing at its
 * row's end once it differs from what is saved, types the install script
 * into its empty row where none is saved yet, adds a setup script from a
 * repository picked in the menu a task's repository is picked in, and
 * removes one from its ⋯, a removal asking first. Each save answers the
 * setup as it then stands, which the page draws at once.
 */

/** A script's row while the setup is read. */
const SCRIPT_ROW_SKELETON: SettingsRowSkeletonShape = {
  described: false,
  controls: [SETTINGS_SKELETON_CONTROL.MORE],
};

/** What a script's editor offers while it is empty, by which script it is. */
const PLACEHOLDER = {
  INSTALL: "sudo apt-get install -y postgresql-client",
  SETUP: "pnpm install\ndocker compose pull",
} as const;

/** How many lines an empty script's editor stands, so its placeholder and the first lines typed have room. */
const EMPTY_SCRIPT_LINES = 3;

/** The language main colors a script in. */
const SCRIPT_LANGUAGE = "bash";

/** What a setup script being added is called until its repository is picked. */
const NEW_SETUP = "New setup script";

/** Whether a repository is one the service takes, so Save waits for one it would not refuse by shape. */
const isRepository = Schema.is(githubRepositoryFullNameSchema);

const ACCEPTED: ActionResult = { status: ACTION_RESULT_STATUS.ACCEPTED };

function rejected(error: unknown): ActionResult {
  return { status: ACTION_RESULT_STATUS.REJECTED, reason: actFailureWords(error) };
}

/** Whether a script may be saved as typed: words, within the bound. */
function savable(script: string): boolean {
  return script.trim() !== "" && script.length <= WORKSPACE_SANDBOX_SETUP_BOUNDS.MAX_SCRIPT_CHARS;
}

/** Why a row's last save was refused, as the line under it says it; nothing while none was. */
function saveRefusal(error: Error | null): ShownError | undefined {
  if (error === null) return undefined;
  return replayMaskedError(
    refusalShown(
      { words: actFailureWords(error), cause: error },
      FAILURE_SURFACE.WORKSPACE_SANDBOX_SETUP_SAVE,
    ),
  );
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

/** A script under its row, colored as Bash while it is typed, masked in a screen recording; read-only to a member. */
function ScriptEditor({
  label,
  value,
  onChange,
  install,
  editable,
  busy,
}: {
  label: string;
  value: string;
  onChange: (script: string) => void;
  /** Whether it is the install script, which its placeholder suggests. */
  install: boolean;
  /** Whether the reader may change it: an owner or admin. */
  editable: boolean;
  /** Whether a save of it is out, which holds it still. */
  busy: boolean;
}): React.JSX.Element {
  const lines = useTypedCodeColoring(SCRIPT_LANGUAGE, value);
  return (
    <ReplayMask>
      <CodeEditor
        label={label}
        value={value}
        onChange={onChange}
        lines={lines}
        placeholder={install ? PLACEHOLDER.INSTALL : PLACEHOLDER.SETUP}
        rows={value === "" ? EMPTY_SCRIPT_LINES : 1}
        readOnly={!editable || busy}
      />
    </ReplayMask>
  );
}

/** A row's way out of an edit and its Save, at the row's end. */
function EditActions({
  leave,
  saving,
  canSave,
  onLeave,
  onSave,
}: {
  /** What letting the edit go says: Discard for a saved script, Cancel for a new one. */
  leave: string;
  saving: boolean;
  canSave: boolean;
  onLeave: () => void;
  onSave: () => void;
}): React.JSX.Element {
  return (
    <Inline gap={GAP.CONTROL}>
      <Button
        variant={BUTTON_VARIANT.QUIET}
        size={BUTTON_SIZE.COMPACT}
        disabled={saving}
        onClick={onLeave}
      >
        {leave}
      </Button>
      <Button
        variant={BUTTON_VARIANT.PRIMARY}
        size={BUTTON_SIZE.COMPACT}
        disabled={!canSave || saving}
        onClick={onSave}
      >
        {saving ? "Saving" : "Save"}
      </Button>
    </Inline>
  );
}

/**
 * One script's row: its name and the script under it, which an owner or
 * admin edits in place, Discard and Save standing at the row's end once it
 * differs from what is saved, and a ⋯ with Remove once one is saved. The
 * install script's row stands with an empty script where none is saved, so
 * the first is typed in place as any edit is. Note that the edit is held
 * apart from what is saved, so a save from elsewhere is drawn while nothing
 * is being typed.
 */
function ScriptRow({
  workspaceId,
  name,
  repository,
  script,
  manages,
  pictures,
}: {
  workspaceId: string;
  name: string;
  repository?: string;
  /** The script as saved; empty for an install script not yet saved. */
  script: string;
  manages: boolean;
  /** Whether a repository is drawn with its owner's picture (`RepositoryPicture`). */
  pictures: boolean;
}): React.JSX.Element {
  const [edited, setEdited] = useState<string | undefined>(undefined);
  const saving = useSaveScript(workspaceId);
  const target: ScriptTarget = repository === undefined ? {} : { repository };
  const shown = edited ?? script;
  const changed = edited !== undefined && edited !== script;
  const removeAct = useConfirmAct(saving, {
    send: () => saving.mutateAsync({ target, script: "" }),
    answered: () => ACCEPTED,
    failed: rejected,
  });
  const removal = useConfirmDialog(
    { subject: true, surfaceOpen: true },
    removeAct,
    confirmFailure(FAILURE_SURFACE.WORKSPACE_SANDBOX_SETUP_SAVE),
  );
  const discard = () => {
    saving.reset();
    setEdited(undefined);
  };
  const save = () =>
    saving.mutate({ target, script: shown }, { onSuccess: () => setEdited(undefined) });
  const actions =
    manages && script !== ""
      ? [{ label: "Remove", icon: <TrashIcon />, danger: true, onSelect: removal.ask }]
      : [];
  return (
    <>
      <MenuRow
        thing={name}
        actions={actions}
        row={{
          // Note that the owner's picture rides the label rather than leading the row, so every script's editor stands at the same inset.
          label:
            repository === undefined ? (
              name
            ) : (
              <Inline gap={GAP.ICON}>
                <GlyphSlot line>
                  <RepositoryPicture
                    repository={repository}
                    pictures={pictures}
                    size={AVATAR_SIZE.GLYPH}
                  />
                </GlyphSlot>
                <ReplayMask>{name}</ReplayMask>
              </Inline>
            ),
          error: saveRefusal(saving.error),
          control: changed ? (
            <EditActions
              leave="Discard"
              saving={saving.isPending}
              canSave={savable(shown)}
              onLeave={discard}
              onSave={save}
            />
          ) : undefined,
          below: (
            <ScriptEditor
              label={name}
              value={shown}
              onChange={setEdited}
              install={repository === undefined}
              editable={manages}
              busy={saving.isPending}
            />
          ),
        }}
      />
      {manages ? (
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
      ) : null}
    </>
  );
}

/**
 * A setup script being added: the repository's chip, its menu opened at
 * once on the repositories the workspace's GitHub reaches that have no setup
 * script yet, and the script under it; Cancel lets it go, and Save stands
 * once a repository is picked and the script holds words. Its save's answer
 * draws the repository's own row, so it goes once that lands.
 */
function NewSetupRow({
  workspaceId,
  taken,
  onDone,
}: {
  workspaceId: string;
  /** The repositories that have a setup script already, which the menu leaves out. */
  taken: readonly string[];
  onDone: () => void;
}): React.JSX.Element {
  const [repository, setRepository] = useState<string | null>(null);
  const [script, setScript] = useState("");
  const saving = useSaveScript(workspaceId);
  const chooser = useRepositoriesIn()(workspaceId);
  const ready = repository !== null && isRepository(repository) && savable(script);
  const save = () => {
    if (repository !== null)
      saving.mutate({ target: { repository }, script }, { onSuccess: onDone });
  };
  return (
    <MenuRow
      thing={NEW_SETUP}
      actions={[]}
      row={{
        label: (
          <RepositoryChip
            place={CHIP_PLACE.FIELD}
            value={repository}
            chooser={chooser}
            onChoose={setRepository}
            omit={taken}
            openRequest={1}
            align={POPOVER_ALIGN.START}
            held={saving.isPending ? "Saving" : undefined}
          />
        ),
        error: saveRefusal(saving.error),
        control: (
          <EditActions
            leave="Cancel"
            saving={saving.isPending}
            canSave={ready}
            onLeave={onDone}
            onSave={save}
          />
        ),
        below: (
          <ScriptEditor
            label={repository ?? NEW_SETUP}
            value={script}
            onChange={setScript}
            install={false}
            editable
            busy={saving.isPending}
          />
        ),
      }}
    />
  );
}

/** The page over one workspace: its install script, then each repository's setup script. */
function ShownCloudSetup({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const manages = managesWorkspace(workspace);
  const pictures = useRepositoryPictures();
  const setup = useQuery(setupQuery(workspace.id));
  const [adding, setAdding] = useState(false);
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
  const setups = answer?.setups ?? [];
  return (
    <>
      <SettingsSection
        title="Install software"
        caption="Runs with sudo each time a repository's snapshot is built, so what it installs is in every new agent sandbox."
      >
        {read ??
          (answer?.install == null && !manages ? (
            <SettingsLine>No install script yet.</SettingsLine>
          ) : (
            <ScriptRow
              workspaceId={workspace.id}
              name="Install script"
              script={answer?.install?.script ?? ""}
              manages={manages}
              pictures={pictures}
            />
          ))}
      </SettingsSection>
      <SettingsSection
        title="Setup scripts"
        caption="Run once in each new agent sandbox of their repository, after its checkout, with the workspace's environment variables."
        action={
          manages && !adding ? (
            <Button
              variant={BUTTON_VARIANT.OUTLINE}
              icon={<PlusIcon />}
              onClick={() => setAdding(true)}
            >
              Add script
            </Button>
          ) : undefined
        }
      >
        {read ?? (
          <>
            {setups.length === 0 && !adding ? (
              <SettingsLine>No setup scripts yet.</SettingsLine>
            ) : null}
            {setups.map((each) => (
              <ScriptRow
                key={each.repository.toLowerCase()}
                workspaceId={workspace.id}
                name={each.repository}
                repository={each.repository}
                script={each.script}
                manages={manages}
                pictures={pictures}
              />
            ))}
            {manages && adding ? (
              <NewSetupRow
                workspaceId={workspace.id}
                taken={setups.map((each) => each.repository)}
                onDone={() => setAdding(false)}
              />
            ) : null}
          </>
        )}
      </SettingsSection>
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
