/**
 * conversation-picture-budget.ts -- a conversation's picture budget filled by rows that stand in for pictures, for a test of what it refuses once full.
 */

import { CONVERSATION_PICTURE_BOUNDS } from "@repo/features/conversation-picture-wire";
import { INBOX_IMAGE_TYPE } from "@repo/features/inbox-wire";
import { Effect } from "effect";
import { Database, type QueryError } from "../core/query.js";
import type { ConversationTarget } from "../models/writer.js";
import { attachment } from "../schemas/attachment.js";

/**
 * Keeps rows in the conversation counting `byteCount` bytes between them,
 * each within a picture's own bound, as the pictures a full transcript kept
 * would. Note that each row's bytes are one byte, because the budget is read
 * off the rows' counts and two hundred megabytes of real bytes would only
 * slow a test.
 */
export function fillConversationPictures(
  target: ConversationTarget,
  byteCount: number,
): Effect.Effect<void, QueryError, Database> {
  const most = CONVERSATION_PICTURE_BOUNDS.MAX_BYTES;
  const rows = Math.ceil(byteCount / most);

  return Effect.asVoid(
    Database.use((db) =>
      db.insert(attachment).values(
        Array.from({ length: rows }, (_, index) => ({
          userId: target.userId,
          conversationId: target.conversationId,
          sha256: index.toString(16).padStart(64, "f"),
          contentType: INBOX_IMAGE_TYPE.PNG,
          width: 1,
          height: 1,
          byteCount: Math.min(most, byteCount - index * most),
          bytes: new Uint8Array([0]),
          createdAt: new Date(),
        })),
      ),
    ),
  );
}
