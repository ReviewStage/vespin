import type { ReplyButtonAction } from "@repo/features/reply-button-wire";
import { index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, timestamptz } from "./_helpers.js";
import { agentTable } from "./agent.js";
import { user } from "./auth.js";

/**
 * reply-button.ts -- a button a coding agent put in its reply, which starts a new agent or sends to a running one once a member presses it, and how its press stands.
 *
 * An agent makes one with `add_suggestion`, which keeps its label and what it
 * does here and answers the link the agent writes beside the line the
 * button is about (`@repo/features/reply-button-wire`). What it does is kept
 * whole when it is made, so the press runs what the member saw. A press
 * claims the row for the member who pressed, runs it as them, and keeps the
 * agent it started or sent to, so every later press, by anyone, answers
 * that one rather than running it again (`../models/reply-buttons.ts`). The
 * row goes with the agent that made it; the presser's account and the agent
 * a press reached may go first, and leave the press standing with neither
 * named, its landing kept apart from them so it still never runs again.
 */
export const replyButtonTable = pgTable(
  "reply_button",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The agent whose reply holds the button; its task and workspace are the button's. */
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agentTable.id, { onDelete: "cascade" }),
    /** The words the button draws. */
    label: text("label").notNull(),
    /** What a press does, as the agent made it. */
    action: jsonb("action").$type<ReplyButtonAction>().notNull(),
    createdAt: createdAt(),
    /** The member whose press runs it, from the claim on; null until pressed, or once their account is gone. */
    pressedBy: text("pressed_by").references(() => user.id, { onDelete: "set null" }),
    /** When the press that runs it was claimed; null until pressed. */
    pressedAt: timestamptz("pressed_at"),
    /** The one attempt that holds the claim, which alone may release it, so a failed attempt never releases a retry's claim; null until pressed. */
    pressAttempt: uuid("press_attempt"),
    /** When the press landed on the agent it reached; null while it runs or never ran. Kept whatever goes later, so a landed press never runs again. */
    landedAt: timestamptz("landed_at"),
    /** The agent the press started or sent to, once it landed; null while the press runs, or once that agent is gone. */
    reachedAgentId: uuid("reached_agent_id").references(() => agentTable.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    // An agent's buttons leave with it, and are read by it.
    index("reply_button_agent").on(table.agentId),
  ],
);
