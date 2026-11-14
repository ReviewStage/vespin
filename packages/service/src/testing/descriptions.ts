import { Database } from "@repo/database/core/query";
import { task } from "@repo/database/schemas/task";
import { eq, sql } from "drizzle-orm";

/**
 * descriptions.ts -- a stored description's text and its revisions, as a test sets them.
 *
 * A description starts as one empty text (`docs/TASKS.md`); a test that needs
 * words writes the text, or a revision of the text, straight onto the rows.
 */

/** A synthetic description: a design doc's headings with an answer under each, and the assumptions as a section of the text. */
export const INVITATIONS_TEXT = [
  "## Context",
  "",
  "Only an admin can add someone to a workspace today.",
  "",
  "## Goal",
  "",
  "- Any member can invite a teammate by email.",
  "",
  "## Assumptions",
  "",
  "- An invite expires after 7 days.",
  "",
].join("\n");

/** Makes the description hold `text`. */
export function makeDescriptionTask(taskId: string, text: string) {
  return Database.use((db) =>
    db.update(task).set({ description: text }).where(eq(task.id, taskId)),
  );
}

/**
 * Makes the description hold `text`, saved a minute after it
 * started and before its history began, so its first save records the text
 * as the revision it changed (`earlier`) and its sections read as no one's.
 */
export function makeSavedDescriptionTask(taskId: string, text: string) {
  return Database.use((db) =>
    db
      .update(task)
      .set({ description: text, updatedAt: sql`${task.createdAt} + interval '1 minute'` })
      .where(eq(task.id, taskId)),
  );
}
