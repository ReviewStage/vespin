import { INBOX_SCOPE_KIND } from "@repo/features/agent-view";
import {
  type AccountInboxItemsLiveAnswer,
  type AccountInboxItemsLiveRows,
  INBOX_ITEMS_READ,
  inboxInOrder,
  inboxOfLiveRows,
} from "@repo/features/inbox-live";
import { INBOX_STATUS, type InboxItem } from "@repo/features/inbox-wire";
import { ACCOUNT_INBOX_ITEMS } from "@repo/features/live-wire";
import { type TaskSummary, taskSummarySchema } from "@repo/features/task-wire";
import type { EntityPool, HeldRows } from "@repo/sync";
import { Clock, Effect, Option, Schema } from "effect";
import { ACCOUNT_ITEMS_PAGES, followStoredItems } from "./account-items-stored.js";
import type { AppInboxItems, AppInboxRead } from "./app-state.js";
import {
  type AccountWideReads,
  INBOX_ITEM,
  type InboxChange,
  itemOf,
  type PlacedInboxItem,
  placedItem,
} from "./inbox-collections.js";
import { KEPT_LIST } from "./kept-lists.js";
import {
  confirmWrite,
  droppedParts,
  followTakingRows,
  type LiveFailure,
  restarting,
  type SyncStanding,
  syncIdOf,
  type TxWait,
} from "./live-follow.js";

/**
 * account-items-follow.ts -- every inbox item the account reaches, whole, followed by sync id over the service's one held poll for the signed-in session and told whole as it moves.
 *
 * The host follows the account's items read (`/api/live/inbox-items`,
 * `live-follow.ts`) for as long as the session's account reads stand
 * (`live-collection.ts`'s `accountReads`), by sync id (`LIVE_POLL.SYNC`):
 * its first answer, and any while it is too far behind, is every item
 * whole, where each stands (`stamps`), its row, and every message and file
 * its thread draws; and each poll after is held until something moves past
 * the id the last answer named, and answered only the items that moved,
 * each whole, with the ids of those that stand no longer for the account
 * (`gone`). The follow keeps every item it holds with the plan it is on,
 * or, where its stamp names no plan, as its agent's on no task, which it
 * tells under that agent (`AppInboxItems`'s `agents`). An item settled longer ago than the
 * read's window leaves it by the clock, which no answer says, so the follow
 * drops it itself; and a sync id that stalls is asked around whole
 * (`live-follow.ts`'s `SYNC_STALL`).
 *
 * The items stand in the sync engine's pool (`inbox-collections.ts`'s
 * `INBOX_ITEM`): each answer upserts only the items it carries, at the sync
 * id it was read at, so an older copy never replaces a newer row another
 * read took, and holds the rest by id. They are told by plan after each
 * answer and each write drawn over them. Only a plan an item
 * on it moved is ordered again, every other's list told as the very one
 * told before, so a change costs the plans it moved rather than the
 * feed's whole. A read the service refused, or a follow that stopped, is
 * read again after `LIVE_RESTART`, whole, keeping what it told; one refused
 * before it ever answered is told as failed.
 *
 * Each answer is kept in the local database (`PoolRead.kept`): the items
 * as the follow took them from the service, never with a write drawn over
 * them, the first in the order a plan's list draws them that fit in
 * `KEPT_CHARACTERS`, with the plan each is on and the sync id they were
 * read at as the read's cursor. The follow draws what the database held as
 * its read stands, before it reads, so a launch draws the Inbox at once,
 * and its first attempt reads past the sync id kept where the database
 * kept every item, since a read past an id answers every item that moved
 * since it; where it kept only the first, the first read is whole, since
 * an item left out that never moved would never be answered again.
 *
 * Beside them it keeps the tasks the items stand on as the task list summed
 * them up when the items were kept (`keptHolders`), the latest changed
 * first, up to `KEPT_HOLDERS`, each the task list's summary where it holds
 * one now and the one kept before where it does not yet, as at a launch
 * whose list is still being drawn. They are told beside the Inbox drawn from
 * the database, for as long as the follow stands, so a window groups the
 * kept rows under them while the task list is still read or drawn rather
 * than waiting on the whole list, which on a phone with thousands of tasks
 * is most of a launch.
 */

/**
 * The most characters of items kept on disk, as JSON: about 1 MB, an Inbox
 * of some 130 threads whole, so its first read goes past the sync id it was
 * kept at, and the first 600 or so of a larger one. Note that it is bound,
 * because the items are read and decoded whole before a launch draws the
 * Inbox: the kept rows' decode on Hermes is about 55 ms a MB on the iPhone
 * 18 Pro and the iOS 26.5 iPad alike, so this many add about 60 ms, where a
 * 640-thread Inbox's 4.8 MB would add about 0.3 s to every launch.
 */
const KEPT_CHARACTERS = 1_000_000;

/** The items the local database keeps: the first, in the order a plan's list draws them, whose JSON fits in `KEPT_CHARACTERS`. */
const KEPT_INBOX_BOUND = {
  size: (item: InboxItem) => JSON.stringify(item).length,
  within: KEPT_CHARACTERS,
};

/**
 * The most tasks kept beside the items, the latest changed first: every task
 * of a busy account's Inbox, so its groups and counts stand whole before the
 * task list is drawn rather than growing as it is, and few enough that a
 * launch decodes them in a few milliseconds.
 */
const KEPT_HOLDERS = 250;

/** A read the service did not answer, `gone` where it never will again. */

/** One item as the follow last took it, and the plan it is on. */
interface HeldItem {
  readonly item: InboxItem;
  /** The item's task; null for one on no task. */
  readonly taskId: string | null;
}

/** Every item held, by its id. */
type Held = ReadonlyMap<string, HeldItem>;

export interface AccountItemsDependencies {
  /** The account's items read for the account named, past the sync id named, whole where it is empty or none, or the page of a whole answer named; signed out, or a failure where the service answered none. */
  readonly seal: (
    userId: string,
    sync: string | undefined,
    page?: string,
  ) => Effect.Effect<AccountInboxItemsLiveAnswer | LiveFailure>;
  /** The sync engine's pool, which the items stand in while they are followed. */
  readonly pool: EntityPool;
  /** The account's own reads, among which the feed's wait stands while it is followed. */
  readonly accountWide: AccountWideReads;
  /** The task list's summaries of the tasks `taskIds` names, of those it holds now; none where it holds none, as before it is drawn. */
  readonly tasksListed?: (taskIds: readonly string[]) => readonly TaskSummary[];
  /** Hears each part of an answer whose reading left rows out, since they did not decode, and how many (`live-follow.ts`). */
  readonly dropped?: (part: AccountItemsPart, count: number) => void;
}

/** A part of the account's items read, whose dropped rows are counted by it. */
export type AccountItemsPart = keyof typeof INBOX_ITEMS_READ.parts;

/** Every part of the account's items read, each counted where its reading drops any rows. */
// SAFETY: the keys of the read's own parts are its parts, every one of them.
const ACCOUNT_ITEMS_PARTS = Object.keys(INBOX_ITEMS_READ.parts) as readonly AccountItemsPart[];

type HeldAfterResult = {
  readonly held: Held;
  readonly sent: readonly PlacedInboxItem[];
  readonly placed: readonly string[];
};

/**
 * The items held after an answer, the items it carried that stand, and the
 * items now on another plan than they were. A whole answer is every item
 * there is; one past a sync id carries only the items that moved, each
 * whole, and names those that stand no longer, which leave, as does every
 * item settled before the read's window, by the clock. The last page of a
 * whole answer in pages lets go every item no page carried.
 */
function heldAfter(
  held: Held,
  rows: AccountInboxItemsLiveRows,
  standing: SyncStanding | undefined,
  now: number,
): HeldAfterResult {
  const carried = new Map(inboxOfLiveRows(rows).map((item) => [item.id, item]));
  const next = new Map<string, HeldItem>(standing?.past === undefined ? [] : held);
  const placed: string[] = [];

  for (const stamp of rows.stamps) {
    const item = carried.get(stamp.id);

    if (item === undefined) continue;
    const before = held.get(stamp.id);

    if (before !== undefined && before.taskId !== stamp.taskId) placed.push(stamp.id);
    next.set(stamp.id, { item, taskId: stamp.taskId });
  }

  for (const id of standing?.gone ?? []) next.delete(id);

  for (const id of next.keys()) if (standing?.carried?.has(id) === false) next.delete(id);
  withinWindow(next, now);

  const sent = [...carried.values()].flatMap((item) => {
    const on = next.get(item.id);

    return on === undefined ? [] : [placedItem(item, on.taskId)];
  });

  return { held: next, sent, placed };
}

/** `held` cut, in place, to the items the read's window holds at `now`: every open item, and every settled one that stood within it. */
function withinWindow(held: Map<string, HeldItem>, now: number): void {
  const settledSince = now - ACCOUNT_INBOX_ITEMS.SETTLED_WINDOW_MILLIS;

  for (const [id, { item }] of held) {
    if (item.status === INBOX_STATUS.OPEN) continue;

    // A nod on an old notice settles it without moving its last change, and a reminder brings it back when it comes due, so it stands by the latest of the three, as the service carries it.
    const standsBy = Math.max(
      item.updatedAt,
      item.settledAt ?? item.updatedAt,
      item.remindAt ?? item.updatedAt,
    );

    if (standsBy < settledSince) held.delete(id);
  }
}

/**
 * What the local database keeps beside the items, as the read's cursor: the
 * sync id they were read at, where they were, and the plan each item held
 * is on, since an item names none of its own. The pool keeps it whole even
 * where the bound left items out, so the plans of the items it kept are
 * always among it.
 */
const keptInboxSchema = Schema.Struct({
  at: Schema.optionalKey(Schema.String),
  plans: Schema.Record(Schema.String, Schema.NullOr(Schema.String)),
  // Note that each holder is decoded alone (`keptHoldersOf`), so one a build no longer reads leaves out that task rather than the kept Inbox.
  holders: Schema.optionalKey(Schema.Array(Schema.Unknown)),
});

type KeptInbox = typeof keptInboxSchema.Type;

const decodeKept = Schema.decodeUnknownOption(keptInboxSchema);

const decodeHolder = Schema.decodeUnknownOption(taskSummarySchema);

/** The tasks `kept` holds beside its items that this build reads, in the order it kept them. */
function keptHoldersOf(kept: KeptInbox | undefined): readonly TaskSummary[] {
  return (kept?.holders ?? []).flatMap((holder) => Option.toArray(decodeHolder(holder)));
}

/** No task summed up: what a follow handed no task list keeps beside its items. */
const noneListed = (): readonly TaskSummary[] => [];

/** The tasks `held`'s items stand on, the one whose item changed latest first, up to `KEPT_HOLDERS`. */
function holderIdsOf(held: Held): readonly string[] {
  const latest = new Map<string, number>();

  for (const { item, taskId } of held.values()) {
    if (taskId === null) continue;
    latest.set(taskId, Math.max(latest.get(taskId) ?? 0, item.updatedAt));
  }

  return [...latest]
    .sort(([, one], [, other]) => other - one)
    .slice(0, KEPT_HOLDERS)
    .map(([taskId]) => taskId);
}

/**
 * What the local database keeps beside `held`, read at the sync id `standing`
 * names where it names one: each item's plan, and the tasks they stand on
 * (`holderIdsOf`), each as the task list sums it up now (`listed`) or as
 * `before` kept it where the list holds none of it yet.
 */
function keptOf(
  held: Held,
  standing: SyncStanding | undefined,
  listed: (taskIds: readonly string[]) => readonly TaskSummary[],
  before: readonly TaskSummary[],
): KeptInbox {
  const plans = Object.fromEntries([...held].map(([id, { taskId }]) => [id, taskId]));
  const holderIds = holderIdsOf(held);
  const summaries = new Map([...before, ...listed(holderIds)].map((task) => [task.id, task]));

  const holders = holderIds.flatMap((taskId) => {
    const summary = summaries.get(taskId);

    return summary === undefined ? [] : [summary];
  });

  return standing === undefined ? { plans, holders } : { at: standing.next, plans, holders };
}

/** The items `kept` holds a plan for among `items`, as the local database held them, each on its plan. */
function heldOfKept(items: readonly InboxItem[], kept: KeptInbox): Map<string, HeldItem> {
  const held = new Map<string, HeldItem>();

  for (const item of items) {
    const taskId = kept.plans[item.id];

    if (taskId !== undefined) held.set(item.id, { item, taskId });
  }

  return held;
}

/** No item on any plan, as the feed is told before it first answers. */
const NO_ITEMS: AppInboxItems = { [INBOX_SCOPE_KIND.TASK]: {} };

/** Where an item stands in what the feed tells: on its plan, or, on no plan, under its agent. */
function holderOf({ item, taskId }: HeldItem): { readonly agents: boolean; readonly id: string } {
  return taskId === null ? { agents: true, id: item.agentId } : { agents: false, id: taskId };
}

/** One kind of holder's lists, by the plan's or the agent's id, as the feed tells them. */
type HolderLists = AppInboxItems[typeof INBOX_SCOPE_KIND.TASK];

/** One kind of holder's lists as `told` tells them: the plans', or the agents' on no plan. */
function toldOf(told: AppInboxItems, agents: boolean): HolderLists {
  return agents ? (told.agents ?? {}) : told[INBOX_SCOPE_KIND.TASK];
}

/**
 * One kind of holder's lists once those `touched` names are drawn again from
 * `held`, each as `drawnOf` draws it, in the order its own read answers
 * them, and gone where it holds none; every other's list is the very one
 * told.
 */
function listsPatched(
  told: HolderLists,
  touched: ReadonlySet<string>,
  agents: boolean,
  held: Held,
  drawnOf: (id: string) => InboxItem | undefined,
): HolderLists {
  const lists = new Map<string, InboxItem[]>();

  for (const [id, on] of held) {
    const holder = holderOf(on);

    if (holder.agents !== agents || !touched.has(holder.id)) continue;
    const items = lists.get(holder.id);
    const shown = drawnOf(id) ?? on.item;

    if (items === undefined) lists.set(holder.id, [shown]);
    else items.push(shown);
  }

  const next = { ...told };

  for (const id of touched) {
    const items = lists.get(id);

    if (items === undefined) Reflect.deleteProperty(next, id);
    else next[id] = inboxInOrder(items);
  }

  return next;
}

/**
 * The plans `told` once the items `moved` names are drawn again: each plan
 * one of them stood on in `was`, or stands on in `held`, holds what `held`
 * puts on it now, each as `drawnOf` draws it, in the order its own read
 * answers them, and is gone where it holds none; and each agent on no plan
 * alike, by the agent. Every other list is the very one told.
 */
function inboxItemsPatched(
  told: AppInboxItems,
  moved: Iterable<string>,
  was: Held,
  held: Held,
  drawnOf: (id: string) => InboxItem | undefined,
): AppInboxItems {
  const touchedPlans = new Set<string>();
  const touchedAgents = new Set<string>();

  for (const id of moved) {
    for (const on of [was.get(id), held.get(id)]) {
      if (on === undefined) continue;
      const holder = holderOf(on);
      (holder.agents ? touchedAgents : touchedPlans).add(holder.id);
    }
  }

  if (touchedPlans.size === 0 && touchedAgents.size === 0) return told;

  const plans =
    touchedPlans.size === 0
      ? told[INBOX_SCOPE_KIND.TASK]
      : listsPatched(toldOf(told, false), touchedPlans, false, held, drawnOf);

  const agents =
    touchedAgents.size === 0
      ? told.agents
      : listsPatched(toldOf(told, true), touchedAgents, true, held, drawnOf);

  return agents === undefined
    ? { [INBOX_SCOPE_KIND.TASK]: plans }
    : { [INBOX_SCOPE_KIND.TASK]: plans, agents };
}

/**
 * Every item the account `userId` reaches, told whole until the fiber is
 * let go: once the first rows land, then after each answer and each write
 * drawn over them. A read the service refused, or a follow that stopped, is
 * read again after `LIVE_RESTART`; one refused before any answer is told
 * as failed, and one after keeps what was told.
 */
export function followAccountItems(
  dependencies: AccountItemsDependencies,
  userId: string,
  tell: (read: AppInboxRead) => Effect.Effect<void>,
): Effect.Effect<void> {
  /** Whether any read answered, so a later refusal keeps what was told. */
  let answered = false;
  /** Whether no attempt has read yet, so the first alone reads past the sync id the local database kept. */
  let firstAttempt = true;
  /** The tasks the local database kept beside the items it held as the follow stood, told beside every reading for as long as it stands; none where it kept none. */
  let keptHolders: readonly TaskSummary[] = [];

  const attempt = Effect.scoped(
    Effect.gen(function* () {
      const resumes = firstAttempt;
      firstAttempt = false;
      let wait: TxWait | undefined;
      /** Every item as the follow last took it, with its plan. */
      let held: Held | undefined;
      /** The items as last drawn, a standing write's among them, by the plan each is on. */
      let told = NO_ITEMS;
      /** Whether the items drawn are still the store's, before the read's first answer took their place. */
      let drawnFromStore = false;

      /** Tells the items as last drawn, once the read first answered or the store's were drawn, marked kept while they are still the store's. */
      const toldNow = Effect.suspend(() => {
        if (held === undefined) return Effect.void;
        answered = true;

        return tell({
          rows: told,
          ...(drawnFromStore ? { kept: true } : undefined),
          ...(keptHolders.length === 0 ? undefined : { keptHolders }),
        });
      });

      /** Draws the items `ids` names again, a write standing over them, on the plans the read answered them on. */
      const drawn = (ids: readonly string[]) =>
        Effect.suspend(() => {
          if (held !== undefined) {
            told = inboxItemsPatched(told, ids, held, held, toldRow);
          }

          return toldNow;
        });

      const items: HeldRows<PlacedInboxItem, InboxChange> = yield* dependencies.pool.stand(
        INBOX_ITEM,
        {
          redraw: drawn,
          confirmation: () => {
            const handed = wait;

            return handed === undefined ? undefined : (txid) => confirmWrite(handed, txid);
          },
          kept: { ...KEPT_LIST.INBOX, bound: KEPT_INBOX_BOUND },
          owns: true,
        },
      );

      yield* dependencies.accountWide.stand(() => wait);

      /** The item `id` names as a window is told it, a write standing over it drawn, without the task the pool holds it on. */
      const toldRow = (id: string) => {
        const row = items.row(id);

        return row === undefined ? undefined : itemOf(row);
      };

      // Note that where the account's database keeps the Inbox kind whole, the follow writes each answer there and tells no item on the document (`account-items-stored.ts`).
      if (items.onDisk) {
        const read = yield* followStoredItems({
          seal: (sync, page) => dependencies.seal(userId, sync, page),
          pool: dependencies.pool,
          items,
          resumes,
          tasksListed: dependencies.tasksListed ?? noneListed,
          onTxWait: (handed) => {
            wait = handed;
          },
          decoded: (rows, read) => {
            for (const [part, count] of droppedParts(ACCOUNT_ITEMS_PARTS, read, rows)) {
              dependencies.dropped?.(part, count);
            }
          },
          tell: (told) =>
            Effect.suspend(() => {
              answered = true;

              return tell(told);
            }),
        });

        if (!read && !answered) yield* tell({ failed: true });

        return true;
      }

      /** The items `after` holds taken in place of those `was` held, `sent` the ones that came with it, read where `standing` says, and told. */
      const taken = (
        was: Held,
        after: Held,
        sent: readonly PlacedInboxItem[],
        placed: readonly string[],
        standing: SyncStanding | undefined,
      ) =>
        Effect.gen(function* () {
          held = after;
          const at = syncIdOf(standing);

          // Note that the items are held in the order a plan's list draws them, so the local database keeps the first of them that fit.
          const moved = yield* items.answer(sent, {
            held: inboxInOrder([...after.values()].map((each) => each.item)).map((item) => item.id),
            ...(at === undefined ? undefined : { at }),
            cursor: keptOf(after, standing, dependencies.tasksListed ?? noneListed, keptHolders),
          });

          told = inboxItemsPatched(told, [...moved, ...placed], was, after, toldRow);
          yield* toldNow;
        });

      // Note that the items the local database held are drawn before the first read, so a launch draws the Inbox at once, and taken at no sync id, so the read's first answer takes their place whatever id it was read at.
      const kept = items.loaded ? Option.getOrUndefined(decodeKept(items.stored)) : undefined;
      const stored = items.synced();

      if (kept !== undefined) {
        keptHolders = keptHoldersOf(kept);
        const fromStore = heldOfKept(stored.map(itemOf), kept);
        withinWindow(fromStore, yield* Clock.currentTimeMillis);
        held = fromStore;
        drawnFromStore = true;
        told = inboxItemsPatched(told, fromStore.keys(), new Map(), fromStore, toldRow);
        yield* toldNow;
      }

      // Note that the first read goes past the sync id kept only where the local database kept every item, since one left out that never moved would never be answered again.
      const every = kept !== undefined && stored.length === Object.keys(kept.plans).length;
      const from = resumes && every ? (kept.at ?? "") : "";

      const first = yield* dependencies.seal(userId, from);

      if ("failure" in first) {
        if (!answered) yield* tell({ failed: true });

        return true;
      }

      const landed = (decoded: AccountInboxItemsLiveRows, standing?: SyncStanding) =>
        Effect.gen(function* () {
          drawnFromStore = false;
          const was = held ?? new Map<string, HeldItem>();
          const after = heldAfter(was, decoded, standing, yield* Clock.currentTimeMillis);
          yield* taken(was, after.held, after.sent, after.placed, standing);
        });

      yield* followTakingRows(
        {
          poll: (_after, _cursor, sync, page) => dependencies.seal(userId, sync, page),
          pages: ACCOUNT_ITEMS_PAGES,
          onTxWait: (handed) => {
            wait = handed;
          },
        },
        first,
        INBOX_ITEMS_READ.rows,
        (decoded, standing, read) => {
          for (const [part, count] of droppedParts(ACCOUNT_ITEMS_PARTS, read, decoded)) {
            dependencies.dropped?.(part, count);
          }

          return landed(decoded, standing);
        },
      ).pipe(Effect.catch(() => Effect.void));

      return true;
    }),
  );

  return restarting(attempt);
}
