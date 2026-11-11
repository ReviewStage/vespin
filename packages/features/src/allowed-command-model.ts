import { type CommandPrefix, CommandPrefixSchema } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { Result } from "effect";

/**
 * allowed-command-model.ts -- a command the account always allows, as a window reads one typed and shows one kept: its first words, then a `*` for whatever follows.
 *
 * What a member types into Settings › Agents' Always allowed is split on
 * whitespace, a trailing `*` dropped, since the list shows every command
 * that way and a member may type it back as it reads, and decoded as a
 * prefix (`CommandPrefixSchema`), so what the field takes is what the
 * service keeps. A prefix is shown as its words and a `*` after them, the
 * way a held call's Always allow and the list both name it.
 */

/** Why typed words are not a command's first words. */
export const TYPED_COMMAND_REFUSAL = {
  /** Nothing but whitespace or a lone `*`. */
  EMPTY: "empty",
  /** A word with shell syntax, a glob, or a quote, or too many or too long words. */
  NOT_A_PREFIX: "not-a-prefix",
} as const;

export type TypedCommandRefusal =
  (typeof TYPED_COMMAND_REFUSAL)[keyof typeof TYPED_COMMAND_REFUSAL];

/** The trailing word that stands for whatever follows a prefix. */
const ANY_REST = "*";

/** The prefix typed words name, or why they name none. */
export function typedCommandPrefix(
  typed: string,
): { readonly prefix: CommandPrefix } | { readonly refused: TypedCommandRefusal } {
  const words = typed.split(/\s+/u).filter((word) => word !== "");
  const named = words.at(-1) === ANY_REST ? words.slice(0, -1) : words;
  if (named.length === 0) return { refused: TYPED_COMMAND_REFUSAL.EMPTY };
  const prefix = Result.getOrUndefined(readEither(CommandPrefixSchema)(named));
  return prefix === undefined ? { refused: TYPED_COMMAND_REFUSAL.NOT_A_PREFIX } : { prefix };
}

/** A prefix as it reads: its words, then a `*` for whatever follows (`pnpm test *`). */
export function allowedCommandWords(prefix: readonly string[]): string {
  return [...prefix, ANY_REST].join(" ");
}

/** Whether two prefixes are the same words in the same order. */
export function samePrefix(one: readonly string[], other: readonly string[]): boolean {
  return one.length === other.length && one.every((word, at) => word === other[at]);
}
