import { skillWord } from "@repo/features/skill-word";
import { SLASH_COMMAND, type SlashCommand } from "@repo/features/slash-command";
import {
  type ComboboxOption,
  HoverCard,
  HoverCardHead,
  HoverCardNote,
  INLINE_REF_LOOK,
  INLINE_REF_NAME,
  InlineRef,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import type { ReactNode } from "react";

/**
 * command-ref.tsx -- one of the box's own commands named in place: the chip `/compact` is drawn as in the composer and in a sent message, the card it hangs, and the row the `/` list offers it on.
 *
 * A command is named as the words that run it, as a skill is, and drawn the
 * way a skill is wherever its words stand as a message's first word (`skill-ref.tsx`):
 * the composer's chip and a sent message's are the one pill (`@repo/ui`'s
 * `InlineRef`), led by the command's own glyph, which hangs its card: the
 * glyph and the name at its head, "Command" under it, and what it does. A
 * command has no file, so its chip opens nothing, as an installed skill's
 * does not: it hangs its card alone, and still takes the focus for it.
 */

/** What a command is: its glyph, what its row and its card say it does, and the alias that names it too. */
interface CommandEntry {
  readonly glyph: () => ReactNode;
  readonly detail: string;
  readonly alias?: SlashCommand;
}

/** The commands the `/` list offers, in its order, `/new` named by `/clear`'s alias rather than a row of its own. */
export const LISTED_COMMANDS = [
  SLASH_COMMAND.MODEL,
  SLASH_COMMAND.COMPACT,
  SLASH_COMMAND.CLEAR,
  SLASH_COMMAND.GOAL,
] as const satisfies readonly SlashCommand[];

const COMMANDS = {
  [SLASH_COMMAND.MODEL]: { glyph: () => <GLYPH.MODEL />, detail: "Change the model" },
  [SLASH_COMMAND.COMPACT]: {
    glyph: () => <GLYPH.COMPACT />,
    detail: "Summarize to free up context",
  },
  [SLASH_COMMAND.CLEAR]: {
    glyph: () => <GLYPH.NEW_SESSION />,
    detail: "Start a fresh session",
    alias: SLASH_COMMAND.NEW,
  },
  [SLASH_COMMAND.NEW]: { glyph: () => <GLYPH.NEW_SESSION />, detail: "Start a fresh session" },
  [SLASH_COMMAND.GOAL]: {
    glyph: () => <GLYPH.GOAL />,
    detail: "Keep working until a condition holds",
  },
} as const satisfies Record<SlashCommand, CommandEntry>;

/** Every name a command chip stands for in the box, its alias among them, each acting on the agent's session; `/model` opens its menu as it is chosen, so it never stands there as a chip. */
export const COMMAND_NAMES: ReadonlySet<string> = new Set([
  SLASH_COMMAND.COMPACT,
  SLASH_COMMAND.CLEAR,
  SLASH_COMMAND.NEW,
  SLASH_COMMAND.GOAL,
]);

/** The commands a sent message carries as its first word, which its bubble draws as their chip: the others run in the box and never go. */
export const SENT_COMMANDS: ReadonlySet<string> = new Set([
  SLASH_COMMAND.COMPACT,
  SLASH_COMMAND.GOAL,
]);

/** The command chips of a box with no session yet, which can still open its agent's first turn on a goal. */
export const GOAL_NAMES: ReadonlySet<string> = new Set([SLASH_COMMAND.GOAL]);

/** What the card says under a command's name. */
const COMMAND_KIND = "Command";

/** Which of the commands a box runs: `/model` where it stands beside a model chip, the ones that act on a session where its agent has one to compact or clear, and `/goal` there or where the box starts an agent on its words. */
export interface CommandReach {
  readonly model: boolean;
  readonly session: boolean;
  readonly goal: boolean;
}

/** Whether a box runs a command, by name or by alias: `/model` beside its chip, `/goal` where a goal may be set, the rest on a session. */
export function runsCommand(name: SlashCommand, reach: CommandReach): boolean {
  if (name === SLASH_COMMAND.MODEL) return reach.model;

  return name === SLASH_COMMAND.GOAL ? reach.goal : reach.session;
}

/** The listed commands the box reaches that the `/` word's query finds, by name or by alias. */
export function matchingCommands(query: string, reach: CommandReach): readonly SlashCommand[] {
  const typed = query.toLowerCase();

  return LISTED_COMMANDS.filter((name) => {
    const entry: CommandEntry = COMMANDS[name];
    const found = name.startsWith(typed) || (entry.alias?.startsWith(typed) ?? false);

    return found && runsCommand(name, reach);
  });
}

/** A command as the `/` list draws its row: its glyph, its `/name`, and what it does. */
export function commandOption(name: SlashCommand): ComboboxOption {
  const entry = COMMANDS[name];

  return {
    id: name,
    label: skillWord(name),
    icon: entry.glyph(),
    detail: entry.detail,
  };
}

/** The command's card: its glyph and name, that it is a command, and what it does. */
function CommandCard({ name }: { name: SlashCommand }): React.JSX.Element {
  const entry = COMMANDS[name];

  return (
    <HoverCard data-command-card="">
      <HoverCardHead glyph={entry.glyph()} name={skillWord(name)} sub={COMMAND_KIND} />
      <HoverCardNote>{entry.detail}</HoverCardNote>
    </HoverCard>
  );
}

/** A command named in place: its glyph and `/name` as one pill, kept whole in words, which hangs its card and opens nothing. */
export function CommandRef({ name }: { name: SlashCommand }): React.JSX.Element {
  return (
    <InlineRef
      look={INLINE_REF_LOOK.PILL}
      glyph={COMMANDS[name].glyph()}
      kind={COMMAND_KIND}
      label={skillWord(name)}
      name={INLINE_REF_NAME.WHOLE}
      onPress={undefined}
      card={<CommandCard name={name} />}
      data-command-ref=""
    />
  );
}
