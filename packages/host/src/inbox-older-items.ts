/**
 * inbox-older-items.ts -- the account's settled inbox items older than its feed holds, read a page at a time as an Inbox lists every item, held in memory for the signed-in session beside the feed, the member's own writes drawn over them, and told whole on the document as they move.
 *
 * The account's feed (`account-items-follow.ts`) holds every open item and
 * the settled ones of its read's window; those settled before it stand only
 * on the service, which answers them a page at a time
 * (`INBOX_OLDER_READ`), as All asks for them at its end
 * (`AGENTS_INBOX_OLDER_PAGE`, `compose-agents.ts`). Each page's items are
 * held here, the latest copy of each taking the place of the one before, so
 * a page read again as All is shown anew brings its items up to date, and
 * they stand for the session: a sign-out lets every one go (`clear`).
 *
 * They are held apart from the pool's rows, never in the Inbox kind's
 * collection, which a platform keeps on disk whole and the feed alone
 * writes (`account-items-stored.ts`); and apart from the feed's own items,
 * whose window the clock narrows, so the clock never lets one of them go.
 * An item the feed comes to carry, as one a write moved back into its
 * window, is the feed's alone from then on (`carried`), so it is never told
 * twice. What they are told as is the document's slice of them
 * (`LIVE_READ.INBOX_OLDER`), by the plan each is on and those on no task by
 * their agent, as the feed's are, which All lists past the feed and nothing
 * counts.
 *
 * A member's write is drawn over them as over any read's: they stand on the
 * Inbox kind beside the pool (`PoolRead.beside`), as main's read of what
 * waits does, so each write standing over one of them is drawn over its
 * copy the moment it is asked, and taken back where the service refused
 * it. They hand no wait, so a write the service answered is taken into the
 * copy in its place, and stands there once it stands down.
 */

import { INBOX_SCOPE_KIND } from "@repo/features/agent-view";
import { inboxInOrder } from "@repo/features/inbox-live";
import type { InboxItem } from "@repo/features/inbox-wire";
import { type EntityPool, type HeldRows, ROW_GONE } from "@repo/sync";
import { Effect, type Scope } from "effect";
import type { AppHostRead, AppInboxItems } from "./app-state.js";
import {
  changedIds,
  INBOX_ITEM,
  type InboxChange,
  itemOf,
  type PlacedInboxItem,
} from "./inbox-collections.js";

/** The older items as a session holds them, and their moving. */
export interface OlderInboxItems {
  /** Stands the items beside the pool for the caller's scope, as the session's feed stands on the account's database open now, so each write standing over one is drawn over it while it stands. */
  readonly stand: Effect.Effect<void, never, Scope.Scope>;
  /** Takes a page's items, each on its plan, in the place of any copy held, and tells them. */
  readonly took: (items: readonly PlacedInboxItem[]) => void;
  /** Lets go of the items `ids` names, which the feed carried, and tells the rest where any was held. */
  readonly carried: (ids: readonly string[]) => void;
  /** Lets go of every item held, as a sign-out does, and tells none read. */
  readonly clear: () => void;
}

export interface OlderInboxItemsDependencies {
  /** The sync engine's pool, beside which the items stand, drawing the writes standing over them. */
  readonly pool: EntityPool;
  /** Tells the items as they now stand, the writes standing drawn over them. */
  readonly tell: (read: AppHostRead<AppInboxItems>) => void;
}

/** No item told: the slice before any page is read, and after a sign-out. */
const NONE_READ: AppHostRead<AppInboxItems> = {};

/** `row` with every change of `standing` that names it drawn over it, in order; none where one took it away. */
function drawnOver(
  row: PlacedInboxItem,
  standing: readonly InboxChange[],
): PlacedInboxItem | undefined {
  let drawn: PlacedInboxItem | undefined = row;

  for (const change of standing) {
    if (drawn === undefined || !changedIds(change).includes(row.id)) continue;
    const next = INBOX_ITEM.drawn(change, drawn);

    if (next === ROW_GONE) drawn = undefined;
    else if (next !== undefined) drawn = next;
  }

  return drawn;
}

/** `rows` by the plan each is on, and those on no task by their agent, each list in the order a holder's list draws it (`inboxInOrder`). */
function itemsByHolder(rows: Iterable<PlacedInboxItem>): AppInboxItems {
  const plans = new Map<string, InboxItem[]>();
  const agents = new Map<string, InboxItem[]>();

  for (const row of rows) {
    const [lists, holder] = row.taskId === null ? [agents, row.agentId] : [plans, row.taskId];
    const list = lists.get(holder);

    if (list === undefined) lists.set(holder, [itemOf(row)]);
    else list.push(itemOf(row));
  }

  const ordered = (lists: Map<string, InboxItem[]>) =>
    Object.fromEntries([...lists].map(([holder, items]) => [holder, inboxInOrder(items)]));

  return agents.size === 0
    ? { [INBOX_SCOPE_KIND.TASK]: ordered(plans) }
    : { [INBOX_SCOPE_KIND.TASK]: ordered(plans), agents: ordered(agents) };
}

/**
 * The session's older items, none held until a page is taken. Note that
 * they stand beside the pool only while a session stands them (`stand`),
 * since a kind kept on disk holds its rows, and the writes over them, in
 * the account's database open now, which the session opened after the
 * host was built.
 */
export function olderInboxItems(dependencies: OlderInboxItemsDependencies): OlderInboxItems {
  /** Every item held, as the service last answered it or a write's answer left it, by its id. */
  let held = new Map<string, PlacedInboxItem>();
  /** The items as they stand beside the pool, while a session stands them. */
  let writes: HeldRows<PlacedInboxItem, InboxChange> | undefined;

  const toldNow = () => {
    const standing = writes?.standing() ?? [];

    const rows = [...held.values()].flatMap((row) => {
      const drawn = drawnOver(row, standing);

      return drawn === undefined ? [] : [drawn];
    });

    dependencies.tell({ rows: itemsByHolder(rows) });
  };

  const stand = Effect.gen(function* () {
    const stood: HeldRows<PlacedInboxItem, InboxChange> = yield* dependencies.pool.stand(
      INBOX_ITEM,
      {
        redraw: () => Effect.sync(toldNow),
        // Note that the items follow nothing, so a write over one is taken into its copy once the service answers it.
        confirmation: () => undefined,
        beside: {
          shows: (key) => held.has(key),
          take: (change) => {
            for (const id of changedIds(change)) {
              const row = held.get(id);

              if (row === undefined) continue;
              const drawn = drawnOver(row, [change]);

              if (drawn === undefined) held.delete(id);
              else held.set(id, drawn);
            }
          },
        },
      },
    );

    writes = stood;
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        if (writes === stood) writes = undefined;
      }),
    );
  });

  return {
    stand,
    took: (items) => {
      for (const item of items) held.set(item.id, item);
      toldNow();
    },
    carried: (ids) => {
      const before = held.size;

      for (const id of ids) held.delete(id);

      if (held.size !== before) toldNow();
    },
    clear: () => {
      held = new Map();
      dependencies.tell(NONE_READ);
    },
  };
}
