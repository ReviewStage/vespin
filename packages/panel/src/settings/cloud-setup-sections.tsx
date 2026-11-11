import { LINK_DESTINATION } from "@repo/features/link-grammar";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { knownTaskSectionIcon, type TaskSectionIcon } from "@repo/features/task-section-wire";
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
import {
  ArrowDownIcon,
  ArrowUpIcon,
  AVATAR_SIZE,
  Badge,
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  CONFIRM_LOSS,
  CodeEditor,
  ConfirmDialog,
  GAP,
  GlyphSlot,
  INLINE_EDIT_LOOK,
  INLINE_REF_LOOK,
  Inline,
  InlineEdit,
  InlineRef,
  OneLine,
  PlayIcon,
  PlusIcon,
  POPOVER_ALIGN,
  RepositoryPicture,
  SETTINGS_ORDER_HANDLE,
  SETTINGS_ROW_CONTROLS,
  SETTINGS_SKELETON_CONTROL,
  SettingsLine,
  SettingsOrderedRows,
  SettingsRowControlHold,
  SettingsRowMark,
  type SettingsRowSkeletonShape,
  SettingsRowsSkeleton,
  SettingsSection,
  TEXT_ELEMENT,
  TEXT_FONT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TIME_LOOK,
  Time,
  TrashIcon,
  useConfirmDialog,
} from "@repo/ui";
import { GLYPH, SquareTerminalIcon, StarIcon, StarOffIcon } from "@repo/ui/icons";
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
import { useRef, useState } from "react";
import { actFailureWords, askAct, sendAct } from "../act.js";
import { useTypedCodeColoring } from "../code-coloring.js";
import { useConfirmAct } from "../confirm-act.js";
import { SectionIconWell, sectionGlyph } from "../desktop/section-icon-picker.js";
import { useRowDrag } from "../desktop/use-row-drag.js";
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
 * what is saved, ⌘S or ⌘↩ and Escape in it pressing them, in a line
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
 * a script saved since that run says it has not run since. A repository's
 * run actions are edited in place the same way, each with its label and
 * icon leading its row, dragged by its grip or moved from its ⋯ to another
 * place, and one made the Run button's default from its ⋯.
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
    caption: "Run in each new cloud sandbox after its repository is checked out.",
    empty: "No setup scripts yet.",
  },
  [REPOSITORY_SCRIPT_KIND.ARCHIVE]: {
    title: "Archive scripts",
    caption:
      "Run when an agent is archived, before its sandbox is deleted. Stopped after 90 seconds.",
    empty: "No archive scripts yet.",
  },
} as const satisfies Record<
  RepositoryScriptKind,
  { readonly title: string; readonly caption: string; readonly empty: string }
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

/** What a save wrote: a script, or one repository's run actions. */
type SetupWrite = { readonly runActionsOf?: undefined } | { readonly runActionsOf: string };

/**
 * Every repository's run actions as the page holds them with an answer laid
 * over them: each repository's list taken from whichever of the two was saved
 * later, by its `updatedAt`, and the repository a save of run actions wrote
 * taken from its answer whatever it says, gone where the answer holds none.
 */
function newerRunActions(
  held: RunActionLists,
  answered: RunActionLists,
  saved: string | undefined,
): RepositoryRunActions[] {
  const byName = new Map(held.map((list) => [list.repository.toLowerCase(), list]));
  for (const list of answered) {
    const name = list.repository.toLowerCase();
    const standing = byName.get(name);
    const ours = saved !== undefined && sameRepository(saved, list.repository);
    if (standing === undefined || ours || list.updatedAt >= standing.updatedAt) {
      byName.set(name, list);
    }
  }
  if (saved !== undefined && !answered.some((list) => sameRepository(list.repository, saved))) {
    byName.delete(saved.toLowerCase());
  }
  // Note that the lists stand in the order of their names, as the service answers them.
  return [...byName.entries()]
    .sort(([one], [other]) => (one < other ? -1 : one > other ? 1 : 0))
    .map(([, list]) => list);
}

/**
 * A save's answer drawn over the page, a read still under way canceled first
 * so its older setup cannot land over it. Note that its run actions are laid
 * over the page's rather than replacing them (`newerRunActions`), because an
 * answer from a save sent earlier can land after one sent later, and the next
 * save of run actions writes a repository's whole list as the page holds it,
 * so an older list drawn back would be saved back.
 */
async function drawAnswer(
  queries: QueryClient,
  workspaceId: string,
  answer: WorkspaceSandboxSetupAnswer,
  write: SetupWrite,
): Promise<void> {
  const { queryKey } = setupQuery(workspaceId);
  await queries.cancelQueries({ queryKey, exact: true });
  queries.setQueryData(queryKey, (held) => {
    if (held === undefined) return answer;
    const runActions = newerRunActions(
      held.runActions ?? [],
      answer.runActions ?? [],
      write.runActionsOf,
    );
    // A script's save takes the scripts from its answer; a save of run actions leaves them as the page holds them.
    return write.runActionsOf === undefined ? { ...answer, runActions } : { ...held, runActions };
  });
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
    onSuccess: (answer) => drawAnswer(queries, workspaceId, answer, {}),
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
  /** What ⌘S or ⌘↩ in it does: the row's Save, where it may save now. */
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
  // Note that ⌘S and ⌘↩ answer only what the row's Save would: an edit that may be saved, with no save already out.
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

/** A run action as its row edits it: its label, its command, and its icon. */
interface RunActionDraft {
  readonly label: string;
  readonly command: string;
  readonly icon: TaskSectionIcon | undefined;
}

/** What the run actions' list is called to a reader, which names no repository so a screen recording carries none. */
const RUN_ACTIONS_LIST = "Run actions";

/** Every repository's run actions as the setup answers them. */
type RunActionLists = readonly RepositoryRunActions[];

/** A run action as a save writes it: one already in the list with its id, or a new one with none. */
interface RunActionWritten {
  readonly id: string | undefined;
  readonly label: string;
  readonly command: string;
  readonly icon: TaskSectionIcon | undefined;
  readonly isDefault: boolean;
}

/** An action as saved, written back as it stands. */
function writtenOf(action: RunAction): RunActionWritten {
  return {
    id: action.id,
    label: action.label,
    command: action.command,
    icon: action.icon === undefined ? undefined : knownTaskSectionIcon(action.icon),
    isDefault: action.isDefault === true,
  };
}

/** Whether an action may be saved as typed: a label and a command, each within its bound. */
function runActionSavable(draft: RunActionDraft): boolean {
  const name = draft.label.trim();
  return (
    name !== "" &&
    name.length <= WORKSPACE_SANDBOX_SETUP_BOUNDS.MAX_RUN_ACTION_LABEL_CHARS &&
    draft.command.trim() !== "" &&
    draft.command.length <= WORKSPACE_SANDBOX_SETUP_BOUNDS.MAX_RUN_ACTION_COMMAND_CHARS
  );
}

/**
 * A save of a repository's whole list of run actions, an empty one removing
 * it, its answer drawn over the page at once. Note that the section holds
 * one for every row, and each control stands still while it is out, because
 * a save writes the whole list as its control last read it, so a second
 * press under the first would write over the first's change.
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
        // An action new to the list names no id, and the service names it; an icon and the default are named only where they stand.
        actions: actions.map(({ id, label, command, icon, isDefault }) => ({
          ...(id === undefined ? undefined : { id }),
          label,
          command,
          ...(icon === undefined ? undefined : { icon }),
          ...(isDefault ? { isDefault: true } : undefined),
        })),
      }),
    onSuccess: (answer, { repository }) =>
      drawAnswer(queries, workspaceId, answer, { runActionsOf: repository }),
  });
}

/** The section's one save of a repository's run actions. */
type RunActionSave = ReturnType<typeof useSaveRunActions>;

/**
 * A repository's run actions in the order the service keeps, a drag drawn
 * at once and saved as the whole list; the list rests on the order sent
 * until the save answers, and its refusal is said under the repository's
 * row as any save's is.
 */
function useRunActionOrder(
  saving: RunActionSave,
  repository: string,
  actions: readonly RunAction[],
): { ordered: readonly RunAction[]; move: (from: number, to: number) => void } {
  const [sentOrder, setSentOrder] = useState<readonly string[] | undefined>(undefined);
  const byId = new Map(actions.map((action) => [action.id, action]));
  // Note that an action added or removed meanwhile is drawn where the service says, after those sent.
  const ordered =
    sentOrder === undefined
      ? actions
      : [
          ...sentOrder.flatMap((id) => byId.get(id) ?? []),
          ...actions.filter((action) => !sentOrder.includes(action.id)),
        ];
  const move = (from: number, to: number) => {
    const next = [...ordered];
    const [moved] = next.splice(from, 1);
    if (moved === undefined || from === to) return;
    next.splice(to, 0, moved);
    setSentOrder(next.map((action) => action.id));
    void saving
      .mutateAsync({ repository, actions: next.map(writtenOf) })
      .catch(() => undefined)
      .then(() => setSentOrder(undefined));
  };
  return { ordered, move };
}

/** What a closed row says of its command: the line count where it runs over several, then its lines joined by ⏎, which the row cuts at its edge. */
function commandSummary(command: string): string {
  const lines = command.split("\n");
  const said = lines.map((line) => line.trim()).filter((line) => line !== "");
  const joined = said.join("  ⏎  ");
  return lines.length > 1 ? `${lines.length} lines · ${joined}` : joined;
}

/**
 * One run action's row, as compact as a subscription's: its icon in the
 * row's mark column, its label, renamed in place, a Default badge on the
 * repository's default, and its command under the label as one muted line.
 * An owner or admin picks an icon from the well, saved as soon as it is
 * picked, as a section's is; renames it from its ⋯, saved as the rename
 * ends, as a subscription's name is; and opens Edit command from its ⋯,
 * which draws the command's numbered editor under the row with Cancel and
 * Save, ⌘S or ⌘↩ in it pressing Save and Escape Cancel. The ⋯ also moves it
 * up or down, which a keyboard reaches where the grip's drag does not,
 * makes it the default or lets the default go, and removes it, a removal
 * asking first. An action just added stands with its label being typed and
 * its editor open, Cancel letting it go, until it is saved, when the saved
 * list draws it in its place. A member reads each, its command under it.
 */
function RunActionRow({
  saving,
  repository,
  actions,
  action,
  manages,
  added,
  onMove,
}: {
  /** The section's one save, which every row shares (`useSaveRunActions`). */
  saving: RunActionSave;
  repository: string;
  /** The repository's whole list as saved, which every change saves anew. */
  actions: readonly RunAction[];
  /** The action as saved; none for one just added. */
  action: RunAction | undefined;
  manages: boolean;
  /** An action just added and not yet saved: what Cancel does to let it go. */
  added?: { readonly onCancel: () => void } | undefined;
  /** Moves a saved action one place up (-1) or down (1), as the grip's drag would; none for one just added. */
  onMove?: ((by: -1 | 1) => void) | undefined;
}): React.JSX.Element {
  const busy = saving.isPending;
  const savedLabel = action?.label ?? "";
  const savedCommand = action?.command ?? "";
  const savedIcon = action?.icon === undefined ? undefined : knownTaskSectionIcon(action.icon);
  const [renaming, setRenaming] = useState(added !== undefined);
  const [picking, setPicking] = useState(false);
  // A new action's label and icon, held until its first save; a saved one's are saved as they change.
  const [newLabel, setNewLabel] = useState("");
  const [newIcon, setNewIcon] = useState<TaskSectionIcon | undefined>(undefined);
  // The command being edited, while Edit command stands open; a new action's stands open from the start.
  const [command, setCommand] = useState<string | undefined>(added === undefined ? undefined : "");
  const label = action === undefined ? newLabel : savedLabel;
  const icon = action === undefined ? newIcon : savedIcon;
  const editing = command !== undefined;
  // The command a save sent, which closes the editor once what is saved agrees with it.
  const [sent, setSent] = useState<string | undefined>(undefined);
  // Note that the editor closes once the read draws the save, not when the save answers, so the old command never shows for a frame between (`ScriptRow`).
  if (sent !== undefined && sent === savedCommand && command === sent && !busy) {
    setSent(undefined);
    setCommand(undefined);
  }
  const standing = () => actions.map(writtenOf);
  const saveChange = (change: Partial<RunActionWritten>) => {
    if (action === undefined) return;
    saving.mutate({
      repository,
      actions: standing().map((each) => (each.id === action.id ? { ...each, ...change } : each)),
    });
  };
  const draft = { label, command: command ?? savedCommand, icon };
  const canSave =
    editing && runActionSavable(draft) && (action === undefined || command !== savedCommand);
  const save = () => {
    const typed = { label: label.trim(), command: command ?? savedCommand, icon };
    const next =
      action === undefined
        ? [...standing(), { id: undefined, isDefault: false, ...typed }]
        : standing().map((each) => (each.id === action.id ? { ...each, ...typed } : each));
    if (action !== undefined) setSent(typed.command);
    saving.mutate(
      { repository, actions: next },
      { onSuccess: () => added?.onCancel(), onError: () => setSent(undefined) },
    );
  };
  const cancel = () => {
    saving.reset();
    setSent(undefined);
    if (added !== undefined) added.onCancel();
    else setCommand(undefined);
  };
  // Note that ⌘S and ⌘↩ answer only what the row's Save would: an edit that may be saved, with no save already out.
  const saveKey = canSave && !busy ? save : undefined;
  const removeAct = useConfirmAct(saving, {
    send: () =>
      saving.mutateAsync({
        repository,
        actions: actions.filter((each) => each.id !== action?.id).map(writtenOf),
      }),
    answered: () => ACCEPTED,
    failed: rejected,
  });
  const removal = useConfirmDialog(
    { subject: true, surfaceOpen: true },
    removeAct,
    confirmFailure(FAILURE_SURFACE.WORKSPACE_SANDBOX_SETUP_SAVE),
  );
  const isDefault = action?.isDefault === true;
  const setDefault = (on: boolean) =>
    saving.mutate({
      repository,
      actions: actions.map((each) => ({
        ...writtenOf(each),
        isDefault: on && each.id === action?.id,
      })),
    });
  const place = action === undefined ? -1 : actions.findIndex((each) => each.id === action.id);
  const menu = !manages
    ? []
    : action === undefined
      ? [
          [
            {
              label: "Rename",
              icon: <GLYPH.RENAME />,
              disabled: busy,
              onSelect: () => setRenaming(true),
            },
          ],
        ]
      : [
          [
            {
              label: "Edit command",
              icon: <SquareTerminalIcon />,
              disabled: busy || editing,
              onSelect: () => setCommand(savedCommand),
            },
            {
              label: "Rename",
              icon: <GLYPH.RENAME />,
              disabled: busy,
              onSelect: () => setRenaming(true),
            },
          ],
          [
            {
              label: "Move up",
              icon: <ArrowUpIcon />,
              disabled: busy || place <= 0,
              onSelect: () => onMove?.(-1),
            },
            {
              label: "Move down",
              icon: <ArrowDownIcon />,
              disabled: busy || place === actions.length - 1,
              onSelect: () => onMove?.(1),
            },
            isDefault
              ? {
                  label: "Remove default",
                  icon: <StarOffIcon />,
                  disabled: busy,
                  onSelect: () => setDefault(false),
                }
              : {
                  label: "Make default",
                  icon: <StarIcon />,
                  disabled: busy,
                  onSelect: () => setDefault(true),
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
        ];
  const endRename = (value: string | undefined) => {
    setRenaming(false);
    const named = value?.trim();
    if (named === undefined || named === "" || named === label) return;
    if (action === undefined) setNewLabel(named);
    else saveChange({ label: named });
  };
  const pickIcon = (next: TaskSectionIcon | undefined) => {
    if (action === undefined) setNewIcon(next);
    else saveChange({ icon: next });
  };
  return (
    <>
      <MenuRow
        thing={label === "" ? "New run action" : label}
        actions={menu}
        row={{
          leading: (
            <SettingsRowMark>
              {manages ? (
                <SectionIconWell
                  icon={icon}
                  title="Run action icon"
                  open={picking}
                  onOpenChange={(open) => setPicking(open)}
                  onIcon={pickIcon}
                  variant={BUTTON_VARIANT.QUIET}
                  size={BUTTON_SIZE.COMPACT}
                  disabled={busy}
                />
              ) : (
                (sectionGlyph(icon) ?? <PlayIcon />)
              )}
            </SettingsRowMark>
          ),
          label: (
            <ReplayMask>
              <InlineEdit
                value={label}
                label="Label"
                editing={renaming}
                look={INLINE_EDIT_LOOK.INPUT}
                placeholder="Dev server"
                maxLength={WORKSPACE_SANDBOX_SETUP_BOUNDS.MAX_RUN_ACTION_LABEL_CHARS}
                onEnd={({ value }) => endRename(value)}
              >
                {label === "" ? (
                  <Text
                    as={TEXT_ELEMENT.SPAN}
                    variant={TEXT_VARIANT.INHERIT}
                    tone={TEXT_TONE.MUTED}
                  >
                    Untitled action
                  </Text>
                ) : (
                  <OneLine>{label}</OneLine>
                )}
              </InlineEdit>
            </ReplayMask>
          ),
          adornment: isDefault ? <Badge>Default</Badge> : undefined,
          description: editing ? undefined : (
            <ReplayMask>
              <OneLine words={commandSummary(savedCommand)}>
                <Text
                  as={TEXT_ELEMENT.SPAN}
                  variant={TEXT_VARIANT.INHERIT}
                  font={TEXT_FONT.MONO}
                  tone={TEXT_TONE.MUTED}
                >
                  {commandSummary(savedCommand)}
                </Text>
              </OneLine>
            </ReplayMask>
          ),
          // Note that Cancel and Save stay beside the label at any width, the label giving way, since dropping under it would move the editor at a phone's width.
          controls: SETTINGS_ROW_CONTROLS.BESIDE,
          control: editing ? (
            <EditActions
              leave="Cancel"
              saving={busy}
              canSave={canSave}
              onLeave={cancel}
              onSave={save}
            />
          ) : undefined,
          below: editing ? (
            <ScriptEditor
              label="Command"
              value={command}
              onChange={setCommand}
              placeholder="pnpm dev"
              editable={manages}
              busy={busy}
              autoFocus={added === undefined}
              changed={action !== undefined && command !== savedCommand}
              onSave={saveKey}
              onLeave={busy ? undefined : cancel}
            />
          ) : undefined,
        }}
      />
      {manages && action !== undefined ? (
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

/** An action an owner or admin added to a repository and has not yet saved, known by a key of its own until it is. */
interface AddedRunAction {
  readonly repository: string;
  readonly key: number;
}

/**
 * Each repository's run actions, behind the Run actions experiment: a row
 * for the repository with its Add action, and its actions under it in their
 * order, each edited in place. An owner or admin adds one from Add action,
 * to a repository already listed or one picked in the repository menu,
 * drags one by its grip to another place or moves it from its ⋯, and makes
 * one the default or removes it there; every change saves the repository's whole list.
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
  const [added, setAdded] = useState<readonly AddedRunAction[]>([]);
  const nextKey = useRef(0);
  const addedTo = (repository: string) =>
    added.filter((each) => sameRepository(each.repository, repository));
  const countOf = (repository: string) =>
    runActionsOf(lists, repository).length + addedTo(repository).length;
  const add = (repository: string) => {
    if (countOf(repository) >= WORKSPACE_SANDBOX_SETUP_BOUNDS.MAX_RUN_ACTIONS) return;
    nextKey.current += 1;
    const key = nextKey.current;
    setAdded((now) => [...now, { repository, key }]);
  };
  const letGo = (key: number) => setAdded((now) => now.filter((each) => each.key !== key));
  // Note that a repository with only an unsaved action stands after the saved ones, so the row being typed in does not jump as the list is read again.
  const repositories = [
    ...lists.map((list) => list.repository),
    ...added
      .map((each) => each.repository)
      .filter(
        (repository, at, all) =>
          !lists.some((list) => sameRepository(list.repository, repository)) &&
          all.findIndex((other) => sameRepository(other, repository)) === at,
      ),
  ];
  // A repository whose list is full is left out of Add action's menu, as its own row's Add action stands still, so no row opens on a save the service would refuse.
  const full = repositories.filter(
    (repository) => countOf(repository) >= WORKSPACE_SANDBOX_SETUP_BOUNDS.MAX_RUN_ACTIONS,
  );
  return (
    <SettingsSection
      title="Run actions"
      caption="Listed in each cloud agent's Run menu, the default on its button. Each runs in a Terminal tab of the agent's sandbox when pressed."
      action={
        manages ? (
          <AddRepositoryButton
            workspaceId={workspaceId}
            label="Add action"
            taken={full}
            onPick={add}
          />
        ) : undefined
      }
    >
      {read ?? (
        <>
          {repositories.length === 0 ? <SettingsLine>No run actions yet.</SettingsLine> : null}
          {repositories.map((repository) => (
            <RunActionsOfRepository
              key={repository.toLowerCase()}
              saving={saving}
              repository={repository}
              actions={runActionsOf(lists, repository)}
              added={manages ? addedTo(repository) : []}
              manages={manages}
              pictures={pictures}
              full={countOf(repository) >= WORKSPACE_SANDBOX_SETUP_BOUNDS.MAX_RUN_ACTIONS}
              onAdd={() => add(repository)}
              onLetGo={letGo}
            />
          ))}
        </>
      )}
    </SettingsSection>
  );
}

/** A repository's run actions as the answer holds them; none where it holds no list. */
function runActionsOf(lists: RunActionLists, repository: string): readonly RunAction[] {
  return lists.find((each) => sameRepository(each.repository, repository))?.actions ?? [];
}

/** One repository's row, its saved run actions under it, dragged by their grips, and those added to it not yet saved after them. */
function RunActionsOfRepository({
  saving,
  repository,
  actions,
  added,
  manages,
  pictures,
  full,
  onAdd,
  onLetGo,
}: {
  saving: RunActionSave;
  repository: string;
  actions: readonly RunAction[];
  added: readonly AddedRunAction[];
  manages: boolean;
  pictures: boolean;
  /** Whether its list holds as many actions as it may, saved and added together. */
  full: boolean;
  onAdd: () => void;
  onLetGo: (key: number) => void;
}): React.JSX.Element {
  const order = useRunActionOrder(saving, repository, actions);
  // Note that the move itself is let go while a save is out, so a drag already under way drops nothing over the save, since each move saves the whole list as it reads it now.
  const drag = useRowDrag(manages && !saving.isPending ? order.move : undefined, {
    handle: SETTINGS_ORDER_HANDLE,
  });
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
                  disabled: full,
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
      {order.ordered.length === 0 ? null : (
        <SettingsOrderedRows
          label={RUN_ACTIONS_LIST}
          onPointerDown={drag}
          gutter={manages}
          rows={order.ordered.map((action, index) => ({
            key: action.id,
            row: (
              <RunActionRow
                saving={saving}
                repository={repository}
                actions={order.ordered}
                action={action}
                manages={manages}
                onMove={(by) => order.move(index, index + by)}
              />
            ),
          }))}
        />
      )}
      {added.length === 0 ? null : (
        <SettingsOrderedRows
          label={RUN_ACTIONS_LIST}
          gutter
          rows={added.map((each) => ({
            key: String(each.key),
            row: (
              <RunActionRow
                saving={saving}
                repository={repository}
                actions={order.ordered}
                action={undefined}
                manages={manages}
                added={{ onCancel: () => onLetGo(each.key) }}
              />
            ),
          }))}
        />
      )}
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
