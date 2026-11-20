import {
  SECRET_VARIABLE_WORDS,
  setByVespinNote,
  VARIABLE_WORDS,
  variableChanger,
  variableChangeWord,
  variableCreatedAt,
  variableDeleteTitle,
} from "@repo/features/cloud-environment-words";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { readingWords } from "@repo/features/words";
import {
  WORKSPACE_ENVIRONMENT_BOUNDS,
  type WorkspaceEnvironmentAnswer,
  type WorkspaceVariable,
  workspaceVariableNameSchema,
} from "@repo/features/workspace-environment-wire";
import { managesWorkspace } from "@repo/features/workspace-role";
import type { Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import {
  ANNOUNCE,
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  CHOICE_BAR_LOOK,
  ChoiceBar,
  CONFIRM_LOSS,
  COPY_CHIP_LOOK,
  COPY_LOOK,
  ConfirmDialog,
  CopyButton,
  CopyIcon,
  DIALOG_SIZE,
  DIALOG_TONE,
  Dialog,
  DialogActions,
  ErrorLine,
  FormField,
  GAP,
  IconButton,
  Inline,
  type NameValueRow,
  NameValueRows,
  PencilIcon,
  PlusIcon,
  SETTINGS_ROW_STATE,
  SETTINGS_SECTION_FRAME,
  SETTINGS_SKELETON_CONTROL,
  SearchField,
  SearchLine,
  SecretField,
  SettingsAttentionMark,
  SettingsLine,
  type SettingsRowSkeletonLayout,
  SettingsRowStateLine,
  SettingsRowsSkeleton,
  SettingsRowValue,
  SettingsSection,
  STATUS_TONE,
  Stack,
  TEXT_FIELD_FONT,
  TEXT_FONT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextArea,
  TextField,
  TIME_LOOK,
  Time,
  Tooltip,
  TrashIcon,
  useConfirmDialog,
  useFilePicker,
  useMenu,
} from "@repo/ui";
import { ACTOR_KIND, type Actor, personActor } from "@repo/ui/actor-model";
import {
  ArrowDownAZIcon,
  CalendarPlusIcon,
  ClockIcon,
  CloudUploadIcon,
  GLYPH,
  SlidersHorizontalIcon,
} from "@repo/ui/icons";
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
import { useRef, useState } from "react";
import { actFailureWords, askAct, sendAct } from "../act.js";
import { ActorLine, ActorRef } from "../actor-ref.js";
import { useConfirmAct } from "../confirm-act.js";
import { copyThroughShell } from "../copy-feedback.js";
import { ActionMenu, type MenuAction } from "../desktop/action-menu.js";
import { useFormDialog } from "../desktop/use-form-dialog.js";
import { confirmFailure } from "../failure-report.js";
import { MemberDirectory, useMemberDirectory } from "../member-directory.js";
import { QUERY_ROOT } from "../query-keys.js";
import { showToast } from "../toast.js";
import { parseDotenv } from "./dotenv.js";
import { ReadFailed, replayMaskedError } from "./marks.js";
import { MenuRow } from "./menu-row.js";
import {
  type FiledUnder,
  FORMER_PEOPLE_KEY,
  filterPeople,
  PeopleFilter,
  PeopleFilterChips,
} from "./people-filter.js";
import { SECTION, settingsSectionHead } from "./settings-sections.js";

/**
 * environment-variables-section.tsx -- Settings › Cloud environment's Variables: the variables the workspace hands its members' cloud agents, added, edited, and deleted by its owners and admins.
 *
 * Each variable is a row: its name, a chip that copies it, and under it
 * when and by whom it was added or last changed. A secret shows nothing
 * more, since its value is never handed back to anyone. A config, a value
 * every member may read, such as `NODE_ENV`, stands masked at the row's end
 * until its eye shows it. A name we set ourselves for our agents wears
 * the attention mark, which says on hover that ours replaces it.
 *
 * Over the rows stand a search, a Filter by who last changed each, and
 * View options ordering them, as Memory's do. An owner or admin adds
 * several at once (Add variables), secrets or configs as the choice heading
 * the dialog says, a `.env` imported or pasted into a Name spread a pair to
 * a line, each line saying what is wrong with its name or that it replaces
 * one saved; edits one's value from its row's ⋯ (Edit), a variable never
 * renamed but deleted and added again;
 * makes a config secret from the same ⋯, which asks first since it is never
 * undone; and deletes one, which asks first too. Each write answers the variables as they then
 * stand, which the section draws at once, the rows it wrote lit once.
 */

/** A variable's row while the variables are read. */
export const VARIABLE_ROW_SKELETON: SettingsRowSkeletonLayout = {
  described: true,
  controls: [],
  end: [SETTINGS_SKELETON_CONTROL.MORE],
};

/** Whether a name is one the service takes, so a line says what is wrong with one it would refuse. */
const isVariableName = Schema.is(workspaceVariableNameSchema);

const ACCEPTED: ActionResult = { status: ACTION_RESULT_STATUS.ACCEPTED };

/** The words the section says. */
const WORDS = {
  CAPTION: VARIABLE_WORDS.CAPTION,
  ADD: "Add variables",
  ADD_ANOTHER: "Add another",
  IMPORT: "Import .env",
  OR_PASTE: "or paste into Name",
  SEARCH: "Search variables",
  UPDATED_BY: "Updated by",
  VIEW_OPTIONS: "View options",
  ORDER_BY: "Order by",
  NONE: VARIABLE_WORDS.NONE,
  NO_MATCH: "No variables match.",
  KIND: "Type",
  MAKE_SECRET: "Make secret",
  /** What a save or an edit says once it lands: when the agents already running take it. */
  SAVED: "Saved. Agents pick it up from their next message.",
  NAME_SPELLING: VARIABLE_WORDS.NAME_SPELLING,
  SEALS_CONFIG: "Choose Config to replace its value, or make it secret from its row.",
  MASKED: "••••••••",
} as const;

/** The one toast saves stand under, so saves one after another take its place rather than stack. */
const SAVED_TOAST = "workspace-variables-saved";

/** What a variable is: a secret, whose value no one reads once it is saved, or a config, whose value every member reads. */
const KIND = { SECRET: "secret", CONFIG: "config" } as const;

type Kind = (typeof KIND)[keyof typeof KIND];

/** Each kind's name in Add's choice, and the one line under it saying what the kind chosen does. */
const KIND_SHOWN = {
  [KIND.SECRET]: {
    label: SECRET_VARIABLE_WORDS.LABEL,
    detail: SECRET_VARIABLE_WORDS.DETAIL,
  },
  [KIND.CONFIG]: {
    label: "Config",
    detail: "Its value stays visible to everyone in the workspace.",
  },
} as const satisfies Record<Kind, { label: string; detail: string }>;

/** How the rows are ordered. */
const ORDER = { NAME: "name", UPDATED: "updated", CREATED: "created" } as const;

type Order = (typeof ORDER)[keyof typeof ORDER];

/** Each order's name and glyph in View options. */
const ORDER_SHOWN = {
  [ORDER.NAME]: { label: "Name", icon: <ArrowDownAZIcon /> },
  [ORDER.UPDATED]: { label: "Last updated", icon: <ClockIcon /> },
  [ORDER.CREATED]: { label: "Created", icon: <CalendarPlusIcon /> },
} as const satisfies Record<Order, { label: string; icon: React.JSX.Element }>;

/** The key the filter files a variable no member is named for under: one from before who set it was kept. */
const NOBODY_KEY = "nobody";

function rejected(cause: unknown): ActionResult {
  return { status: ACTION_RESULT_STATUS.REJECTED, reason: actFailureWords(cause) };
}

/** The workspace's variables, read as the page opens and on Try again. */
function environmentQuery(workspaceId: string) {
  return queryOptions({
    queryKey: [QUERY_ROOT.WORKSPACE_ENVIRONMENT, workspaceId],
    queryFn: () => askAct(ACT_KIND.WORKSPACE_ENVIRONMENT_LIST, { workspaceId }),
    retry: false,
  });
}

/** A write's answer drawn over the list, a read still under way canceled first so its older variables cannot land over it. */
async function drawAnswer(
  queries: QueryClient,
  workspaceId: string,
  answer: WorkspaceEnvironmentAnswer,
): Promise<void> {
  const { queryKey } = environmentQuery(workspaceId);
  await queries.cancelQueries({ queryKey, exact: true });
  queries.setQueryData(queryKey, answer);
}

/** A name's problem among the other names it is saved beside, in the words its line says. */
function nameProblem(name: string, others: readonly string[]): string | undefined {
  if (name === "") return undefined;

  if (!isVariableName(name)) return WORDS.NAME_SPELLING;

  if (others.includes(name)) return `${name} is named twice.`;

  return undefined;
}

/** What saving a line over a variable already saved does to it, where one is. */
function replacesNote(
  name: string,
  saved: WorkspaceVariable | undefined,
  secret: boolean,
): string | undefined {
  if (saved === undefined) return undefined;

  // Note that a secret stays one whatever a save says, so a line saved as a config says so.
  return !secret && saved.secret !== false
    ? `Replaces the saved ${name}, which stays a secret.`
    : `Replaces the saved ${name}.`;
}

/** The variables in the order View options names. */
function ordered(variables: readonly WorkspaceVariable[], order: Order): WorkspaceVariable[] {
  return [...variables].sort((one, other) => {
    if (order === ORDER.UPDATED) return other.updatedAt - one.updatedAt;

    if (order === ORDER.CREATED) return variableCreatedAt(other) - variableCreatedAt(one);

    return one.name.localeCompare(other.name);
  });
}

/** The variables a write left, by the names it wrote, which their rows light once for. */
function useLanded() {
  const [landed, setLanded] = useState<ReadonlySet<string>>(new Set());

  return { landed, land: (names: readonly string[]) => setLanded(new Set(names)) };
}

/** Under a variable's name: Added or Updated, when, and by whom where the service names them. */
function ChangeLine({
  variable,
  actor,
}: {
  variable: WorkspaceVariable;
  actor: Actor | undefined;
}): React.JSX.Element {
  return (
    <SettingsRowStateLine state={SETTINGS_ROW_STATE.PLAIN} block wrap>
      <ActorLine>
        {`${variableChangeWord(variable)} `}
        <Time at={variable.updatedAt} look={TIME_LOOK.AGO} />
        {actor === undefined ? null : (
          <>
            {` ${VARIABLE_WORDS.BY} `}
            <ActorRef actor={actor} />
          </>
        )}
      </ActorLine>
    </SettingsRowStateLine>
  );
}

/** A config's value at its row's end: masked until its eye shows it, then in the code face. */
function ConfigValue({ name, value }: { name: string; value: string }): React.JSX.Element {
  const [shown, setShown] = useState(false);

  return (
    <SettingsRowValue>
      <Inline gap={GAP.ICON} wrap={false}>
        <ReplayMask>
          <Text as="span" font={TEXT_FONT.MONO} tone={shown ? TEXT_TONE.DEFAULT : TEXT_TONE.MUTED}>
            {shown ? value : WORDS.MASKED}
          </Text>
        </ReplayMask>
        <IconButton
          size={BUTTON_SIZE.COMPACT}
          icon={shown ? <GLYPH.HIDE /> : <GLYPH.SHOW />}
          label={`${shown ? "Hide" : "Show"} ${name}`}
          pressed={shown}
          onClick={() => setShown(!shown)}
        />
      </Inline>
    </SettingsRowValue>
  );
}

/** One variable's row: its name as a chip that copies it, its line, a config's value, and for an owner or admin a ⋯ with Edit, the copies, and Delete. */
function VariableRow({
  workspaceId,
  variable,
  actor,
  manages,
  landed,
  onWritten,
}: {
  workspaceId: string;
  variable: WorkspaceVariable;
  actor: Actor | undefined;
  manages: boolean;
  landed: boolean;
  onWritten: (names: readonly string[]) => void;
}): React.JSX.Element {
  const queries = useQueryClient();
  const { name, value } = variable;
  const edit = useEditDialog(workspaceId, variable, onWritten);

  const deleting = useMutation({
    mutationFn: () => sendAct(ACT_KIND.WORKSPACE_ENVIRONMENT_DELETE, { workspaceId, name }),
    onSuccess: (answer) => drawAnswer(queries, workspaceId, answer),
  });

  const deleteAct = useConfirmAct(deleting, {
    send: () => deleting.mutateAsync(),
    answered: () => ACCEPTED,
    failed: rejected,
  });

  const deletion = useConfirmDialog(
    { subject: true, surfaceOpen: true },
    deleteAct,
    confirmFailure(FAILURE_SURFACE.WORKSPACE_VARIABLE_DELETE),
  );

  // Note that a config is made secret by saving its value again as a secret, which the window already holds.
  const sealing = useMutation({
    mutationFn: () =>
      sendAct(ACT_KIND.WORKSPACE_ENVIRONMENT_SAVE, {
        workspaceId,
        secret: true,
        variables: [{ name, value: value ?? "" }],
      }),
    onSuccess: async (answer) => {
      await drawAnswer(queries, workspaceId, answer);
      onWritten([name]);
    },
  });

  const sealAct = useConfirmAct(sealing, {
    send: () => sealing.mutateAsync(),
    answered: () => ACCEPTED,
    failed: rejected,
  });

  const seal = useConfirmDialog(
    { subject: true, surfaceOpen: true },
    sealAct,
    confirmFailure(FAILURE_SURFACE.WORKSPACE_VARIABLE_SAVE),
  );

  const copyName: MenuAction = {
    label: "Copy name",
    icon: <CopyIcon />,
    onSelect: () => void copyThroughShell(name),
  };

  // Note that only a config's value is ever handed to the window, so only a config's row copies one.
  const copies: readonly MenuAction[] =
    value === undefined
      ? [copyName]
      : [
          copyName,
          { label: "Copy value", icon: <CopyIcon />, onSelect: () => void copyThroughShell(value) },
        ];

  const editing: MenuAction = { label: "Edit", icon: <PencilIcon />, onSelect: edit.ask };

  // Note that a config may become a secret and a secret never a config, so only a config's row offers it.
  const changes: readonly MenuAction[] =
    value === undefined
      ? [editing]
      : [editing, { label: WORDS.MAKE_SECRET, icon: <GLYPH.SECRET />, onSelect: seal.ask }];

  const actions: readonly (readonly MenuAction[])[] = manages
    ? [
        [...changes, ...copies],
        [{ label: "Delete", icon: <TrashIcon />, danger: true, onSelect: deletion.ask }],
      ]
    : [copies];

  const note = setByVespinNote(name);

  return (
    <>
      <MenuRow
        thing={name}
        actions={actions}
        row={{
          label: (
            <ReplayMask>
              <CopyButton
                look={COPY_LOOK.CHIP}
                face={COPY_CHIP_LOOK.TOOLBAR}
                flush
                lead={GLYPH.VARIABLE}
                text={name}
                what={`name ${name}`}
                copy={copyThroughShell}
              />
            </ReplayMask>
          ),
          adornment: note === undefined ? undefined : <SettingsAttentionMark note={note} />,
          description: <ChangeLine variable={variable} actor={actor} />,
          control: value === undefined ? undefined : <ConfigValue name={name} value={value} />,
          landed,
        }}
      />
      {manages ? (
        <>
          {edit.dialog}
          <ConfirmDialog
            open
            confirm={seal}
            question={{
              title: `Make ${name} secret?`,
              body: "Its value will be hidden from everyone in the workspace, for good. Agents still get it.",
              verb: WORDS.MAKE_SECRET,
              running: "Saving",
              loss: CONFIRM_LOSS.IRREVERSIBLE,
              replayUnmasked: true,
              titleReplayMasked: true,
            }}
          />
          <ConfirmDialog
            open
            confirm={deletion}
            question={{
              title: variableDeleteTitle(name),
              verb: VARIABLE_WORDS.DELETE,
              running: "Deleting",
              loss: CONFIRM_LOSS.IRREVERSIBLE,
              replayUnmasked: true,
              titleReplayMasked: true,
            }}
          />
        </>
      ) : null}
    </>
  );
}

/**
 * A variable's Edit: its value, a secret's typed afresh, since the saved one
 * is never shown, a config's shown to change in place, saved as what it is.
 * A variable is never renamed, as a value sealed under its name cannot
 * move: it is deleted and added again. A config is made secret from its
 * row's ⋯.
 */
function useEditDialog(
  workspaceId: string,
  variable: WorkspaceVariable,
  onWritten: (names: readonly string[]) => void,
) {
  const queries = useQueryClient();
  const wasSecret = variable.secret !== false;
  const [value, setValue] = useState(variable.value ?? "");
  // Note that a secret's field opens empty, so only a value typed into it changes it, while a config may be cleared to an empty value.
  const valueChanged = wasSecret ? value !== "" : value !== (variable.value ?? "");
  const multiline = (variable.value ?? "").includes("\n");
  // The value's field, one line's or several's, where focus lands as the card opens.
  const line = useRef<HTMLInputElement | null>(null);
  const lines = useRef<HTMLTextAreaElement | null>(null);

  const editing = useMutation({
    mutationFn: () =>
      sendAct(ACT_KIND.WORKSPACE_ENVIRONMENT_SAVE, {
        workspaceId,
        secret: wasSecret,
        variables: [{ name: variable.name, value }],
      }),
    onSuccess: async (answer) => {
      await drawAnswer(queries, workspaceId, answer);
      onWritten([variable.name]);
      showToast({
        words: WORDS.SAVED,
        tone: STATUS_TONE.COMPLETE,
        subject: SAVED_TOAST,
        replayUnmasked: true,
      });
    },
  });

  const act = useConfirmAct(editing, {
    send: () => editing.mutateAsync(),
    answered: () => ACCEPTED,
    failed: rejected,
  });

  const confirm = useConfirmDialog(
    { subject: true, surfaceOpen: true },
    act,
    confirmFailure(FAILURE_SURFACE.WORKSPACE_VARIABLE_SAVE),
  );

  const form = useFormDialog(
    confirm,
    valueChanged && value.length <= WORKSPACE_ENVIRONMENT_BOUNDS.MAX_VALUE_CHARS,
  );

  const reset = () => setValue(variable.value ?? "");

  const dialog = (
    <Dialog
      open={form.open}
      size={DIALOG_SIZE.CONFIRM}
      title={`Edit ${variable.name}`}
      replayUnmasked
      titleReplayMasked
      initialFocus={multiline ? lines : line}
      busy={form.settling}
      refused={form.refusal !== undefined}
      onDismiss={form.dismiss}
      onExited={reset}
      actions={
        <DialogActions
          onCancel={form.dismiss}
          act={{ verb: "Save", tone: DIALOG_TONE.PRIMARY, running: "Saving", ...form.act }}
        />
      }
    >
      <Stack>
        {wasSecret ? (
          <SecretField
            ref={line}
            label="Value"
            saved
            error={replayMaskedError(form.refusal)}
            disabled={form.settling}
            value={value}
            onChange={setValue}
            onEnter={form.submit}
          />
        ) : (
          <FormField label="Value" error={replayMaskedError(form.refusal)}>
            {(control) => (
              <ReplayMask>
                {/* Note that a value of several lines, as a `.env` may set, is edited where its line breaks stand, since one line's field would drop them. */}
                {multiline ? (
                  <TextArea
                    ref={lines}
                    field={control}
                    font={TEXT_FIELD_FONT.MONO}
                    rows={3}
                    grow
                    spellCheck={false}
                    disabled={form.settling}
                    value={value}
                    onChange={setValue}
                  />
                ) : (
                  <TextField
                    ref={line}
                    field={control}
                    font={TEXT_FIELD_FONT.MONO}
                    autoCorrect={false}
                    spellCheck={false}
                    disabled={form.settling}
                    value={value}
                    onChange={setValue}
                    onEnter={form.submit}
                  />
                )}
              </ReplayMask>
            )}
          </FormField>
        )}
      </Stack>
    </Dialog>
  );

  // Note that the draft is taken from the variable as it stands each time Edit opens, since a save from Add variables may have changed it while this row stood.
  const ask = () => {
    reset();
    confirm.ask();
  };

  return { ask, dialog };
}

/** One line of Add variables while it is typed. */
interface Draft {
  readonly key: string;
  readonly name: string;
  readonly value: string;
}

/** A fresh line's key, unique among the lines a dialog holds. */
let draftCount = 0;
const blankDraft = (): Draft => ({ key: `draft-${draftCount++}`, name: "", value: "" });

/**
 * Add variables: one or more lines of a name and a value, saved together
 * as secrets or as configs, a `.env` imported or pasted into a Name spread
 * a pair to a line. Each line says what is wrong with its name, that it
 * replaces one saved, or that we set it ourselves.
 */
function useAddDialog(
  workspaceId: string,
  existing: readonly WorkspaceVariable[],
  onWritten: (names: readonly string[]) => void,
) {
  const queries = useQueryClient();
  const [drafts, setDrafts] = useState<readonly Draft[]>(() => [blankDraft()]);
  const [kind, setKind] = useState<Kind>(KIND.SECRET);
  // The first line's name, where focus lands as the card opens.
  const firstName = useRef<HTMLInputElement | null>(null);
  const secret = kind === KIND.SECRET;
  const typedNames = drafts.map((draft) => draft.name.trim());
  // Note that a named line is saved whatever its value, an empty one among them, as a `.env`'s `OPTIONAL=` sets it.
  const filled = drafts.filter((draft) => draft.name.trim() !== "");

  const rows: readonly NameValueRow[] = drafts.map((draft, at) => {
    const name = draft.name.trim();

    const problem = nameProblem(
      name,
      typedNames.filter((_, other) => other !== at),
    );

    const saved = problem === undefined ? existing.find((each) => each.name === name) : undefined;
    const savedConfig = saved !== undefined && saved.secret === false;

    // Note that a save as secrets would turn a saved config secret for good, which only Make secret does, behind its question.
    const sealsConfig =
      secret && savedConfig ? `${name} is a config. ${WORDS.SEALS_CONFIG}` : undefined;

    return {
      key: draft.key,
      name: draft.name,
      value: draft.value,
      problem: problem ?? sealsConfig,
      note: setByVespinNote(name) ?? replacesNote(name, saved, secret),
    };
  });

  const ready =
    filled.length > 0 &&
    filled.length <= WORKSPACE_ENVIRONMENT_BOUNDS.MAX_SAVED &&
    rows.every((row) => row.problem === undefined) &&
    drafts.every((draft) => draft.name.trim() !== "" || draft.value === "") &&
    filled.every((draft) => draft.value.length <= WORKSPACE_ENVIRONMENT_BOUNDS.MAX_VALUE_CHARS);

  const saving = useMutation({
    mutationFn: () =>
      sendAct(ACT_KIND.WORKSPACE_ENVIRONMENT_SAVE, {
        workspaceId,
        secret,
        variables: filled.map((draft) => ({ name: draft.name.trim(), value: draft.value })),
      }),
    onSuccess: async (answer) => {
      await drawAnswer(queries, workspaceId, answer);
      onWritten(filled.map((draft) => draft.name.trim()));
      showToast({
        words: WORDS.SAVED,
        tone: STATUS_TONE.COMPLETE,
        subject: SAVED_TOAST,
        replayUnmasked: true,
      });
    },
  });

  const act = useConfirmAct(saving, {
    send: () => saving.mutateAsync(),
    answered: () => ACCEPTED,
    failed: rejected,
  });

  const confirm = useConfirmDialog(
    { subject: true, surfaceOpen: true },
    act,
    confirmFailure(FAILURE_SURFACE.WORKSPACE_VARIABLE_SAVE),
  );

  const form = useFormDialog(confirm, ready);

  /** A `.env`'s pairs in place of the line it came into, or after the lines typed, the empty ones dropped; nothing where it sets none. */
  const spread = (key: string | undefined, text: string): boolean => {
    const pairs = parseDotenv(text);

    if (pairs.length === 0 || (pairs.length === 1 && !text.includes("="))) return false;
    setDrafts((now) => [
      ...now.filter((draft) => draft.key !== key && (draft.name !== "" || draft.value !== "")),
      ...pairs.map((pair) => ({ ...blankDraft(), ...pair })),
    ]);

    return true;
  };

  const picker = useFilePicker({
    onFiles: (files) => void files[0]?.text().then((text) => spread(undefined, text)),
  });

  const patch = (key: string, change: Partial<Draft>) =>
    setDrafts((now) => now.map((draft) => (draft.key === key ? { ...draft, ...change } : draft)));

  const reset = () => {
    setDrafts([blankDraft()]);
    setKind(KIND.SECRET);
  };

  const count = filled.length;

  const dialog = (
    <Dialog
      open={form.open}
      size={DIALOG_SIZE.WIDE}
      title={WORDS.ADD}
      replayUnmasked
      initialFocus={firstName}
      busy={form.settling}
      refused={form.refusal !== undefined}
      onDismiss={form.dismiss}
      onExited={reset}
      actionsStart={
        <Inline gap={GAP.CONTROL} wrap={false}>
          <Button
            variant={BUTTON_VARIANT.OUTLINE}
            icon={<CloudUploadIcon />}
            disabled={form.settling}
            onClick={picker.open}
          >
            {WORDS.IMPORT}
          </Button>
          <Text as="span" tone={TEXT_TONE.MUTED}>
            {WORDS.OR_PASTE}
          </Text>
          {picker.input}
        </Inline>
      }
      actions={
        <DialogActions
          onCancel={form.dismiss}
          act={{
            verb: count > 1 ? `Save ${count} variables` : "Save",
            tone: DIALOG_TONE.PRIMARY,
            running: "Saving",
            ...form.act,
          }}
        />
      }
    >
      <Stack>
        {/* Note that the kind is chosen first, since it says whether the values typed under it are masked. */}
        <Stack gap={GAP.TIGHT}>
          <div>
            <ChoiceBar<Kind>
              label={WORDS.KIND}
              look={CHOICE_BAR_LOOK.SEGMENTED}
              value={kind}
              disabled={form.settling}
              onChange={setKind}
              items={Object.values(KIND).map((each) => ({
                value: each,
                label: KIND_SHOWN[each].label,
              }))}
            />
          </div>
          <Text as="span" variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            {KIND_SHOWN[kind].detail}
          </Text>
        </Stack>
        <ReplayMask>
          <NameValueRows
            rows={rows}
            secret={secret}
            namePlaceholder="NAME"
            disabled={form.settling}
            firstName={firstName}
            onName={(key, name) => patch(key, { name })}
            onValue={(key, value) => patch(key, { value })}
            onRemove={(key) => setDrafts((now) => now.filter((draft) => draft.key !== key))}
            onPasteLines={spread}
          />
        </ReplayMask>
        <div>
          <Button
            variant={BUTTON_VARIANT.OUTLINE}
            icon={<PlusIcon />}
            disabled={form.settling}
            onClick={() => setDrafts((now) => [...now, blankDraft()])}
          >
            {WORDS.ADD_ANOTHER}
          </Button>
        </div>
        <ErrorLine level={ANNOUNCE.ALERT} error={replayMaskedError(form.refusal)} />
      </Stack>
    </Dialog>
  );

  return { ask: confirm.ask, dialog };
}

/** View options: Order by, the order shown checked. */
function ViewOptions({
  order,
  onOrder,
}: {
  order: Order;
  onOrder: (order: Order) => void;
}): React.JSX.Element {
  const menu = useMenu(true);

  const rows: MenuAction[] = Object.values(ORDER).map((each) => ({
    label: ORDER_SHOWN[each].label,
    icon: ORDER_SHOWN[each].icon,
    checked: each === order,
    onSelect: () => onOrder(each),
  }));

  return (
    <>
      <Tooltip label={WORDS.VIEW_OPTIONS}>
        <IconButton
          icon={<SlidersHorizontalIcon />}
          label={WORDS.VIEW_OPTIONS}
          {...menu.trigger()}
        />
      </Tooltip>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={WORDS.VIEW_OPTIONS}
          menu={menu.drawn}
          heading={WORDS.ORDER_BY}
          groups={[rows]}
          replayUnmasked
          onClose={menu.close}
        />
      )}
    </>
  );
}

/** A variable as the list draws it: who its line names, and the key the filter files it under. */
interface ShownVariable {
  readonly variable: WorkspaceVariable;
  readonly actor: Actor | undefined;
  readonly key: string;
}

/** The variables searched, filtered, and ordered over their rows, drawn under the members around them. */
function VariableList({
  workspaceId,
  variables,
  manages,
  readerId,
  landed,
  onWritten,
}: {
  workspaceId: string;
  variables: readonly WorkspaceVariable[];
  manages: boolean;
  readerId: string | undefined;
  landed: ReadonlySet<string>;
  onWritten: (names: readonly string[]) => void;
}): React.JSX.Element {
  const { members, former } = useMemberDirectory();
  const [query, setQuery] = useState("");
  const [kept, setKept] = useState<ReadonlySet<string>>(new Set());
  const [order, setOrder] = useState<Order>(ORDER.NAME);

  const shown = variables.map((variable): ShownVariable => {
    const changer = variableChanger(variable);

    if (changer === undefined) return { variable, actor: undefined, key: NOBODY_KEY };
    const actor = personActor(changer, members, readerId, former);

    // Note that everyone who left is filed under one key, which the filter names as former members together.
    const key = actor.kind === ACTOR_KIND.PERSON ? changer.userId : FORMER_PEOPLE_KEY;

    return { variable, actor, key };
  });

  const filed: FiledUnder[] = shown.flatMap(({ actor, key }) =>
    actor === undefined ? [] : [{ key, actor }],
  );

  const people = filterPeople(filed);
  const asked = query.trim().toLowerCase();

  const listed = shown.filter(
    (each) =>
      each.variable.name.toLowerCase().includes(asked) && (kept.size === 0 || kept.has(each.key)),
  );

  const byName = new Map(listed.map((each) => [each.variable.name, each]));

  return (
    <Stack gap={GAP.CONTROL}>
      <SearchLine>
        <SearchField
          label={WORDS.SEARCH}
          placeholder={WORDS.SEARCH}
          value={query}
          onChange={setQuery}
          onClear={() => setQuery("")}
          onEscape={() => setQuery("")}
        />
        <PeopleFilter field={WORDS.UPDATED_BY} people={people} kept={kept} onKept={setKept} />
        <ViewOptions order={order} onOrder={setOrder} />
      </SearchLine>
      <PeopleFilterChips field={WORDS.UPDATED_BY} people={people} kept={kept} onKept={setKept} />
      <SettingsSection>
        {listed.length === 0 ? (
          <SettingsLine>{WORDS.NO_MATCH}</SettingsLine>
        ) : (
          ordered(
            listed.map((each) => each.variable),
            order,
          ).map((variable) => (
            <VariableRow
              key={variable.name}
              workspaceId={workspaceId}
              variable={variable}
              actor={byName.get(variable.name)?.actor}
              manages={manages}
              landed={landed.has(variable.name)}
              onWritten={onWritten}
            />
          ))
        )}
      </SettingsSection>
    </Stack>
  );
}

/** Variables over one workspace, Add variables on its heading for an owner or admin. */
export function EnvironmentVariablesSection({
  workspace,
  readerId,
}: {
  workspace: Workspace;
  /** The signed-in account, whose own changes read as You. */
  readerId: string | undefined;
}): React.JSX.Element {
  const manages = managesWorkspace(workspace);
  const environment = useQuery(environmentQuery(workspace.id));
  const { landed, land } = useLanded();
  const variables = environment.data?.variables;

  const add = useAddDialog(workspace.id, variables ?? [], land);

  return (
    <>
      <SettingsSection
        {...settingsSectionHead(SECTION.ENVIRONMENT_VARIABLES)}
        caption={WORDS.CAPTION}
        frame={SETTINGS_SECTION_FRAME.NONE}
        action={
          manages ? (
            <Button variant={BUTTON_VARIANT.OUTLINE} icon={<PlusIcon />} onClick={add.ask}>
              {WORDS.ADD}
            </Button>
          ) : undefined
        }
      >
        {environment.isError ? (
          <SettingsSection>
            <ReadFailed
              line={VARIABLE_WORDS.READ_FAILED}
              surface={FAILURE_SURFACE.WORKSPACE_ENVIRONMENT_READ}
              onRetry={() => void environment.refetch()}
            />
          </SettingsSection>
        ) : variables === undefined ? (
          <SettingsRowsSkeleton
            label={readingWords("the variables")}
            rows={[VARIABLE_ROW_SKELETON]}
          />
        ) : variables.length === 0 ? (
          <SettingsSection>
            <SettingsLine>{WORDS.NONE}</SettingsLine>
          </SettingsSection>
        ) : (
          <MemberDirectory workspace={workspace} readerId={readerId}>
            <VariableList
              workspaceId={workspace.id}
              variables={variables}
              manages={manages}
              readerId={readerId}
              landed={landed}
              onWritten={land}
            />
          </MemberDirectory>
        )}
      </SettingsSection>
      {manages ? add.dialog : null}
    </>
  );
}
