import { LINK_DESTINATION } from "@repo/features/link-grammar";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { momentText } from "@repo/features/time-format";
import { readingWords } from "@repo/features/words";
import { managesWorkspace } from "@repo/features/workspace-role";
import {
  type CloudSetupScriptRun,
  REPOSITORY_SCRIPT_KIND,
  type RepositoryRunActions,
  type RepositoryScriptKind,
  type RunAction,
  WORKSPACE_SANDBOX_SETUP_BOUNDS,
  type WorkspaceSandboxSetupAnswer,
} from "@repo/features/workspace-sandbox-setup-wire";
import type { Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import { EXPERIMENT } from "@repo/settings";
import { SETTINGS_SEARCH_ROW } from "@repo/settings/settings-anchors";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  AVATAR_SIZE,
  BUTTON_VARIANT,
  Button,
  CONFIRM_LOSS,
  CodeEditor,
  ConfirmDialog,
  DIALOG_TONE,
  Dialog,
  DialogActions,
  FormField,
  GAP,
  GlyphSlot,
  INLINE_REF_LOOK,
  Inline,
  InlineRef,
  OneLine,
  PlusIcon,
  POPOVER_ALIGN,
  RepositoryPicture,
  SETTINGS_ROW_CONTROLS,
  SETTINGS_ROW_INDENT,
  SETTINGS_SKELETON_CONTROL,
  SettingsLine,
  SettingsRowControlHold,
  type SettingsRowSkeletonShape,
  SettingsRowsSkeleton,
  SettingsSection,
  Stack,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextField,
  TIME_LOOK,
  Time,
  TrashIcon,
  useConfirmDialog,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
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
import { useState } from "react";
import { actFailureWords, askAct, sendAct } from "../act.js";
import { useTypedCodeColoring } from "../code-coloring.js";
import { useConfirmAct } from "../confirm-act.js";
import { useFormDialog } from "../desktop/use-form-dialog.js";
import { confirmFailure, refusalShown } from "../failure-report.js";
import { QUERY_ROOT } from "../query-keys.js";
import { useRepositoryPictures } from "../repository-pictures.js";
import { useRepositoryMenu } from "../tasks/repository-chip.js";
import { useRepositoriesIn } from "../tasks/task-repository-menus.js";
import { useOpenPlace } from "../tasks/use-open-link.js";
import { useWorkspaceExperiment } from "../workspace-experiments.js";
import { ReadFailed, replayMaskedError } from "./marks.js";
import { MenuRow } from "./menu-row.js";

/**
 * cloud-setup-sections.tsx -- Settings › Cloud environment's scripts: how the workspace's cloud agent sandboxes are set up and archived, its install script and each repository's setup and archive scripts, saved by its owners and admins.
 *
 * As Conductor Cloud's Cloud computer settings keep them. The install script
 * runs once per build of each of the workspace's repositories' base
 * snapshots, with `sudo`, so what it installs is in every new sandbox; a
 * repository's setup script runs once in each new agent sandbox of it, after
 * its checkout, and its archive script once in each as its agent is archived,
 * just before the sandbox is deleted, both with the workspace's environment
 * variables. Every member reads them all, each script drawn under its row in
 * Bash's colors with its lines numbered, at least a few lines tall; an owner
 * or admin edits each in place, as a file is edited, its border taking the
 * accent and Discard and Save standing at its row's end once it differs from
 * what is saved, ⌘S and Escape in it pressing them, in a line
 * that already stands as tall as they are, so neither their arrival nor the
 * first character typed moves the page; types the install script into its
 * empty row where none is saved
 * yet, adds a setup or archive script from a repository picked in the menu a
 * task's repository is picked in, and removes one from its ⋯, a removal
 * asking first. Each save answers the setup as it then stands, which the
 * sections draw at once. Under a saved script's name stands how it last ran in
 * a cloud sandbox, so an owner sees whether it works without starting an
 * agent: when, in which agent's sandbox, whose name opens the agent so its
 * Terminal shows the log, and how it exited, a failure in the danger ink;
 * a script saved since that run says it has not run since.
 */

/** A script's row while the setup is read. */
const SCRIPT_ROW_SKELETON: SettingsRowSkeletonShape = {
  described: false,
  controls: [],
  end: [SETTINGS_SKELETON_CONTROL.MORE],
};

/** What a script's editor offers while it is empty, by which script it is. */
const PLACEHOLDER = {
  INSTALL: "sudo apt-get install -y postgresql-client",
  [REPOSITORY_SCRIPT_KIND.SETUP]: "pnpm install\ndocker compose pull",
  [REPOSITORY_SCRIPT_KIND.ARCHIVE]: "docker compose down --volumes",
} as const;

/** What a section of a repository's scripts says, by which script it holds. */
const REPOSITORY_SECTION = {
  [REPOSITORY_SCRIPT_KIND.SETUP]: {
    title: "Setup scripts",
    anchor: SETTINGS_SEARCH_ROW.ENVIRONMENT_SETUP,
    caption: "Run in each new cloud sandbox after its repository is checked out.",
    empty: "No setup scripts yet.",
  },
  [REPOSITORY_SCRIPT_KIND.ARCHIVE]: {
    title: "Archive scripts",
    anchor: SETTINGS_SEARCH_ROW.ENVIRONMENT_ARCHIVE,
    caption:
      "Run when an agent is archived, before its sandbox is deleted. Stopped after 90 seconds.",
    empty: "No archive scripts yet.",
  },
} as const satisfies Record<
  RepositoryScriptKind,
  {
    readonly title: string;
    readonly anchor: string;
    readonly caption: string;
    readonly empty: string;
  }
>;

/** How many lines a script's editor stands while it holds fewer, so its placeholder and the first lines typed have room, and an empty one does not shrink as it is typed in. */
const MIN_SCRIPT_LINES = 3;

/** The language main colors a script in. */
const SCRIPT_LANGUAGE = "bash";

const ACCEPTED: ActionResult = { status: ACTION_RESULT_STATUS.ACCEPTED };

function rejected(error: unknown): ActionResult {
  return { status: ACTION_RESULT_STATUS.REJECTED, reason: actFailureWords(error) };
}

/** Whether two names are one repository, as GitHub's names ignore case. */
function sameRepository(one: string, other: string): boolean {
  return one.toLowerCase() === other.toLowerCase();
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

/** Which script a save names: the workspace's install script, or a repository's setup or archive script. */
type ScriptTarget =
  | { readonly repository?: undefined }
  | { readonly repository: string; readonly kind: RepositoryScriptKind };

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
            kind: target.kind,
          }),
    onSuccess: (answer) => drawAnswer(queries, workspaceId, answer),
  });
}

/** A script under its row, colored as Bash while it is typed, masked in a screen recording; read-only to a member. */
function ScriptEditor({
  label,
  value,
  onChange,
  placeholder,
  editable,
  busy,
  autoFocus,
  changed,
  onSave,
  onLeave,
}: {
  label: string;
  value: string;
  onChange: (script: string) => void;
  /** What it offers while empty, by which script it is (`PLACEHOLDER`). */
  placeholder: string;
  /** Whether the reader may change it: an owner or admin. */
  editable: boolean;
  /** Whether a save of it is out, which holds it still. */
  busy: boolean;
  /** Whether the caret lands in it as it is drawn, as in a setup script just added. */
  autoFocus?: boolean;
  /** Whether it holds an edit not yet saved, which its border says. */
  changed: boolean;
  /** What ⌘S in it does: the row's Save, where it may save now. */
  onSave: (() => void) | undefined;
  /** What Escape in it does: the row's Discard or Cancel, while either stands. */
  onLeave: (() => void) | undefined;
}): React.JSX.Element {
  const lines = useTypedCodeColoring(SCRIPT_LANGUAGE, value);
  return (
    <ReplayMask>
      <CodeEditor
        label={label}
        value={value}
        onChange={onChange}
        lines={lines}
        placeholder={placeholder}
        rows={MIN_SCRIPT_LINES}
        lineNumbers
        changed={changed}
        onSave={onSave}
        onEscape={onLeave}
        readOnly={!editable || busy}
        autoFocus={autoFocus}
      />
    </ReplayMask>
  );
}

/** A script as saved: when it was saved, and how it last ran where it has. */
type SavedScript = NonNullable<WorkspaceSandboxSetupAnswer["install"]>;

/**
 * How a saved script last ran, as the line under its name says it: when, in
 * which agent's sandbox, whose name opens that agent, and how it exited, in
 * the danger ink where it failed. It holds to one line, fading where it is
 * cut and saying itself whole in its hint, as the name above it does, so the
 * narrower words an edit's Discard and Save leave never rewrap it and move
 * the editor. Note that a run from before the script's last save is not said
 * as the script's, because what ran is no longer what is saved.
 */
function LastRun({
  run,
  savedAt,
}: {
  run: CloudSetupScriptRun;
  savedAt: number;
}): React.JSX.Element {
  const openPlace = useOpenPlace();
  if (run.ranAt < savedAt) return <OneLine>Hasn't run since it was saved.</OneLine>;
  const { agent } = run;
  return (
    <OneLine words={`Last ran ${momentText(run.ranAt)} in ${agent.name}, exited ${run.exitCode}`}>
      <Text
        as={TEXT_ELEMENT.SPAN}
        variant={TEXT_VARIANT.INHERIT}
        tone={run.exitCode === 0 ? TEXT_TONE.MUTED : TEXT_TONE.DANGER}
      >
        Last ran <Time at={run.ranAt} look={TIME_LOOK.AGO} hint={false} />
        {" in "}
        <ReplayMask>
          <InlineRef
            look={INLINE_REF_LOOK.LINK}
            label={agent.name}
            hint={false}
            onPress={
              openPlace === undefined
                ? undefined
                : () =>
                    openPlace({
                      kind: LINK_DESTINATION.AGENT,
                      planId: agent.taskId,
                      agentId: agent.id,
                    })
            }
          />
        </ReplayMask>
        {`, exited ${run.exitCode}`}
      </Text>
    </OneLine>
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
      <Button variant={BUTTON_VARIANT.QUIET} disabled={saving} onClick={onLeave}>
        {leave}
      </Button>
      <Button variant={BUTTON_VARIANT.PRIMARY} disabled={!canSave || saving} onClick={onSave}>
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
 * the first is typed in place as any edit is; a setup script just added
 * stands the same way, the caret in it and Cancel at its end until it is
 * saved, when it goes on as the repository's saved row. Note that the edit
 * is held apart from what is saved, so a save from elsewhere is drawn while
 * nothing is being typed, and that it is let go once what is saved agrees
 * with it rather than when its save answers, as the Optimistic Updates
 * guide's "via the UI" draws a mutation's variables until the read catches
 * up (`row-write.ts`): the read's observers hear the answer a tick after the
 * save's own callback runs, so letting go then would draw the old script for
 * a frame between.
 */
function ScriptRow({
  workspaceId,
  name,
  target,
  script,
  manages,
  pictures,
  added,
  saved,
}: {
  workspaceId: string;
  name: string;
  target: ScriptTarget;
  /** The script as saved; empty for an install script or a setup script not yet saved. */
  script: string;
  /** The script as saved, with how it last ran; none while it is not yet saved. */
  saved: SavedScript | undefined;
  manages: boolean;
  /** Whether a repository is drawn with its owner's picture (`RepositoryPicture`). */
  pictures: boolean;
  /** A setup script just added and not yet saved: what Cancel does to let it go. */
  added?: { readonly onCancel: () => void } | undefined;
}): React.JSX.Element {
  const [edited, setEdited] = useState<string | undefined>(undefined);
  const saving = useSaveScript(workspaceId);
  const { repository } = target;
  // An edit the saved script now agrees with, its own save's or another's, is let go.
  if (edited !== undefined && edited === script && !saving.isPending) setEdited(undefined);
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
  const save = () => saving.mutate({ target, script: shown });
  const editing = changed || added !== undefined;
  const leave = added === undefined ? discard : added.onCancel;
  // Note that ⌘S answers only what the row's Save would: an edit that may be saved, with no save already out.
  const saveKey = editing && savable(shown) && !saving.isPending ? save : undefined;
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
              <Inline gap={GAP.ICON} wrap={false}>
                <GlyphSlot line>
                  <RepositoryPicture
                    repository={repository}
                    pictures={pictures}
                    size={AVATAR_SIZE.GLYPH}
                  />
                </GlyphSlot>
                {/* Note that the name keeps to one line, fading where it is cut, so the Discard and Save an edit brings never wrap it and move the editor. */}
                <ReplayMask>
                  <OneLine>{name}</OneLine>
                </ReplayMask>
              </Inline>
            ),
          description:
            saved?.lastRun === undefined ? undefined : (
              <LastRun run={saved.lastRun} savedAt={saved.updatedAt} />
            ),
          error: saveRefusal(saving.error),
          // Note that Discard and Save stay beside the name at any width, the name giving way, since dropping under it would move the editor at a phone's width.
          controls: SETTINGS_ROW_CONTROLS.BESIDE,
          control: editing ? (
            <EditActions
              leave={added === undefined ? "Discard" : "Cancel"}
              saving={saving.isPending}
              canSave={savable(shown)}
              onLeave={leave}
              onSave={save}
            />
          ) : manages ? (
            // Note that a row an owner may edit already stands as tall as the Discard and Save its edit brings, so their arrival moves nothing.
            <SettingsRowControlHold />
          ) : undefined,
          below: (
            <ScriptEditor
              label={name}
              value={shown}
              onChange={setEdited}
              placeholder={
                target.repository === undefined ? PLACEHOLDER.INSTALL : PLACEHOLDER[target.kind]
              }
              editable={manages}
              busy={saving.isPending}
              autoFocus={added !== undefined}
              changed={changed}
              onSave={saveKey}
              onLeave={editing && !saving.isPending ? leave : undefined}
            />
          ),
        }}
      />
      {manages ? (
        <ConfirmDialog
          open
          confirm={removal}
          question={{
            title:
              target.repository === undefined
                ? `Remove ${name}?`
                : `Remove ${name}'s ${target.kind} script?`,
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
 * A repository section's Add, which drops the repository menu a task's
 * repository is picked in (`useRepositoryMenu`): the repositories the
 * workspace's GitHub reaches, less those `taken`. A pick adds to that
 * repository, and the press stands for the next one.
 */
function AddRepositoryButton({
  workspaceId,
  label,
  taken,
  onPick,
}: {
  workspaceId: string;
  /** The press's words: Add script, Add action. */
  label: string;
  /** The repositories the menu leaves out: those with a script of the section's kind saved or being added. */
  taken: readonly string[];
  onPick: (repository: string) => void;
}): React.JSX.Element {
  const chooser = useRepositoriesIn()(workspaceId);
  const menu = useRepositoryMenu({
    value: null,
    chooser,
    onChoose: onPick,
    omit: taken,
    align: POPOVER_ALIGN.END,
  });
  // Note that the menu's press only opens or shuts it, starting no act, so it is named for that.
  const toggleMenu = menu.press;
  return (
    <div className="relative inline-flex min-w-0" ref={menu.room}>
      <Button
        variant={BUTTON_VARIANT.OUTLINE}
        icon={<PlusIcon />}
        aria-haspopup="dialog"
        aria-expanded={menu.open}
        aria-controls={menu.open ? menu.menuId : undefined}
        onClick={(event) => toggleMenu(event.currentTarget)}
      >
        {label}
      </Button>
      {menu.menu}
    </div>
  );
}

/**
 * One section of the repositories' scripts of a kind: a row for each saved,
 * and for each repository an owner or admin added and has not yet saved,
 * under its Add script.
 */
function RepositoryScriptsSection({
  workspaceId,
  kind,
  saved,
  read,
  manages,
  pictures,
}: {
  workspaceId: string;
  kind: RepositoryScriptKind;
  /** The repositories' saved scripts of the kind, in the order of their names. */
  saved: WorkspaceSandboxSetupAnswer["setups"];
  /** What stands in the rows' place while the setup is read, or why it could not be; nothing once it is. */
  read: React.JSX.Element | undefined;
  manages: boolean;
  pictures: boolean;
}): React.JSX.Element {
  const [added, setAdded] = useState<readonly string[]>([]);
  const words = REPOSITORY_SECTION[kind];
  // A repository added and since saved is the saved list's now, so it is let go of here.
  const unsaved = added.filter(
    (repository) => !saved.some((each) => sameRepository(each.repository, repository)),
  );
  if (unsaved.length !== added.length) setAdded(unsaved);
  // Note that the saved and the added stand in one list keyed by repository, so a row just saved goes on as the same row, its caret where it was.
  const rows = [
    ...saved,
    ...(manages ? unsaved.map((repository) => ({ repository, script: "", added: true })) : []),
  ];
  const taken = rows.map((each) => each.repository);
  const add = (repository: string) =>
    setAdded((now) =>
      now.some((each) => sameRepository(each, repository)) ? now : [...now, repository],
    );
  const letGo = (repository: string) =>
    setAdded((now) => now.filter((each) => !sameRepository(each, repository)));
  return (
    <SettingsSection
      title={words.title}
      anchor={words.anchor}
      caption={words.caption}
      action={
        manages ? (
          <AddRepositoryButton
            workspaceId={workspaceId}
            label="Add script"
            taken={taken}
            onPick={add}
          />
        ) : undefined
      }
    >
      {read ?? (
        <>
          {rows.length === 0 ? <SettingsLine>{words.empty}</SettingsLine> : null}
          {rows.map((each) => (
            <ScriptRow
              key={each.repository.toLowerCase()}
              workspaceId={workspaceId}
              name={each.repository}
              target={{ repository: each.repository, kind }}
              script={each.script}
              manages={manages}
              pictures={pictures}
              added={"added" in each ? { onCancel: () => letGo(each.repository) } : undefined}
              saved={"added" in each ? undefined : each}
            />
          ))}
        </>
      )}
    </SettingsSection>
  );
}

/** Which run action the dialog writes: a new one at the end of a repository's list, or the one at `index` in it. */
interface RunActionTarget {
  readonly repository: string;
  readonly index?: number | undefined;
}

/** Every repository's run actions as the setup answers them. */
type RunActionLists = readonly RepositoryRunActions[];

/** A run action as a save writes it: one already in the list with its id, or a new one with none. */
interface RunActionWritten {
  readonly id: string | undefined;
  readonly label: string;
  readonly command: string;
}

/** A repository's run actions as the answer holds them; none where it holds no list. */
function runActionsOf(lists: RunActionLists, repository: string): readonly RunAction[] {
  return lists.find((each) => sameRepository(each.repository, repository))?.actions ?? [];
}

/** Whether an action may be saved as typed: a label and a command, each within its bound. */
function runActionSavable(label: string, command: string): boolean {
  const name = label.trim();
  return (
    name !== "" &&
    name.length <= WORKSPACE_SANDBOX_SETUP_BOUNDS.MAX_RUN_ACTION_LABEL_CHARS &&
    command.trim() !== "" &&
    command.length <= WORKSPACE_SANDBOX_SETUP_BOUNDS.MAX_RUN_ACTION_COMMAND_CHARS
  );
}

/**
 * A save of a repository's whole list of run actions, an empty one removing
 * it, its answer drawn over the page at once. Note that the section holds
 * one for every row and its card, and each control stands still while it is
 * out, because a save writes the whole list as its control last read it, so
 * a second press under the first would write over the first's change.
 */
function useSaveRunActions(workspaceId: string) {
  const queries = useQueryClient();
  return useMutation({
    mutationFn: ({
      repository,
      actions,
    }: {
      repository: string;
      actions: readonly RunActionWritten[];
    }) =>
      sendAct(ACT_KIND.WORKSPACE_RUN_ACTIONS_PUT, {
        workspaceId,
        repository,
        // An action new to the list names no id, and the service names it.
        actions: actions.map(({ id, label, command }) =>
          id === undefined ? { label, command } : { id, label, command },
        ),
      }),
    onSuccess: (answer) => drawAnswer(queries, workspaceId, answer),
  });
}

/** The section's one save of a repository's run actions. */
type RunActionSave = ReturnType<typeof useSaveRunActions>;

/**
 * The card that adds a run action to a repository, or edits one: its label
 * and its command, the command colored as Bash. Saving writes the
 * repository's whole list with the action added at its end or changed in
 * its place.
 */
function useRunActionDialog(saving: RunActionSave, lists: RunActionLists) {
  const [target, setTarget] = useState<RunActionTarget | undefined>(undefined);
  const [label, setLabel] = useState("");
  const [command, setCommand] = useState("");
  const lines = useTypedCodeColoring(SCRIPT_LANGUAGE, command);
  const act = useConfirmAct(saving, {
    send: () => {
      const repository = target?.repository ?? "";
      const standing = runActionsOf(lists, repository);
      const typed = { label: label.trim(), command };
      const index = target?.index;
      const actions =
        index === undefined
          ? [...standing, { id: undefined, ...typed }]
          : standing.map((each, at) => (at === index ? { ...each, ...typed } : each));
      return saving.mutateAsync({ repository, actions });
    },
    answered: () => ACCEPTED,
    failed: rejected,
  });
  const confirm = useConfirmDialog(
    { subject: true, surfaceOpen: true },
    act,
    confirmFailure(FAILURE_SURFACE.WORKSPACE_SANDBOX_SETUP_SAVE),
  );
  const form = useFormDialog(confirm, target !== undefined && runActionSavable(label, command));
  const edited =
    target?.index === undefined ? undefined : runActionsOf(lists, target.repository)[target.index];
  const open = (next: RunActionTarget) => {
    const shown =
      next.index === undefined ? undefined : runActionsOf(lists, next.repository)[next.index];
    setTarget(next);
    setLabel(shown?.label ?? "");
    setCommand(shown?.command ?? "");
    confirm.ask();
  };
  const dialog = (
    <Dialog
      open={form.open}
      title={edited === undefined ? "Add run action" : `Edit ${edited.label}`}
      replayUnmasked
      titleReplayMasked={edited !== undefined}
      busy={form.settling}
      refused={form.refusal !== undefined}
      onDismiss={form.dismiss}
      actions={
        <DialogActions
          onCancel={form.dismiss}
          act={{ verb: "Save", tone: DIALOG_TONE.PRIMARY, running: "Saving", ...form.act }}
        />
      }
    >
      <Stack>
        <FormField label="Label">
          {(control) => (
            <ReplayMask>
              <TextField
                field={control}
                placeholder="Dev server"
                maxLength={WORKSPACE_SANDBOX_SETUP_BOUNDS.MAX_RUN_ACTION_LABEL_CHARS}
                disabled={form.settling}
                value={label}
                onChange={setLabel}
                onEnter={form.submit}
              />
            </ReplayMask>
          )}
        </FormField>
        <FormField
          label="Command"
          description="Runs from the checkout with the workspace's environment variables."
          error={replayMaskedError(form.refusal)}
        >
          {(control) => (
            <ReplayMask>
              <CodeEditor
                id={control.id}
                label="Command"
                describedBy={control["aria-describedby"]}
                invalid={control["aria-invalid"]}
                value={command}
                onChange={setCommand}
                lines={lines}
                placeholder="pnpm dev"
                rows={MIN_SCRIPT_LINES}
                readOnly={form.settling}
              />
            </ReplayMask>
          )}
        </FormField>
      </Stack>
    </Dialog>
  );
  return { open, dialog };
}

/**
 * One run action's row, under its repository's: its label, its command
 * under it, and for an owner or admin a ⋯ with Edit, Move up, Move down,
 * and Remove, a removal asking first.
 */
function RunActionRow({
  saving,
  repository,
  actions,
  index,
  manages,
  onEdit,
}: {
  /** The section's one save, which every row and the card share (`useSaveRunActions`). */
  saving: RunActionSave;
  repository: string;
  /** The repository's whole list, which every change saves anew. */
  actions: readonly RunAction[];
  index: number;
  manages: boolean;
  onEdit: () => void;
}): React.JSX.Element | null {
  const action = actions[index];
  const save = (next: readonly RunActionWritten[]) => saving.mutate({ repository, actions: next });
  const moved = (by: number) => {
    const next = [...actions];
    const [taken] = next.splice(index, 1);
    if (taken !== undefined) next.splice(index + by, 0, taken);
    return next;
  };
  const removeAct = useConfirmAct(saving, {
    send: () =>
      saving.mutateAsync({ repository, actions: actions.filter((_, at) => at !== index) }),
    answered: () => ACCEPTED,
    failed: rejected,
  });
  const removal = useConfirmDialog(
    { subject: true, surfaceOpen: true },
    removeAct,
    confirmFailure(FAILURE_SURFACE.WORKSPACE_SANDBOX_SETUP_SAVE),
  );
  if (action === undefined) return null;
  const busy = saving.isPending;
  const menu = manages
    ? [
        [
          { label: "Edit", icon: <GLYPH.RENAME />, disabled: busy, onSelect: onEdit },
          {
            label: "Move up",
            icon: <ArrowUpIcon />,
            disabled: busy || index === 0,
            onSelect: () => save(moved(-1)),
          },
          {
            label: "Move down",
            icon: <ArrowDownIcon />,
            disabled: busy || index === actions.length - 1,
            onSelect: () => save(moved(1)),
          },
        ],
        [
          {
            label: "Remove",
            icon: <TrashIcon />,
            danger: true,
            disabled: busy,
            onSelect: removal.ask,
          },
        ],
      ]
    : [];
  return (
    <>
      <MenuRow
        thing={action.label}
        actions={menu}
        row={{
          label: <ReplayMask>{action.label}</ReplayMask>,
          description: <ReplayMask>{action.command}</ReplayMask>,
          indent: SETTINGS_ROW_INDENT.MARK,
        }}
      />
      {manages ? (
        <ConfirmDialog
          open
          confirm={removal}
          question={{
            title: `Remove ${action.label}?`,
            verb: "Remove",
            running: "Removing",
            loss: CONFIRM_LOSS.AFFECTS_OTHERS,
            replayUnmasked: true,
            titleReplayMasked: true,
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Each repository's run actions, behind the Run actions experiment: a row
 * for the repository with its Add action, and a row for each action under
 * it, in its order. An owner or admin adds one from Add action, to a
 * repository already listed or one picked in the repository menu, and
 * edits, moves, or removes one from its ⋯; every change saves the
 * repository's whole list.
 */
function RunActionsSection({
  workspaceId,
  lists,
  read,
  manages,
  pictures,
}: {
  workspaceId: string;
  lists: RunActionLists;
  /** What stands in the rows' place while the setup is read, or why it could not be; nothing once it is. */
  read: React.JSX.Element | undefined;
  manages: boolean;
  pictures: boolean;
}): React.JSX.Element {
  const saving = useSaveRunActions(workspaceId);
  const dialog = useRunActionDialog(saving, lists);
  // A repository whose list is full is left out of Add action's menu, as its own row's Add action stands still, so no card opens on a save the service would refuse.
  const full = lists
    .filter((list) => list.actions.length >= WORKSPACE_SANDBOX_SETUP_BOUNDS.MAX_RUN_ACTIONS)
    .map((list) => list.repository);
  return (
    <SettingsSection
      title="Run actions"
      anchor={SETTINGS_SEARCH_ROW.ENVIRONMENT_RUN_ACTIONS}
      caption="Listed in each cloud agent's Run menu, the first on its button. Each runs in a Terminal tab of the agent's sandbox when pressed."
      action={
        manages ? (
          <AddRepositoryButton
            workspaceId={workspaceId}
            label="Add action"
            taken={full}
            onPick={(repository) => {
              if (!saving.isPending) dialog.open({ repository });
            }}
          />
        ) : undefined
      }
    >
      {read ?? (
        <>
          {lists.length === 0 ? <SettingsLine>No run actions yet.</SettingsLine> : null}
          {lists.map((list) => (
            <RunActionsOfRepository
              key={list.repository.toLowerCase()}
              saving={saving}
              repository={list.repository}
              actions={list.actions}
              manages={manages}
              pictures={pictures}
              onAdd={() => dialog.open({ repository: list.repository })}
              onEdit={(index) => dialog.open({ repository: list.repository, index })}
            />
          ))}
        </>
      )}
      {manages ? dialog.dialog : null}
    </SettingsSection>
  );
}

/** One repository's row and its run actions' rows under it. */
function RunActionsOfRepository({
  saving,
  repository,
  actions,
  manages,
  pictures,
  onAdd,
  onEdit,
}: {
  saving: RunActionSave;
  repository: string;
  actions: readonly RunAction[];
  manages: boolean;
  pictures: boolean;
  onAdd: () => void;
  onEdit: (index: number) => void;
}): React.JSX.Element {
  const full = actions.length >= WORKSPACE_SANDBOX_SETUP_BOUNDS.MAX_RUN_ACTIONS;
  // Why the last save of this repository's list was refused, said under its row, whichever control sent it.
  const refused = saving.variables?.repository === repository ? saving.error : null;
  return (
    <>
      <MenuRow
        thing={repository}
        alone
        actions={
          manages
            ? [
                {
                  label: "Add action",
                  icon: <PlusIcon />,
                  disabled: full || saving.isPending,
                  onSelect: onAdd,
                },
              ]
            : []
        }
        row={{
          label: (
            <Inline gap={GAP.ICON}>
              <GlyphSlot line>
                <RepositoryPicture
                  repository={repository}
                  pictures={pictures}
                  size={AVATAR_SIZE.GLYPH}
                />
              </GlyphSlot>
              <ReplayMask>{repository}</ReplayMask>
            </Inline>
          ),
          error: saveRefusal(refused),
        }}
      />
      {actions.map((action, index) => (
        <RunActionRow
          key={action.id}
          saving={saving}
          repository={repository}
          actions={actions}
          index={index}
          manages={manages}
          onEdit={() => onEdit(index)}
        />
      ))}
    </>
  );
}

/** The scripts over one workspace: its install script, then each repository's setup script, then each one's archive script, then each one's run actions where the workspace has Run actions on. */
export function CloudSetupSections({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const manages = managesWorkspace(workspace);
  const runActionsOn = useWorkspaceExperiment(workspace.id, EXPERIMENT.RUN_ACTIONS);
  const pictures = useRepositoryPictures();
  const setup = useQuery(setupQuery(workspace.id));
  const answer = setup.data;
  const read = setup.isError ? (
    <ReadFailed
      line="The scripts could not be read."
      surface={FAILURE_SURFACE.WORKSPACE_SANDBOX_SETUP_READ}
      onRetry={() => void setup.refetch()}
    />
  ) : answer === undefined ? (
    <SettingsRowsSkeleton label={readingWords("the scripts")} rows={[SCRIPT_ROW_SKELETON]} />
  ) : undefined;
  return (
    <>
      <SettingsSection
        title="Install software"
        anchor={SETTINGS_SEARCH_ROW.ENVIRONMENT_INSTALL}
        caption="Installs tools in every new cloud sandbox. Runs with sudo."
      >
        {read ??
          (answer?.install == null && !manages ? (
            <SettingsLine>No install script yet.</SettingsLine>
          ) : (
            <ScriptRow
              workspaceId={workspace.id}
              name="Install script"
              target={{}}
              script={answer?.install?.script ?? ""}
              manages={manages}
              pictures={pictures}
              saved={answer?.install ?? undefined}
            />
          ))}
      </SettingsSection>
      <RepositoryScriptsSection
        workspaceId={workspace.id}
        kind={REPOSITORY_SCRIPT_KIND.SETUP}
        saved={answer?.setups ?? []}
        read={read}
        manages={manages}
        pictures={pictures}
      />
      <RepositoryScriptsSection
        workspaceId={workspace.id}
        kind={REPOSITORY_SCRIPT_KIND.ARCHIVE}
        saved={answer?.archives ?? []}
        read={read}
        manages={manages}
        pictures={pictures}
      />
      {runActionsOn ? (
        <RunActionsSection
          workspaceId={workspace.id}
          lists={answer?.runActions ?? []}
          read={read}
          manages={manages}
          pictures={pictures}
        />
      ) : null}
    </>
  );
}
