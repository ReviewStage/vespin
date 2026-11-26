import { MANAGER_CHAT_AUTHOR, type ManagerChatAuthor } from "@repo/features/manager-chat-live";
import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { literal, timestamptz } from "./_helpers.js";
import { agentTable } from "./agent.js";
import { user } from "./auth.js";
import { managerChatMessage } from "./manager-chat-message.js";

/**
 * manager-chat-reaction.ts -- one reaction given a message of a Manager's chat: any emoji Slack names, by a member or by the Manager itself.
 *
 * A reaction is its message's, by the Manager whose chat it is and the
 * message's id, and goes with the message, so a rewind that drops a
 * message drops its reactions. Its giver is a member, by their account, or
 * the Manager, which names none; each gives a message each kind once. Its
 * kind is the name it is kept under (`reactionOfName`), and its emoji is
 * kept beside it, so a reader draws a kind it never heard of. A
 * member's reaction goes with their account. Note that the row names the
 * Manager, as its message does, so a write to it wakes the chat's live
 * read on the Manager's topic.
 */
export const managerChatReaction = pgTable(
  "manager_chat_reaction",
  {
    /** The Manager whose chat the message is. */
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agentTable.id, { onDelete: "cascade" }),
    /** The message's short id, unique within the chat. */
    messageId: text("message_id").notNull(),
    reactorKind: text("reactor_kind").$type<ManagerChatAuthor>().notNull(),
    /** The member who gave it; null for the Manager's own. */
    reactorUserId: text("reactor_user_id").references(() => user.id, { onDelete: "cascade" }),
    /** Slack's name for its emoji, as the reaction is kept (`reactionOfName`). */
    kind: text("kind").notNull(),
    /** The emoji the kind names, as Slack's table spells it. */
    emoji: text("emoji").notNull(),
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "manager_chat_reaction_message",
      columns: [table.agentId, table.messageId],
      foreignColumns: [managerChatMessage.agentId, managerChatMessage.id],
    }).onDelete("cascade"),
    // A message's reactions, read by every page of the chat and found by its delete, whoever gave them, which neither partial index below serves.
    index("manager_chat_reaction_of_message").on(table.agentId, table.messageId),
    // Note that a member gives a message each kind once, and so does the Manager, which names no member.
    uniqueIndex("manager_chat_reaction_member")
      .on(table.agentId, table.messageId, table.kind, table.reactorUserId)
      .where(sql`${table.reactorUserId} is not null`),
    uniqueIndex("manager_chat_reaction_manager")
      .on(table.agentId, table.messageId, table.kind)
      .where(sql`${table.reactorUserId} is null`),
    // An account's delete taking each of its reactions.
    index("manager_chat_reaction_user")
      .on(table.reactorUserId)
      .where(sql`${table.reactorUserId} is not null`),
    check(
      "manager_chat_reaction_reactor",
      sql`(${table.reactorKind} = ${literal(MANAGER_CHAT_AUTHOR.PERSON)} and ${table.reactorUserId} is not null) or (${table.reactorKind} = ${literal(MANAGER_CHAT_AUTHOR.AGENT)} and ${table.reactorUserId} is null)`,
    ),
    check("manager_chat_reaction_kind", sql`${table.kind} <> '' and ${table.emoji} <> ''`),
  ],
);
