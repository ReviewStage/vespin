/**
 * slash-command.ts -- the commands a message box runs itself, and how a message's leading `/name` is read.
 *
 * A message that opens with `/name` names a command: one of these, which
 * the box runs itself rather than sending as words (`/model` changes the
 * model, `/clear` and its alias `/new` start the agent's harness on a fresh
 * session), or `/compact`, which goes as a message the service hands its
 * harness as a compaction, or `/goal`, which goes as a message the service
 * hands its harness as its goal command; or one of the harness's own, which the service
 * hands it bare (`coder-host/harness-commands.ts`). A `/name` anywhere but
 * at the message's start is words, and so is a path (`/tmp/build.log`),
 * whose name is followed by another `/` rather than a space or the end.
 */

/** The commands the box knows by name. */
export const SLASH_COMMAND = {
  MODEL: "model",
  COMPACT: "compact",
  CLEAR: "clear",
  NEW: "new",
  GOAL: "goal",
} as const;

export type SlashCommand = (typeof SLASH_COMMAND)[keyof typeof SLASH_COMMAND];

/** The lines that change an agent's goal from its row: clear it, which both harnesses' `/goal` takes, and pause or resume it, which Codex's alone does. */
export const GOAL_LINE = {
  CLEAR: "/goal clear",
  PAUSE: "/goal pause",
  RESUME: "/goal resume",
} as const;

/** A message's leading command: its name, without the slash, and the words after it. */
export interface LeadingCommand {
  readonly name: string;
  readonly words: string;
}

/** A command's name and the words after it, the name followed by a space, a line break, or nothing. */
const LEADING_COMMAND = /^\/([A-Za-z][\w.:-]*)(?:\s+([\s\S]*))?$/;

/** The command the words open with, the space ahead of it let go; none where they open with none. */
export function leadingCommand(text: string): LeadingCommand | undefined {
  const match = LEADING_COMMAND.exec(text.trim());
  const name = match?.[1];

  if (match === null || name === undefined) return undefined;

  return { name, words: (match[2] ?? "").trim() };
}

/** Whether a name is one of the box's own commands, as typed. */
export function isSlashCommand(name: string): name is SlashCommand {
  return Object.values(SLASH_COMMAND).some((command) => command === name);
}
