/**
 * inbox-undelivered.ts -- the reader's Inbox replies that did not go, kept where they were sent with Retry, Edit, and Delete, as a chat app keeps a message that did not go, across a reload and a relaunch.
 *
 * What one is, the words it is said in, and which a thread draws are
 * `@repo/features/inbox-undelivered`'s, which the iOS app keeps the same
 * way. Here they are kept in the renderer's storage for the account that
 * sent them (`keptLines`), so a reload or a relaunch draws them again; their
 * files stay in the window that attached them, as a draft's do
 * (`use-task-inbox.ts`).
 */

import {
  type KeptUndelivered,
  keptUndelivered,
  keptUndeliveredSchema,
  type UndeliveredReply,
  undeliveredFromKept,
} from "@repo/features/inbox-undelivered";
import { keptLines } from "../composer-drafts.js";

/** Where the replies that did not go are kept in the renderer's storage. */
const STORAGE_KEY = "app.inboxUndelivered";

/** Every reply that did not go, the account signed in's alone, in the order they failed. */
export const undeliveredReplies = keptLines<UndeliveredReply, KeptUndelivered>({
  key: STORAGE_KEY,
  kept: keptUndeliveredSchema,
  toKept: keptUndelivered,
  fromKept: undeliveredFromKept,
  idOf: (kept) => kept.key,
});
