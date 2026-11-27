/**
 * inbox-older.ts -- one page of the account's settled inbox items older than the items read carries, bound (`INBOX_OLDER_READ`): its statements, the cursor it reads past, and the page after it.
 *
 * Its statements are the inbox store's own (`accountOlderItemsPageStatements`),
 * so a page answers each item in the rows the items read does
 * (`./inbox-items.ts`), on the same rule of who reads it.
 */

import { TOPIC } from "@repo/database/sync/notification";
import { INBOX_OLDER_READ } from "@repo/features/inbox-live";
import { ACCOUNT_INBOX_ITEMS } from "@repo/features/live-wire";
import { Clock, Effect, Option, Schema } from "effect";
import { TASKLESS_LIVE, tasklessLiveParam } from "../../agents/taskless-reads.js";
import { HOSTED_REFUSAL, hostedStoreOrUnavailable } from "../../http/http-effect.js";
import {
  type AccountItemsReader,
  accountOlderItemsPageEnd,
  accountOlderItemsPageStatements,
  type OlderItemsPast,
} from "../../inbox/inbox-store.js";
import { instantParam } from "../../sync/live-param.js";
import { bindLiveRead } from "../live-read-binding.js";
import { SCOPE_INBOX_READS } from "./scope-inbox.js";

/** Where a page ends, as a reader carries it: its JSON, as base64url, so it reads as one opaque word in a query. */
const PastWord = Schema.StringFromBase64Url.pipe(
  Schema.decodeTo(
    Schema.fromJsonString(
      Schema.Struct({
        updatedAt: Schema.String,
        id: Schema.String.check(Schema.isUUID()),
      }),
    ),
  ),
);

const decodePast = Schema.decodeUnknownOption(PastWord);

const encodePast = Schema.encodeSync(PastWord);

/** The page a reader names in `before`, read: none where it names none, and none of any shape where it does not read as one, which the read refuses. */
function pastOf(before: string): Option.Option<OlderItemsPast | undefined> {
  return before === "" ? Option.some(undefined) : decodePast(before);
}

/** Whose items the read carries, as its params bind them (`AccountItemsReader`). */
function readerOf(params: {
  readonly userId: string;
  readonly settledSince: string;
  readonly taskless: string;
}): AccountItemsReader {
  return {
    userId: params.userId,
    settledSince: instantParam(params.settledSince),
    taskless: params.taskless === TASKLESS_LIVE.CARRIED,
  };
}

/**
 * One page of the account's settled items its items read leaves out, past
 * the page the reader names, each whole. It binds the instant the items
 * read carries settled items since from the clock as that read does, so
 * the two stand apart at one instant, and answers it beside the rows with
 * the page after this one, read by a statement of its own over the same
 * items. Note that the two need no snapshot in common: an item that moved
 * between them moved into the items read's window, so the page leaves it
 * out, and at worst the next page reads again an item this one read. It is
 * read once and never followed, so it wakes on the account's topic as the
 * items read does. A `before` the service did not answer is refused.
 */
export const inboxOlderRead = bindLiveRead(INBOX_OLDER_READ, {
  reads: SCOPE_INBOX_READS,
  topics: ({ userId }) => [[TOPIC.ACCOUNT, userId]],
  statements: (params) =>
    accountOlderItemsPageStatements(readerOf(params), Option.getOrUndefined(pastOf(params.before))),
  serve: (_params, _query, request) =>
    Effect.map(Clock.currentTimeMillis, (now) => ({
      settledSince: String(now - ACCOUNT_INBOX_ITEMS.SETTLED_WINDOW_MILLIS),
      taskless: tasklessLiveParam(request),
    })),
  admit: ({ before }) =>
    Option.isSome(pastOf(before)) ? Effect.void : Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST),
  beside: ({ params }) =>
    Effect.map(
      hostedStoreOrUnavailable(
        accountOlderItemsPageEnd(readerOf(params), Option.getOrUndefined(pastOf(params.before))),
      ),
      (end) => {
        const settledSince = instantParam(params.settledSince).getTime();

        return end === undefined ? { settledSince } : { next: encodePast(end), settledSince };
      },
    ),
});
