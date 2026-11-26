/**
 * kept-words.ts -- the words each kept Inbox message says, in a table of their own beside the account's kept collections, which a search reads in SQLite off the JavaScript thread and answers with the threads alone.
 *
 * TanStack's SQLite persistence pushes only a prefix `like` into SQL
 * (`compileSafeSqlPrefilter`), so a substring search over messages would
 * decode every kept message in JS. So the words stand here instead,
 * lowercased as a search
 * lowercases what it reads (`matchesTokens`), one row to a message, in a
 * database file of their own driven through the platform's async API
 * (`KeptWordsDatabase`), and a search answers only which of a thread's
 * messages say each word typed.
 *
 * The follow that answers every message (`account-items-stored.ts`) is the
 * one writer, and the scope follow, whose threads are held in memory
 * alone, never writes here. Nothing commits the words with the messages,
 * so they are derived and rewritten rather than kept in step: a whole
 * answer replaces every row, and each thread an answer past a sync id
 * carries or takes away has its rows rewritten whole, as an aged thread
 * has its taken away. So a write missed as a launch is cut short heals on
 * the next answer for that thread, and a search is only ever read over the
 * rows the thread kind holds, so a row left for a thread gone names
 * nothing a list draws. A sign-out, and so an account switch, deletes the
 * file with the account's folder. Where the database will not open, the
 * words are kept in memory for the launch, as the kinds beside them are.
 */

import { inboxMessageWords } from "@repo/features/inbox-list-model";
import type { InboxItem } from "@repo/features/inbox-wire";

/** The table each message's words stand in, by the message's id. */
const WORDS_SCHEMA = `CREATE TABLE IF NOT EXISTS message_words (
  message_id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  words TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS message_words_thread ON message_words (thread_id)`;

/** How many rows one statement writes or deletes, each batch handed as one JSON value, so a whole answer is a few statements and never one value the size of the account's every message. */
const BATCH = 500;

/** The most words typed a search reads in SQLite, each a bit of what a thread says; a word past them is never found among the messages, so a row answers it only where its title holds it. */
const MOST_TOKENS = 30;

/** A value a statement binds. */
type WordsValue = null | number | string;

/** A value a row answers. */
type WordsCell = null | number | bigint | string | Uint8Array;

/** An open database driven through the platform's async API, whose statements run off the JavaScript thread. */
export interface KeptWordsDatabase {
  readonly exec: (sql: string) => Promise<void>;
  readonly run: (sql: string, params: readonly WordsValue[]) => Promise<void>;
  readonly all: (
    sql: string,
    params: readonly WordsValue[],
  ) => Promise<readonly Readonly<Record<string, WordsCell>>[]>;
  readonly close: () => Promise<void>;
}

/** One message's words as a search reads them, on the thread it stands on. */
export interface MessageWords {
  readonly messageId: string;
  readonly threadId: string;
  /** Every line it says (`inboxMessageWords`), lowercased. */
  readonly words: string;
}

/** The words each kept message says, as the follow writes them and a search reads them. */
export interface KeptWords {
  /** Every message's words there are, in place of those kept. */
  readonly replaced: (rows: readonly MessageWords[]) => Promise<void>;
  /** The words of every message of the threads `threadIds` names rewritten whole as `rows`, those threads' rows kept before deleted. */
  readonly rewritten: (
    threadIds: readonly string[],
    rows: readonly MessageWords[],
  ) => Promise<void>;
  /** Each thread whose kept messages say any of `tokens`, each already lowercased, with those they say; none where none is typed. */
  readonly threadsSaying: (
    tokens: readonly string[],
  ) => Promise<ReadonlyMap<string, readonly string[]>>;
}

/** No thread says what was typed. */
const NONE_SAYING: ReadonlyMap<string, readonly string[]> = new Map();

/** `rows` in batches of `BATCH`. */
function batched<Row>(rows: readonly Row[]): readonly (readonly Row[])[] {
  const batches: Row[][] = [];

  for (let start = 0; start < rows.length; start += BATCH) {
    batches.push(rows.slice(start, start + BATCH));
  }

  return batches;
}

/** Each message of `item`'s thread's words as a search reads them. */
export function messageWordsOf(item: InboxItem): readonly MessageWords[] {
  return (item.thread ?? []).map((message) => ({
    messageId: message.id,
    threadId: item.id,
    words: inboxMessageWords(message).join("\n").toLowerCase(),
  }));
}

/** The words kept in `database`, its table made where it stands not; each call waits on the last, so a search never reads a write half made. */
export async function keptWordsIn(database: KeptWordsDatabase): Promise<KeptWords> {
  await database.exec(WORDS_SCHEMA);
  let queue: Promise<unknown> = Promise.resolve();

  const inTurn = <T>(step: () => Promise<T>): Promise<T> => {
    const next = queue.then(step, step);
    queue = next.catch(() => undefined);

    return next;
  };

  const written = async (rows: readonly MessageWords[]) => {
    for (const batch of batched(rows)) {
      await database.run(
        `INSERT OR REPLACE INTO message_words (message_id, thread_id, words)
         SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]')
         FROM json_each(?)`,
        [JSON.stringify(batch.map((row) => [row.messageId, row.threadId, row.words]))],
      );
    }
  };

  const deleted = async (threadIds: readonly string[]) => {
    for (const batch of batched(threadIds)) {
      await database.run(
        "DELETE FROM message_words WHERE thread_id IN (SELECT value FROM json_each(?))",
        [JSON.stringify(batch)],
      );
    }
  };

  // Note that each step is one transaction, so a launch cut short keeps the words it kept before, never half of an answer's.
  const transaction = (step: () => Promise<void>) =>
    inTurn(async () => {
      await database.exec("BEGIN IMMEDIATE");

      try {
        await step();
        await database.exec("COMMIT");
      } catch (cause) {
        await database.exec("ROLLBACK");
        throw cause;
      }
    });

  return {
    replaced: (rows) =>
      transaction(async () => {
        await database.exec("DELETE FROM message_words");
        await written(rows);
      }),
    rewritten: (threadIds, rows) =>
      transaction(async () => {
        await deleted(threadIds);
        await written(rows);
      }),
    threadsSaying: (typed) => {
      const tokens = typed.slice(0, MOST_TOKENS);

      if (tokens.length === 0) return Promise.resolve(NONE_SAYING);

      // Note that which of the words typed a thread's messages say is one number, a bit to each by its place, so one scan answers every word.
      const bits = tokens
        .map((_, place) => `MAX(instr(words, ?${place + 1}) > 0) * ${2 ** place}`)
        .join(" + ");

      const any = tokens.map((_, place) => `instr(words, ?${place + 1}) > 0`).join(" OR ");

      return inTurn(async () => {
        const rows = await database.all(
          `SELECT thread_id, ${bits} AS said FROM message_words WHERE ${any} GROUP BY thread_id`,
          tokens,
        );

        return new Map(
          rows.map((row) => {
            const said = Number(row.said);

            return [
              String(row.thread_id),
              tokens.filter((_, place) => (said & (2 ** place)) !== 0),
            ];
          }),
        );
      });
    },
  };
}

/** The words kept in memory for a launch whose database will not open, read as the table is. */
export function keptWordsInMemory(): KeptWords {
  const kept = new Map<string, MessageWords>();

  const put = (rows: readonly MessageWords[]) => {
    for (const row of rows) kept.set(row.messageId, row);
  };

  return {
    replaced: async (rows) => {
      kept.clear();
      put(rows);
    },
    rewritten: async (threadIds, rows) => {
      const rewriting = new Set(threadIds);

      for (const [id, row] of kept) if (rewriting.has(row.threadId)) kept.delete(id);
      put(rows);
    },
    threadsSaying: async (tokens) => {
      if (tokens.length === 0) return NONE_SAYING;
      const saying = new Map<string, Set<string>>();

      for (const { threadId, words } of kept.values()) {
        const said = tokens.filter((token) => words.includes(token));

        if (said.length === 0) continue;
        const was = saying.get(threadId) ?? new Set();

        for (const token of said) was.add(token);
        saying.set(threadId, was);
      }

      return new Map([...saying].map(([threadId, said]) => [threadId, [...said]] as const));
    },
  };
}
