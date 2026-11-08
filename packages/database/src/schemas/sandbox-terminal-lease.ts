import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { conversations } from "./storage.js";

/**
 * sandbox-terminal-lease.ts -- the renewal claim of the GitHub token at a coding agent's sandbox's firewall.
 *
 * One row per coding agent's conversation, written by the terminal relay as
 * it claims the renewal of the token at the sandbox's firewall, so two
 * windows on one sandbox session mint one token between them. The row names
 * a conversation, a session, and an instant alone, never a byte of what was
 * typed, and goes with its conversation.
 */
export const sandboxTerminalLease = pgTable("sandbox_terminal_lease", {
  conversationId: uuid("conversation_id")
    .primaryKey()
    .references(() => conversations.id, { onDelete: "cascade" }),
  /** When the terminal relay last set a fresh GitHub token at the sandbox's firewall; null until it has. */
  credentialAt: timestamptz("credential_at"),
  /** The sandbox session that token was set on: a resumed sandbox is a new session whose firewall holds none. */
  credentialSession: text("credential_session"),
});
