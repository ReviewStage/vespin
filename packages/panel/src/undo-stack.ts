/**
 * undo-stack.ts -- ⌘Z and ⇧⌘Z for the reader's writes in this window: the entries each takes back and puts back, run one at a time, the row entries whose fields before are read off the rows the window shows, the declared entries whose inverse is an act of its own, and the local entries of state this window holds alone.
 *
 * An entry is one press's write: what it did, in a toast's words, and how
 * to take it back and put it back, each run answering whether it applied.
 * ⌘Z runs the newest entry waiting to be taken back and, where it applied,
 * keeps it for ⇧⌘Z, which mirrors it; a new entry leaves nothing to put
 * back, since what it would put back has been replaced. A toast's Undo runs
 * its own entry through the same lists, so a write is never taken back
 * twice, once by the toast and once by the key. Every run waits for the one
 * before it, so two quick presses never send their writes out of order.
 * The lists are this window's alone, in a store of its own, and go when the
 * account signed in changes, since a write is its presser's own: a write
 * still out then keeps nothing, and a run still waiting sends nothing. Only
 * this module builds an Undo toast, so every Undo runs an entry, bar the
 * writes `TOAST_ONLY_UNDO` declares; an entry pushed off a list past its
 * bound withdraws its toast, whose Undo would find nothing. A toast's words
 * are masked in session replay unless its declaration says they are all the
 * app's own (`unmasked`), which every declaration must say.
 *
 * A row entry (`pressRows`) is built from a declaration of its write's kind
 * (`ROW_WRITE`): the fields the act sets, read off the rows its caller
 * draws, and the act that sets them, so no caller builds an inverse of its
 * own. Its fields before are read as the press is made, before the act is
 * sent, so they are what the reader saw: the window's rows are the sync
 * engine's, every write still standing drawn over them at once
 * (`@repo/sync`), so an earlier write still in flight is read too. Note
 * that each row is taken back only while it still holds what the act set,
 * because a row changed since, here, on another Mac, or by a teammate, was
 * chosen anew, and an undo must not take that choice back.
 *
 * A declared entry (`pressWrite`) is built from a declaration of a write
 * whose inverse is no field sent back (`UndoWrite`): its words, the act and
 * its inverse, whether the target still holds what each set, and what a
 * refusal says and is reported as. The stack sends its act, says what came
 * of it, and keeps it for ⌘Z where the service kept it, so a caller names
 * the declaration and what it asks, and builds no Undo of its own. A write
 * whose change is read off its act's answer is sent by its caller and kept
 * once the service kept it (`keepWrite`).
 *
 * A local entry (`pressLocal`) is built from a declaration of a write to
 * state this window holds alone (`LocalWrite`): a draft closed, a held
 * comment removed. Nothing is sent and nothing refuses it, so it is kept for
 * ⌘Z at the press. One named for a subject leaves both lists, its toast
 * with it, once its caller withdraws that subject (`withdrawUndo`), as what
 * it would put back has gone.
 *
 * A held entry (`pressHeld`) is built from a declaration of a write the host
 * holds from the service until its toast is gone (`HeldWrite`): its words,
 * the act sent held, how its hold is let go, its inverse, and what a refusal
 * of either says. It is kept for ⌘Z at the press, since a held write is
 * drawn at once, and is never put back, since sending it again would be a
 * new write rather than the one taken back.
 */

import type { AgentAgentAnswer } from "@repo/features/agent-view";
import type { AgentSummary } from "@repo/features/agent-wire";
import type { LIVE_READ } from "@repo/features/live-wire";
import {
  FAILURE_SURFACE,
  type FailureAbout,
  type FailureSurface,
} from "@repo/features/shown-failure";
import type { Task, TaskPriority, TaskStatus, TaskSummary } from "@repo/features/task-wire";
import type { TasksView } from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import type { PortActKind } from "@repo/host/contract";
import { STATUS_TONE } from "@repo/ui";
import { Store, useSelector } from "@tanstack/react-store";
import { type ActResult, type ActVariables, askKept, KEPT, type Kept, notKept } from "./act.js";
import { priorityOf, statusOf } from "./desktop/task-row-parts.js";
import type { ShownFailure } from "./failure-report.js";
import {
  showToast,
  TOAST_HOLD,
  type ToastNotice,
  withdrawToast,
  withdrawToastActing,
} from "./toast.js";

/** The most entries each list keeps; an older one leaves as a newer one comes. */
const MAX_ENTRIES = 50;

/** What a toast's action says when it takes back what the toast reports. */
const UNDO_LABEL = "Undo";

/** What a run of an entry came to. */
export const UNDO_RAN = {
  /** The write was sent and the service kept it. */
  APPLIED: "applied",
  /** No row still held what the entry set, so nothing was sent. */
  CHANGED: "changed",
  /** The service refused the write. */
  REFUSED: "refused",
} as const;

export type UndoRan = (typeof UNDO_RAN)[keyof typeof UNDO_RAN];

/** A run's answer: whether it applied, and the failure where the service refused it, with its own words where its declaration names them. */
type UndoRun =
  | { readonly ran: typeof UNDO_RAN.APPLIED | typeof UNDO_RAN.CHANGED }
  | {
      readonly ran: typeof UNDO_RAN.REFUSED;
      readonly failure: ShownFailure;
      readonly words?: string;
      /** What its toast offers, as asking again for what was not reached. */
      readonly action?: ToastAction;
    };

const APPLIED_RUN: UndoRun = { ran: UNDO_RAN.APPLIED };

const CHANGED_RUN: UndoRun = { ran: UNDO_RAN.CHANGED };

/** A toast's one action, as a refusal's toast offers it. */
type ToastAction = NonNullable<ToastNotice["action"]>;

/** One press's write: what it did, in a toast's words, and how to take it back and put it back; one that cannot be put back names no redo. */
interface UndoEntry {
  readonly words: string;
  readonly undo: () => Promise<UndoRun>;
  readonly redo?: () => Promise<UndoRun>;
  /** What taking it back claims as it is pressed, before its run's turn comes, as a held write's hold. */
  readonly claim?: () => void;
  /** What it is about, by which its caller withdraws it with its toast (`withdrawUndo`); none for an entry that stays until it is run or pushed out. */
  readonly subject?: string | undefined;
}

/** The entries waiting on each key, oldest first. */
interface UndoLine {
  /** What ⌘Z takes back. */
  readonly undo: readonly UndoEntry[];
  /** What ⇧⌘Z puts back. */
  readonly redo: readonly UndoEntry[];
}

/** Which way a run goes, named as the list it runs from and the entry's run it calls. */
const UNDO_WAY = {
  UNDO: "undo",
  REDO: "redo",
} as const satisfies Record<string, keyof UndoLine & keyof UndoEntry>;

type UndoWay = (typeof UNDO_WAY)[keyof typeof UNDO_WAY];

/** The way a run that applied leaves its entry to go next. */
const BACK_WAY = {
  [UNDO_WAY.UNDO]: UNDO_WAY.REDO,
  [UNDO_WAY.REDO]: UNDO_WAY.UNDO,
} as const satisfies Record<UndoWay, UndoWay>;

/** What a toast says once a key's run applied, before the entry's own words. */
const DONE_WORDS = {
  [UNDO_WAY.UNDO]: "Undone",
  [UNDO_WAY.REDO]: "Redone",
} as const satisfies Record<UndoWay, string>;

/** What a toast says where a run found no row still holding what it would change. */
const CHANGED_WORDS = {
  [UNDO_WAY.UNDO]: "Not undone, as it has changed since.",
  [UNDO_WAY.REDO]: "Not redone, as it has changed since.",
} as const satisfies Record<UndoWay, string>;

/** What a toast says where the service refused a run's write. */
const REFUSED_WORDS = {
  [UNDO_WAY.UNDO]: "The change could not be undone. Try again.",
  [UNDO_WAY.REDO]: "The change could not be redone. Try again.",
} as const satisfies Record<UndoWay, string>;

const EMPTY_LINE: UndoLine = { undo: [], redo: [] };

/** This window's lists, the module's as its toasts are, since a press's entry outlives the menu that pushed it. */
const undoLine = new Store<UndoLine>(EMPTY_LINE);

/** The run every next run waits for: the newest asked. */
let turn: Promise<unknown> = Promise.resolve();

/** How many times the lists were emptied, so a run that settles after its account left keeps nothing. */
let generation = 0;

/** Each entry's toast's Undo, by which its toast is withdrawn once the entry is pushed off the lists. */
const undoPresses = new WeakMap<UndoEntry, () => void>();

/** The lists as they stand. */
function lineNow(): UndoLine {
  return undoLine.state;
}

/**
 * `entry` laid on top of `entries`, the oldest leaving past the bound. Note
 * that one pushed off withdraws its toast, because that toast's Undo would
 * no longer find it and so would do nothing.
 */
function stacked(entries: readonly UndoEntry[], entry: UndoEntry): readonly UndoEntry[] {
  const next = [...entries, entry];
  for (const off of next.slice(0, -MAX_ENTRIES)) {
    const press = undoPresses.get(off);
    if (press !== undefined) withdrawToastActing(press);
  }
  return next.slice(-MAX_ENTRIES);
}

/**
 * The toast an act that happened at once says it with, so the reader can
 * take it back: its words in the success tone, with Undo, standing for the
 * Undo hold. Pressing Undo dismisses it, then runs `undo`. Note that only
 * this module builds one, so every Undo runs an entry through the lists,
 * bar the writes `TOAST_ONLY_UNDO` names.
 */
function undoToast(words: string, undo: () => void): ToastNotice {
  return {
    words,
    tone: STATUS_TONE.COMPLETE,
    action: { label: UNDO_LABEL, onPress: undo, replayUnmasked: true },
    hold: TOAST_HOLD.UNDO,
  };
}

/** The toast a write that happened at once says it with where nothing is left to take back: its words alone. */
function doneToast(words: string): ToastNotice {
  return { words, tone: STATUS_TONE.COMPLETE, hold: TOAST_HOLD.DONE };
}

/** Says what a run came to: a refusal and a row changed since, always; a key's run that applied names its entry, and one from its own toast says nothing more. */
function said(entry: UndoEntry, way: UndoWay, run: UndoRun, keyed: boolean): void {
  if (run.ran === UNDO_RAN.REFUSED) {
    const saying = {
      words: run.words ?? REFUSED_WORDS[way],
      tone: STATUS_TONE.DANGER,
      hold: TOAST_HOLD.FAILED,
      failure: run.failure,
      replayUnmasked: run.words !== undefined,
    } as const;
    showToast(run.action === undefined ? saying : { ...saying, action: run.action });
    return;
  }
  if (run.ran === UNDO_RAN.CHANGED) {
    showToast({ words: CHANGED_WORDS[way], tone: STATUS_TONE.ATTENTION, hold: TOAST_HOLD.DONE });
    return;
  }
  if (!keyed) return;
  showToast({
    words: `${DONE_WORDS[way]}: ${entry.words}`,
    tone: STATUS_TONE.COMPLETE,
    hold: TOAST_HOLD.DONE,
  });
}

/**
 * Takes `entry` off the list `way` runs from and runs it once every run
 * asked before it has settled, keeping it for the other way where it
 * applied and dropping it where it did not. Answers what it came to, or
 * nothing where that list no longer held it: a toast's Undo for an entry a
 * key already took back.
 */
function ran(entry: UndoEntry, way: UndoWay, keyed: boolean): Promise<UndoRan | undefined> {
  const line = lineNow();
  const go = entry[way];
  if (go === undefined || !line[way].includes(entry)) return Promise.resolve(undefined);
  if (way === UNDO_WAY.UNDO) entry.claim?.();
  undoLine.setState(() => ({ ...line, [way]: line[way].filter((each) => each !== entry) }));
  const asked = generation;
  // Note that a run still waiting its turn as the account changes sends nothing, because it would send the last account's write on the next one's session.
  const run = turn.then(() => {
    if (asked !== generation) return undefined;
    return go().then((answered) => {
      if (asked !== generation) return answered.ran;
      const back = BACK_WAY[way];
      if (answered.ran === UNDO_RAN.APPLIED && entry[back] !== undefined) {
        const now = lineNow();
        undoLine.setState(() => ({ ...now, [back]: stacked(now[back], entry) }));
      }
      said(entry, way, answered, keyed);
      return answered.ran;
    });
  });
  turn = run.catch(() => undefined);
  return run;
}

/** The newest entry waiting on `way`'s list, run; nothing where none waits. */
function ranNewest(way: UndoWay): Promise<UndoRan | undefined> {
  const newest = lineNow()[way].at(-1);
  return newest === undefined ? Promise.resolve(undefined) : ran(newest, way, true);
}

/** Keeps `entry` as the newest for ⌘Z, leaving nothing for ⇧⌘Z, and answers its toast, whose Undo runs it through the lists. */
function undoable(entry: UndoEntry): ToastNotice {
  const press = () => void ran(entry, UNDO_WAY.UNDO, false);
  undoPresses.set(entry, press);
  const { undo } = lineNow();
  undoLine.setState(() => ({ undo: stacked(undo, entry), redo: [] }));
  return undoToast(entry.words, press);
}

/** ⌘Z: takes back the newest entry, answering what it came to, or nothing where none waits. */
export function undoLast(): Promise<UndoRan | undefined> {
  return ranNewest(UNDO_WAY.UNDO);
}

/** ⇧⌘Z: puts back the entry taken back last, answering what it came to, or nothing where none waits. */
export function redoLast(): Promise<UndoRan | undefined> {
  return ranNewest(UNDO_WAY.REDO);
}

/** Which keys have an entry waiting on them. */
export interface UndoWaits {
  readonly undoes: boolean;
  readonly redoes: boolean;
}

/** Which keys have an entry waiting, for the window to offer their commands by. */
export function useUndoWaits(): UndoWaits {
  const undoes = useSelector(undoLine, (line) => line.undo.length > 0);
  const redoes = useSelector(undoLine, (line) => line.redo.length > 0);
  return { undoes, redoes };
}

/** Every entry about `subject` taken off both lists, and its toast withdrawn, once what it would put back has gone. */
export function withdrawUndo(subject: string): void {
  withdrawToast(subject);
  const kept = (entry: UndoEntry) => entry.subject !== subject;
  undoLine.setState((now) => ({ undo: now.undo.filter(kept), redo: now.redo.filter(kept) }));
}

/**
 * The writes whose Undo stands on their toast alone, outside the lists, so
 * ⌘Z never reaches them, each with whether its toast's words are the app's
 * own: a version restored, whose Undo restores the version that stood
 * before it, and an agent archived after a question was asked first, since
 * ⌘Z must not put back what took a question, or with no row of it drawn to
 * read what to put back. Every other Undo is an entry's.
 */
export const TOAST_ONLY_UNDO = {
  VERSION_RESTORE: { replayUnmasked: true },
  AGENT_ARCHIVE: { replayUnmasked: true },
} as const;

export type ToastOnlyUndo = (typeof TOAST_ONLY_UNDO)[keyof typeof TOAST_ONLY_UNDO];

/** The toast one of the writes `TOAST_ONLY_UNDO` names says itself with, whose Undo runs `undo` and nothing on the lists. */
export function toastOnlyUndo(write: ToastOnlyUndo, words: string, undo: () => void): ToastNotice {
  return { ...undoToast(words, undo), replayUnmasked: write.replayUnmasked };
}

/** Both lists emptied, as the account signed in changes, so no write is taken back under another account. */
export function forgetUndo(): void {
  generation += 1;
  undoLine.setState(() => EMPTY_LINE);
}

/** How a row write's act is sent: the `mutateAsync` of its kind's mutation (`act-mutations.ts`). */
type RowSend<Kind extends PortActKind> = (
  variables: ActVariables<Kind>,
) => Promise<ActResult<Kind>>;

/**
 * A kind of row write, as an entry takes it back and puts it back: the
 * fields it sets as the rows a caller draws (`Rows`) show them on one row,
 * whether a row still holds some, and the act that sets them, by its `kind`.
 * `Fields` names every field the act may set; one press sets those its
 * `after` names.
 */
export interface RowWrite<Rows, Fields extends object, Kind extends PortActKind> {
  /** The fields of `id`'s row as `rows` show it; none where they show no such row. */
  readonly read: (rows: Rows, id: string) => Fields | undefined;
  /** Whether `now` holds what `wanted` names, of the fields it names. */
  readonly holds: (now: Fields, wanted: Fields) => boolean;
  /** The act that sets the fields, whose mutation a caller's doors send it on. */
  readonly kind: Kind;
  /** Sends `id`'s row the fields `fields` names on `send`, answering whether the service kept it. */
  readonly send: (send: RowSend<Kind>, id: string, fields: Fields) => Promise<Kept>;
  /** Whether the words its callers keep it with are all the app's own, which a screen recording shows as they read; one quoting a name leaves this false. */
  readonly unmasked: boolean;
  /** What a refusal of it is reported as. */
  readonly surface: FailureSurface;
  /** What a run's refusal says and is about, of the first row refused, the fields sent it, and how many rows the run sent were kept and refused; the stack's own words where none. */
  readonly refused?: (id: string, sent: Fields, kept: number, refused: number) => RowRefusal;
}

/** What a row write's refusal says, and what it is about. */
export interface RowRefusal {
  readonly words: string;
  readonly about?: FailureAbout;
}

/**
 * Where a press's rows are read and its writes sent, for as long as its
 * entry waits: the rows its caller draws, as they stand at each call, which
 * are the window's own (`app:state`), and the caller's mutation of the
 * write's act. Note that a mutation sent after its caller is gone still
 * reaches the act port, so ⌘Z sends through it after the row's surface left.
 */
export interface RowDoors<Rows, Kind extends PortActKind> {
  readonly rows: () => Rows;
  readonly send: RowSend<Kind>;
}

/** One row a press writes: its id, and the fields the act sets on it, as it sets them. */
export interface RowAsked<Fields extends object> {
  readonly id: string;
  readonly after: Fields;
}

/** One row a press wrote: its id, and the fields the act set, as they stood before and as it set them. */
interface RowChange<Fields extends object> {
  readonly id: string;
  readonly before: Fields;
  readonly after: Fields;
}

/** A press's rows as they stood before its act was drawn, for an entry to keep once the service answers. */
export interface PressedRows {
  /** Whether the doors showed any of its rows as it was pressed, so there is something to put back. */
  readonly drawn: boolean;
  /**
   * Keeps the rows the service kept, those `kept` says it kept or every one
   * where it says nothing, as the newest entry for ⌘Z, called `words`. Keep
   * it once the act answers kept, never at the press, so a write the
   * service refused is never offered back. Answers the toast to say it
   * with: its Undo, which runs the entry through the lists, or its words
   * alone where no row is left to change; none, and no entry, where the
   * account signed in changed since the press.
   */
  readonly keep: (words: string, kept?: (id: string) => boolean) => ToastNotice | undefined;
}

/** Of `whole`, the fields `like` names. */
function fieldsLike<Fields extends object>(whole: Fields, like: Fields): Fields {
  // SAFETY: each key is one of `like`'s own, so the fields kept are of `Fields`, as `like` is.
  return Object.fromEntries(
    Object.keys(like).map((key) => [key, Reflect.get(whole, key)]),
  ) as Fields;
}

/** Whether `now` holds each field `wanted` names, by value. */
function holdsEach<Fields extends object>(now: Fields, wanted: Fields): boolean {
  return Object.entries(wanted).every(([key, value]) => Object.is(Reflect.get(now, key), value));
}

/**
 * Each of `changes` that `due` finds still holding what the run takes away,
 * sent on `send`, as one run: it applied where every one sent was, it was
 * refused as the first refused one was, and it changed where none was due.
 */
function dueRun<Change>(
  changes: readonly Change[],
  due: (change: Change) => boolean,
  send: (change: Change) => Promise<UndoRun>,
): Promise<UndoRun> {
  const sent = changes.filter(due);
  if (sent.length === 0) return Promise.resolve(CHANGED_RUN);
  return Promise.all(sent.map(send)).then(
    (runs) => runs.find((run) => run.ran === UNDO_RAN.REFUSED) ?? APPLIED_RUN,
  );
}

/**
 * Each row of `changes` still holding what `from` names sent what `to`
 * names, as one run: it applied where every row sent was kept, changed
 * where no row still held it, and was refused as the first row refused
 * was, in its declaration's words where it names them.
 */
function rowsRun<Rows, Fields extends object, Kind extends PortActKind>(
  write: RowWrite<Rows, Fields, Kind>,
  doors: RowDoors<Rows, Kind>,
  changes: readonly RowChange<Fields>[],
  from: (change: RowChange<Fields>) => Fields,
  to: (change: RowChange<Fields>) => Fields,
): Promise<UndoRun> {
  const rows = doors.rows();
  const sent = changes.filter((change) => {
    const now = write.read(rows, change.id);
    return now !== undefined && write.holds(now, from(change));
  });
  if (sent.length === 0) return Promise.resolve(CHANGED_RUN);
  return Promise.all(sent.map((change) => write.send(doors.send, change.id, to(change)))).then(
    (answers): UndoRun => {
      const at = answers.findIndex((answer) => !answer.kept);
      const first = answers[at];
      const change = sent[at];
      if (first === undefined || first.kept || change === undefined) return APPLIED_RUN;
      const refused = answers.filter((answer) => !answer.kept).length;
      const said = write.refused?.(change.id, to(change), answers.length - refused, refused);
      return {
        ran: UNDO_RAN.REFUSED,
        failure: { surface: write.surface, cause: first.cause, about: said?.about },
        ...(said === undefined ? undefined : { words: said.words }),
      };
    },
  );
}

/**
 * The rows of a press as `doors` show them before its act is drawn, each
 * with the fields the act sets as they stand now. Read it as the press is
 * made, before the act is sent, so what it holds before is what the reader
 * saw. A row the doors show none of is left out, since there is nothing to
 * put back on it. Each row is taken back to its fields before, and put back
 * to its fields after, only while it still holds the other.
 */
export function pressRows<Rows, Fields extends object, Kind extends PortActKind>(
  write: RowWrite<Rows, Fields, Kind>,
  doors: RowDoors<Rows, Kind>,
  asked: readonly RowAsked<Fields>[],
): PressedRows {
  const since = generation;
  const rows = doors.rows();
  const changes = asked.flatMap(({ id, after }): readonly RowChange<Fields>[] => {
    const now = write.read(rows, id);
    return now === undefined ? [] : [{ id, before: fieldsLike(now, after), after }];
  });
  return {
    drawn: changes.length > 0,
    keep: (words, kept = () => true) => {
      if (since !== generation) return undefined;
      const landed = changes.filter((change) => kept(change.id));
      if (landed.length === 0) return { ...doneToast(words), replayUnmasked: write.unmasked };
      const toast = undoable({
        words,
        undo: () =>
          rowsRun(
            write,
            doors,
            landed,
            (each) => each.after,
            (each) => each.before,
          ),
        redo: () =>
          rowsRun(
            write,
            doors,
            landed,
            (each) => each.before,
            (each) => each.after,
          ),
      });
      return { ...toast, replayUnmasked: write.unmasked };
    },
  };
}

/**
 * A write an entry takes back by an act of its own rather than by sending
 * fields back: a block taken away is added again, a parent cleared is set
 * again. `Asked` is what a press names, `Change` what the press read of it
 * that its inverse needs, and `Answer` what its act answers, which it
 * settles itself, an act that never answered among it, so it never rejects.
 */
export interface UndoWrite<Rows, Asked, Change, Kind extends PortActKind, Answer> {
  /** What its toast says once the act is kept, and what ⌘Z's toast calls it: the same for every press, or of what the press changed. */
  readonly words: string | ((change: Change) => string);
  /** Whether its toast's words are all the app's own, which a screen recording shows as they read; one quoting a name answers false. */
  readonly unmasked: (change: Change) => boolean;
  /** The act its write and its inverse are sent on, whose mutation a caller's doors send it on. */
  readonly kind: Kind;
  /** What `asked` changes as `rows` show it, read as the press is made; none where there is nothing to change. */
  readonly read: (rows: Rows, asked: Asked) => Change | undefined;
  /** Sends the write, against `rows` as they stand as it is sent. */
  readonly act: (send: RowSend<Kind>, change: Change, rows: Rows) => Promise<Answer>;
  /** Sends its inverse, against `rows` as they stand as it is sent. */
  readonly undo: (send: RowSend<Kind>, change: Change, rows: Rows) => Promise<Answer>;
  /** Whether `rows` still hold what the act set, so ⌘Z may take it back. */
  readonly holds: (rows: Rows, change: Change) => boolean;
  /** Whether `rows` still hold what the inverse set, so ⇧⌘Z may put it back. */
  readonly undone: (rows: Rows, change: Change) => boolean;
  /** What a refusal of the act or its inverse says, of the answer that refused it; none where the answer kept it. */
  readonly refused: (answer: Answer) => string | undefined;
  /** What a refusal of it is reported as. */
  readonly surface: FailureSurface;
  /** What a refusal of it is about. */
  readonly about?: (change: Change) => FailureAbout;
  /** What a refusal reports as its cause, of the answer that refused it; the answer itself where none is named. */
  readonly cause?: (answer: Answer) => unknown;
}

/** What a declared write's refusal reports: its surface, the answer that refused it, and what it is about. */
function writeFailure<Rows, Asked, Change, Kind extends PortActKind, Answer>(
  write: UndoWrite<Rows, Asked, Change, Kind, Answer>,
  change: Change,
  answer: Answer,
): ShownFailure {
  const cause = write.cause === undefined ? answer : write.cause(answer);
  return { surface: write.surface, cause, about: write.about?.(change) };
}

/** A declared write's answer as a run of it: applied where kept, else refused in its own words. */
function answeredRun<Rows, Asked, Change, Kind extends PortActKind, Answer>(
  write: UndoWrite<Rows, Asked, Change, Kind, Answer>,
  change: Change,
  answer: Answer,
): UndoRun {
  const words = write.refused(answer);
  return words === undefined
    ? APPLIED_RUN
    : { ran: UNDO_RAN.REFUSED, words, failure: writeFailure(write, change, answer) };
}

/**
 * Presses a declared write: reads what `asked` changes off `doors`' rows,
 * sends its act, and once the service keeps it keeps it as the newest entry
 * for ⌘Z and says so with its toast's Undo, which runs that entry; a
 * refusal says so in its own words, since the menu that asked has closed.
 * The entry is taken back only while the rows still hold what the act set,
 * and put back only while they hold what its inverse set. Answers whether
 * the service kept it; not where there was nothing to change. Its toasts
 * are said on `say`, a working toast's settle where the press showed one,
 * and none keeps an entry once the account signed in changed while its act
 * was out.
 */
export function pressWrite<Rows, Asked, Change, Kind extends PortActKind, Answer>(
  write: UndoWrite<Rows, Asked, Change, Kind, Answer>,
  doors: RowDoors<Rows, Kind>,
  asked: Asked,
  say: (notice: ToastNotice) => void = showToast,
): Promise<boolean> {
  const change = write.read(doors.rows(), asked);
  if (change === undefined) return Promise.resolve(false);
  const keep = keepWrite(write, doors, say);
  return write.act(doors.send, change, doors.rows()).then((answer) => {
    const refusal = write.refused(answer);
    if (refusal !== undefined) {
      say({
        replayUnmasked: true,
        words: refusal,
        tone: STATUS_TONE.DANGER,
        hold: TOAST_HOLD.FAILED,
        failure: writeFailure(write, change, answer),
      });
      return false;
    }
    keep(change);
    return true;
  });
}

/**
 * Answers how to keep a declared write its caller sends as the newest entry
 * for ⌘Z once the service kept it, saying so with its toast's Undo, which
 * runs that entry: for a write whose change is read off its act's answer,
 * which `pressWrite` cannot read before it sends. Call it as the press is
 * made, before the act is sent, because a write whose act was still out as
 * the account signed in changed keeps no entry and says nothing. The entry
 * is taken back only while the rows still hold what the act set, and put
 * back only while they hold what its inverse set. Its toast is said on
 * `say`, as `pressWrite`'s are.
 */
export function keepWrite<Rows, Asked, Change, Kind extends PortActKind, Answer>(
  write: UndoWrite<Rows, Asked, Change, Kind, Answer>,
  doors: RowDoors<Rows, Kind>,
  say: (notice: ToastNotice) => void = showToast,
): (change: Change) => void {
  const since = generation;
  return (change) => {
    if (since === generation) keptWrite(write, doors, change, say);
  };
}

/** Keeps a declared write the service kept as the newest entry for ⌘Z, and says so on `say` with its toast's Undo (`keepWrite`). */
function keptWrite<Rows, Asked, Change, Kind extends PortActKind, Answer>(
  write: UndoWrite<Rows, Asked, Change, Kind, Answer>,
  doors: RowDoors<Rows, Kind>,
  change: Change,
  say: (notice: ToastNotice) => void,
): void {
  const run = (
    due: (rows: Rows, change: Change) => boolean,
    send: (send: RowSend<Kind>, change: Change, rows: Rows) => Promise<Answer>,
  ) =>
    dueRun(
      [change],
      (each) => due(doors.rows(), each),
      (each) =>
        send(doors.send, each, doors.rows()).then((answer) => answeredRun(write, each, answer)),
    );
  const words = typeof write.words === "string" ? write.words : write.words(change);
  const toast = undoable({
    words,
    undo: () => run(write.holds, write.undo),
    redo: () => run(write.undone, write.act),
  });
  say({ ...toast, replayUnmasked: write.unmasked(change) });
}

/** What a refusal of a held write says, and what it is reported as. */
export interface HeldRefusal {
  readonly words: string;
  readonly failure: ShownFailure;
}

/** What a refusal of a held write's act says, and whether the service took none of it, so nothing is left for ⌘Z to take back. */
export interface HeldActRefusal extends HeldRefusal {
  readonly whole: boolean;
}

/** What a refusal of a held write's inverse says, and, where part of it was not reached, what asking again takes back and what that action is called. */
export interface HeldUndoRefusal<Change> extends HeldRefusal {
  readonly retry?: { readonly label: string; readonly change: Change };
}

/**
 * A write the host holds from the service until its toast is gone, taken
 * back by letting the hold go unsent rather than by an act of its own:
 * `Doors` are the caller's mutations it is sent on, `Change` what a press
 * changes, `Answer` what its act answers and `Released` what letting its
 * hold go unsent answers, each settled by itself, an act that never
 * answered among it, so neither rejects.
 */
export interface HeldWrite<Doors, Change, Answer, Released> {
  /** What its toast says, and what ⌘Z's toast calls it. */
  readonly words: (change: Change) => string;
  /** The glyph its toast leads with. */
  readonly glyph: NonNullable<ToastNotice["glyph"]>;
  /** Whether its toast's words are the app's own, which a screen recording shows as they read; one quoting a name leaves this false. */
  readonly unmasked: (change: Change) => boolean;
  /** Sends the write, held. */
  readonly act: (doors: Doors, change: Change) => Promise<Answer>;
  /** Lets the hold go as sent. */
  readonly letGo: (doors: Doors, change: Change) => void;
  /** Lets the hold go unsent, which takes the write back while the host still holds it. */
  readonly undo: (doors: Doors, change: Change) => Promise<Released>;
  /** What a refusal of the act says, of its answer; none where the service took it. */
  readonly refused: (change: Change, answer: Answer) => HeldActRefusal | undefined;
  /** What a refusal of its inverse says, of its answer; none where the write was taken back. */
  readonly unheld: (change: Change, released: Released) => HeldUndoRefusal<Change> | undefined;
}

/** Lets each held write this window still holds go as sent; each lets itself out of the set as it goes. */
const heldHere = new Set<() => void>();

/** Whether the window's leaving is heard yet, which is heard once for the window's life. */
let leavingHeard = false;

/**
 * Lets every write the window holds go as sent once it leaves, heard once
 * for the window's life rather than a surface's, since a toast outlives the
 * surface it was pressed on. Note that a page kept in the back-forward cache
 * has not left, because it may come back with its toast and its Undo still
 * standing.
 */
function hearLeaving(): void {
  if (leavingHeard) return;
  leavingHeard = true;
  window.addEventListener("pagehide", (event) => {
    if (event.persisted) return;
    for (const letGo of [...heldHere]) letGo();
  });
}

/**
 * Presses a held write: sends its act held, keeps it at once as the newest
 * entry for ⌘Z, and says so with its toast's Undo, which runs that entry;
 * once the toast is gone, or the window leaves, the hold is let go as sent.
 * ⌘Z takes it back by letting the hold go unsent, which, once the hold was
 * let go, takes it back only where the host still holds it, and says why
 * otherwise. A refusal of the act says so in its own words, unless the
 * write was taken back. Answers once the act answered.
 */
export function pressHeld<Doors, Change, Answer, Released>(
  write: HeldWrite<Doors, Change, Answer, Released>,
  doors: Doors,
  change: Change,
): Promise<void> {
  hearLeaving();
  let taken = false;
  const letGo = () => {
    if (!heldHere.delete(letGo)) return;
    write.letGo(doors, change);
  };
  heldHere.add(letGo);
  // Note that the hold is claimed as the take-back is pressed, by ⌘Z or its toast's Undo, because its toast may be gone, and let the hold go, before the run's turn comes.
  const claim = () => {
    heldHere.delete(letGo);
    taken = true;
  };
  const answered = write.act(doors, change);
  const entry: UndoEntry = {
    words: write.words(change),
    claim,
    undo: () => takeBack(change),
  };
  const takeBack = (among: Change): Promise<UndoRun> =>
    write.undo(doors, among).then((released): UndoRun => {
      const refusal = write.unheld(among, released);
      if (refusal === undefined) return APPLIED_RUN;
      const { words, failure, retry } = refusal;
      if (retry === undefined) return { ran: UNDO_RAN.REFUSED, words, failure };
      const again = () =>
        void takeBack(retry.change).then((run) => said(entry, UNDO_WAY.UNDO, run, false));
      return {
        ran: UNDO_RAN.REFUSED,
        words,
        failure,
        action: { label: retry.label, replayUnmasked: true, onPress: again },
      };
    });
  showToast({
    ...undoable(entry),
    glyph: write.glyph,
    replayUnmasked: write.unmasked(change),
    onGone: letGo,
  });
  return answered.then((answer) => {
    // Note that a write taken back answers nothing worth saying, since the reader undid it.
    const refusal = taken ? undefined : write.refused(change, answer);
    if (refusal === undefined) return;
    // Note that a write the service took none of leaves the list, so ⌘Z takes back the one before it rather than saying it was too late.
    if (refusal.whole) {
      undoLine.setState((now) => ({ ...now, undo: now.undo.filter((each) => each !== entry) }));
    }
    showToast({
      replayUnmasked: true,
      words: refusal.words,
      tone: STATUS_TONE.DANGER,
      hold: TOAST_HOLD.FAILED,
      failure: refusal.failure,
    });
  });
}

/**
 * A write to state this window holds alone, which nothing sends and nothing
 * refuses: its words, the write and its inverse, each made at once, and
 * whether the state still holds what each made. `Doors` is where its
 * caller's state is read and written, as it stands at each call, and
 * `Change` what the press read of it that its inverse needs.
 */
export interface LocalWrite<Doors, Change> {
  /** What its toast says, and what ⌘Z's toast calls it. */
  readonly words: string;
  /** Whether its toast's words are all the app's own, which a screen recording shows as they read; one quoting a name answers false. */
  readonly unmasked: (change: Change) => boolean;
  /** Makes the write. */
  readonly act: (doors: Doors, change: Change) => void;
  /** Makes its inverse. */
  readonly undo: (doors: Doors, change: Change) => void;
  /** Whether `doors` still hold what the act made, so ⌘Z may take it back. */
  readonly holds: (doors: Doors, change: Change) => boolean;
  /** Whether `doors` still hold what the inverse made, so ⇧⌘Z may put it back. */
  readonly undone: (doors: Doors, change: Change) => boolean;
}

/**
 * Presses a local write: makes it, keeps it as the newest entry for ⌘Z, and
 * says so with its toast's Undo, which runs that entry. The entry is taken
 * back only while `doors` still hold what the act made, and put back only
 * while they hold what its inverse made. One named for `subject` carries it
 * on its toast, and leaves with that toast as its caller withdraws it
 * (`withdrawUndo`).
 */
export function pressLocal<Doors, Change>(
  write: LocalWrite<Doors, Change>,
  doors: () => Doors,
  change: Change,
  subject?: string,
): void {
  write.act(doors(), change);
  const run = (
    due: (doors: Doors, change: Change) => boolean,
    make: (doors: Doors, change: Change) => void,
  ) =>
    dueRun(
      [change],
      (each) => due(doors(), each),
      (each) => {
        make(doors(), each);
        return Promise.resolve(APPLIED_RUN);
      },
    );
  const toast = undoable({
    words: write.words,
    undo: () => run(write.holds, write.undo),
    redo: () => run(write.undone, write.act),
    subject,
  });
  showToast({
    ...toast,
    replayUnmasked: write.unmasked(change),
    ...(subject === undefined ? undefined : { subject }),
  });
}

/**
 * The rows a task's write reads: the tasks drawn, and the plans the host
 * holds for the window (`LIVE_READ.DESCRIPTION_DOCUMENT`), none before the
 * document is read, as the caller's Query client holds them.
 */
export interface TaskRows {
  readonly tasks: TasksView;
  readonly held: AppStateSnapshot[typeof LIVE_READ.DESCRIPTION_DOCUMENT] | undefined;
}

/** A task as the host holds its plan for the window, with what the list leaves out, its blocks among it; none where it holds none. */
export function heldTask({ held }: TaskRows, taskId: string): Task | undefined {
  const rows = held?.[taskId]?.rows;
  return rows !== undefined && "task" in rows ? rows.task : undefined;
}

/**
 * A task's row as the tasks drawn show it: the list's, else its plan's as
 * the host holds it for the window, as a task just started is held before
 * the list carries it.
 */
export function taskRow(rows: TaskRows, taskId: string): TaskSummary | undefined {
  return rows.tasks.tasks.find((task) => task.id === taskId) ?? heldTask(rows, taskId);
}

/** A pin as an entry reads and sends it: whether it stands, and where it was dragged, none while it stands by when it was pinned. */
interface PinFields {
  readonly pinned: boolean;
  readonly position: string | null;
}

/** Where a task stands, as an entry reads and sends it: a member assigned by id and the name the window knows them by. */
interface StandingFields {
  readonly status?: TaskStatus;
  readonly priority?: TaskPriority;
  readonly assignee?: NonNullable<TaskSummary["assignee"]> | null;
}

/** An agent's answer to a write as whether it was kept, with what refused it where it was not. */
function agentKept(asked: Promise<AgentAgentAnswer>): Promise<Kept> {
  return asked.then((answer) => ("agent" in answer ? KEPT : notKept(answer)), notKept);
}

/** An agent's pin as the tasks drawn show it: on its own row for one with no plan, else among its plan's pins; none where they show no such agent. */
function agentPin(tasks: TasksView, agentId: string): PinFields | undefined {
  const { tasklessAgents = [], taskAgents = [], taskAgentPins = [] } = tasks;
  const taskless = tasklessAgents.find((agent) => agent.id === agentId);
  if (taskless !== undefined) {
    return { pinned: taskless.pinnedAt !== undefined, position: taskless.pinPosition ?? null };
  }
  if (!taskAgents.some((agent) => agent.id === agentId)) return undefined;
  const pin = taskAgentPins.find((each) => each.agentId === agentId);
  return { pinned: pin !== undefined, position: pin?.pinPosition ?? null };
}

/** The pin a write sends: a place only with a pin that was dragged to one. */
function pinSent({ pinned, position }: PinFields): { pinned: boolean; position?: string } {
  return pinned && position !== null ? { pinned, position } : { pinned };
}

/**
 * The row writes an entry takes back and puts back, one for each act that
 * changes a row's fields at once and asks nothing first (`CLAUDE.md`'s
 * Confirms): a task's name, where it stands, and its pin, read off the
 * tasks drawn, and an agent's pin, read there too, and its archive, read
 * off the agents drawn.
 */
export const ROW_WRITE = {
  TASK_RENAME: {
    read: (tasks, taskId) => {
      const task = taskRow(tasks, taskId);
      return task === undefined ? undefined : { name: task.name };
    },
    holds: holdsEach,
    kind: ACT_KIND.TASKS_RENAME,
    send: (send, taskId, { name }) => askKept(send({ taskId, name })),
    unmasked: true,
    surface: FAILURE_SURFACE.TASK_RENAME,
  } satisfies RowWrite<TaskRows, { readonly name: string }, typeof ACT_KIND.TASKS_RENAME>,
  TASK_STANDING: {
    read: (tasks, taskId) => {
      const task = taskRow(tasks, taskId);
      if (task === undefined) return undefined;
      return {
        status: statusOf(task),
        priority: priorityOf(task),
        assignee: task.assignee ?? null,
      };
    },
    // Note that a member assigned is compared by id alone, because the name the window drew them by gives way to the service's.
    holds: ({ assignee, ...now }, { assignee: wanted, ...rest }) =>
      holdsEach(now, rest) &&
      (wanted === undefined || (assignee?.userId ?? null) === (wanted?.userId ?? null)),
    kind: ACT_KIND.TASKS_SET_STANDING,
    send: (send, taskId, { assignee, ...standing }) =>
      askKept(
        send({
          taskId,
          ...standing,
          ...(assignee === undefined
            ? undefined
            : assignee === null
              ? { assigneeId: null }
              : { assigneeId: assignee.userId, assigneeName: assignee.name }),
        }),
      ),
    unmasked: true,
    surface: FAILURE_SURFACE.TASK_STANDING,
  } satisfies RowWrite<TaskRows, StandingFields, typeof ACT_KIND.TASKS_SET_STANDING>,
  TASK_PIN: {
    read: (tasks, taskId) => {
      const task = taskRow(tasks, taskId);
      if (task === undefined) return undefined;
      return { pinned: task.pinnedAt !== undefined, position: task.pinPosition ?? null };
    },
    holds: holdsEach,
    kind: ACT_KIND.TASKS_PIN,
    send: (send, taskId, pin) => askKept(send({ taskId, ...pinSent(pin) })),
    unmasked: true,
    surface: FAILURE_SURFACE.TASK_MARK,
  } satisfies RowWrite<TaskRows, PinFields, typeof ACT_KIND.TASKS_PIN>,
  AGENT_PIN: {
    read: ({ tasks }, agentId) => agentPin(tasks, agentId),
    holds: holdsEach,
    kind: ACT_KIND.AGENTS_PIN,
    send: (send, agentId, pin) => agentKept(send({ agentId, ...pinSent(pin) })),
    unmasked: true,
    surface: FAILURE_SURFACE.AGENT_PIN,
  } satisfies RowWrite<TaskRows, PinFields, typeof ACT_KIND.AGENTS_PIN>,
  AGENT_ARCHIVE: {
    read: (agents, agentId) => {
      const agent = agents.find((each) => each.id === agentId);
      return agent === undefined ? undefined : { archived: agent.archivedAt !== undefined };
    },
    holds: holdsEach,
    kind: ACT_KIND.AGENTS_ARCHIVE,
    send: (send, agentId, { archived }) => agentKept(send({ agentId, archived })),
    unmasked: true,
    surface: FAILURE_SURFACE.AGENT_ARCHIVE,
  } satisfies RowWrite<
    readonly AgentSummary[],
    { readonly archived: boolean },
    typeof ACT_KIND.AGENTS_ARCHIVE
  >,
} as const;
