import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { literal, timestamptz } from "./_helpers.js";
import { agentTable } from "./agent.js";
import { user } from "./auth.js";
import { turns } from "./storage.js";

/**
 * manager-chat-message.ts -- one message of a Manager's chat with people: a person's or the Manager's own, in the chat's order.
 *
 * The chat is its own record rather than rows of the transcript
 * (`messages`), which stays the agent's own journal and the model's history:
 * a message lands here before its send answers, and every reader of the
 * chat reads it here. A message is the chat's by its agent and goes with it.
 * Its id is short, since the model repeats it, and unique within the chat;
 * `seq` orders the whole chat as its writes committed. A reply names its
 * thread's root, never another reply, so no reader walks a chain. A write
 * sent again under the same key lands once.
 */

/** Who wrote a message of a Manager's chat: a person, or the Manager itself. */
export const MANAGER_CHAT_AUTHOR = {
  PERSON: "person",
  AGENT: "agent",
} as const;

export type ManagerChatAuthor = (typeof MANAGER_CHAT_AUTHOR)[keyof typeof MANAGER_CHAT_AUTHOR];

/** A file a message carries, by the id it was kept under: a file a person sent, or a picture of a set the Manager showed. */
export interface ManagerChatAttachment {
  readonly id: string;
  readonly mediaType: string;
  readonly caption?: string;
}

export const managerChatMessage = pgTable(
  "manager_chat_message",
  {
    /** The Manager whose chat it is. */
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agentTable.id, { onDelete: "cascade" }),
    /** The short id the model names the message by, unique within the chat. */
    id: text("id").notNull(),
    /** The chat's order, the order its writes committed in. */
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity().notNull(),
    authorKind: text("author_kind").$type<ManagerChatAuthor>().notNull(),
    /** The person who wrote it; null for the Manager's own, and once their account is gone. */
    authorUserId: text("author_user_id").references(() => user.id, { onDelete: "set null" }),
    /** The author's name as it stood, so a former member's message still reads by name. */
    authorName: text("author_name").notNull(),
    /** The message's Markdown; empty where its files carry it alone. */
    text: text("text").notNull(),
    attachments: jsonb("attachments")
      .$type<readonly ManagerChatAttachment[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** The root of the thread it replies in; null for a message of the chat itself. */
    threadRoot: text("thread_root"),
    /** That a reply was also posted to the chat. */
    broadcast: boolean("broadcast").notNull().default(false),
    /** The turn the Manager sent it in, or that a person's message opened or steered; null once that turn is gone. */
    turnId: uuid("turn_id").references(() => turns.id, { onDelete: "set null" }),
    /** A person's line in the transcript (`messages`), which an edit or a rewind finds it by; null for the Manager's own. */
    lineId: uuid("line_id"),
    /** The key its writer sent it under, so a send run again lands once. */
    clientKey: text("client_key").notNull(),
    createdAt: timestamptz("created_at").notNull(),
    /** When a person's words were last edited in place; null while they stand as sent. */
    editedAt: timestamptz("edited_at"),
  },
  (table) => [
    primaryKey({ columns: [table.agentId, table.id] }),
    // Note that a thread is deleted with its root, as a rewind deletes every message after one.
    foreignKey({
      name: "manager_chat_message_thread_root",
      columns: [table.agentId, table.threadRoot],
      foreignColumns: [table.agentId, table.id],
    }).onDelete("cascade"),
    uniqueIndex("manager_chat_message_client_key").on(table.agentId, table.clientKey),
    index("manager_chat_message_agent_seq").on(table.agentId, table.seq),
    index("manager_chat_message_thread_seq")
      .on(table.agentId, table.threadRoot, table.seq)
      .where(sql`${table.threadRoot} is not null`),
    // The foreign key's check on every turn deleted finds the messages it was sent in, which a scan would read through to the last.
    index("manager_chat_message_turn").on(table.turnId).where(sql`${table.turnId} is not null`),
    check(
      "manager_chat_message_author",
      sql`${table.authorKind} in (${literal(MANAGER_CHAT_AUTHOR.PERSON)}, ${literal(MANAGER_CHAT_AUTHOR.AGENT)}) and (${table.authorKind} = ${literal(MANAGER_CHAT_AUTHOR.PERSON)} or ${table.authorUserId} is null)`,
    ),
    // Note that a reply's root stands in the chat itself, and only a reply is posted to the chat besides.
    check(
      "manager_chat_message_thread",
      sql`(${table.threadRoot} is null or ${table.threadRoot} <> ${table.id}) and (${table.broadcast} = false or ${table.threadRoot} is not null)`,
    ),
  ],
);
