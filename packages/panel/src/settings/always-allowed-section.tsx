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
  SETTINGS_ROW_STATE,
  SETTINGS_SKELETON_CONTROL,
  SettingsAddRow,
  type SettingsRowSkeletonLayout,
  SettingsRowStateLine,
  SettingsRowsSkeleton,
  SettingsSection,
  TEXT_FIELD_FONT,
  TEXT_FONT,
  TEXT_VARIANT,
  Text,
  TIME_LOOK,
  Time,
} from "@repo/ui";
import { ACTOR_KIND, ACTOR_STATE, type Actor } from "@repo/ui/actor-model";
import { GLYPH } from "@repo/ui/icons";
import { inputProblem, type ShownError } from "@repo/ui/reported-failure";
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
 * always-allowed-section.tsx -- Settings › Agents' Always allowed: the shell commands the account's Claude Code agents run without asking, one added in place, each removed from its ⋯.
 *
 * The list is the one the host holds for the account signed in
 * (`LIVE_READ.ALLOWED_COMMANDS`), where each write's own answer is laid. It
 * stands newest first under the row that adds one, a command's first words
 * shown with a `*` for whatever follows (`pnpm test *`), and under each who
 * added it when: the agent whose Always allow kept it, named and marked as
 * the window's lists name it, or a plain agent's chip where none does, or
 * "you" for one added here. What is typed is split into words, a trailing
 * `*` dropped, and checked as a prefix before it is sent, so shell syntax
 * is refused under the field unsent; a list that holds all it may refuses
 * it there too. A command just added lands lit under the field.
 *
 * Remove, from a row's ⋯, asks nothing and is not drawn red, since it
 * reaches only the reader and can be undone: the row leaves at once and a
 * toast offers Undo, which adds the command again (`undo-stack.ts`), as ⌘Z
 * does; it stands as added by you, since the list keeps no agent for an add
 * by hand. A removal stops applying at an agent's next launch. Codex
 * agents neither read the list nor add to it, so the caption names Claude
 * Code alone.
 */

/** What the section says. */
const SECTION = {
  TITLE: "Always allowed",
  CAPTION: "Commands your Claude Code agents run without asking.",
  FIELD: "Add a command",
  PLACEHOLDER: "pnpm test",
  READ_FAILED: "Couldn't read your always-allowed commands.",
  REMOVE: "Remove",
  ADDED: "Added",
  BY: "by",
  YOU: "you",
} as const;

/** Why a command was not added, as the field says it. */
const ADD_REFUSED = {
  [TYPED_COMMAND_REFUSAL.EMPTY]: "Type a command's first words, such as pnpm test.",
  [TYPED_COMMAND_REFUSAL.NOT_A_PREFIX]:
    "Type the start of one command: up to 8 plain words, with no quotes, pipes, globs, or other shell syntax.",
} as const satisfies Record<TypedCommandRefusal, string>;

/** Why the service changed nothing, as the field or a removal's toast says it. */
const WRITE_FAILED = {
  FULL: "You allow as many commands as you can. Remove one to add another.",
  ADD: "Couldn't add the command. Try again.",
  CHANGE: "Couldn't change your always-allowed commands. Try again.",
} as const;

/** The add row's shape, then one command's, as the loaded section draws them. */
const ADD_ROW_SKELETON: SettingsRowSkeletonLayout = {
  described: false,
  controls: [SETTINGS_SKELETON_CONTROL.FIELD, SETTINGS_SKELETON_CONTROL.BUTTON],
};

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

/** One command: its first words and a `*`, who added it when, and Remove in its ⋯. */
function CommandRow({
  command,
  landed,
  onRemove,
}: {
  command: AllowedCommand;
  /** Whether it was just added here, which lights it once. */
  landed: boolean;
  onRemove: () => void;
}): React.JSX.Element {
  const words = allowedCommandWords(command.prefix);

  return (
    <MenuRow
      thing={words}
      actions={[{ label: SECTION.REMOVE, icon: <GLYPH.REMOVE />, onSelect: onRemove }]}
      row={{
        landed,
        label: (
          <Text as="span" variant={TEXT_VARIANT.LABEL} font={TEXT_FONT.MONO}>
            {words}
          </Text>
        ),
        description: <AddedLine command={command} />,
      }}
    />
  );
}

/**
 * The commands once read: the row that adds one, then each command newest
 * first, those whose removal is out left out at once.
 */
function CommandRows({ commands }: { commands: CommandRows }): React.JSX.Element {
  const { mutateAsync: send } = useMutation(actMutation(ACT_KIND.ALLOWED_COMMANDS_WRITE));
  const [typed, setTyped] = useState("");
  const [adding, setAdding] = useState(false);
  const [problem, setProblem] = useState<ShownError | undefined>(undefined);
  const [landed, setLanded] = useState<readonly string[] | undefined>(undefined);
  const [removing, setRemoving] = useState<ReadonlySet<string>>(new Set());
  // Note that an Undo reads the commands as they stand when it is pressed, since it lands renders after the removal.
  const latest = useRef(commands);
  latest.current = commands;

  // Note that a send that never reached the host answers unanswered, so a removal or its Undo says why in its toast rather than leaving its row hidden.
  const doors: RowDoors<CommandRows, typeof ACT_KIND.ALLOWED_COMMANDS_WRITE> = {
    rows: () => latest.current,
    send: (write) => send(write).catch(() => UNANSWERED),
  };

  const add = (value: string) => {
    const typedPrefix = typedCommandPrefix(value);

    if ("refused" in typedPrefix) {
      setProblem(inputProblem(ADD_REFUSED[typedPrefix.refused]));

      return;
    }

    setAdding(true);
    setProblem(undefined);
    void doors.send({ add: [...typedPrefix.prefix] }).then((answer) => {
      setAdding(false);
      const refusal = writeRefusal(answer, WRITE_FAILED.ADD);

      if (refusal !== undefined) {
        setProblem(refusedShown(refusal, FAILURE_SURFACE.ALLOWED_COMMANDS_WRITE));

        return;
      }

      setTyped("");
      setLanded(typedPrefix.prefix);
    });
  };

  const remove = (command: AllowedCommand) => {
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

  return (
    <>
      <SettingsAddRow
        label={SECTION.FIELD}
        placeholder={SECTION.PLACEHOLDER}
        font={TEXT_FIELD_FONT.MONO}
        value={typed}
        busy={adding}
        error={problem}
        onChange={(value) => {
          setTyped(value);
          setProblem(undefined);
        }}
        onAdd={add}
      />
      {shown.map((command) => (
        <CommandRow
          key={command.id}
          command={command}
          landed={landed !== undefined && samePrefix(command.prefix, landed)}
          onRemove={() => remove(command)}
        />
      ))}
    </>
  );
}

/** Always allowed for the account signed in: its commands once read, a skeleton through the same rows while they are read, and Retry where the read failed. */
export function AlwaysAllowedSection(): React.JSX.Element {
  const accountId = signedInAccountId(useQuery({ ...appStateQuery, select: selectAccount }).data);
  const read = useQuery(allowedCommandsQuery(accountId));
  const retry = useMutation(allowedCommandsRetryMutation());
  const commands = read.data?.commands;

  return (
    <SettingsSection
      title={SECTION.TITLE}
      caption={SECTION.CAPTION}
      anchor={SETTINGS_SEARCH_ROW.ALWAYS_ALLOWED}
    >
      {commands !== undefined ? (
        <CommandRows commands={commands} />
      ) : read.isError ? (
        <ReadFailed
          line={SECTION.READ_FAILED}
          surface={FAILURE_SURFACE.ALLOWED_COMMANDS_READ}
          onRetry={() => retry.mutate()}
        />
      ) : (
        <SettingsRowsSkeleton
          label={readingWords("your always-allowed commands")}
          rows={[ADD_ROW_SKELETON, COMMAND_ROW_SKELETON]}
        />
      )}
    </SettingsSection>
  );
}
