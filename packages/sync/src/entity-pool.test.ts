import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber, Schema, Scope } from "effect";
import {
  anyWrite,
  type EntityPool,
  entityPool,
  type FieldChange,
  fieldKind,
  type HeldRows,
  type KeptAnswer,
  type KeptLoad,
  type KeptRead,
  type PoolStore,
  type WriteDeclaration,
} from "./entity-pool.js";

/**
 * The pool: a row lives once however many reads hold it, and leaves once
 * the last lets it go; and a write stands over the rows without holding back
 * what the reads answer meanwhile. Synthetic rows.
 */

interface Row {
  readonly id: string;
  readonly name: string;
  readonly runs: number;
}

const ROW = fieldKind((row: Row) => row.id);

const settled = Effect.repeat(Effect.yieldNow, { times: 20 });

/** A read stood on the pool in a scope of its own, which the test closes to let it go, counting how often the pool draws it again; one that `adopts` shows every row a write makes. */
function standing(pool: EntityPool, adopts = false) {
  return Effect.gen(function* () {
    const scope = yield* Scope.make();
    const drawn = { times: 0 };

    const rows: HeldRows<Row> = yield* Scope.provide(scope)(
      pool.stand(ROW, {
        redraw: () =>
          Effect.sync(() => {
            drawn.times += 1;
          }),
        confirmation: () => undefined,
        ...(adopts ? { adopts: () => true } : undefined),
      }),
    );

    return { rows, drawn, letGo: Scope.close(scope, Exit.void) };
  });
}

/** A write that makes `row` and stands until the service answers, which it never does. */
const MAKES: WriteDeclaration<Row, FieldChange<Row>, Row, void> = {
  kind: ROW,
  keys: (row) => [row.id],
  change: (row) => ({ made: row }),
  send: () => Effect.never,
};

/** What a read that adopts shows of `row`'s key while a write making it stands: the pool's own row where it still holds one, else the one made. */
function shownOver(pool: EntityPool, row: Row) {
  return Effect.gen(function* () {
    const probe = yield* standing(pool, true);
    const write = yield* Effect.forkChild(pool.write(MAKES, row));
    yield* settled;
    const shown = probe.rows.rows();
    yield* Fiber.interrupt(write);
    yield* probe.letGo;

    return shown;
  });
}

it.effect(
  "a read that adopts and stands after a write laid back from the store shows what it made, and none of a write asked before it stood",
  () =>
    Effect.gen(function* () {
      const make: WriteDeclaration<Row, FieldChange<Row>, Row, string> = {
        kind: ROW,
        keys: (row) => [row.id],
        change: (row) => ({ made: row }),
        send: () => Effect.succeed({ refused: "unreachable", unanswered: true as const }),
        queue: {
          name: "make",
          input: Schema.Struct({ id: Schema.String, name: Schema.String, runs: Schema.Number }),
          queued: () => "waits",
        },
      };

      const pool = yield* entityPool({ mintKey: () => "key-1", replayRefused: Effect.void });
      const laid = { id: "1", name: "Made offline", runs: 0 };
      yield* pool.requeue([{ name: "make", key: "key-0", input: laid }], [anyWrite(make)]);

      const asked = yield* Effect.forkChild(
        pool.write(MAKES, { id: "2", name: "Made now", runs: 0 }),
      );

      yield* settled;

      const late = yield* standing(pool, true);

      assert.deepEqual(late.rows.rows(), [laid]);
      yield* Fiber.interrupt(asked);
    }).pipe(Effect.scoped),
);

it.effect("two reads hold one row, which leaves the pool only once the last lets it go", () =>
  Effect.gen(function* () {
    const pool = yield* entityPool();
    const feed = yield* standing(pool);
    const inbox = yield* standing(pool);
    yield* feed.rows.answer([{ id: "1", name: "Triage", runs: 0 }]);
    yield* inbox.rows.answer([{ id: "1", name: "Triage", runs: 0 }]);

    yield* feed.rows.answer([{ id: "1", name: "Triage issues", runs: 1 }]);

    assert.deepEqual(inbox.rows.rows(), [{ id: "1", name: "Triage issues", runs: 1 }]);
    assert.equal(inbox.drawn.times, 1, "the other read is drawn again");

    yield* feed.letGo;
    const made = { id: "1", name: "Made", runs: 0 };
    assert.deepEqual(yield* shownOver(pool, made), [{ id: "1", name: "Triage issues", runs: 1 }]);

    yield* inbox.letGo;
    assert.deepEqual(
      yield* shownOver(pool, made),
      [made],
      "nothing of a row every read let go is left",
    );
  }).pipe(Effect.scoped),
);

it.effect(
  "an answer of only what moved keeps every row the read held, takes up its own, and lets go those it names gone, but one another read holds",
  () =>
    Effect.gen(function* () {
      const pool = yield* entityPool();
      const feed = yield* standing(pool);
      const inbox = yield* standing(pool);
      const triage = { id: "1", name: "Triage", runs: 0 };
      const billing = { id: "2", name: "Billing", runs: 0 };
      const invites = { id: "3", name: "Invites", runs: 0 };
      const exports = { id: "4", name: "Exports", runs: 0 };
      yield* feed.rows.answer([triage, billing, exports]);
      yield* inbox.rows.answer([billing]);

      const moved = yield* feed.rows.answer([invites], { gone: ["1", "2"] });

      assert.deepEqual(moved.toSorted(), ["1", "2", "3"]);
      assert.deepEqual(feed.rows.rows(), [exports, invites]);
      assert.deepEqual(inbox.rows.rows(), [billing], "a row another read holds stays");

      const made = { id: "1", name: "Made", runs: 0 };
      assert.deepEqual(yield* shownOver(pool, made), [made], "nothing of the row let go is left");
    }).pipe(Effect.scoped),
);

it.effect(
  "an answer lands while a write stands, and the write is drawn over the newer row it brings",
  () =>
    Effect.gen(function* () {
      const pool = yield* entityPool();
      const list = yield* standing(pool);
      yield* list.rows.answer([
        { id: "1", name: "Triage", runs: 0 },
        { id: "2", name: "Deploy", runs: 0 },
      ]);
      const answered = yield* Deferred.make<void>();

      const rename: WriteDeclaration<Row, FieldChange<Row>, string, string> = {
        kind: ROW,
        keys: () => ["1"],
        change: (name) => () => ({ name }),
        send: () => Effect.as(Deferred.await(answered), { answer: "renamed", txid: undefined }),
      };

      const write = yield* Effect.forkChild(pool.write(rename, "Triage issues"));
      yield* settled;
      assert.deepEqual(list.rows.rows()[0], { id: "1", name: "Triage issues", runs: 0 });

      yield* list.rows.answer([
        { id: "1", name: "Triage", runs: 3 },
        { id: "2", name: "Deploy to production", runs: 0 },
      ]);

      assert.deepEqual(list.rows.rows(), [
        { id: "1", name: "Triage issues", runs: 3 },
        { id: "2", name: "Deploy to production", runs: 0 },
      ]);
      yield* Deferred.succeed(answered, undefined);
      assert.equal(yield* Fiber.join(write), "renamed");
    }).pipe(Effect.scoped),
);

it.effect("an answer read at an older sync id never replaces a row taken at a newer one", () =>
  Effect.gen(function* () {
    const pool = yield* entityPool();
    const feed = yield* standing(pool);
    const inbox = yield* standing(pool);

    yield* feed.rows.answer([{ id: "1", name: "Triage issues", runs: 2 }], { at: 20n });
    yield* inbox.rows.answer([{ id: "1", name: "Triage", runs: 1 }], { at: 10n });

    assert.deepEqual(inbox.rows.rows(), [{ id: "1", name: "Triage issues", runs: 2 }]);
  }).pipe(Effect.scoped),
);

it.effect(
  "a write that may wait stands while the service answers nothing, is kept, and lands once sent again under its key",
  () =>
    Effect.gen(function* () {
      const reachable = { now: false };
      const sentUnder: (string | undefined)[] = [];

      const rename: WriteDeclaration<Row, FieldChange<Row>, string, string> = {
        kind: ROW,
        keys: () => ["1"],
        change: (name) => () => ({ name }),
        send: (_name, { key }) =>
          Effect.sync(() => {
            sentUnder.push(key);

            return reachable.now
              ? { answer: "renamed", txid: undefined }
              : { refused: "not renamed", unanswered: true as const };
          }),
        queue: { name: "rename", input: Schema.String, queued: () => "waits" },
      };

      const options = { mintKey: () => "key-1", replayRefused: Effect.void };
      const quit = yield* Scope.make();
      const before = yield* Scope.provide(quit)(entityPool(options));
      const list = yield* Scope.provide(quit)(standing(before));
      yield* list.rows.answer([{ id: "1", name: "Triage", runs: 0 }]);

      const answered = yield* before.write(rename, "Triage issues");
      const kept = before.queued();
      yield* Scope.close(quit, Exit.void);
      const after = yield* entityPool(options);
      const relaunched = yield* standing(after);
      yield* relaunched.rows.answer([{ id: "1", name: "Triage", runs: 0 }]);
      yield* after.requeue(kept, [anyWrite(rename)]);
      const drawn = relaunched.rows.rows();
      reachable.now = true;
      yield* after.resend;
      yield* settled;

      assert.equal(answered, "waits");
      assert.deepEqual(kept, [{ name: "rename", key: "key-1", input: "Triage issues" }]);
      assert.deepEqual(drawn, [{ id: "1", name: "Triage issues", runs: 0 }]);
      assert.deepEqual(
        sentUnder,
        ["key-1", "key-1"],
        "sent once more, under the key it was kept with",
      );
      assert.deepEqual(after.queued(), []);
    }).pipe(Effect.scoped),
);

it.effect(
  "a write that may wait asked while others wait is drawn and answered at once, never held behind the network",
  () =>
    Effect.gen(function* () {
      const network = yield* Deferred.make<void>();
      const reachable = { now: false };

      const rename: WriteDeclaration<Row, FieldChange<Row>, string, string> = {
        kind: ROW,
        keys: () => ["1"],
        change: (name) => () => ({ name }),
        send: () =>
          reachable.now
            ? Effect.as(Deferred.await(network), { answer: "renamed", txid: undefined })
            : Effect.succeed({ refused: "not renamed", unanswered: true as const }),
        queue: { name: "rename", input: Schema.String, queued: () => "waits" },
      };

      const pool = yield* entityPool({ mintKey: () => "key", replayRefused: Effect.void });
      const list = yield* standing(pool);
      yield* list.rows.answer([{ id: "1", name: "Triage", runs: 0 }]);
      yield* pool.write(rename, "Triage issues");
      reachable.now = true;

      const answered = yield* pool.write(rename, "Triage bugs");

      assert.equal(answered, "waits");
      assert.deepEqual(list.rows.rows(), [{ id: "1", name: "Triage bugs", runs: 0 }]);
      assert.equal(pool.queued().length, 2, "both wait while the service holds the first");
      yield* Deferred.succeed(network, undefined);
    }).pipe(Effect.scoped),
);

it.effect(
  "a waiting write is never sent as the account the session moved to while a resend round runs",
  () =>
    Effect.gen(function* () {
      const session = { holder: "account-a" };
      const reachable = { now: false };
      const gate = yield* Deferred.make<void>();
      const sentAs: string[] = [];
      const refusedCount = { now: 0 };

      const rename: WriteDeclaration<Row, FieldChange<Row>, string, string> = {
        kind: ROW,
        keys: () => ["1"],
        change: (name) => () => ({ name }),
        send: () => {
          const sent = Effect.sync(() => sentAs.push(session.holder));

          return reachable.now
            ? Effect.andThen(
                sent,
                Effect.as(Deferred.await(gate), { answer: "renamed", txid: undefined }),
              )
            : Effect.andThen(
                sent,
                Effect.succeed({ refused: "not renamed", unanswered: true as const }),
              );
        },
        queue: { name: "rename", input: Schema.String, queued: () => "waits" },
      };

      const pool = yield* entityPool({
        mintKey: () => "key",
        replayRefused: Effect.sync(() => {
          refusedCount.now += 1;
        }),
        holder: () => session.holder,
      });

      const list = yield* standing(pool);
      yield* list.rows.answer([{ id: "1", name: "Triage", runs: 0 }]);
      yield* pool.write(rename, "Triage issues");
      yield* pool.write(rename, "Triage bugs");
      yield* settled;
      reachable.now = true;

      const round = yield* Effect.forkChild(pool.resend);
      yield* settled;
      session.holder = "account-b";
      yield* Deferred.succeed(gate, undefined);
      yield* Fiber.join(round);
      yield* settled;

      assert.ok(!sentAs.includes("account-b"), `sent as ${sentAs.join(", ")}`);
      assert.deepEqual(pool.queued(), []);
      assert.deepEqual(list.rows.rows(), [{ id: "1", name: "Triage issues", runs: 0 }]);
      assert.equal(refusedCount.now, 0, "a write let go is not told as one the service refused");
    }).pipe(Effect.scoped),
);

/**
 * A pool whose store holds `load` for every kept read and records each kept
 * answer, after `before` runs on it, and a kept read stood on it in a scope
 * the test closes.
 */
function keptStanding(
  kept: KeptRead<Row>,
  load?: KeptLoad,
  before: (pool: EntityPool) => Effect.Effect<unknown> = () => Effect.void,
) {
  return Effect.gen(function* () {
    const told: KeptAnswer[] = [];

    const pool = yield* entityPool({
      mintKey: () => "key",
      replayRefused: Effect.void,
      store: {
        rows: {
          answered: (answer) => Effect.sync(() => void told.push(answer)),
          loaded: () => Effect.succeed(load),
        },
      },
    });

    yield* before(pool);
    const scope = yield* Scope.make();

    const rows = yield* Scope.provide(scope)(
      pool.stand(ROW, { redraw: () => Effect.void, confirmation: () => undefined, kept }),
    );

    return { pool, rows, told, letGo: Scope.close(scope, Exit.void) };
  });
}

it.effect(
  "a kept read hands the store the synced rows that moved and the keys it holds, past a whole answer only the keys that moved since, another read's among them, and nothing as it closes",
  () =>
    Effect.gen(function* () {
      const { pool, rows, told, letGo } = yield* keptStanding({
        name: "feed",
        kind: "row",
        workspace: "w",
      });

      const triage = { id: "1", name: "Triage", runs: 0 };
      const deploy = { id: "2", name: "Deploy", runs: 0 };
      yield* rows.answer([triage, deploy], { cursor: { syncId: 1 } });

      // Note that a write standing over a row never reaches the store; only the service's next answer does.
      const rename = yield* Effect.forkChild(
        pool.write({ ...MAKES, change: () => () => ({ name: "Renamed" }) }, deploy),
      );

      yield* settled;
      const ship = { id: "3", name: "Ship", runs: 0 };
      yield* rows.answer([{ ...deploy, runs: 1 }, ship], { cursor: { syncId: 2 } });
      yield* Fiber.interrupt(rename);

      // Past a sync id, Deploy goes and Launch comes; then another read answers Ship moved, which the kept read's next answer hands on though it names no row.
      const launch = { id: "4", name: "Launch", runs: 0 };

      yield* rows.answer([{ ...ship, runs: 1 }, launch], {
        gone: ["2"],
        cursor: { syncId: 3 },
      });

      const other = yield* pool.stand(ROW, {
        redraw: () => Effect.void,
        confirmation: () => undefined,
      });

      yield* other.answer([{ ...ship, runs: 2 }]);
      yield* rows.answer([], { gone: [], cursor: { syncId: 4 } });
      yield* letGo;

      assert.deepEqual(told, [
        {
          read: "feed",
          kind: "row",
          workspace: "w",
          upserted: [
            { key: "1", row: triage },
            { key: "2", row: deploy },
          ],
          deleted: [],
          held: { every: ["1", "2"] },
          cursor: { syncId: 1 },
        },
        {
          read: "feed",
          kind: "row",
          workspace: "w",
          upserted: [
            { key: "2", row: { ...deploy, runs: 1 } },
            { key: "3", row: ship },
          ],
          deleted: ["1"],
          held: { every: ["2", "3"] },
          cursor: { syncId: 2 },
        },
        {
          read: "feed",
          kind: "row",
          workspace: "w",
          upserted: [
            { key: "3", row: { ...ship, runs: 1 } },
            { key: "4", row: launch },
          ],
          deleted: ["2"],
          held: { appended: ["4"] },
          cursor: { syncId: 3 },
        },
        {
          read: "feed",
          kind: "row",
          workspace: "w",
          upserted: [{ key: "3", row: { ...ship, runs: 2 } }],
          deleted: [],
          held: { appended: [] },
          cursor: { syncId: 4 },
        },
      ]);
    }),
);

it.effect(
  "a bounded kept read hands the store only its first rows that fit, and its cursor whole once it leaves one out",
  () =>
    Effect.gen(function* () {
      const { rows, told } = yield* keptStanding({
        name: "inbox",
        kind: "row",
        bound: { size: (row) => row.name.length, within: 10 },
      });

      const triage = { id: "1", name: "Triage", runs: 0 };
      const ship = { id: "2", name: "Ship", runs: 0 };
      yield* rows.answer([triage, ship], { cursor: "c1" });
      yield* rows.answer([triage, ship, { id: "3", name: "Deploy", runs: 0 }], { cursor: "c2" });

      assert.deepEqual(
        told.map(({ upserted, held, cursor }) => ({ upserted, held, cursor })),
        [
          {
            upserted: [
              { key: "1", row: triage },
              { key: "2", row: ship },
            ],
            held: { every: ["1", "2"] },
            cursor: "c1",
          },
          { upserted: [], held: { every: ["1", "2"] }, cursor: "c2" },
        ],
      );
    }),
);

/** How the service answers each send in turn, and what the pool is asked after the first. */
const OUTBOX_CASES = [
  { stands: "settles as the service takes it at once", answers: ["took"], after: "nothing" },
  { stands: "settles once sent again", answers: ["silent", "took"], after: "resend" },
  { stands: "is refused once sent again", answers: ["silent", "refused"], after: "resend" },
  { stands: "is let go", answers: ["silent"], after: "letGoQueued" },
] as const;

it.effect.each(OUTBOX_CASES)(
  "a write that may wait reaches the store before it is sent, and leaves it as it $stands",
  ({ answers, after }) =>
    Effect.gen(function* () {
      const told: string[] = [];
      const left = [...answers];

      const rename: WriteDeclaration<Row, FieldChange<Row>, string, string> = {
        kind: ROW,
        keys: () => ["1"],
        change: (name) => () => ({ name }),
        send: () =>
          Effect.sync(() => {
            const answer = left.shift();

            told.push(`sent ${answer}`);

            if (answer === "took") return { answer: "renamed", txid: undefined };

            if (answer === "refused") return { refused: "not renamed" };

            return { refused: "not renamed", unanswered: true as const };
          }),
        queue: { name: "rename", input: Schema.String, queued: () => "waits" },
      };

      const store: PoolStore = {
        outbox: {
          added: (entry) =>
            Effect.sync(() => told.push(`added ${entry.key} ${String(entry.input)}`)),
          removed: (entry) => Effect.sync(() => told.push(`removed ${entry.key}`)),
        },
      };

      const pool = yield* entityPool({ mintKey: () => "key-1", replayRefused: Effect.void, store });
      const list = yield* standing(pool);
      yield* list.rows.answer([{ id: "1", name: "Triage", runs: 0 }]);
      yield* pool.write(rename, "Triage issues");

      if (after === "resend") yield* pool.resend;

      if (after === "letGoQueued") yield* pool.letGoQueued;

      yield* settled;

      assert.deepEqual(told, [
        "added key-1 Triage issues",
        ...answers.map((answer) => `sent ${answer}`),
        "removed key-1",
      ]);
    }).pipe(Effect.scoped),
);

it.effect(
  "a kept read draws what the store held at once, under the writes standing, until the service's first answer replaces it",
  () =>
    Effect.gen(function* () {
      const triage = { id: "1", name: "Triage", runs: 0 };
      const deploy = { id: "2", name: "Deploy", runs: 0 };

      const { rows, told } = yield* keptStanding(
        { name: "feed", kind: "row" },
        { rows: [triage, deploy], cursor: { syncId: 7 } },
        (pool) =>
          Effect.gen(function* () {
            yield* Effect.forkChild(
              pool.write({ ...MAKES, change: () => () => ({ name: "Renamed" }) }, deploy),
            );
            yield* settled;
          }),
      );

      assert.deepEqual(rows.rows(), [triage, { ...deploy, name: "Renamed" }]);
      assert.deepEqual(rows.stored, { syncId: 7 });
      assert.equal(rows.loaded, true);
      assert.deepEqual(told, [], "what the store held is not handed back to it");

      const ship = { id: "3", name: "Ship", runs: 0 };
      yield* rows.answer([deploy, ship], { cursor: { syncId: 8 } });

      assert.deepEqual(rows.rows(), [{ ...deploy, name: "Renamed" }, ship]);
      assert.deepEqual(
        told.map(({ upserted, deleted }) => ({ upserted, deleted })),
        [{ upserted: [{ key: "3", row: ship }], deleted: ["1"] }],
        "the store is told only what moved since what it held",
      );
    }).pipe(Effect.scoped),
);

it.effect("a kept read the store holds nothing of stands empty, with no cursor", () =>
  Effect.gen(function* () {
    const { rows } = yield* keptStanding({ name: "feed", kind: "row" });

    assert.deepEqual(rows.rows(), []);
    assert.equal(rows.stored, undefined);
    assert.equal(rows.loaded, false);
  }),
);
