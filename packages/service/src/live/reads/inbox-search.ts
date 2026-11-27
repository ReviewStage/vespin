/**
 * inbox-search.ts -- the inbox items a search finds bound (`INBOX_SEARCH_READ`): the items it finds, read once as it is asked, their statements and their holders', the tables they read, the topic that wakes it, who it carries items on no task to, and the queries it refuses.
 *
 * Its statements are the inbox store's own (`inboxSearchStatements`), the
 * account's inbox items' rows narrowed to the items found, beside the task
 * list's rows of their holders (`inboxHoldersStatements`).
 */

import { liveKeysBound } from "@repo/database/core/live-statement";
import { queryBuilder } from "@repo/database/core/query";
import { inboxItem } from "@repo/database/schemas/inbox";
import { TOPIC } from "@repo/database/sync/notification";
import { INBOX_SEARCH_QUERY_MAX_CHARS, INBOX_SEARCH_READ } from "@repo/features/inbox-live";
import { Effect, Option, Schema } from "effect";
import { TASKLESS_LIVE, tasklessLiveParam } from "../../agents/taskless-reads.js";
import { HOSTED_REFUSAL, hostedStoreOrUnavailable } from "../../http/http-effect.js";
import { findInboxSearchHits, inboxSearchStatements } from "../../inbox/inbox-store.js";
import { bindLiveRead } from "../live-read-binding.js";
import { SCOPE_INBOX_READS } from "./scope-inbox.js";
import { inboxHoldersStatements, TASK_LIST_TABLES } from "./tasks.js";

/** The ids of the items found, as the read binds them for its statements: a param is text. */
const FoundSchema = Schema.fromJsonString(Schema.Array(Schema.String));

/**
 * An Inbox search, read once, as a client searches, and woken, were it
 * held, on the account's topic, as the account's inbox items are
 * (`inboxItemsRead`). The items it answers are found once, as it is asked
 * (`findInboxSearchHits`), and bound as `found`, so the match, a scan of the
 * reader's items' threads, runs once rather than in each part's statement;
 * each part reads the items found again on its own rule of who may read
 * them. The items on no task it carries only to a build that reads them
 * (`tasklessLiveParam`), which it binds from the headers the build names
 * itself in. A query longer than `INBOX_SEARCH_QUERY_MAX_CHARS` is refused
 * as an invalid request, its words named nowhere.
 */
export const inboxSearchRead = bindLiveRead(INBOX_SEARCH_READ, {
  reads: [...SCOPE_INBOX_READS, ...TASK_LIST_TABLES],
  topics: ({ userId }) => [[TOPIC.ACCOUNT, userId]],
  statements: ({ userId, taskless, found }) => {
    const ids = Option.getOrElse(Schema.decodeUnknownOption(FoundSchema)(found), () => []);

    const items = queryBuilder
      .select({ id: inboxItem.id })
      .from(inboxItem)
      .where(liveKeysBound(inboxItem.id, ids));

    return {
      ...inboxSearchStatements(userId, ids),
      ...inboxHoldersStatements(userId, items.getSQL(), taskless === TASKLESS_LIVE.CARRIED),
    };
  },
  serve: Effect.fnUntraced(function* ({ userId, query }, _query, request) {
    const taskless = tasklessLiveParam(request);

    const found = yield* hostedStoreOrUnavailable(
      findInboxSearchHits({ userId, taskless: taskless === TASKLESS_LIVE.CARRIED }, query),
    );

    return { taskless, found: Schema.encodeSync(FoundSchema)(found) };
  }),
  admit: ({ query }) =>
    query.length > INBOX_SEARCH_QUERY_MAX_CHARS
      ? Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST)
      : Effect.void,
});
