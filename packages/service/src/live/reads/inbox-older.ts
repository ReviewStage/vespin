/**
 * inbox-older.ts -- one page of the account's settled inbox items older than the items read carries, bound (`INBOX_OLDER_READ`): its statements, the cursor it reads past, and the page after it.
 *
 * Its statements are the inbox store's own (`accountOlderItemsPageStatements`),
 * so a page answers each item in the rows the items read does
 * (`./inbox-items.ts`), on the same rule of who reads it, beside the task
 * list's own statements for what holds them (`inboxHoldersStatements`).
 */

import { TOPIC } from "@repo/database/sync/notification";
import { INBOX_OLDER_READ } from "@repo/features/inbox-live";
import { ACCOUNT_INBOX_ITEMS } from "@repo/features/live-wire";
import { Clock, Effect, Option, Schema } from "effect";
import { TASKLESS_LIVE, tasklessLiveParam } from "../../agents/taskless-reads.js";
import { HOSTED_REFUSAL, hostedStoreOrUnavailable } from "../../http/http-effect.js";
import {
  type AccountItemsReader,
  accountOlderItemsKeyed,
  accountOlderItemsPage,
  accountOlderItemsPageStatements,
  type OlderItemsPast,
} from "../../inbox/inbox-store.js";
import { instantParam } from "../../sync/live-param.js";
import { bindLiveRead } from "../live-read-binding.js";
import { SCOPE_INBOX_READS } from "./scope-inbox.js";
import { inboxHoldersStatements, TASK_LIST_TABLES } from "./tasks.js";

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

/** The page's items' ids as the service binds them, JSON text (`pageKeys`). */
const PageKeys = Schema.fromJsonString(Schema.Array(Schema.String));

const decodeKeysOption = Schema.decodeUnknownOption(PageKeys);

/** The page's items' ids, as `serve` bound them; none where the param spells none, as a statement built before any page was found binds it. */
function keysOf(pageKeys: string): readonly string[] {
  return Option.getOrElse(decodeKeysOption(pageKeys), () => []);
}

const encodeKeys = Schema.encodeSync(PageKeys);

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
 * the page the reader names, each whole beside what holds it. It binds the
 * instant the items read carries settled items since from the clock as
 * that read does, so the two stand apart at one instant, and answers it
 * beside the rows. It finds the page once, as it binds its params, so its
 * items' ids and the page after it are read by one statement and every
 * part reads the page by those ids, each still on its own rule of who
 * reads it. It is read once and never followed, so it wakes on the
 * account's topic as the items read does. A `before` the service did not
 * answer is refused.
 */
export const inboxOlderRead = bindLiveRead(INBOX_OLDER_READ, {
  reads: [...new Set([...SCOPE_INBOX_READS, ...TASK_LIST_TABLES])],
  topics: ({ userId }) => [[TOPIC.ACCOUNT, userId]],
  statements: (params) => {
    const reader = readerOf(params);
    const keys = keysOf(params.pageKeys);

    return {
      ...accountOlderItemsPageStatements(reader, keys),
      ...inboxHoldersStatements(
        reader.userId,
        accountOlderItemsKeyed(reader, keys),
        reader.taskless,
      ),
    };
  },
  serve: ({ userId, before }, _query, request) =>
    Effect.gen(function* () {
      const past = pastOf(before);

      if (Option.isNone(past)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
      const now = yield* Clock.currentTimeMillis;
      const settledSince = String(now - ACCOUNT_INBOX_ITEMS.SETTLED_WINDOW_MILLIS);
      const taskless = tasklessLiveParam(request);

      const page = yield* hostedStoreOrUnavailable(
        accountOlderItemsPage(readerOf({ userId, settledSince, taskless }), past.value),
      );

      return {
        settledSince,
        taskless,
        pageKeys: encodeKeys(page.keys),
        pageNext: page.end === undefined ? "" : encodePast(page.end),
      };
    }),
  beside: ({ params }) => {
    const settledSince = instantParam(params.settledSince).getTime();

    return Effect.succeed(
      params.pageNext === "" ? { settledSince } : { next: params.pageNext, settledSince },
    );
  },
});
