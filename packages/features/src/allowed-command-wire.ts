import { CommandPrefixSchema } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import { countedNumber, wireUuidSchema } from "./service-wire.js";

/**
 * allowed-command-wire.ts -- the shell commands a member always allows their coding agents to run unasked, by their first words, as Settings › Agents lists, adds, edits, and removes them.
 *
 * A member's Always allow on a command's ask lasts past the agent's session
 * where the harness proposed the command's prefix (`CommandPrefixSchema`,
 * `["pnpm","test"]`, shown as `pnpm test *`): the prefix is kept on the
 * member's list, which names the agent it came from, and every later launch
 * of the member's agents, in any repository, is handed the list, so a
 * command it covers asks no more. Only Claude Code proposes a prefix and
 * applies the list for now; a Codex agent's Always allow lasts for its
 * session alone. Everything else an
 * Always allow covers, a file edit, a web fetch, an MCP tool, or a command
 * with no proposed prefix, stays the agent's session's alone. The list
 * matters only in a mode that asks; full access asks nothing.
 *
 * `/api/account/allowed-commands` answers the member's list in the order
 * it was added (GET), adds a prefix by hand, naming no agent (POST), puts
 * a prefix typed by hand in place of one of the list's by its id (PATCH),
 * and removes one by its id in the query (DELETE). A prefix already kept is
 * answered as it stands, and one past the list's bound is refused
 * (`allowed-commands-full`). An edit is one write: the command it names
 * takes the new words and stands as added by hand at the edit, or goes
 * where the list already keeps them, so no failure leaves the list half
 * changed. A removal stops applying at an agent's next
 * launch; a runner already running holds the rules it launched with. Every
 * answer carries the list as it then stands. A list is its member's alone:
 * no one else reads, adds to, edits, or removes from it.
 */

/** The bounds of a member's list. */
export const ALLOWED_COMMAND_BOUNDS = {
  /** The most prefixes a member keeps; an Always allow past it stays the session's. */
  MAX_COMMANDS: 200,
} as const;

/** The removal's query key, since a `DELETE` carries no body. */
export const ALLOWED_COMMAND_QUERY = {
  ID: "id",
} as const;

export const allowedCommandIdSchema = wireUuidSchema;

/**
 * One command the member always allows: its id, which a removal names; its
 * first words; the agent whose ask it came from, null for one added by
 * hand or whose agent is gone; and when it was added, in epoch milliseconds.
 */
export const allowedCommandSchema = EffectSchema.Struct({
  id: allowedCommandIdSchema,
  prefix: EffectSchema.Array(EffectSchema.String),
  agentId: EffectSchema.NullOr(wireUuidSchema),
  addedAt: countedNumber,
});

export type AllowedCommand = typeof allowedCommandSchema.Type;

/** The member's list as it stands, the earliest added first. */
export const allowedCommandsAnswerSchema = EffectSchema.Struct({
  commands: EffectSchema.Array(allowedCommandSchema),
});

export type AllowedCommandsAnswer = typeof allowedCommandsAnswerSchema.Type;

/** A prefix added by hand (POST). */
export const allowedCommandAddRequestSchema = EffectSchema.Struct({
  prefix: CommandPrefixSchema,
});

export type AllowedCommandAddRequest = typeof allowedCommandAddRequestSchema.Type;

/** A command's first words replaced by ones typed by hand (PATCH): the command by its id, and its new prefix. */
export const allowedCommandEditRequestSchema = EffectSchema.Struct({
  id: allowedCommandIdSchema,
  prefix: CommandPrefixSchema,
});

export type AllowedCommandEditRequest = typeof allowedCommandEditRequestSchema.Type;
