/**
 * harness-commands.ts -- how a message that opens with a `/name` reaches the agent's harness: as its own command, bare, or as words.
 *
 * Claude Code runs a slash command from a message it is streamed (the
 * Agent SDK's input mode) where the message's last text block opens with
 * one it knows: a local one answers at once (`/context`, `/usage`), a
 * prompt one or a skill runs a turn, and one it does not know reaches the
 * model as words. A message carries the turn's words (`turn-message.ts`)
 * as its first block, so a command written after them still runs, and the
 * CLI drops them unread; a command therefore goes bare, the developer's
 * blocks alone, and the session is not told it was handed what it never
 * read. A command that would change what the service keeps for the agent
 * (its model, effort, session, or name) or that is the CLI's terminal's
 * alone is held back: the turn's words go after it, so the CLI reads the
 * message as words and the model answers it, where run it would leave the
 * agent's row and its session disagreeing.
 *
 * Codex's app-server runs no command from a turn's words, so a `/name`
 * reaches its model as words, but for `/compact`, which the line asks of
 * the runner as Codex's own compaction (`thread/compact/start`), the words
 * after it dropped, since that takes none.
 */

import { SLASH_COMMAND } from "@repo/features/slash-command";

/** How a message whose first words name a command is handed to the harness. */
export const COMMAND_ROUTE = {
  /** As words, behind the turn's words, as every message goes. */
  WORDS: "words",
  /** Bare: the developer's blocks alone, for the harness to run as its own command. */
  BARE: "bare",
  /** As words the harness cannot read as a command: the turn's words after them. */
  ESCAPED: "escaped",
  /** As the session's compaction, which the line asks of the runner. */
  COMPACT: "compact",
} as const;

export type CommandRoute = (typeof COMMAND_ROUTE)[keyof typeof COMMAND_ROUTE];

/**
 * The commands Claude Code would run that are held back as words: the ones
 * that change what the service keeps for the agent, and the ones of the
 * CLI's terminal, which say nothing an agent's transcript can use.
 */
const CLAUDE_CODE_HELD: ReadonlySet<string> = new Set([
  SLASH_COMMAND.MODEL,
  SLASH_COMMAND.CLEAR,
  SLASH_COMMAND.NEW,
  "effort",
  "fast",
  "rename",
  "resume",
  "rewind",
  "config",
  "permissions",
  "login",
  "logout",
  "exit",
  "quit",
  "add-dir",
  "mcp",
  "agents",
  "hooks",
  "plugin",
  "reload-plugins",
  "reload-skills",
  "autocompact",
  "auto-mode-setup",
  "output-style",
  "color",
  "focus",
  "theme",
  "vim",
  "statusline",
  "terminal-setup",
  "ide",
  "keybindings",
  "heapdump",
  "doctor",
]);

/** How Claude Code is handed a message opening with the command named. */
export function claudeCodeCommandRoute(name: string): CommandRoute {
  return CLAUDE_CODE_HELD.has(name) ? COMMAND_ROUTE.ESCAPED : COMMAND_ROUTE.BARE;
}

/** How Codex is handed a message opening with the command named. */
export function codexCommandRoute(name: string): CommandRoute {
  return name === SLASH_COMMAND.COMPACT ? COMMAND_ROUTE.COMPACT : COMMAND_ROUTE.WORDS;
}

/**
 * The route a message takes where the session is to be handed the agent's
 * steps so far ahead of it: never one that drops the turn's words, which
 * carry them, so a command the harness would run goes as words instead.
 */
export function routeBesideReplay(route: CommandRoute): CommandRoute {
  if (route === COMMAND_ROUTE.BARE) return COMMAND_ROUTE.ESCAPED;

  if (route === COMMAND_ROUTE.COMPACT) return COMMAND_ROUTE.WORDS;

  return route;
}
