import { signedInAccountId } from "@repo/credentials/snapshot";
import {
  ALLOWED_COMMANDS_WRITE_FAILURE,
  type AllowedCommandsWriteAnswerView,
} from "@repo/features/agent-view";
import {
  allowedCommandWords,
  samePrefix,
  TYPED_COMMAND_REFUSAL,
  type TypedCommandRefusal,
  typedCommandPrefix,
} from "@repo/features/allowed-command-model";
import type { AllowedCommand } from "@repo/features/allowed-command-wire";
import { agentName } from "@repo/features/model-label";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { readingWords } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import { SETTINGS_SEARCH_ROW } from "@repo/settings/settings-anchors";
import {
  BUTTON_VARIANT,
  Button,
  EditActions,
  PlusIcon,
  SETTINGS_ROW_CONTROLS,
  SETTINGS_ROW_STATE,
  SETTINGS_SKELETON_CONTROL,
  SettingsLine,
  type SettingsRowSkeletonLayout,
  SettingsRowStateLine,
  SettingsRowsSkeleton,
  SettingsSection,
  TEXT_FIELD_SIZE,
  TEXT_FONT,
  TEXT_VARIANT,
  Text,
  TextField,
  TIME_LOOK,
  Time,
} from "@repo/ui";
import { ACTOR_KIND, ACTOR_STATE, type Actor } from "@repo/ui/actor-model";
import { GLYPH } from "@repo/ui/icons";
import { inputProblem, type ShownError } from "@repo/ui/reported-failure";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { actMutation } from "../act-mutations.js";
import { ActorLine, ActorRef } from "../actor-ref.js";
import { refusedShown } from "../failure-report.js";
import { allowedCommandsQuery, allowedCommandsRetryMutation } from "../live-reads.js";
import { agentActor } from "../tasks/agent-model.js";
import { listedAgentIn } from "../tasks/use-workspace-agents.js";
import { pressWrite, type RowDoors, type UndoWrite } from "../undo-stack.js";
import { appStateQuery, selectAccount, selectTasks } from "../use-app-state.js";
import { ReadFailed } from "./marks.js";
import { MenuRow } from "./menu-row.js";

/**
 * always-allowed-section.tsx -- Settings › Agents' Always allowed: the shell commands the account's Claude Code agents run without asking, added from the heading and edited in place, each removed from its ⋯.
 *
 * The list is the one the host holds for the account signed in
 * (`LIVE_READ.ALLOWED_COMMANDS`), where each write's own answer is laid. It
 * stands newest first, a command's first words shown with a `*` for
 * whatever follows (`pnpm test *`), and under each who added it when: the
 * agent whose Always allow kept it, named and marked as the window's lists
 * name it, or a plain agent's chip where none does, or "you" for one added
 * or edited here.
 *
 * A command is written in place, as a run action's command is
 * (`cloud-setup-sections.tsx`): Add command, on the section's heading as
 * every Settings list adds an item, opens a new row at the top of the card,
 * and a row's Edit command turns its words into a field. While one is
 * written its row is ringed in the accent, its words bare in the row's own
 * type, and Cancel and Save stand at its end with no ⋯, Return saving and
 * Escape canceling. What is typed is split into words, a trailing `*` dropped,
 * and checked as a prefix before it is sent, so shell syntax is refused
 * under the row unsent; a list that holds all it may refuses it there too.
 * An edit is one write, which puts the words typed in the command's place,
 * and the command then stands as added by you just now, since no agent
 * proposed those words. A command just added or edited lands lit at the
 * top. What is being written stands for the account it was opened for
 * alone, so a switch to another account lets it go.
 *
 * Remove, from a row's ⋯, asks nothing and is not drawn red, since it
 * reaches only the reader and can be undone: the row leaves at once and a
 * toast offers Undo, which adds the command again (`undo-stack.ts`), as ⌘Z
 * does; it stands as added by you, since the list keeps no agent for an add
 * by hand. A removal or an edit stops applying at an agent's next launch.
 * Codex agents neither read the list nor add to it, so the caption names
 * Claude Code alone.
 */

/** What the section says. */
const SECTION = {
  TITLE: "Always allowed",
  CAPTION: "Commands your Claude Code agents run without asking.",
  ADD: "Add command",
  EDIT: "Edit command",
  FIELD: "Command",
  NEW: "New command",
  PLACEHOLDER: "pnpm test",
  EMPTY: "No commands yet.",
  READ_FAILED: "Couldn't read your always-allowed commands.",
  REMOVE: "Remove",
  CANCEL: "Cancel",
  ADDED: "Added",
  BY: "by",
  YOU: "you",
} as const;

/** Why a command was not added or edited, as the field says it. */
const ADD_REFUSED = {
  [TYPED_COMMAND_REFUSAL.EMPTY]: "Type a command's first words, such as pnpm test.",
  [TYPED_COMMAND_REFUSAL.NOT_A_PREFIX]:
    "Type the start of one command: up to 8 plain words, with no quotes, pipes, globs, or other shell syntax.",
} as const satisfies Record<TypedCommandRefusal, string>;

/** Why the service changed nothing, as the field or a removal's toast says it. */
const WRITE_FAILED = {
  FULL: "You allow as many commands as you can. Remove one to add another.",
  ADD: "Couldn't add the command. Try again.",
  EDIT: "Couldn't save the command. Try again.",
  CHANGE: "Couldn't change your always-allowed commands. Try again.",
} as const;

/** One command's shape, as the loaded section draws it. */
const COMMAND_ROW_SKELETON: SettingsRowSkeletonLayout = {
  described: true,
  controls: [],
  end: [SETTINGS_SKELETON_CONTROL.MORE],
};

/** What a removal changes: the command's first words, which its Undo adds again. */
interface Removed {
  readonly prefix: readonly string[];
  readonly words: string;
}

/** The commands as the section reads them, for an Undo that lands renders later. */
type CommandRows = readonly AllowedCommand[];

/** Whether `rows` hold a command of `prefix`. */
function holds(rows: CommandRows, prefix: readonly string[]): boolean {
  return rows.some((each) => samePrefix(each.prefix, prefix));
}

/** Why a write's answer changed nothing, `otherwise` where the list was not full; none where the service kept it. */
function writeRefusal(
  answer: AllowedCommandsWriteAnswerView,
  otherwise: string,
): string | undefined {
  if (!("failure" in answer)) return undefined;

  return answer.failure === ALLOWED_COMMANDS_WRITE_FAILURE.ALLOWED_COMMANDS_FULL
    ? WRITE_FAILED.FULL
    : otherwise;
}

/** No answer, as a send that never reached the host reads. */
const UNANSWERED: AllowedCommandsWriteAnswerView = {
  failure: ALLOWED_COMMANDS_WRITE_FAILURE.UNANSWERED,
};

/**
 * A command removed, which ⌘Z and its toast's Undo add again while it is
 * still gone, and put back gone while it stands; its toast quotes the
 * command, so a screen recording masks it.
 */
const REMOVE_UNDO = {
  words: ({ words }) => `Removed ${words}`,
  unmasked: () => false,
  kind: ACT_KIND.ALLOWED_COMMANDS_WRITE,
  read: (rows, command) =>
    holds(rows, command.prefix)
      ? { prefix: command.prefix, words: allowedCommandWords(command.prefix) }
      : undefined,
  act: (send, { prefix }) => send({ remove: [...prefix] }),
  undo: (send, { prefix }) => send({ add: [...prefix] }),
  holds: (rows, { prefix }) => !holds(rows, prefix),
  undone: (rows, { prefix }) => holds(rows, prefix),
  refused: (answer) => writeRefusal(answer, WRITE_FAILED.CHANGE),
  surface: FAILURE_SURFACE.ALLOWED_COMMANDS_WRITE,
} satisfies UndoWrite<
  CommandRows,
  AllowedCommand,
  Removed,
  typeof ACT_KIND.ALLOWED_COMMANDS_WRITE,
  AllowedCommandsWriteAnswerView
>;

/** The agent whose Always allow kept a command, as the window's lists name it; a plain agent's chip where none does. */
function useAddedBy(agentId: string): Actor {
  const tasks = useQuery({ ...appStateQuery, select: selectTasks }).data;
  const listed = listedAgentIn(tasks, agentId);

  if (listed === undefined) {
    return {
      kind: ACTOR_KIND.AGENT,
      name: "an agent",
      provider: undefined,
      state: ACTOR_STATE.REST,
    };
  }

  return { ...agentActor(listed, agentName(listed)), agentId };
}

/** Who added a command and when: "Added 2h ago by" an agent's chip, or "by you". */
function AddedLine({ command }: { command: AllowedCommand }): React.JSX.Element {
  const added = (
    <>
      {`${SECTION.ADDED} `}
      <Time at={command.addedAt} look={TIME_LOOK.AGO} />
      {` ${SECTION.BY} `}
    </>
  );

  return (
    <SettingsRowStateLine state={SETTINGS_ROW_STATE.PLAIN} block wrap>
      {command.agentId === null ? (
        <>
          {added}
          {SECTION.YOU}
        </>
      ) : (
        <AgentAddedLine added={added} agentId={command.agentId} />
      )}
    </SettingsRowStateLine>
  );
}

/** The added line naming the agent that kept the command. */
function AgentAddedLine({
  added,
  agentId,
}: {
  added: React.ReactNode;
  agentId: string;
}): React.JSX.Element {
  const actor = useAddedBy(agentId);

  return (
    <ActorLine>
      {added}
      <ActorRef actor={actor} />
    </ActorLine>
  );
}

/** A command's words in the list's monospace face, which a field typed over them takes too. */
function CommandWords({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <Text as="span" variant={TEXT_VARIANT.LABEL} font={TEXT_FONT.MONO}>
      {children}
    </Text>
  );
}

/**
 * The command being written in place: the one edited, by its id, or the
 * new one's (none), what is typed, and the account it was opened for,
 * which alone it stands for, since a Save after a switch to another
 * account would keep the words on that account's list.
 */
interface CommandEdit {
  readonly id: string | undefined;
  readonly typed: string;
  readonly accountId: string;
}

/** What a row being written in place is handed: what is typed, why it was refused, whether its save is out, and its keys and presses. */
interface EditDoors {
  readonly typed: string;
  readonly error: ShownError | undefined;
  readonly saving: boolean;
  readonly canSave: boolean;
  readonly onType: (typed: string) => void;
  readonly onSave: () => void;
  readonly onCancel: () => void;
}

/** The words typed in place, bare in the row's monospace type, Return saving and Escape canceling. */
function CommandField({ doors, label }: { doors: EditDoors; label: string }): React.JSX.Element {
  return (
    <CommandWords>
      <ReplayMask>
        <TextField
          label={label}
          size={TEXT_FIELD_SIZE.INLINE}
          autoFocus
          autoCorrect={false}
          spellCheck={false}
          placeholder={SECTION.PLACEHOLDER}
          readOnly={doors.saving}
          invalid={doors.error !== undefined}
          value={doors.typed}
          onChange={doors.onType}
          onEnter={doors.onSave}
          onEscape={doors.onCancel}
        />
      </ReplayMask>
    </CommandWords>
  );
}

/** Cancel and Save at the end of a row being written in place. */
function CommandEditActions({ doors }: { doors: EditDoors }): React.JSX.Element {
  return (
    <EditActions
      leave={SECTION.CANCEL}
      saving={doors.saving}
      canSave={doors.canSave}
      onLeave={doors.onCancel}
      onSave={doors.onSave}
    />
  );
}

/**
 * One command: its first words and a `*`, who added it when, and Edit
 * command and Remove in its ⋯. While it is edited the row is ringed, its
 * words a field, and Cancel and Save stand at its end in place of its ⋯.
 */
function CommandRow({
  command,
  edit,
  landed,
  onEdit,
  onRemove,
}: {
  command: AllowedCommand;
  /** The edit of its words, while one stands. */
  edit: EditDoors | undefined;
  /** Whether it was just added or edited here, which lights it once. */
  landed: boolean;
  onEdit: () => void;
  onRemove: () => void;
}): React.JSX.Element {
  const words = allowedCommandWords(command.prefix);

  return (
    <MenuRow
      thing={words}
      // Note that a row being edited drops its ⋯, as Cancel and Save are all it offers then.
      actions={
        edit === undefined
          ? [
              { label: SECTION.EDIT, icon: <GLYPH.RENAME />, onSelect: onEdit },
              { label: SECTION.REMOVE, icon: <GLYPH.REMOVE />, onSelect: onRemove },
            ]
          : []
      }
      row={{
        landed,
        editing: edit !== undefined,
        error: edit?.error,
        controls: SETTINGS_ROW_CONTROLS.BESIDE,
        label:
          edit === undefined ? (
            <CommandWords>{words}</CommandWords>
          ) : (
            <CommandField doors={edit} label={SECTION.FIELD} />
          ),
        description: <AddedLine command={command} />,
        control: edit === undefined ? undefined : <CommandEditActions doors={edit} />,
      }}
    />
  );
}

/** The new command, at the top of the card while it is written: ringed, its field empty but for what to write, and Cancel and Save at its end. */
function NewCommandRow({ doors }: { doors: EditDoors }): React.JSX.Element {
  return (
    <MenuRow
      thing={SECTION.NEW}
      actions={[]}
      row={{
        editing: true,
        error: doors.error,
        controls: SETTINGS_ROW_CONTROLS.BESIDE,
        label: <CommandField doors={doors} label={SECTION.NEW} />,
        control: <CommandEditActions doors={doors} />,
      }}
    />
  );
}

/**
 * The commands once read, newest first, under the new command while it is
 * written, those whose removal is out left out at once, or a line saying
 * there are none. One command is written in place at a time: a new one
 * from the heading's Add command, or one edited from its ⋯.
 */
function CommandRows({
  accountId,
  commands,
  edit,
  onEdit,
}: {
  accountId: string | undefined;
  commands: CommandRows;
  /** The command being written in place, while one is, for the account signed in. */
  edit: CommandEdit | undefined;
  onEdit: (edit: CommandEdit | undefined) => void;
}): React.JSX.Element {
  const { mutateAsync: send } = useMutation(actMutation(ACT_KIND.ALLOWED_COMMANDS_WRITE));
  const [removing, setRemoving] = useState<ReadonlySet<string>>(new Set());
  const [problem, setProblem] = useState<ShownError | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [landed, setLanded] = useState<readonly string[] | undefined>(undefined);
  // Note that an Undo reads the commands as they stand when it is pressed, since it lands renders after the removal.
  const latest = useRef(commands);
  latest.current = commands;

  // Note that a send that never reached the host answers unanswered, so a removal or its Undo says why in its toast rather than leaving its row hidden.
  const doors: RowDoors<CommandRows, typeof ACT_KIND.ALLOWED_COMMANDS_WRITE> = {
    rows: () => latest.current,
    send: (write) => send(write).catch(() => UNANSWERED),
  };

  const editing = edit !== undefined && edit.accountId === accountId ? edit : undefined;

  const edited =
    editing?.id === undefined ? undefined : commands.find((each) => each.id === editing.id);

  // Note that a save's answer is laid only on the edit that sent it, read as it stands when the answer lands, because a newer edit, another account's among them, may have taken its place.
  const current = useRef(editing);
  current.current = editing;

  const open = (command: AllowedCommand | undefined) => {
    if (accountId === undefined || saving) return;
    setProblem(undefined);
    // Note that an edit opens on the command's own words, without the `*` the list shows, since that is what the field takes.
    onEdit({ id: command?.id, typed: command?.prefix.join(" ") ?? "", accountId });
  };

  const cancel = () => {
    if (saving) return;
    setProblem(undefined);
    onEdit(undefined);
  };

  // Note that a typed command is checked before anything is sent, so shell syntax is said under the row as the person's own input, never sent.
  const save = () => {
    if (editing === undefined || saving) return;
    const typedPrefix = typedCommandPrefix(editing.typed);

    if ("refused" in typedPrefix) {
      setProblem(inputProblem(ADD_REFUSED[typedPrefix.refused]));

      return;
    }

    const { prefix } = typedPrefix;
    const otherwise = edited === undefined ? WRITE_FAILED.ADD : WRITE_FAILED.EDIT;
    const sent = editing;
    setSaving(true);
    void doors
      .send(
        edited === undefined ? { add: [...prefix] } : { edit: [...edited.prefix], to: [...prefix] },
      )
      .then((answer) => {
        setSaving(false);
        const refusal = writeRefusal(answer, otherwise);
        const still = current.current === sent;

        if (refusal !== undefined) {
          if (still) setProblem(refusedShown(refusal, FAILURE_SURFACE.ALLOWED_COMMANDS_WRITE));

          return;
        }

        setLanded(prefix);

        if (!still) return;
        setProblem(undefined);
        onEdit(undefined);
      });
  };

  const editDoors = (current: CommandEdit): EditDoors => ({
    typed: current.typed,
    error: problem,
    saving,
    canSave: current.typed.trim() !== "",
    onType: (typed) => {
      setProblem(undefined);
      onEdit({ ...current, typed });
    },
    onSave: save,
    onCancel: cancel,
  });

  const remove = (command: AllowedCommand) => {
    if (editing?.id === command.id) onEdit(undefined);
    setRemoving((was) => new Set(was).add(command.id));
    void pressWrite(REMOVE_UNDO, doors, command).finally(() =>
      setRemoving((was) => {
        const left = new Set(was);
        left.delete(command.id);

        return left;
      }),
    );
  };

  const shown = commands.filter((command) => !removing.has(command.id)).reverse();
  // Note that an edit whose command another window removed stands as a new one, so what was typed can still be saved, as an add, or let go.
  const adding = editing !== undefined && edited === undefined;

  if (shown.length === 0 && !adding) return <SettingsLine>{SECTION.EMPTY}</SettingsLine>;

  return (
    <>
      {adding ? <NewCommandRow doors={editDoors(editing)} /> : null}
      {shown.map((command) => (
        <CommandRow
          key={command.id}
          command={command}
          edit={editing?.id === command.id ? editDoors(editing) : undefined}
          landed={landed !== undefined && samePrefix(command.prefix, landed)}
          onEdit={() => open(command)}
          onRemove={() => remove(command)}
        />
      ))}
    </>
  );
}

/** Always allowed for the account signed in: Add command on its heading, its commands once read, a skeleton through the same rows while they are read, and Retry where the read failed. */
export function AlwaysAllowedSection(): React.JSX.Element {
  const accountId = signedInAccountId(useQuery({ ...appStateQuery, select: selectAccount }).data);
  const read = useQuery(allowedCommandsQuery(accountId));
  const retry = useMutation(allowedCommandsRetryMutation());
  const [edit, setEdit] = useState<CommandEdit | undefined>(undefined);
  const commands = read.data?.commands;

  return (
    <SettingsSection
      title={SECTION.TITLE}
      caption={SECTION.CAPTION}
      anchor={SETTINGS_SEARCH_ROW.ALWAYS_ALLOWED}
      action={
        <Button
          variant={BUTTON_VARIANT.OUTLINE}
          icon={<PlusIcon />}
          disabled={commands === undefined || accountId === undefined}
          onClick={() => {
            if (accountId !== undefined) setEdit({ id: undefined, typed: "", accountId });
          }}
        >
          {SECTION.ADD}
        </Button>
      }
    >
      {commands !== undefined ? (
        <CommandRows accountId={accountId} commands={commands} edit={edit} onEdit={setEdit} />
      ) : read.isError ? (
        <ReadFailed
          line={SECTION.READ_FAILED}
          surface={FAILURE_SURFACE.ALLOWED_COMMANDS_READ}
          onRetry={() => retry.mutate()}
        />
      ) : (
        <SettingsRowsSkeleton
          label={readingWords("your always-allowed commands")}
          rows={[COMMAND_ROW_SKELETON]}
        />
      )}
    </SettingsSection>
  );
}
