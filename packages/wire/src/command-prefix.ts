/**
 * command-prefix.ts -- a shell command's first words, which a member's Always allow keeps across an agent's launches: what a prefix may hold, declared once for the runner and the service.
 *
 * A prefix is the command's leading arguments as tokens (`["pnpm","test"]`,
 * shown as `pnpm test *`), which the harness itself proposes as an ask's
 * rule (Claude Code's Bash suggestion) or a
 * member types in Settings. Each token is one argument with nothing a shell
 * reads as more than a word: no whitespace, quote, escape, glob, operator,
 * redirection, substitution, or comment, so a prefix can only name the
 * start of one simple command and is written into a harness's rule
 * (`Bash(pnpm test *)`) as it stands. A prefix that
 * breaks the rule is not kept, and its ask's Always allow stays the
 * session's alone.
 */

import { Schema } from "effect";

/** The bounds of one prefix: how many tokens, and how long each. */
export const COMMAND_PREFIX = {
  MAX_TOKENS: 8,
  MAX_TOKEN_CHARS: 128,
} as const;

/** A token a shell reads as one plain word: none of its operators, quotes, globs, or control characters, and no whitespace. */
const PLAIN_TOKEN = /^[^\s\p{Cc};&|<>$`(){}[\]*?"'\\#!]+$/u;

/** One argument of a prefix. */
const CommandTokenSchema = Schema.String.check(
  Schema.isMaxLength(COMMAND_PREFIX.MAX_TOKEN_CHARS),
  Schema.isPattern(PLAIN_TOKEN),
);

/** A command's first words, one to `MAX_TOKENS` plain tokens. */
export const CommandPrefixSchema = Schema.Array(CommandTokenSchema).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(COMMAND_PREFIX.MAX_TOKENS),
);

export type CommandPrefix = typeof CommandPrefixSchema.Type;
