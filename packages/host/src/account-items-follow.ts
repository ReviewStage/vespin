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
import type { EntityPool, HeldRows } from "@repo/sync";
import { Clock, Effect } from "effect";
import type { AppHostRead, AppInboxItems } from "./app-state.js";
import { type EntityStore, KEPT_READ, type KeptRows } from "./entity-store.js";
import { type AccountWideReads, INBOX_ITEM, type InboxChange } from "./inbox-collections.js";
import {
  confirmWrite,
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
 * (`gone`). The follow keeps every item it holds with the plan it is on;
 * one whose stamp names no plan, which no agent leaves since every agent
 * works on one, is not held. An item settled longer ago than the
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
 * Each answer read at a sync id is kept on disk (`entity-store.ts`'s
 * `KEPT_READ.INBOX`): the items as the follow took them from the service,
 * never with a write drawn over them, the first in the order a plan's list
 * draws them that fit in `KEPT_CHARACTERS`. The follow's first attempt
 * draws what the store kept before it reads, so a launch draws the Inbox at
 * once, and reads past the sync id it was kept at where the store kept
 * every item, since a read past an id answers every item that moved since
 * it; where it kept only the first, the id is not kept, and the first read
 * is whole, since an item left out that never moved would never be
 * answered again.
 */

/**
 * The most characters of items kept on disk, as JSON: about twenty threads,
 * a first screen of them on every device. Note that it is small, because
 * the file is opened whole at every launch, and on the iPhone its cipher is
 * XChaCha20 in JavaScript on Hermes: an Inbox of 640 threads, about 4.8 MB,
 * took about 4 s to open under Node `--jitless`, where this many add about
 * 0.12 s beside the task list.
 */
export const KEPT_CHARACTERS = 150_000;

/** A read the service did not answer, `gone` where it never will again. */

/** One item as the follow last took it, and the plan it is on. */
interface HeldItem {
  readonly item: InboxItem;
  readonly planId: string;
}

/** Every item held, by its id. */
type Held = ReadonlyMap<string, HeldItem>;

export interface AccountItemsDependencies {
  /** The account's items read for the account named, past the sync id named, whole where it is empty or none; signed out, or a failure where the service answered none. */
  readonly seal: (
    userId: string,
    sync: string | undefined,
  ) => Effect.Effect<AccountInboxItemsLiveAnswer | LiveFailure>;
  /** The sync engine's pool, which the items stand in while they are followed. */
  readonly pool: EntityPool;
  /** The account's own reads, among which the feed's wait stands while it is followed. */
  readonly accountWide: AccountWideReads;
  /** The signed-in account's lists kept on disk, which the feed is kept among; none where nothing keeps them. */
  readonly entities?: () => EntityStore | undefined;
}

type HeldAfterResult = {
  readonly held: Held;
  readonly sent: readonly InboxItem[];
  readonly placed: readonly string[];
};

/**
 * The items held after an answer, the items it carried that stand, and the
 * items now on another plan than they were. A whole answer is every item
 * there is; one past a sync id carries only the items that moved, each
 * whole, and names those that stand no longer, which leave, as does every
 * item settled before the read's window, by the clock.
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

    if (before !== undefined && before.planId !== stamp.planId) placed.push(stamp.id);
    next.set(stamp.id, { item, planId: stamp.planId });
  }

  for (const id of standing?.gone ?? []) next.delete(id);
  withinWindow(next, now);
  const sent = [...carried.values()].filter((item) => next.has(item.id));

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

type KeptInbox = KeptRows[typeof KEPT_READ.INBOX];

/** What the store keeps of `held`, read at `at`: its first items in the order a plan's list draws them, as many as fit in `KEPT_CHARACTERS`, and the sync id only where that is every item. */
function keptOf(held: Held, at: string): KeptInbox {
  const items: HeldItem[] = [];
  let characters = 0;

  for (const { id } of inboxInOrder([...held.values()].map((each) => each.item))) {
    const each = held.get(id);

    if (each === undefined) continue;
    characters += JSON.stringify(each).length;

    if (characters > KEPT_CHARACTERS) break;
    items.push(each);
  }

  return items.length === held.size ? { items, at } : { items };
}

/** No item on any plan, as the feed is told before it first answers. */
const NO_ITEMS: AppInboxItems = { [INBOX_SCOPE_KIND.PLAN]: {} };

/**
 * The plans `told` once the items `moved` names are drawn again: each plan
 * one of them stood on in `was`, or stands on in `held`, holds what `held`
 * puts on it now, each as `drawnOf` draws it, in the order its own read
 * answers them, and is gone where it holds none; every other plan's list
 * is the very one told.
 */
function inboxItemsPatched(
  told: AppInboxItems,
  moved: Iterable<string>,
  was: Held,
  held: Held,
  drawnOf: (id: string) => InboxItem | undefined,
): AppInboxItems {
  const touched = new Set<string>();

  for (const id of moved) {
    for (const on of [was.get(id), held.get(id)]) if (on !== undefined) touched.add(on.planId);
  }

  if (touched.size === 0) return told;
  const lists = new Map<string, InboxItem[]>();

  for (const [id, { item, planId }] of held) {
    if (!touched.has(planId)) continue;
    const items = lists.get(planId);
    const shown = drawnOf(id) ?? item;

    if (items === undefined) lists.set(planId, [shown]);
    else items.push(shown);
  }

  const next = { ...told[INBOX_SCOPE_KIND.PLAN] };

  for (const planId of touched) {
    const items = lists.get(planId);

    if (items === undefined) Reflect.deleteProperty(next, planId);
    else next[planId] = inboxInOrder(items);
  }

  return { [INBOX_SCOPE_KIND.PLAN]: next };
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
  tell: (read: AppHostRead<AppInboxItems>) => Effect.Effect<void>,
): Effect.Effect<void> {
  /** Whether any read answered, so a later refusal keeps what was told. */
  let answered = false;
  /** The feed as the store kept it, which the first attempt alone draws and reads past. */
  let fromDisk = dependencies.entities?.()?.stored(KEPT_READ.INBOX);

  const attempt = Effect.scoped(
    Effect.gen(function* () {
      const kept = fromDisk;
      fromDisk = undefined;
      let wait: TxWait | undefined;
      /** Every item as the follow last took it, with its plan. */
      let held: Held | undefined;
      /** The items as last drawn, a standing write's among them, by the plan each is on. */
      let told = NO_ITEMS;

      /** Tells the items as last drawn, once the read first answered or the store's were drawn. */
      const toldNow = Effect.suspend(() => {
        if (held === undefined) return Effect.void;
        answered = true;

        return tell({ rows: told });
      });

      /** Draws the items `ids` names again, a write standing over them, on the plans the read answered them on. */
      const drawn = (ids: readonly string[]) =>
        Effect.suspend(() => {
          if (held !== undefined) {
            told = inboxItemsPatched(told, ids, held, held, items.row);
          }

          return toldNow;
        });

      const items: HeldRows<InboxItem, InboxChange> = yield* dependencies.pool.stand(INBOX_ITEM, {
        redraw: drawn,
        confirmation: () => {
          const handed = wait;

          return handed === undefined ? undefined : (txid) => confirmWrite(handed, txid);
        },
      });

      yield* dependencies.accountWide.stand(() => wait);

      /** The items `after` holds taken in place of those `was` held, `sent` the ones that came with it, at the sync id `at` names, and told. */
      const taken = (
        was: Held,
        after: Held,
        sent: readonly InboxItem[],
        placed: readonly string[],
        at: bigint | undefined,
      ) =>
        Effect.gen(function* () {
          held = after;

          const moved = yield* items.answer(sent, {
            held: [...after.keys()],
            ...(at === undefined ? undefined : { at }),
          });

          told = inboxItemsPatched(told, [...moved, ...placed], was, after, items.row);
          yield* toldNow;
        });

      // Note that the store's items are drawn before the first read, so a launch draws the Inbox at once, and at no sync id, so the read's first answer takes their place whatever id it was read at.
      if (kept !== undefined) {
        const fromStore = new Map(kept.items.map((each) => [each.item.id, each]));
        withinWindow(fromStore, yield* Clock.currentTimeMillis);
        const sent = [...fromStore.values()].map((each) => each.item);
        yield* taken(new Map(), fromStore, sent, [], undefined);
      }

      const first = yield* dependencies.seal(userId, kept?.at ?? "");

      if ("failure" in first) {
        if (!answered) yield* tell({ failed: true });

        return true;
      }

      const landed = (decoded: AccountInboxItemsLiveRows, standing?: SyncStanding) =>
        Effect.gen(function* () {
          const was = held ?? new Map<string, HeldItem>();
          const after = heldAfter(was, decoded, standing, yield* Clock.currentTimeMillis);
          yield* taken(was, after.held, after.sent, after.placed, syncIdOf(standing));
          const entities = dependencies.entities?.();

          // Note that only an answer read at a sync id is kept, and one that moved no item is written only beside the next save of something that did, or as the store closes.
          if (entities !== undefined && standing !== undefined) {
            const keptNow = keptOf(after.held, standing.next);

            yield* after.sent.length > 0 || after.held.size !== was.size
              ? entities.keep(KEPT_READ.INBOX, keptNow)
              : entities.keepUnmoved(KEPT_READ.INBOX, keptNow);
          }
        });

      yield* followTakingRows(
        {
          poll: (_after, _cursor, sync) => dependencies.seal(userId, sync),
          onTxWait: (handed) => {
            wait = handed;
          },
        },
        first,
        INBOX_ITEMS_READ.rows,
        landed,
      ).pipe(Effect.catch(() => Effect.void));

      return true;
    }),
  );

  return restarting(attempt);
}
