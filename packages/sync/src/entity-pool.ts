/**
 * entity-pool.ts -- every row the host's reads hold, once, by kind and key: each read stands on the keys it answered, and a write is drawn over a row once and reaches every read that holds it the moment it is asked.
 *
 * A kind is declared by its client (`RowKind`): a row's key, and how a
 * change of the kind is drawn over a row. The pool keeps each kind's rows in
 * one collection only sync writes (`synced-collection.ts`), made the first
 * time a read stands on the kind or a write names it, for as long as the pool
 * stands. A read stands on a kind for its own scope: each answer upserts its
 * rows and replaces the keys it holds, a key no read holds any longer leaves
 * in the same commit, and every other read holding a row that moved is drawn
 * again. As the read's scope closes its keys are let go, and so is any row no
 * other read holds, so one account's rows never reach the next account's
 * reads.
 *
 * A write (`WriteDeclaration`) names its kind, the keys it changes, the
 * change, and how it is sent. It is laid over the rows the moment it is
 * asked, as the newest of the writes standing, and every read holding one of
 * its keys is drawn again; a read shows each row as the synced one with every
 * write standing on it drawn over it, in the order asked. Note that a write
 * is never a TanStack transaction, because a persisting transaction holds
 * back every answer its collection is synced, so one write would freeze
 * every read of its kind; here an answer lands at once and the writes
 * standing are drawn over it. So a change is drawn again over each row taken
 * while it stands, and must leave a row the service already changed as it
 * is.
 *
 * A write goes to the service once every write to its keys asked before it
 * has been answered, so the service takes them in the order asked. It
 * answers its caller as soon as the service does, and goes on standing until
 * each read holding its keys carries its transaction, through the wait that
 * read hands in (`Confirmation`); where a read hands none, what the service
 * answered is taken in that read's place, and where the service answered no
 * transaction, the write stands until its own wait for its reads settles
 * first, where it hands one (`Written.carried`). Writes to one key stand down in the
 * order asked, so an older one never stands over a newer one the reads
 * already carry. From the service's answer on, a write may stand as what the
 * service said of its rows (`Written.standsAs`), as an inbox item answered
 * with its reply does. A write the service refused is taken back before its
 * caller hears so, on the service's word where it gave one, and the caller
 * says so, as a toast does.
 *
 * A read that keeps rows of another shape stands beside the pool
 * (`PoolRead.beside`): it holds none of the kind's rows, draws the writes
 * standing over its own, and is waited on, drawn again, and handed the
 * service's word as a read of the pool is.
 *
 * A write whose declaration says it may wait (`WriteDeclaration.queue`) is
 * sent under an idempotency key the pool mints for it once and sends on
 * every attempt, each sent from the waiting writes saying so
 * (`Sent.waited`). Where the service did not answer it (`Refused.unanswered`),
 * it goes on standing and waits, its caller answered at once with what the
 * declaration says it hears meanwhile; a write that may wait asked while
 * others wait waits behind them, so the service takes them in the order
 * asked. The waiting writes are sent again one at a time, oldest first, as
 * `resend` asks and each time one is laid behind them, until one is still
 * unanswered; one the service took already under its key
 * (`Written.settled`) stands down at once, and one it refused is taken back
 * and counted (`PoolOptions.replayRefused`). A waiting write is sent again
 * only as the account that asked it (`PoolOptions.holder`): one whose
 * account the session no longer holds is let go, taken back as a sign-out
 * takes it, and never sent. One whose declaration holds its
 * caller (`QueuedWrite.holds`) answers it only once it is sent again, as a
 * start whose outcome its window draws does. At most `QUEUE_BOUND` wait;
 * past them a write unanswered is taken back. They are handed out to be
 * kept (`queued`) and laid back over the rows (`requeue`) in a form of the
 * declaration's own, which names nothing of how they are kept.
 *
 * A pool handed a store (`PoolOptions.store`) reports its outbox to it as
 * Linear's sync engine keeps `__transactions`: a write that may wait is
 * added (`OutboxStore.added`) before it is first sent, and removed
 * (`OutboxStore.removed`) in the same step it stands down from waiting,
 * once the service took it, refused it, it was let go, it was taken back
 * unanswered past `QUEUE_BOUND`, or its caller gave up on its first send, so
 * the store holds what the pool holds. One laid back (`requeue`) came from the
 * store, so it is not added again. A write still waiting as the pool's scope
 * closes is never removed, so a quit leaves it to be laid back.
 *
 * A read may be kept (`PoolRead.kept`), where the pool has a store
 * (`PoolOptions.store`): each time it answers, the store is handed, in one
 * call, the synced rows of it that moved since its last answer, the keys it
 * holds, and its cursor (`KeptAnswer`), cut to its bound where it names one.
 * Past a whole answer, an unbounded read hands it only the keys whose row
 * or holding moved since (`unreported`), in work as large as the change
 * rather than the read. Only the service's rows reach the store, never a
 * write drawn over them, and a kept read's scope closing tells it nothing,
 * so quitting never empties it. As a kept read first stands, it answers
 * from what the store holds of it (`RowsStore.loaded`), before the service
 * answers, as Linear's local bootstrap draws from its database before it
 * catches up: those rows count as synced, writes standing drawn over them,
 * but are never handed back to the store, and a stored row never replaces
 * one the pool already holds. Its stored cursor (`HeldRows.stored`) is what
 * its follow reads past.
 *
 * A kind may be kept on disk whole instead (`RowKind.stored`), where the
 * store has the account's database open (`PoolStore.collections`): its
 * collection is TanStack DB's own persistence, made for that database and
 * closed with it, so no row of one account's reaches the next's, and every
 * sync transaction the pool writes on it is written to disk as it commits.
 * A live query over it loads only the rows it asks for, so the pool holds
 * in memory only the rows answered or loaded since the database opened, and
 * no read's letting go of a row, as its scope closes or its answer leaves it
 * out, removes it: a row kept on disk leaves only on the word of the read
 * that answers every row of the kind the account reaches (`PoolRead.owns`),
 * a whole answer of whose replaces what is kept, every row other reads hold
 * in memory beside it, and an answer of only what moved deletes what it
 * lets go (`gone`). A kept read's cursor on such a kind is written in the
 * same transaction as its rows, as a mark of the collection's
 * (`SyncedCollection.mark`), rather than to the rows store, which hears
 * nothing of it.
 */

import {
  Deferred,
  Effect,
  Equal,
  Exit,
  FiberSet,
  Option,
  Predicate,
  PubSub,
  Result,
  Schema,
  Scope,
  Semaphore,
  Stream,
} from "effect";
import {
  type CollectionMark,
  type KeepCollection,
  type RowCollection,
  rowChanges,
  type SyncedCollection,
  syncedCollection,
} from "./synced-collection.js";

/** What a change leaves of a row it takes out of every read, as a deleted automation is. */
export const ROW_GONE: unique symbol = Symbol("the row is gone");

/** The most writes that wait for the service at once. */
export const QUEUE_BOUND = 200;

/**
 * How a kind's rows are kept on disk where the account's database keeps
 * them: the name its collection is stored under, and its rows' shape
 * version, a move of which clears what was kept at the old one. Both are
 * stored, so each stays as it first shipped until its shape moves.
 */
export interface StoredKind {
  readonly name: string;
  readonly version: number;
}

/** A kind of row, as the client that reads it declares it. */
export interface RowKind<Row extends object, Change> {
  /** The row's key, its entity id. */
  readonly key: (row: Row) => string;
  /** That its rows are kept on disk whole where the store has the account's database open; none keeps them in memory alone. */
  readonly stored?: StoredKind;
  /**
   * The row as `change` leaves it: a row, `ROW_GONE`, or `undefined` to leave
   * it alone; `row` is none where no read has answered the key.
   */
  readonly drawn: (change: Change, row: Row | undefined) => Row | typeof ROW_GONE | undefined;
}

/** A row made, drawn only while no read has answered its key, as a task started is before its list carries it. */
export interface MadeRow<Row> {
  readonly made: Row;
}

/**
 * A change to a row's fields, from the row as it is drawn now, or its
 * deletion, or a row made: the changes a kind of plain rows is written with.
 */
export type FieldChange<Row> = ((row: Row) => Partial<Row> | typeof ROW_GONE) | MadeRow<Row>;

/** Whether `fields` sets any of `row`'s own fields to a value it does not already carry. */
function movesRow<Row extends object>(row: Row, fields: Partial<Row>): boolean {
  for (const name in fields) {
    if (Object.hasOwn(fields, name) && !Equal.equals(row[name], fields[name])) return true;
  }

  return false;
}

/** A kind of plain rows, keyed by `key`, whose every change is a `FieldChange`. */
export function fieldKind<Row extends object>(
  key: (row: Row) => string,
): RowKind<Row, FieldChange<Row>> {
  return {
    key,
    drawn: (change, row) => {
      if (!Predicate.isFunction(change)) return row === undefined ? change.made : undefined;

      if (row === undefined) return undefined;
      const fields = change(row);

      if (fields === ROW_GONE) return ROW_GONE;

      // Note that a change the row already carries leaves it alone, so a reader holds the very row.
      return movesRow(row, fields) ? { ...row, ...fields } : undefined;
    },
  };
}

/** A read's wait for a write's transaction: it settles once the read carries it, or once the read stops waiting, and never fails. */
export type Confirmation = (txid: string) => Effect.Effect<void>;

/**
 * How a read whose rows are kept on disk is named and cut: the read's stable
 * name, the kind's stable name its rows are kept under, the workspace it
 * reads where it reads one, and, where only its first rows are kept, the
 * bound they fit within.
 */
export interface KeptRead<Row> {
  readonly name: string;
  readonly kind: string;
  readonly workspace?: string | undefined;
  /** Keeps only the first rows, in the read's order, whose `size`s sum within `within`; none keeps every row. */
  readonly bound?: {
    readonly size: (row: Row) => number;
    readonly within: number;
  };
}

/** A synced row as the store is handed it, by its key. */
export interface KeptRow {
  readonly key: string;
  readonly row: unknown;
}

/**
 * The keys a kept read holds, as one answer tells the store: every one, in
 * the read's order; or, for an answer that moved only some, the keys it took
 * up since it last answered, held after every key it held then, those it let
 * go named by the answer's `deleted`.
 */
export type KeptHeld =
  | { readonly every: readonly string[] }
  | { readonly appended: readonly string[] };

/**
 * One answer of a kept read, as the store is handed it: the synced rows that
 * moved since the read last answered, upserted and deleted by key, the keys
 * the read now holds, and its cursor with the answer's other fields, whole
 * even where its bound left rows out; none where the read answered none.
 */
export interface KeptAnswer {
  readonly read: string;
  readonly kind: string;
  readonly workspace: string | undefined;
  readonly upserted: readonly KeptRow[];
  readonly deleted: readonly string[];
  readonly held: KeptHeld;
  readonly cursor: unknown;
}

/** A kept read as the store names it: the read, the kind its rows are kept under, and its workspace. */
export interface KeptName {
  readonly read: string;
  readonly kind: string;
  readonly workspace: string | undefined;
}

/** What the store holds of a kept read: its rows, in the order it held them, and the cursor it last kept; none where it kept none. */
export interface KeptLoad {
  /** Each the kind's row as the store was handed it (`KeptRow.row`). */
  readonly rows: readonly unknown[];
  readonly cursor: unknown;
}

/**
 * The rows half of a store: told each kept read's answer, in one call, and
 * asked what it holds of a read as the read first stands; never failing,
 * since it keeps its own failures, and answering none for a read it cannot
 * load.
 */
export interface RowsStore {
  readonly answered: (answer: KeptAnswer) => Effect.Effect<void>;
  readonly loaded: (read: KeptName) => Effect.Effect<KeptLoad | undefined>;
}

/** A read as it stands on a kind. */
export interface PoolRead<Row, Change = unknown> {
  /** Draws the read again as it now stands, as rows it shows move: the keys that moved, which may name some it does not show. */
  readonly redraw: (keys: readonly string[]) => Effect.Effect<void>;
  /** The read's wait for a write's transaction; none while its follow hands none. */
  readonly confirmation: () => Confirmation | undefined;
  /**
   * Whether a row a write makes is the read's to show while the write
   * stands, as every task started is the task list's; a read that names
   * none shows only the rows it answered.
   */
  readonly adopts?: (row: Row) => boolean;
  /**
   * For a read that keeps rows of its own shape outside the pool, as main's
   * account inbox keeps its entries: whether it shows `key`, and how it takes
   * a write's change in its place where it hands no wait. It draws the writes
   * standing (`HeldRows.standing`) over its own rows.
   */
  readonly beside?: {
    readonly shows: (key: string) => boolean;
    readonly take: (change: Change) => void;
  };
  /**
   * That the read's answers are kept on disk, where the pool has a store:
   * only the service's rows, never a write drawn over them, and nothing as
   * its scope closes, so quitting never empties the store.
   */
  readonly kept?: KeptRead<Row>;
  /**
   * That the read answers every row of its kind the account reaches, so on
   * a kind kept on disk (`RowKind.stored`) its whole answer replaces what is
   * kept and what it lets go is deleted; no other read removes a kept row.
   */
  readonly owns?: true;
}

/** The rows one read holds of a kind, for as long as it stands on it. */
export interface HeldRows<Row extends object, Change = unknown> {
  /**
   * Takes the rows the read answered, in one commit: each upserted, the keys
   * the read holds now theirs, or those `held` names where the read answers
   * only what moved, or, where it names `gone` instead, every key it held
   * but those, with its rows', in work as large as what moved; and any key
   * no read holds any longer gone; answering
   * the keys whose row moved for the read or that it took up or let go.
   * Every other read holding a row that moved is drawn again; the read draws
   * itself. A row answered `at` a sync id never replaces one taken at a
   * newer id, as from a read whose answer was computed before another's.
   */
  readonly answer: (rows: readonly Row[], answered?: Answered) => Effect.Effect<readonly string[]>;
  /** Whether the read shows `key`'s row. */
  readonly holds: (key: string) => boolean;
  /** The rows the read shows, in the order it answered them and then those it adopted, each as the writes standing draw it. */
  readonly rows: () => readonly Row[];
  /** The row `key` names as the read shows it, the very row the read answered where no write changes it; none where it shows none. */
  readonly row: (key: string) => Row | undefined;
  /** The keys of the rows the read shows that a write stands over. */
  readonly pending: () => readonly string[];
  /**
   * The rows the read answered, in the order it answered them, each as the
   * service last answered it with no write drawn over it, as a store that
   * keeps what the service holds reads them.
   */
  readonly synced: () => readonly Row[];
  /** Every change standing over the kind, oldest first, which a read beside the pool draws over its own rows. */
  readonly standing: () => readonly Change[];
  /** The cursor the store held for a kept read as it stood, which its follow reads past; none where it held none. */
  readonly stored: unknown;
  /** Whether the store held the kept read as it stood, rows or none, so the read draws what it held before the service answers. */
  readonly loaded: boolean;
  /** Whether the kind's rows are kept on disk whole, in the account's database, so the read holds in memory only what it answered since it stood. */
  readonly onDisk: boolean;
}

/**
 * How an answer stands, where its rows are only what moved: every key the
 * read holds now (`held`), or the keys it let go (`gone`), every other it
 * held standing; and the sync id it was read at, where it names one.
 */
export type Answered = {
  readonly at?: bigint;
  /** The read's cursor with the answer's other fields, as a kept read's store keeps them; opaque to the pool. */
  readonly cursor?: unknown;
} & (
  | { readonly held?: readonly string[]; readonly gone?: undefined }
  | { readonly gone: readonly string[]; readonly held?: undefined }
);

/** What the service answered of a write it took: the caller's answer, and the transaction it committed in. */
export interface Written<Change, Answer> {
  readonly answer: Answer;
  readonly txid: string | undefined;
  /** That the service took the write already, under its key, so it stands down at once and nothing is taken in its place. */
  readonly settled?: true;
  /** What the service says the write left of its rows, taken in the place of a read that hands no wait; the write's own change where it says nothing. */
  readonly taken?: Change;
  /** What the write stands as from the service's answer on, drawn in place of its change until its reads carry it, as an inbox item the service answered is. */
  readonly standsAs?: Change;
  /**
   * The write's own wait for its reads to carry it, for a write whose
   * service cannot answer a transaction, as one made through another
   * system's statement: the write goes on standing until it settles, and
   * only then is what the service answered taken in a read's place. A write
   * that can answer a transaction answers it instead. Nothing waits on it:
   * the caller is answered, and the next write to the keys sent, as the
   * service answers. Its answer is taken once every write to its keys asked
   * before it stood down, so one taken late never lands over a newer one.
   */
  readonly carried?: Effect.Effect<void>;
}

/** A write the service refused, which takes back what it drew, and what the caller answers for it. */
export interface Refused<Answer, Change = never> {
  readonly refused: Answer;
  /** That the service did not answer at all, so a write that may wait goes on standing rather than being taken back. */
  readonly unanswered?: true;
  /** What the service says of the rows instead, taken in every read's place before the write is taken back, so it lands on the service's word. */
  readonly taken?: Change;
}

/** How a write that may wait for the service is kept: its name, its input's kept form, and what its caller hears while it waits. */
export interface QueuedWrite<Input, Answer> {
  /** The write's name, its client's own, which a waiting write is laid back by. */
  readonly name: string;
  /** Its input as it is kept while it waits, and read back. */
  readonly input: Schema.Codec<Input, unknown>;
  /** What its caller hears where it waits rather than being answered, or where a write that holds its caller is let go. */
  readonly queued: (input: Input) => Answer;
  /** Whether its caller is answered only once the write is sent again rather than hearing `queued` at once; none holds none. */
  readonly holds?: (input: Input) => boolean;
}

/** What one attempt of a write is sent with: the idempotency key of a write that may wait, the same on every attempt, none for any other; and whether the write waited before it, so what its asking did at once is not done again. */
export interface Sent {
  readonly key: string | undefined;
  /** That the attempt is sent from the waiting writes rather than as the write was asked. */
  readonly waited: boolean;
}

/** A write waiting for the service as the pool hands it out to be kept and takes it back: its declaration's name, its key, and its input in its kept form. */
export interface QueuedEntry {
  readonly name: string;
  readonly key: string;
  readonly input: unknown;
}

/** One kind of write, as its client declares it: what it changes, from its input, and how it is sent. */
export interface WriteDeclaration<Row extends object, Change, Input, Answer> {
  readonly kind: RowKind<Row, Change>;
  /** The keys of the rows the write changes. */
  readonly keys: (input: Input) => readonly string[];
  /** The change drawn over each of them. */
  readonly change: (input: Input) => Change;
  /** Carries the write to the service under what it is sent with, answering what it answered, or that it refused it. */
  readonly send: (
    input: Input,
    sent: Sent,
  ) => Effect.Effect<Written<Change, Answer> | Refused<Answer, Change>>;
  /** How the write waits where the service does not answer it; none for a write that never waits. */
  readonly queue?: QueuedWrite<Input, Answer>;
}

/** A write declaration whose types are its own, as `requeue` takes each to lay its waiting writes back by. */
export type AnyWrite = <Result>(
  use: <Row extends object, Change, Input, Answer>(
    declaration: WriteDeclaration<Row, Change, Input, Answer>,
  ) => Result,
) => Result;

/** `declaration` as `requeue` takes it. */
export function anyWrite<Row extends object, Change, Input, Answer>(
  declaration: WriteDeclaration<Row, Change, Input, Answer>,
): AnyWrite {
  return (use) => use(declaration);
}

/**
 * Where a pool's waiting writes are kept as they move, oldest added first.
 * Each call is an Effect the write path waits on in the asking fiber, so a
 * write is kept before it is sent and the calls arrive in the order asked;
 * a store keeps its own failures, since the pool runs on without it.
 */
export interface OutboxStore {
  /** A write that may wait, before its first send. */
  readonly added: (entry: QueuedEntry) => Effect.Effect<void>;
  /** A write added before, as it stands down from waiting. */
  readonly removed: (entry: QueuedEntry) => Effect.Effect<void>;
}

/** The account's database as a stored kind's collection is kept in, for as long as it stands open. */
export interface CollectionsStore {
  /** Wraps the collection of the kind `stored` names in the database's persistence. */
  readonly keep: (stored: StoredKind) => KeepCollection;
  /** The scope the database stands open for, which closes every collection kept in it. */
  readonly scope: Scope.Scope;
}

/** What a pool reports of what it keeps, each half its own; none where it keeps nothing past memory. */
export interface PoolStore {
  /** The writes that may wait, as they are added and removed. */
  readonly outbox?: OutboxStore | undefined;
  /** Each kept read's synced rows, held keys, and cursor, as it answers. */
  readonly rows?: RowsStore | undefined;
  /** The account's database open now, which each stored kind's collection is kept in; none while none is, when they are held in memory alone. */
  readonly collections?: (() => CollectionsStore | undefined) | undefined;
}

/** What a pool that keeps writes waiting is handed. */
export interface PoolOptions {
  /** Mints a write's idempotency key. */
  readonly mintKey: () => string;
  /** Runs once for each waiting write the service refused as it was sent again. */
  readonly replayRefused: Effect.Effect<void>;
  /**
   * Who the writes are sent as now, an opaque identity read as a write is
   * asked and again before each time it is sent from the waiting writes;
   * none where every write is sent under one account.
   */
  readonly holder?: (() => string | undefined) | undefined;
  /** Where what the pool keeps is reported; none keeps it in memory alone. */
  readonly store?: PoolStore | undefined;
}

/** A kind's rows as they stand: the collection of its synced rows, and the rows the writes standing over it draw. */
export interface StandingRows<Row extends object> {
  readonly collection: RowCollection<Row, string>;
  readonly pending: ReadonlyMap<string, Row | typeof ROW_GONE>;
}

/** Every row the reads hold, and the writes drawn over them. */
export interface EntityPool {
  /** Stands `read` on `kind`'s rows for the caller's scope, holding none until it answers. */
  readonly stand: <Row extends object, Change>(
    kind: RowKind<Row, Change>,
    read: PoolRead<Row, Change>,
  ) => Effect.Effect<HeldRows<Row, Change>, never, Scope.Scope>;
  /**
   * `declaration` written with `input`: drawn at once over every read that
   * holds its keys, sent in turn, and answered as soon as the service
   * answers; it goes on standing until those reads carry it, or is taken
   * back, before it answers, where the service refused it.
   */
  readonly write: <Row extends object, Change, Input, Answer>(
    declaration: WriteDeclaration<Row, Change, Input, Answer>,
    input: Input,
  ) => Effect.Effect<Answer>;
  /**
   * The collection `kind`'s synced rows stand in now, made where none
   * stands: for a stored kind, the one kept in the account's database open
   * now, which a live query loads the rows it asks for from. It holds no
   * write standing over them.
   */
  readonly collection: <Row extends object, Change>(
    kind: RowKind<Row, Change>,
  ) => Effect.Effect<RowCollection<Row, string>>;
  /**
   * `kind`'s rows as they stand now where any read or write made them: the
   * collection its synced rows stand in, and each key a write stands over
   * with the row the writes draw, or `ROW_GONE` where they take it away;
   * a key whose synced row the pool does not hold in memory, as one kept on
   * disk alone, is left out, since nothing can be drawn over it. None
   * before any read or write made them.
   */
  readonly standing: <Row extends object, Change>(
    kind: RowKind<Row, Change>,
  ) => StandingRows<Row> | undefined;
  /** Hears each moving of a kind's collection, of the writes standing over its rows, or of a row they draw; answers how to stop hearing. */
  readonly watch: (heard: () => void) => () => void;
  /** The row `key` names of `kind`, as the reads show it with every write standing drawn over it; none where no read holds it. */
  readonly row: <Row extends object, Change>(
    kind: RowKind<Row, Change>,
    key: string,
  ) => Row | undefined;
  /** The writes waiting for the service, oldest first, as they are kept. */
  readonly queued: () => readonly QueuedEntry[];
  /** Each moving of `queued`, a write laid behind those waiting, answered, or let go, from the moment the stream is run. */
  readonly queueMoves: Stream.Stream<void>;
  /**
   * Lays `entries` over the rows as writes waiting for the service, behind
   * those waiting already, each by the declaration among `writes` its name
   * names; one no declaration names, or whose input no longer reads, is
   * dropped.
   */
  readonly requeue: (
    entries: readonly QueuedEntry[],
    writes: readonly AnyWrite[],
  ) => Effect.Effect<void>;
  /** Sends the waiting writes again, one at a time, oldest first, until one is still unanswered. */
  readonly resend: Effect.Effect<void>;
  /** Lets go of every waiting write, taking back what each drew, as a sign-out does. */
  readonly letGoQueued: Effect.Effect<void>;
}

/** One read standing on a kind: the keys it holds, in the order it answered them, and the keys of rows a standing write made that it shows meanwhile. */
interface Holding<Row, Change = unknown> {
  readonly read: PoolRead<Row, Change>;
  held: Set<string>;
  adopted: ReadonlySet<string>;
  /** The synced rows last handed the store for a kept read, by key. */
  reported: Map<string, Row>;
  /** Whether the read's next answer hands the store every key it holds, a whole answer having replaced them. */
  reportsWhole: boolean;
  /** The keys whose synced row, or whose holding by the read, moved since it last handed the store any, for a kept read. */
  readonly unreported: Set<string>;
  /**
   * Whether the read shows every row of its kind, as the read that answers
   * every row (`PoolRead.owns`) does of a kind kept on disk, whose rows a
   * launch holds in memory only once loaded, so a write over one it never
   * answered is still carried by it.
   */
  readonly showsAll: boolean;
}

/** One write standing: the keys it changes and its change, the service's word in its place once it answered one. */
interface Standing<Change> {
  readonly keys: readonly string[];
  change: Change;
  /** That the write was laid back from the store (`requeue`), so a read that stands after it adopts what it made. */
  readonly laidBack: boolean;
}

/** Where one write stands: answered once the service answered it, and dropped once nothing of it stands drawn. */
interface Turn {
  readonly answered: Deferred.Deferred<void>;
  readonly dropped: Deferred.Deferred<void>;
}

/** How one more attempt of a waiting write ended: kept, refused and taken back, still unanswered, or let go unsent because its account is gone. */
const RETRIED = {
  KEPT: "kept",
  REFUSED: "refused",
  UNANSWERED: "unanswered",
  LET_GO: "let-go",
} as const;

type Retried = (typeof RETRIED)[keyof typeof RETRIED];

/** One write waiting for the service: as it is kept, one more attempt of it, and its letting go. */
interface Waiting {
  readonly entry: QueuedEntry;
  readonly retried: Effect.Effect<Retried>;
  readonly letGo: Effect.Effect<void>;
}

/** The writes waiting for the service, oldest first, and what sends them. */
interface Queue {
  readonly options: PoolOptions | undefined;
  readonly confirming: FiberSet.FiberSet<void>;
  readonly lock: Semaphore.Semaphore;
  /** Told each time `waiting` moves. */
  readonly moves: PubSub.PubSub<void>;
  waiting: readonly Waiting[];
}

/** The queue's waiting writes set to `waiting`, and its moving told. */
function movedTo(queue: Queue, waiting: readonly Waiting[]): Effect.Effect<void> {
  return Effect.suspend(() => {
    queue.waiting = waiting;

    return Effect.asVoid(PubSub.publish(queue.moves, undefined));
  });
}

/** Where a kind's rows stand: the kinds they are held among, the scope their collection closes with, and how it is kept on disk where it is. */
interface KindPlace {
  readonly kinds: Map<object, unknown>;
  readonly scope: Scope.Scope;
  readonly keep?: KeepCollection;
}

/** One kind's rows, the reads standing on them, and the writes drawn over them. */
interface KindRows<Row extends object, Change> {
  readonly kind: RowKind<Row, Change>;
  readonly synced: SyncedCollection<Row, string>;
  readonly reads: Set<Holding<Row, Change>>;
  /** The writes drawn now, oldest first, each one entry so a change written twice stands twice. */
  standing: readonly Standing<Change>[];
  /** Each key's newest write, which the next write to it is sent after and stands down after. */
  readonly lastWrites: Map<string, Turn>;
  /** The sync id each key's row was taken at, where an answer named one. */
  readonly takenAt: Map<string, bigint>;
  /** Tells the pool's watchers that the writes standing over the kind, or the rows they draw, moved. */
  readonly heard: () => void;
}

/** The row `key` names as the reads show it: the synced one with every write standing on it drawn over it, in order; none where none shows. */
function drawnRow<Row extends object, Change>(
  rows: KindRows<Row, Change>,
  key: string,
): Row | undefined {
  let row = rows.synced.row(key);

  for (const write of rows.standing) {
    if (!write.keys.includes(key)) continue;
    const drawn = rows.kind.drawn(write.change, row);

    if (drawn === ROW_GONE) row = undefined;
    else if (drawn !== undefined) row = drawn;
  }

  return row;
}

/** Whether the read shows `key`'s row: one it answered, one it adopted, one it keeps beside the pool, or any where it shows every row. */
function shows<Row, Change>(holding: Holding<Row, Change>, key: string): boolean {
  return (
    holding.showsAll ||
    holding.held.has(key) ||
    holding.adopted.has(key) ||
    holding.read.beside?.shows(key) === true
  );
}

/** The keys of the rows the read shows of the pool: those it answered, in order, then those it adopted. */
function shown<Row, Change>(holding: Holding<Row, Change>): readonly string[] {
  return [...holding.held, ...[...holding.adopted].filter((key) => !holding.held.has(key))];
}

/** Whether any read standing holds `key`, as one it answered. */
function heldByAny<Row, Change>(reads: ReadonlySet<Holding<Row, Change>>, key: string): boolean {
  return [...reads].some((holding) => holding.held.has(key));
}

/** The reads standing that show any of `keys`, but `except`. */
function holdersOf<Row, Change>(
  reads: ReadonlySet<Holding<Row, Change>>,
  keys: readonly string[],
  except?: Holding<Row, Change>,
): readonly Holding<Row, Change>[] {
  return [...reads].filter(
    (holding) => holding !== except && keys.some((key) => shows(holding, key)),
  );
}

/** Draws each read again over the keys that moved. */
function redrawn<Row, Change>(
  holdings: readonly Holding<Row, Change>[],
  keys: readonly string[],
): Effect.Effect<void> {
  if (keys.length === 0) return Effect.void;

  return Effect.forEach(holdings, (holding) => holding.read.redraw(keys), { discard: true });
}

/** Whether a write stands over `key`. */
function standingOver<Row extends object, Change>(
  rows: KindRows<Row, Change>,
  key: string,
): boolean {
  return rows.standing.some((write) => write.keys.includes(key));
}

/**
 * Runs `step` over the pool at once, answering the draw again of the reads
 * that showed or show any of `keys` whose row it moved, or that a write
 * began or ceased to stand over. Note that every read showing a key shows
 * the one row, so a key whose drawn row moved moves every read showing it.
 */
function movedBy<Row extends object, Change>(
  rows: KindRows<Row, Change>,
  keys: readonly string[],
  step: () => void,
): Effect.Effect<void> {
  const before = keys.map((key) => [drawnRow(rows, key), standingOver(rows, key)] as const);
  const showing = holdersOf(rows.reads, keys);
  step();

  const moved = keys.filter(
    (key, at) => !Equal.equals(before[at], [drawnRow(rows, key), standingOver(rows, key)] as const),
  );

  if (moved.length === 0) return Effect.void;
  rows.heard();

  return redrawn([...new Set([...showing, ...holdersOf(rows.reads, moved)])], moved);
}

/**
 * Marks `keys`, whose synced rows moved, as unreported on every kept read of
 * `rows`, so the next answer of each tells its store of them; and tells the
 * pool's watchers where a write stands over any, since the row it draws
 * moved with it.
 */
function unreported<Row extends object, Change>(
  rows: KindRows<Row, Change>,
  keys: readonly string[],
): void {
  if (keys.some((key) => standingOver(rows, key))) rows.heard();

  for (const holding of rows.reads) {
    if (holding.read.kept === undefined || holding.reportsWhole) continue;

    for (const key of keys) holding.unreported.add(key);
  }
}

/** Each read that adopts a row made of `keys`, and does not show it yet, shown it while a write stands over it. */
function adopted<Row extends object, Change>(rows: KindRows<Row, Change>, keys: readonly string[]) {
  for (const key of keys) {
    const row = drawnRow(rows, key);

    if (row === undefined) continue;

    for (const holding of rows.reads) {
      if (shows(holding, key) || holding.read.adopts?.(row) !== true) continue;
      holding.adopted = new Set([...holding.adopted, key]);
    }
  }
}

/** Each read let go of the keys of `keys` it adopted that no write stands over any longer. */
function unadopted<Row extends object, Change>(
  rows: KindRows<Row, Change>,
  keys: readonly string[],
) {
  const loose = keys.filter((key) => !standingOver(rows, key));

  for (const holding of rows.reads) {
    if (!loose.some((key) => holding.adopted.has(key))) continue;
    holding.adopted = new Set([...holding.adopted].filter((key) => !loose.includes(key)));
  }
}

/** `upserted` taken as synced rows and `deleted` let go, every other row left as it is, answering the keys it wrote, and every read showing one drawn again. */
function patchedAndDrawn<Row extends object, Change>(
  rows: KindRows<Row, Change>,
  upserted: ReadonlyMap<string, Row>,
  deleted: readonly string[],
): Effect.Effect<readonly string[]> {
  return Effect.suspend(() => {
    const written = rows.synced.patch(upserted, deleted);
    unreported(rows, written);

    return Effect.as(redrawn(holdersOf(rows.reads, written), written), written);
  });
}

/** Waits for each turn given to reach the point `of` names. */
function awaitEach(
  turns: readonly Turn[],
  of: (turn: Turn) => Deferred.Deferred<void>,
): Effect.Effect<void> {
  return Effect.forEach(turns, (turn) => Deferred.await(of(turn)), { discard: true });
}

/** The rows of `keyed` an answer read `at` takes, each marked taken at it: all but those already taken at a newer sync id. */
function newer<Row extends object, Change>(
  rows: KindRows<Row, Change>,
  keyed: ReadonlyMap<string, Row>,
  at: bigint | undefined,
): ReadonlyMap<string, Row> {
  if (at === undefined) return keyed;
  const taken = new Map<string, Row>();

  for (const [key, row] of keyed) {
    const takenAt = rows.takenAt.get(key);

    if (takenAt !== undefined && takenAt > at) continue;
    taken.set(key, row);
    rows.takenAt.set(key, at);
  }

  return taken;
}

/**
 * An answer of only what moved taken by `holding`: `keyed` upserted and held,
 * `gone` let go, and each of those no read holds any longer gone from the
 * pool, every other key it held left as it stands; answering the keys whose
 * row moved or that it took up or let go, and every other read showing a
 * row that moved drawn again.
 */
function movedOnly<Row extends object, Change>(
  rows: KindRows<Row, Change>,
  holding: Holding<Row, Change>,
  keyed: ReadonlyMap<string, Row>,
  gone: readonly string[],
  at: bigint | undefined,
  mark: CollectionMark | undefined,
): Effect.Effect<readonly string[]> {
  const placed: string[] = [];
  const deleted: string[] = [];
  // Note that a key both answered and let go is let go, as a whole answer's `held` leaving it out lets it go.
  const goneKeys = new Set(gone);
  const upserted = new Map([...newer(rows, keyed, at)].filter(([key]) => !goneKeys.has(key)));

  for (const key of keyed.keys()) {
    if (holding.held.has(key) || goneKeys.has(key)) continue;
    holding.held.add(key);
    placed.push(key);
  }

  for (const key of goneKeys) {
    const held = holding.held.delete(key);

    if (held) placed.push(key);

    // Note that a row kept on disk leaves only on the word of the read that answers every row, which deletes it whether or not it held it, since it may stand on disk alone.
    if (rows.synced.kept ? holding.read.owns !== true : !held || heldByAny(rows.reads, key)) {
      continue;
    }

    deleted.push(key);
    rows.takenAt.delete(key);
  }

  const written = rows.synced.patch(upserted, deleted, mark);
  unreported(rows, [...written, ...placed]);

  return Effect.as(redrawn(holdersOf(rows.reads, written, holding), written), [
    ...new Set([...written, ...placed]),
  ]);
}

/**
 * An answer naming every key `holding` holds now taken by it, committed at
 * once: `taken` upserted, `keys` held, and any key it let go that no read
 * holds any longer gone; answering the keys whose row moved or that it took
 * up or let go, and every other read showing a row that moved drawn again.
 */
function answeredWhole<Row extends object, Change>(
  rows: KindRows<Row, Change>,
  holding: Holding<Row, Change>,
  taken: ReadonlyMap<string, Row>,
  keys: Set<string>,
  mark?: CollectionMark,
): Effect.Effect<readonly string[]> {
  const was = holding.held;
  holding.held = keys;
  holding.reportsWhole = true;

  if (rows.synced.kept) return keptWhole(rows, holding, taken, was, mark);
  const next = new Map(rows.synced.held());

  for (const [key, row] of taken) next.set(key, row);

  for (const key of was) {
    if (heldByAny(rows.reads, key)) continue;
    next.delete(key);
    rows.takenAt.delete(key);
  }

  const placed = [
    ...[...keys].filter((key) => !was.has(key)),
    ...[...was].filter((key) => !keys.has(key)),
  ];

  const written = rows.synced.take(next);
  unreported(rows, written);

  return Effect.as(redrawn(holdersOf(rows.reads, written, holding), written), [
    ...new Set([...written, ...placed]),
  ]);
}

/**
 * A whole answer taken by `holding` on a kind kept on disk, its held keys
 * already its answer's: where it answers every row of the kind (`owns`),
 * the kept rows replaced by the rows it holds, and those every other read
 * holds in memory beside them; else `taken` upserted and nothing let go.
 * Answering the keys it wrote or that it took up or let go, every other
 * read showing a row that moved drawn again.
 */
function keptWhole<Row extends object, Change>(
  rows: KindRows<Row, Change>,
  holding: Holding<Row, Change>,
  taken: ReadonlyMap<string, Row>,
  was: ReadonlySet<string>,
  mark: CollectionMark | undefined,
): Effect.Effect<readonly string[]> {
  const keys = holding.held;

  const placed = [
    ...[...keys].filter((key) => !was.has(key)),
    ...[...was].filter((key) => !keys.has(key)),
  ];

  const written = Effect.suspend(() => {
    if (holding.read.owns !== true) return Effect.succeed(rows.synced.patch(taken, [], mark));
    const synced = rows.synced.held();
    const others = new Set([...rows.reads].filter((each) => each !== holding));
    const next = new Map<string, Row>();

    // Note that a key the read holds that this answer did not carry stands as it was taken, since an answer read at an older sync id leaves out a row taken at a newer one.
    for (const key of keys) {
      const row = taken.get(key) ?? rows.synced.row(key);

      if (row !== undefined) next.set(key, row);
    }

    // Note that a key the read holds whose row was neither taken nor loaded this launch stands on disk alone, where a truncate would drop it, so such an answer deletes only the rows it let go that the collection holds.
    if ([...keys].some((key) => !next.has(key))) {
      const known = new Set<string>([...synced.keys(), ...rows.synced.collection.keys()]);

      const deleted = [...known].filter((key) => !keys.has(key) && !heldByAny(others, key));

      for (const key of deleted) rows.takenAt.delete(key);

      return Effect.succeed(rows.synced.patch(next, deleted, mark));
    }

    for (const [key, row] of synced) {
      if (!next.has(key) && heldByAny(others, key)) next.set(key, row);
    }

    for (const key of synced.keys()) if (!next.has(key)) rows.takenAt.delete(key);

    // Note that the truncate a replace writes reaches no reader as every row moving: TanStack's persistence takes it as the authoritative set, and a live query hears only the rows that moved. Once whole reads come in pages, the first page's truncate would empty a list until the last lands, so a paged read will mark its rows with its generation and sweep the older ones after its last page instead.
    return Effect.succeed(rows.synced.replace(next, mark));
  });

  return Effect.flatMap(written, (moved) => {
    unreported(rows, moved);

    return Effect.as(redrawn(holdersOf(rows.reads, moved, holding), moved), [
      ...new Set([...moved, ...placed]),
    ]);
  });
}

/** The workspace a kept read that names none is marked under. */
const NO_WORKSPACE = "";

/** A kept read's cursors on a kind kept on disk, by workspace, as its collection's mark under the read's name holds them; each opaque to the pool. */
const keptCursorsSchema = Schema.Record(Schema.String, Schema.Unknown);

type KeptCursors = typeof keptCursorsSchema.Type;

const decodeKeptCursors = Schema.decodeUnknownOption(keptCursorsSchema);

/** The cursors `kept`'s read wrote on `synced`'s mark, by workspace; none where it wrote none, or another shape. */
function keptCursors<Row extends object>(
  synced: SyncedCollection<Row, string>,
  kept: KeptRead<Row>,
): KeptCursors {
  return Option.getOrElse(decodeKeptCursors(synced.mark(kept.name)?.value), () => ({}));
}

/** The mark that writes `how`'s cursor as `kept`'s read's on `synced`, beside its other workspaces'; none where the collection is in memory alone or the answer names no cursor. */
function cursorMark<Row extends object>(
  synced: SyncedCollection<Row, string>,
  kept: KeptRead<Row> | undefined,
  how: Answered,
): CollectionMark | undefined {
  if (!synced.kept || kept === undefined || how.cursor === undefined) return undefined;

  return {
    name: kept.name,
    value: { ...keptCursors(synced, kept), [kept.workspace ?? NO_WORKSPACE]: how.cursor },
  };
}

/**
 * What `store` holds of `holding`'s kept read taken as its answer, before the
 * service's first: each row held and counted as already reported, but taken
 * only where the pool holds none of its key, since one another read answered
 * is newer; answering what it held, none where it held nothing.
 */
function loadedFrom<Row extends object, Change>(
  rows: KindRows<Row, Change>,
  holding: Holding<Row, Change>,
  store: RowsStore,
): Effect.Effect<KeptLoad | undefined> {
  const kept = holding.read.kept;

  if (kept === undefined) return Effect.undefined;

  return Effect.flatMap(
    store.loaded({ read: kept.name, kind: kept.kind, workspace: kept.workspace }),
    (load) => {
      if (load === undefined) return Effect.undefined;
      // SAFETY: the store hands back only rows it was handed as this kind's (`KeptAnswer`), under the kind it names.
      const keyed = new Map(load.rows.map((row) => [rows.kind.key(row as Row), row as Row]));
      const synced = rows.synced.held();
      holding.reported = keyed;

      return Effect.as(
        answeredWhole(
          rows,
          holding,
          new Map([...keyed].filter(([key]) => !synced.has(key))),
          new Set(keyed.keys()),
        ),
        load,
      );
    },
  );
}

/** The first of `rows`, in order, whose sizes sum within the bound; every row where `kept` names none. */
function cut<Row>(kept: KeptRead<Row>, rows: readonly Row[]): readonly Row[] {
  const { bound } = kept;

  if (bound === undefined) return rows;
  let used = 0;

  for (const [at, row] of rows.entries()) {
    used += bound.size(row);

    if (used > bound.within) return rows.slice(0, at);
  }

  return rows;
}

/**
 * A kept read's answer as the store is handed it, read the moment the answer
 * is taken: the synced rows of its cut that moved since it last answered, the
 * keys the cut holds, and its cursor, which the read keeps whole even where
 * the cut leaves rows out, since the read alone knows whether it can follow
 * on past it from what was kept. An unbounded read past a whole answer
 * (`reportsWhole`) reads only its keys that moved since (`unreportedOf`).
 */
function reported<Row extends object, Change>(
  rows: KindRows<Row, Change>,
  holding: Holding<Row, Change>,
  kept: KeptRead<Row>,
  { cursor }: Answered,
): KeptAnswer {
  const named = { read: kept.name, kind: kept.kind, workspace: kept.workspace, cursor };

  if (kept.bound === undefined && !holding.reportsWhole) {
    return { ...named, ...unreportedOf(rows, holding) };
  }

  const synced = rows.synced.held();
  const all = [...holding.held].flatMap((key) => synced.get(key) ?? []);
  const keptRows = cut(kept, all);
  const next = new Map(keptRows.map((row) => [rows.kind.key(row), row]));
  const changes = rowChanges(holding.reported, next);
  holding.reported = next;
  holding.reportsWhole = false;
  holding.unreported.clear();

  return {
    ...named,
    upserted: changes.flatMap((change) =>
      change.type === "delete" ? [] : [{ key: rows.kind.key(change.value), row: change.value }],
    ),
    deleted: changes.flatMap((change) => (change.type === "delete" ? [change.key] : [])),
    held: { every: [...next.keys()] },
  };
}

/**
 * What moved of an unbounded kept read since it last answered, read from its
 * unreported keys alone: each whose synced row it holds now and did not, or
 * holds as another row than it handed the store, upserted, the first taken
 * up after every key it held; and each it handed the store and holds no
 * row of now, deleted.
 */
function unreportedOf<Row extends object, Change>(
  rows: KindRows<Row, Change>,
  holding: Holding<Row, Change>,
): Pick<KeptAnswer, "upserted" | "deleted" | "held"> {
  const synced = rows.synced.held();
  const upserted: KeptRow[] = [];
  const deleted: string[] = [];
  const appended: string[] = [];

  for (const key of holding.unreported) {
    const row = holding.held.has(key) ? synced.get(key) : undefined;
    const was = holding.reported.get(key);

    if (row === undefined) {
      if (was !== undefined) deleted.push(key);
      holding.reported.delete(key);
      continue;
    }

    if (was !== undefined && Equal.equals(was, row)) continue;

    if (was === undefined) appended.push(key);
    upserted.push({ key, row });
    holding.reported.set(key, row);
  }

  holding.unreported.clear();

  return { upserted, deleted, held: { appended } };
}

/** `read` stood on `rows` for the caller's scope, its keys let go as the scope closes and any row no other read holds with them. */
function stood<Row extends object, Change>(
  rows: KindRows<Row, Change>,
  read: PoolRead<Row, Change>,
  store: RowsStore | undefined,
): Effect.Effect<HeldRows<Row, Change>, never, Scope.Scope> {
  const release = (holding: Holding<Row, Change>) =>
    Effect.sync(() => {
      rows.reads.delete(holding);

      // Note that a read closing never removes a row kept on disk, which stands there for the next launch.
      if (rows.synced.kept) return;
      const next = new Map(rows.synced.held());

      for (const key of holding.held) {
        if (heldByAny(rows.reads, key)) continue;
        next.delete(key);
        rows.takenAt.delete(key);
      }

      unreported(rows, rows.synced.take(next));
    });

  const acquired = Effect.acquireRelease(
    Effect.sync(() => {
      const holding: Holding<Row, Change> = {
        read,
        held: new Set(),
        adopted: new Set(),
        reported: new Map(),
        reportsWhole: true,
        unreported: new Set(),
        showsAll: rows.synced.kept && read.owns === true,
      };

      rows.reads.add(holding);
      // Note that a read standing after a write laid back from the store adopts the row it made, as one stood before it would have, so a read stood again on the store at launch shows it; a write asked in this session is adopted only by the reads standing as it is asked, so one a sign-out cut off reaches no read of the next account.
      adopted(
        rows,
        rows.standing.flatMap((write) => (write.laidBack ? write.keys : [])),
      );

      return holding;
    }),
    release,
  );

  return Effect.map(
    Effect.flatMap(acquired, (holding) =>
      Effect.map(
        store === undefined || rows.synced.kept
          ? Effect.undefined
          : loadedFrom(rows, holding, store),
        (load) => ({ holding, load }),
      ),
    ),
    ({ holding, load }): HeldRows<Row, Change> => {
      const marked =
        read.kept === undefined
          ? undefined
          : keptCursors(rows.synced, read.kept)[read.kept.workspace ?? NO_WORKSPACE];

      const stored = rows.synced.kept ? marked : load?.cursor;

      return {
        answer: (answered, how = {}) => {
          const { held, gone, at } = how;

          // Note that each branch commits at once and answers the draws it owes, so a kept answer is read before any other read is drawn and another answer can land.
          const committed = (): Effect.Effect<readonly string[]> => {
            const keyed = new Map(answered.map((row) => [rows.kind.key(row), row]));
            const mark = cursorMark(rows.synced, read.kept, how);

            if (gone !== undefined) return movedOnly(rows, holding, keyed, gone, at, mark);

            return answeredWhole(
              rows,
              holding,
              newer(rows, keyed, at),
              new Set(held ?? keyed.keys()),
              mark,
            );
          };

          return Effect.suspend(() => {
            const drawn = committed();
            const { kept } = read;

            if (store === undefined || kept === undefined || rows.synced.kept) return drawn;
            const answer = reported(rows, holding, kept, how);

            // Note that the store is told before any read is drawn, so it hears answers in the order they were taken, and uninterruptibly with the draws, so neither its baseline nor the reads fall behind the commit.
            return Effect.uninterruptible(Effect.andThen(store.answered(answer), drawn));
          });
        },
        holds: (key) => shows(holding, key),
        rows: () => shown(holding).flatMap((key) => drawnRow(rows, key) ?? []),
        row: (key) =>
          holding.held.has(key) || holding.adopted.has(key) ? drawnRow(rows, key) : undefined,
        pending: () => shown(holding).filter((key) => standingOver(rows, key)),
        synced: () => {
          const synced = rows.synced.held();

          return [...holding.held].flatMap((key) => synced.get(key) ?? []);
        },
        standing: () => rows.standing.map((write) => write.change),
        stored,
        loaded: rows.synced.kept ? marked !== undefined : load !== undefined,
        onDisk: rows.synced.kept,
      };
    },
  );
}

/**
 * `taken` laid over `keys` in the place of each of `holdings`: over the
 * pool's rows they show, and the rows a read keeps beside the pool, every
 * read showing one that moved drawn again. A row a read adopted is held
 * from then as if it had answered it.
 */
function takenInPlace<Row extends object, Change>(
  rows: KindRows<Row, Change>,
  holdings: readonly Holding<Row, Change>[],
  keys: readonly string[],
  taken: Change,
): Effect.Effect<void> {
  return Effect.suspend(() => {
    const held = rows.synced.held();
    const upserted = new Map<string, Row>();
    const deleted = new Set<string>();
    const beside: Holding<Row, Change>[] = [];

    // Note that a row a launch only loaded from disk was never taken here, so the change is drawn over it as the collection holds it, and its delete is written by key.
    const current = (key: string): Row | undefined =>
      deleted.has(key) ? undefined : (upserted.get(key) ?? rows.synced.row(key));

    const taking = (key: string): boolean =>
      upserted.has(key) || (held.has(key) && !deleted.has(key));

    for (const holding of holdings) {
      if (keys.some((key) => holding.read.beside?.shows(key) === true)) beside.push(holding);

      for (const key of keys) {
        if (!holding.showsAll && !holding.held.has(key) && !holding.adopted.has(key)) continue;
        const drawn = rows.kind.drawn(taken, current(key));

        if (drawn === ROW_GONE) {
          upserted.delete(key);
          deleted.add(key);
          rows.takenAt.delete(key);
        } else if (drawn !== undefined) {
          deleted.delete(key);
          upserted.set(key, drawn);
        }

        if (holding.held.has(key) || !taking(key)) continue;
        holding.held.add(key);
        holding.unreported.add(key);
      }
    }

    for (const holding of beside) holding.read.beside?.take(taken);

    return Effect.andThen(redrawn(beside, keys), patchedAndDrawn(rows, upserted, [...deleted]));
  });
}

/**
 * A kept write confirmed on one read showing its keys by the read's own
 * wait, or, where it hands none or the write committed no transaction, what
 * the service answered taken in its place. A write with its own wait for its
 * reads (`Written.carried`) is taken once that settles and every write to
 * its keys asked before it (`earlier`) has stood down, so an answer taken
 * late, as where the wait gave up, never lands over a newer write's.
 */
function confirmedOn<Row extends object, Change, Answer>(
  rows: KindRows<Row, Change>,
  holding: Holding<Row, Change>,
  write: Standing<Change>,
  written: Written<Change, Answer>,
  earlier: Effect.Effect<void>,
): Effect.Effect<void> {
  const wait = holding.read.confirmation();

  if (wait !== undefined && written.txid !== undefined) return wait(written.txid);
  const taken = takenInPlace(rows, [holding], write.keys, written.taken ?? write.change);

  if (written.carried === undefined) return taken;

  return Effect.andThen(written.carried, Effect.andThen(earlier, taken));
}

/**
 * The waiting writes sent again, one at a time, oldest first, until one is
 * still unanswered; each refused runs `replayRefused`.
 */
function resent(queue: Queue): Effect.Effect<void> {
  return queue.lock.withPermits(1)(
    Effect.gen(function* () {
      for (;;) {
        const next = queue.waiting[0];

        if (next === undefined) return;
        const retried = yield* next.retried;

        if (retried === RETRIED.UNANSWERED) return;
        yield* movedTo(
          queue,
          queue.waiting.filter((each) => each !== next),
        );

        if (retried === RETRIED.REFUSED) yield* queue.options?.replayRefused ?? Effect.void;
      }
    }),
  );
}

/**
 * `declaration` written over `rows` with `input`, its confirmation standing
 * on in the queue's fiber set once the service took it; where it may wait,
 * under the key it was kept with (`restored`) or one minted now, and laid
 * at once behind the writes waiting where it was kept or others wait.
 */
function written<Row extends object, Change, Input, Answer>(
  rows: KindRows<Row, Change>,
  queue: Queue,
  declaration: WriteDeclaration<Row, Change, Input, Answer>,
  input: Input,
  restored?: string,
): Effect.Effect<Answer> {
  return Effect.gen(function* () {
    const keys = [...new Set(declaration.keys(input))];

    const write: Standing<Change> = {
      keys,
      change: declaration.change(input),
      laidBack: restored !== undefined,
    };

    const plan = declaration.queue;
    // Note that the account is read as the write is asked, or laid back from the store its account opened, so a later send can tell another.
    const askedAs = queue.options?.holder?.();
    const mintKey = queue.options?.mintKey;
    const key = plan === undefined || mintKey === undefined ? undefined : (restored ?? mintKey());

    // Note that the input is kept as its declaration keeps it as it is asked, so one that will not keep never waits.
    const entry =
      plan === undefined || key === undefined
        ? undefined
        : Result.getOrUndefined(
            Result.map(Schema.encodeResult(plan.input)(input), (kept) => ({
              name: plan.name,
              key,
              input: kept,
            })),
          );

    const outbox = queue.options?.store?.outbox;
    const out = { kept: false };

    /** The write kept in the outbox before it takes its turn, unless it was laid back from there. */
    const keep = Effect.suspend(() => {
      if (outbox === undefined || entry === undefined) return Effect.void;
      out.kept = true;

      return restored === undefined ? outbox.added(entry) : Effect.void;
    });

    /** The write out of the outbox, once, as it stands down from waiting. */
    const unkeep = Effect.suspend(() => {
      if (outbox === undefined || entry === undefined || !out.kept) return Effect.void;

      // Note that the write is told kept until its removal is done, so one interrupted is removed on its next step down.
      return Effect.andThen(
        outbox.removed(entry),
        Effect.sync(() => {
          out.kept = false;
        }),
      );
    });

    // Note that the write is kept before it takes its turn on its keys, so a store that waits never lets a later write take the turn ahead of it.
    yield* keep;

    const turn: Turn = {
      answered: yield* Deferred.make<void>(),
      dropped: yield* Deferred.make<void>(),
    };

    const before = [...new Set(keys.flatMap((key) => rows.lastWrites.get(key) ?? []))];

    for (const key of keys) rows.lastWrites.set(key, turn);

    const drawnOn = movedBy(rows, keys, () => {
      rows.standing = [...rows.standing, write];
      adopted(rows, keys);
    });

    const drop = Effect.suspend(() => {
      for (const key of keys) if (rows.lastWrites.get(key) === turn) rows.lastWrites.delete(key);

      return movedBy(rows, keys, () => {
        rows.standing = rows.standing.filter((each) => each !== write);
        unadopted(rows, keys);
      });
    }).pipe(Effect.ensuring(Deferred.succeed(turn.dropped, undefined)));

    // Note that each attempt asks the declaration anew, so one sent again reads the host as it stands then.
    const attempt = (waited: boolean) =>
      Effect.suspend(() => declaration.send(input, { key, waited }));

    const sent = Effect.gen(function* () {
      yield* drawnOn;
      yield* awaitEach(before, (each) => each.answered);

      return yield* attempt(false);
    }).pipe(Effect.ensuring(Deferred.succeed(turn.answered, undefined)));

    // Note that every read showing the keys is waited on at once, so the write stands until the slowest carries it.
    const settled = (kept: Written<Change, Answer>) =>
      Effect.gen(function* () {
        const { standsAs } = kept;

        if (kept.settled !== true && standsAs !== undefined) {
          yield* movedBy(rows, keys, () => {
            write.change = standsAs;
          });
        }

        if (kept.settled !== true) {
          yield* Effect.forEach(
            holdersOf(rows.reads, keys),
            (holding) =>
              confirmedOn(
                rows,
                holding,
                write,
                kept,
                awaitEach(before, (each) => each.dropped),
              ),
            { concurrency: "unbounded", discard: true },
          );
        }

        yield* awaitEach(before, (each) => each.dropped);
      }).pipe(Effect.ensuring(drop));

    /** A refused write taken back, on the service's word where it gave one. */
    const takenBack = (refused: Refused<Answer, Change>) =>
      Effect.gen(function* () {
        const { taken } = refused;

        if (taken !== undefined) {
          yield* takenInPlace(rows, holdersOf(rows.reads, keys), keys, taken);
        }

        yield* drop;
      });

    /** What a caller the write holds hears once it is sent again: the service's answer, its refusal, or, let go, what it hears meanwhile. */
    const heard = yield* Deferred.make<Answer>();

    /** The write laid behind those waiting, still standing, sent again as they are; let go, its caller hears `meanwhile`. */
    const waits = (kept: QueuedEntry, meanwhile: Answer) =>
      Effect.suspend(() => {
        const letGo = Effect.andThen(
          Effect.andThen(drop, unkeep),
          Deferred.succeed(heard, meanwhile),
        );

        const waiting: Waiting = {
          entry: kept,
          retried: Effect.gen(function* () {
            // Note that the account is read again just before the send, because the session may move with no word to the pool, and a write is never carried under another's credential.
            if (queue.options?.holder?.() !== askedAs) {
              yield* letGo;

              return RETRIED.LET_GO;
            }

            const answered = yield* attempt(true);

            if ("refused" in answered) {
              if (answered.unanswered === true) return RETRIED.UNANSWERED;
              yield* takenBack(answered);
              yield* unkeep;
              yield* Deferred.succeed(heard, answered.refused);

              return RETRIED.REFUSED;
            }

            yield* unkeep;
            yield* FiberSet.run(queue.confirming, settled(answered));
            yield* Deferred.succeed(heard, answered.answer);

            return RETRIED.KEPT;
          }),
          letGo,
        };

        return movedTo(queue, [...queue.waiting, waiting]);
      });

    const room = () => queue.waiting.length < QUEUE_BOUND;

    // Note that a kept write answers before its reads carry it, standing on in a fiber of the pool's; a refused one answers once it is taken back, on the service's word where it gave one; one unanswered that may wait answers at once that it waits, or, holding its caller, once it is sent again.
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        // Note that a caller the write holds waits for it interruptibly, so one that gives up leaves it waiting; one laid back holds nobody.
        const heardAs = (waiting: QueuedWrite<Input, Answer>) =>
          waiting.holds?.(input) === true && restored === undefined
            ? restore(Deferred.await(heard))
            : Effect.succeed(waiting.queued(input));

        if (plan !== undefined && entry !== undefined && room()) {
          if (restored !== undefined || queue.waiting.length > 0) {
            yield* drawnOn;
            yield* Deferred.succeed(turn.answered, undefined);
            yield* waits(entry, plan.queued(input));

            if (restored === undefined) yield* FiberSet.run(queue.confirming, resent(queue));

            return yield* heardAs(plan);
          }
        }

        const answered = yield* Effect.onExit(restore(sent), (exit) =>
          Exit.isSuccess(exit) ? Effect.void : Effect.andThen(drop, unkeep),
        );

        if ("refused" in answered) {
          if (answered.unanswered === true && plan !== undefined && entry !== undefined && room()) {
            yield* waits(entry, plan.queued(input));

            return yield* heardAs(plan);
          }

          yield* takenBack(answered);
          yield* unkeep;

          return answered.refused;
        }

        yield* unkeep;
        yield* FiberSet.run(queue.confirming, settled(answered));

        return answered.answer;
      }),
    );
  });
}

/** Each of `entries` laid back over the rows by the declaration its name names among `writes`, in order; one none names, or whose input no longer reads, dropped. */
function requeued(
  entries: readonly QueuedEntry[],
  writes: readonly AnyWrite[],
  rewritten: <Row extends object, Change, Input, Answer>(
    declaration: WriteDeclaration<Row, Change, Input, Answer>,
    input: Input,
    key: string,
  ) => Effect.Effect<void>,
): Effect.Effect<void> {
  const byName = new Map(
    writes.flatMap((each) =>
      each((declaration) =>
        declaration.queue === undefined ? [] : [[declaration.queue.name, each] as const],
      ),
    ),
  );

  return Effect.forEach(
    entries,
    (entry) => {
      const named = byName.get(entry.name);

      if (named === undefined) return Effect.void;

      return named((declaration) => {
        const plan = declaration.queue;

        if (plan === undefined) return Effect.void;
        const input = Result.getOrUndefined(Schema.decodeUnknownResult(plan.input)(entry.input));

        return input === undefined ? Effect.void : rewritten(declaration, input, entry.key);
      });
    },
    { discard: true },
  );
}

/**
 * The pool, empty, for as long as the caller's scope stands, which every
 * kind's rows and every write still standing or waiting are let go with; a
 * pool handed no options keeps no write waiting, and sends every write
 * without a key.
 */
export function entityPool(options?: PoolOptions): Effect.Effect<EntityPool, never, Scope.Scope> {
  return Effect.gen(function* () {
    const scope = yield* Effect.scope;

    const queue: Queue = {
      options,
      confirming: yield* FiberSet.make<void>(),
      lock: yield* Semaphore.make(1),
      moves: yield* PubSub.unbounded<void>(),
      waiting: [],
    };

    /** Whoever watches the pool's kinds and the writes standing over them. */
    const watchers = new Set<() => void>();

    const heard = () => {
      for (const watcher of watchers) watcher();
    };

    /** Each kind's rows held in memory alone, by the kind's own declaration. */
    const memoryKinds = new Map<object, unknown>();
    /** Each stored kind's rows kept in an account's database, by the database and then the kind's own declaration, so a database closed takes its kinds with it. */
    const storedKinds = new WeakMap<CollectionsStore, Map<object, unknown>>();

    /** Where a kind's rows stand now, by how it is `stored`: the kinds they are held among, the scope their collection closes with, and how it is kept on disk where it is. */
    const placeOf = (stored: StoredKind | undefined): KindPlace => {
      const collections = stored === undefined ? undefined : options?.store?.collections?.();

      if (stored === undefined || collections === undefined) return { kinds: memoryKinds, scope };
      const kinds = storedKinds.get(collections) ?? new Map<object, unknown>();
      storedKinds.set(collections, kinds);

      return { kinds, scope: collections.scope, keep: collections.keep(stored) };
    };

    const rowsOf = <Row extends object, Change>(
      kind: RowKind<Row, Change>,
    ): Effect.Effect<KindRows<Row, Change>> =>
      Effect.suspend(() => {
        const place = placeOf(kind.stored);
        const { kinds } = place;
        // SAFETY: the map is keyed by the kind itself, so what it holds for `kind` is of `kind`'s row and change.
        const made = () => kinds.get(kind) as KindRows<Row, Change> | undefined;
        const standing = made();

        if (standing !== undefined) return Effect.succeed(standing);

        return Effect.map(
          Scope.provide(place.scope)(syncedCollection(kind.key, place.keep)),
          (synced) => {
            // Note that a kind made meanwhile by another fiber is the one kept, so a kind has one collection.
            const raced = made();

            if (raced !== undefined) return raced;

            const fresh: KindRows<Row, Change> = {
              kind,
              synced,
              reads: new Set(),
              standing: [],
              lastWrites: new Map(),
              takenAt: new Map(),
              heard,
            };

            kinds.set(kind, fresh);
            heard();

            return fresh;
          },
        );
      });

    return {
      stand: (kind, read) =>
        Effect.flatMap(rowsOf(kind), (rows) => stood(rows, read, options?.store?.rows)),
      write: (declaration, input) =>
        Effect.flatMap(rowsOf(declaration.kind), (rows) =>
          written(rows, queue, declaration, input),
        ),
      collection: (kind) => Effect.map(rowsOf(kind), (rows) => rows.synced.collection),
      standing: <Row extends object, Change>(kind: RowKind<Row, Change>) => {
        // SAFETY: the map is keyed by the kind itself, so what it holds for `kind` is of `kind`'s row and change.
        const rows = placeOf(kind.stored).kinds.get(kind) as KindRows<Row, Change> | undefined;

        if (rows === undefined) return undefined;
        const pending = new Map<string, Row | typeof ROW_GONE>();

        for (const key of new Set(rows.standing.flatMap((write) => write.keys))) {
          const drawn = drawnRow(rows, key);

          if (drawn !== undefined) pending.set(key, drawn);
          else if (rows.synced.collection.has(key)) pending.set(key, ROW_GONE);
        }

        return { collection: rows.synced.collection, pending };
      },
      watch: (watcher) => {
        watchers.add(watcher);

        return () => {
          watchers.delete(watcher);
        };
      },
      row: <Row extends object, Change>(kind: RowKind<Row, Change>, key: string) => {
        // SAFETY: the map is keyed by the kind itself, so what it holds for `kind` is of `kind`'s row and change.
        const rows = placeOf(kind.stored).kinds.get(kind) as KindRows<Row, Change> | undefined;

        return rows === undefined ? undefined : drawnRow(rows, key);
      },
      queued: () => queue.waiting.map((each) => each.entry),
      queueMoves: Stream.fromPubSub(queue.moves),
      requeue: (entries, writes) =>
        requeued(entries, writes, (declaration, input, key) =>
          Effect.asVoid(
            Effect.flatMap(rowsOf(declaration.kind), (rows) =>
              written(rows, queue, declaration, input, key),
            ),
          ),
        ),
      resend: Effect.suspend(() => resent(queue)),
      letGoQueued: Effect.suspend(() => {
        const waiting = queue.waiting;

        if (waiting.length === 0) return Effect.void;

        return Effect.andThen(
          movedTo(queue, []),
          Effect.forEach(waiting, (each) => each.letGo, { discard: true }),
        );
      }),
    };
  });
}
