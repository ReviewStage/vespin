/**
 * local-rows.ts -- the account's kept reads in its local database: each answer's rows, held keys, and cursor written in one transaction, and read back as a kept read first stands.
 *
 * This is the pool's `RowsStore`, kept as Linear's sync engine writes each
 * delta packet to its database before it updates memory: a kept read's
 * answer upserts the rows that moved into `row`, replaces the keys the read
 * holds in `held`, in the order it holds them, and replaces its `cursor`,
 * all in one transaction. An answer that moved only some rows names only the
 * keys it took up, held after every key held already, and those it let go,
 * so its write is as large as the change rather than the read. A key the read let go, as its `deleted` names it
 * or as its held keys leave it out, deletes its row in the same transaction
 * only where no other read's `held` still names it, so a row two reads hold
 * outlives one of them letting it go. Rows leave only on an answer, never
 * as a read's scope closes, and a workspace left is not cleaned up: its
 * lists sit unread until a sign-out deletes the database.
 *
 * The cursor is opaque to the pool, the read's cursor and its answer's
 * other fields together, so it is kept as one JSON value, none where the
 * read answered none. A read with no workspace is kept under the empty
 * one.
 *
 * The pool runs on without its store, so a failed write is logged and
 * left, and a failed load answers none, so the read waits on the service.
 */

import type { KeptAnswer, KeptLoad, KeptName, RowsStore } from "@repo/sync";
import { Effect, Schema } from "effect";
import type { LocalDatabaseConnection } from "./local-database.js";

/** The workspace a read that names none is kept under. */
const NO_WORKSPACE = "";

/** A `held` row as a write compares it. */
const heldRowSchema = Schema.Struct({ key: Schema.String, position: Schema.Number });

/** The last place a read holds a key at, none where it holds none. */
const lastPositionSchema = Schema.Struct({ last: Schema.NullOr(Schema.Number) });

/** A `row` row's JSON, as a load reads it in held order. */
const loadedRowSchema = Schema.Struct({ row: Schema.fromJsonString(Schema.Unknown) });

/** A `cursor` row's JSON, none where the read answered none. */
const cursorRowSchema = Schema.Struct({
  cursor: Schema.NullOr(Schema.fromJsonString(Schema.Unknown)),
});

const decodeHeldRows = Schema.decodeUnknownSync(Schema.Array(heldRowSchema));
const decodeLastPosition = Schema.decodeUnknownSync(Schema.Array(lastPositionSchema));
const decodeLoadedRows = Schema.decodeUnknownSync(Schema.Array(loadedRowSchema));
const decodeCursorRows = Schema.decodeUnknownSync(Schema.Array(cursorRowSchema));

/** Runs `step` inside one immediate transaction, rolled back where it throws. */
function inTransaction(connection: LocalDatabaseConnection, step: () => void): void {
  connection.exec("BEGIN IMMEDIATE;");

  try {
    step();
    connection.exec("COMMIT;");
  } catch (cause) {
    connection.exec("ROLLBACK;");
    throw cause;
  }
}

/** The statements an answer's write runs. */
type Statements = ReturnType<typeof statementsOf>;

/** The statements an answer's write runs, prepared on `connection`. */
function statementsOf(connection: LocalDatabaseConnection) {
  return {
    heldGone: connection.prepare("DELETE FROM held WHERE read = ? AND workspace = ? AND key = ?"),
    heldKept: connection.prepare(
      "INSERT OR REPLACE INTO held (read, workspace, kind, key, position) VALUES (?, ?, ?, ?, ?)",
    ),
    rowKept: connection.prepare("INSERT OR REPLACE INTO row (kind, key, row) VALUES (?, ?, ?)"),
    rowGone: connection.prepare(
      "DELETE FROM row WHERE kind = ? AND key = ? AND NOT EXISTS (SELECT 1 FROM held WHERE kind = ? AND key = ?)",
    ),
  };
}

/** Writes `held`, every key `answer`'s read holds in order, over what `connection` holds of it, answering the keys it no longer holds. */
function everyHeldWritten(
  connection: LocalDatabaseConnection,
  { heldGone, heldKept }: Statements,
  answer: KeptAnswer,
  held: readonly string[],
): readonly string[] {
  const workspace = answer.workspace ?? NO_WORKSPACE;

  const stored = new Map(
    decodeHeldRows(
      connection
        .prepare("SELECT key, position FROM held WHERE read = ? AND workspace = ?")
        .all(answer.read, workspace),
    ).map(({ key, position }) => [key, position]),
  );

  const now = new Map(held.map((key, position) => [key, position]));

  for (const key of stored.keys()) if (!now.has(key)) heldGone.run(answer.read, workspace, key);

  for (const [key, position] of now)
    if (stored.get(key) !== position)
      heldKept.run(answer.read, workspace, answer.kind, key, position);

  return [...stored.keys()].filter((key) => !now.has(key));
}

/** Writes `appended` after every key `answer`'s read holds on `connection`, and lets go each key its answer deleted, answering those. */
function appendedWritten(
  connection: LocalDatabaseConnection,
  { heldGone, heldKept }: Statements,
  answer: KeptAnswer,
  appended: readonly string[],
): readonly string[] {
  const workspace = answer.workspace ?? NO_WORKSPACE;

  for (const key of answer.deleted) heldGone.run(answer.read, workspace, key);

  const [stood] = decodeLastPosition(
    connection
      .prepare("SELECT MAX(position) AS last FROM held WHERE read = ? AND workspace = ?")
      .all(answer.read, workspace),
  );

  const after = (stood?.last ?? -1) + 1;

  for (const [at, key] of appended.entries()) {
    heldKept.run(answer.read, workspace, answer.kind, key, after + at);
  }

  return answer.deleted;
}

/** Writes `answer` to `connection` in one transaction: its rows, its held keys in order, the rows no read holds any more, and its cursor. */
function written(connection: LocalDatabaseConnection, answer: KeptAnswer): void {
  const workspace = answer.workspace ?? NO_WORKSPACE;
  // Note that the cursor's JSON is made before the transaction opens, because a value JSON cannot hold throws here and should leave nothing half written.
  const cursor = answer.cursor === undefined ? null : JSON.stringify(answer.cursor);
  const { held } = answer;

  inTransaction(connection, () => {
    const statements = statementsOf(connection);
    const { rowKept, rowGone } = statements;

    const left =
      "every" in held
        ? everyHeldWritten(connection, statements, answer, held.every)
        : appendedWritten(connection, statements, answer, held.appended);

    for (const { key, row } of answer.upserted) rowKept.run(answer.kind, key, JSON.stringify(row));

    // Note that a key let go deletes its row only once no read holds it, because another read on the kind may stand on it still.
    for (const key of new Set([...answer.deleted, ...left])) {
      rowGone.run(answer.kind, key, answer.kind, key);
    }

    connection
      .prepare("INSERT OR REPLACE INTO cursor (read, workspace, cursor) VALUES (?, ?, ?)")
      .run(answer.read, workspace, cursor);
  });
}

/** What `connection` holds of `name`: its rows in held order and its cursor; none where it never answered. */
function loadedFrom(connection: LocalDatabaseConnection, name: KeptName): KeptLoad | undefined {
  const workspace = name.workspace ?? NO_WORKSPACE;

  const [stored] = decodeCursorRows(
    connection
      .prepare("SELECT cursor FROM cursor WHERE read = ? AND workspace = ?")
      .all(name.read, workspace),
  );

  if (stored === undefined) return undefined;

  const rows = decodeLoadedRows(
    connection
      .prepare(
        "SELECT row.row AS row FROM held JOIN row ON row.kind = held.kind AND row.key = held.key WHERE held.read = ? AND held.workspace = ? ORDER BY held.position",
      )
      .all(name.read, workspace),
  ).map(({ row }) => row);

  return { rows, cursor: stored.cursor ?? undefined };
}

/** The pool's rows store over the account's open database. */
export function localRows(connection: LocalDatabaseConnection): RowsStore {
  return {
    answered: (answer) =>
      Effect.try(() => written(connection, answer)).pipe(
        Effect.catch((failure) =>
          Effect.logWarning(`the local rows of ${answer.read} were not written: ${failure._tag}`),
        ),
      ),
    loaded: (name) =>
      Effect.try(() => loadedFrom(connection, name)).pipe(
        Effect.catch((failure) =>
          Effect.as(
            Effect.logWarning(`the local rows of ${name.read} were not loaded: ${failure._tag}`),
            undefined,
          ),
        ),
      ),
  };
}
