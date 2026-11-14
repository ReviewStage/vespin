import { RUNNER_ENV } from "@repo/agent-runner/protocol";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { readingWords } from "@repo/features/words";
import {
  WORKSPACE_ENVIRONMENT_BOUNDS,
  type WorkspaceEnvironmentAnswer,
  type WorkspaceVariable,
  type WorkspaceVariableEditRequest,
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
  Checkbox,
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
  Stack,
  TEXT_FIELD_FONT,
  TEXT_FONT,
  TEXT_TONE,
  Text,
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
import { inputProblem } from "@repo/ui/reported-failure";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import {
  type QueryClient,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Schema, type Types } from "effect";
import { useState } from "react";
import { actFailureWords, askAct, sendAct } from "../act.js";
import { ActorLine, ActorRef } from "../actor-ref.js";
import { useConfirmAct } from "../confirm-act.js";
import { copyThroughShell } from "../copy-feedback.js";
import { ActionMenu, type MenuAction } from "../desktop/action-menu.js";
import { useFormDialog } from "../desktop/use-form-dialog.js";
import { confirmFailure } from "../failure-report.js";
import { MemberDirectory, useMemberDirectory } from "../member-directory.js";
import { QUERY_ROOT } from "../query-keys.js";
import { parseDotenv } from "./dotenv.js";
import { ReadFailed, replayMaskedError } from "./marks.js";
import { MenuRow } from "./menu-row.js";
import { type FiledUnder, filterPeople, PeopleFilter, PeopleFilterChips } from "./people-filter.js";
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
 * several at once (Add variables), a `.env` imported or pasted into a Name
 * spread a pair to a line, each line saying what is wrong with its name or
 * that it replaces one saved; edits one from its row's ⋯ (Edit: a new name,
 * a new value, a config made secret, never the other way); and deletes
 * one, which asks first. Each write answers the variables as they then
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
  CAPTION: "Cloud agents, setup scripts, and run actions start with these.",
  ADD: "Add variables",
  ADD_ANOTHER: "Add another",
  IMPORT: "Import .env",
  OR_PASTE: "or paste into Name",
  SEARCH: "Search variables",
  UPDATED_BY: "Updated by",
  VIEW_OPTIONS: "View options",
  ORDER_BY: "Order by",
  NONE: "No variables yet.",
  NO_MATCH: "No variables match.",
  SECRET: "Secret",
  SECRET_DETAIL: "Can't be viewed once saved.",
  NAME_SPELLING: "Use letters, digits, and _, not starting with a digit.",
  NO_NAME: "A variable needs a name.",
  ADDED: "Added",
  UPDATED: "Updated",
  BY: "by",
  MASKED: "••••••••",
} as const;

/** How the rows are ordered. */
const ORDER = { NAME: "name", UPDATED: "updated", CREATED: "created" } as const;

type Order = (typeof ORDER)[keyof typeof ORDER];

/** Each order's name and glyph in View options. */
const ORDER_SHOWN = {
  [ORDER.NAME]: { label: "Name", icon: <ArrowDownAZIcon /> },
  [ORDER.UPDATED]: { label: "Last updated", icon: <ClockIcon /> },
  [ORDER.CREATED]: { label: "Created", icon: <CalendarPlusIcon /> },
} as const satisfies Record<Order, { label: string; icon: React.JSX.Element }>;

/** The key the filter files a variable no member is named for under: one from before who set it was kept, or whose member's account is gone. */
const NOBODY_KEY = "nobody";

/**
 * The names we set for our own agents as each launches, which replace
 * a workspace variable of the same name (`runner-sessions.ts`'s launch, its
 * own after the workspace's), each with what its mark says.
 */
const SET_BY_VESPIN: ReadonlyMap<string, string> = new Map([
  [
    RUNNER_ENV.API_KEY,
    `${PRODUCT_NAME} sets ${RUNNER_ENV.API_KEY} for agents on an Anthropic API key, replacing this value.`,
  ],
  [
    RUNNER_ENV.OPENAI_API_KEY,
    `${PRODUCT_NAME} sets ${RUNNER_ENV.OPENAI_API_KEY} for agents on an OpenAI API key, replacing this value.`,
  ],
  [
    RUNNER_ENV.CLAUDE_TOKEN,
    `${PRODUCT_NAME} sets ${RUNNER_ENV.CLAUDE_TOKEN} for Claude agents on a plan, replacing this value.`,
  ],
  [
    RUNNER_ENV.BEARER,
    `${PRODUCT_NAME} sets ${RUNNER_ENV.BEARER} for every agent, so agents never see this value.`,
  ],
]);

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

/** When a variable was added, or last set where a service before it answers no add. */
function createdOf(variable: WorkspaceVariable): number {
  return variable.createdAt ?? variable.updatedAt;
}

/** Whether a variable changed since it was added, which its line says as Updated. */
function changed(variable: WorkspaceVariable): boolean {
  return variable.updatedBy !== undefined || variable.updatedAt > createdOf(variable);
}

/** The member a variable's line names: who last changed it, or who added it until it changed. */
function changerOf(variable: WorkspaceVariable): WorkspaceVariable["createdBy"] {
  return changed(variable) ? variable.updatedBy : variable.createdBy;
}

/** A name's problem among the other names it is saved beside, in the words its line says. */
function nameProblem(name: string, others: readonly string[]): string | undefined {
  if (name === "") return undefined;

  if (!isVariableName(name)) return WORDS.NAME_SPELLING;

  if (others.includes(name)) return `${name} is named twice.`;

  return undefined;
}

/** The variables in the order View options names. */
function ordered(variables: readonly WorkspaceVariable[], order: Order): WorkspaceVariable[] {
  return [...variables].sort((one, other) => {
    if (order === ORDER.UPDATED) return other.updatedAt - one.updatedAt;

    if (order === ORDER.CREATED) return createdOf(other) - createdOf(one);

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
        {`${changed(variable) ? WORDS.UPDATED : WORDS.ADDED} `}
        <Time at={variable.updatedAt} look={TIME_LOOK.AGO} />
        {actor === undefined ? null : (
          <>
            {` ${WORDS.BY} `}
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
  names,
  manages,
  landed,
  onWritten,
}: {
  workspaceId: string;
  variable: WorkspaceVariable;
  actor: Actor | undefined;
  /** Every variable's name, which an edit's new name may not take. */
  names: readonly string[];
  manages: boolean;
  landed: boolean;
  onWritten: (names: readonly string[]) => void;
}): React.JSX.Element {
  const queries = useQueryClient();
  const { name, value } = variable;
  const edit = useEditDialog(workspaceId, variable, names, onWritten);

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

  const actions: readonly (readonly MenuAction[])[] = manages
    ? [
        [{ label: "Edit", icon: <PencilIcon />, onSelect: edit.ask }, ...copies],
        [{ label: "Delete", icon: <TrashIcon />, danger: true, onSelect: deletion.ask }],
      ]
    : [copies];

  const note = SET_BY_VESPIN.get(name);

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
            confirm={deletion}
            question={{
              title: `Delete ${name}?`,
              verb: "Delete variable",
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
 * A variable's Edit: its name, which renames it; its value, a secret's left
 * empty to keep what is saved, a config's shown to change in place; and,
 * for a config, Secret, which once saved cannot be taken back.
 */
function useEditDialog(
  workspaceId: string,
  variable: WorkspaceVariable,
  names: readonly string[],
  onWritten: (names: readonly string[]) => void,
) {
  const queries = useQueryClient();
  const wasSecret = variable.secret !== false;
  const [name, setName] = useState(variable.name);
  const [value, setValue] = useState(variable.value ?? "");
  const [secret, setSecret] = useState(wasSecret);
  const typed = name.trim();
  const renamed = typed !== variable.name;

  const problem =
    typed === ""
      ? WORDS.NO_NAME
      : !isVariableName(typed)
        ? WORDS.NAME_SPELLING
        : renamed && names.includes(typed)
          ? `${typed} already exists.`
          : undefined;

  const valueChanged = wasSecret ? value !== "" : value !== (variable.value ?? "");
  const madeSecret = !wasSecret && secret;

  /** The edit as it is sent: what changed, and nothing that did not. */
  const editAsked = (): WorkspaceVariableEditRequest => {
    const asked: Types.Mutable<WorkspaceVariableEditRequest> = { workspaceId, name: variable.name };

    if (renamed) asked.rename = typed;

    if (valueChanged) asked.value = value;

    if (madeSecret) asked.secret = true;

    return asked;
  };

  const editing = useMutation({
    mutationFn: () => sendAct(ACT_KIND.WORKSPACE_ENVIRONMENT_EDIT, editAsked()),
    onSuccess: async (answer) => {
      await drawAnswer(queries, workspaceId, answer);
      onWritten([typed]);
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
    problem === undefined &&
      (renamed || valueChanged || madeSecret) &&
      (secret || value !== "") &&
      value.length <= WORKSPACE_ENVIRONMENT_BOUNDS.MAX_VALUE_CHARS,
  );

  const reset = () => {
    setName(variable.name);
    setValue(variable.value ?? "");
    setSecret(wasSecret);
  };

  const dialog = (
    <Dialog
      open={form.open}
      size={DIALOG_SIZE.CONFIRM}
      title={`Edit ${variable.name}`}
      replayUnmasked
      titleReplayMasked
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
        <FormField
          label="Name"
          error={inputProblem(problem)}
          description={
            renamed && problem === undefined
              ? `Agents see ${typed} in place of ${variable.name} when they next start.`
              : undefined
          }
        >
          {(control) => (
            <ReplayMask>
              <TextField
                field={control}
                font={TEXT_FIELD_FONT.MONO}
                autoCorrect={false}
                spellCheck={false}
                maxLength={WORKSPACE_ENVIRONMENT_BOUNDS.MAX_NAME_CHARS}
                disabled={form.settling}
                value={name}
                onChange={setName}
                onEnter={form.submit}
              />
            </ReplayMask>
          )}
        </FormField>
        {secret ? (
          <SecretField
            label="Value"
            saved={wasSecret}
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
                <TextField
                  field={control}
                  font={TEXT_FIELD_FONT.MONO}
                  autoCorrect={false}
                  spellCheck={false}
                  disabled={form.settling}
                  value={value}
                  onChange={setValue}
                  onEnter={form.submit}
                />
              </ReplayMask>
            )}
          </FormField>
        )}
        {wasSecret ? null : (
          <Checkbox
            checked={secret}
            disabled={form.settling}
            onChange={setSecret}
            detail={
              <Text as="span" tone={TEXT_TONE.MUTED}>
                {WORDS.SECRET_DETAIL}
              </Text>
            }
          >
            {WORDS.SECRET}
          </Checkbox>
        )}
      </Stack>
    </Dialog>
  );

  return { ask: confirm.ask, dialog };
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
  names: readonly string[],
  onWritten: (names: readonly string[]) => void,
) {
  const queries = useQueryClient();
  const [drafts, setDrafts] = useState<readonly Draft[]>(() => [blankDraft()]);
  const [secret, setSecret] = useState(true);
  const typedNames = drafts.map((draft) => draft.name.trim());
  const filled = drafts.filter((draft) => draft.name.trim() !== "" && draft.value !== "");

  const rows: readonly NameValueRow[] = drafts.map((draft, at) => {
    const name = draft.name.trim();

    const problem = nameProblem(
      name,
      typedNames.filter((_, other) => other !== at),
    );

    const replaces = problem === undefined && names.includes(name);

    return {
      key: draft.key,
      name: draft.name,
      value: draft.value,
      problem,
      note: SET_BY_VESPIN.get(name) ?? (replaces ? `Replaces the saved ${name}.` : undefined),
    };
  });

  const ready =
    filled.length > 0 &&
    filled.length <= WORKSPACE_ENVIRONMENT_BOUNDS.MAX_SAVED &&
    rows.every((row) => row.problem === undefined) &&
    drafts.every((draft) => (draft.name.trim() === "") === (draft.value === "")) &&
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
    setSecret(true);
  };

  const count = filled.length;

  const dialog = (
    <Dialog
      open={form.open}
      size={DIALOG_SIZE.WIDE}
      title={WORDS.ADD}
      replayUnmasked
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
        <ReplayMask>
          <NameValueRows
            rows={rows}
            secret={secret}
            namePlaceholder="NAME"
            disabled={form.settling}
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
        <Checkbox
          checked={secret}
          disabled={form.settling}
          onChange={setSecret}
          detail={
            <Text as="span" tone={TEXT_TONE.MUTED}>
              {WORDS.SECRET_DETAIL}
            </Text>
          }
        >
          {WORDS.SECRET}
        </Checkbox>
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
  const names = variables.map((variable) => variable.name);

  const shown = variables.map((variable): ShownVariable => {
    const changer = changerOf(variable);

    if (changer === undefined) return { variable, actor: undefined, key: NOBODY_KEY };
    const actor = personActor(changer, members, readerId, former);

    return { variable, actor, key: actor.kind === ACTOR_KIND.PERSON ? changer.userId : NOBODY_KEY };
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
              names={names}
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

  const add = useAddDialog(
    workspace.id,
    (variables ?? []).map((variable) => variable.name),
    land,
  );

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
              line="The variables could not be read."
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
