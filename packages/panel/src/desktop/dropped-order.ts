/**
 * dropped-order.ts -- a list's rows drawn in the order a move gave them, in the move's own draw, until the order the list is handed says so.
 *
 * A row dragged to another place (`use-row-drag.ts`), or moved by its keys
 * or its menu, asks its owner for its new place, and the order the list is
 * drawn from reaches it a moment later: main draws the sidebar's pins and
 * sections and an agent's queue over IPC, and a pending save reaches React
 * in a microtask. Drawn from that order alone, the rows would stand back
 * where they were as the drop lets go, the copy landing on the old place,
 * and jump to their new places once the order arrived. So a list whose
 * rows move draws through this: it keeps the order its last move asked for,
 * each row by its key, and draws it at once, in the draw the drop asks for
 * (`flushSync`), as a mutation's optimistic update does in React Query's
 * docs, so the drag comes down over rows already standing where they land.
 *
 * The order the list is handed settles it. One standing the moved rows as
 * the last move asked lets it go. So does one that is neither that nor the
 * order before any move it still waits on, a refusal put back or someone
 * else's move, which is then drawn as handed. An order no write ever
 * reaches, one nothing asked or one lost, is let go after `HOLD_LIMIT_MS`.
 * A row added to the list or taken
 * out of it while the order is kept is drawn where the order handed stands
 * it, the kept rows filling their places among the others in the order
 * kept, and an item handed anew under a kept key, a row renamed or newly
 * unread, is drawn as handed.
 */

import { useEffect, useMemo, useState } from "react";

/** How long, in milliseconds, a list keeps the order a move asked for while the order it is handed never reaches it. */
const HOLD_LIMIT_MS = 10_000;

/**
 * The order a list keeps: the keys in the order the last move asked for,
 * the order handed as it asked, and every order handed or asked since the
 * list was last drawn as handed that its writes may yet pass through on
 * their way, the first of them the order before any move.
 */
interface KeptOrder {
  readonly asked: readonly string[];
  readonly handed: readonly string[];
  readonly passing: readonly (readonly string[])[];
}

/** What a list draws, and how it asks to move a row. */
export interface DroppedOrder<Item> {
  /** The items to draw: those handed, in the order the last move asked for while it is kept. */
  readonly drawn: readonly Item[];
  /** Stands the item drawn at `from` at `to` among those drawn, at once, kept there until the order handed says so. */
  readonly move: (from: number, to: number) => void;
}

/** Whether two runs of keys stand in one order. */
function sameOrder(one: readonly string[], other: readonly string[]): boolean {
  return one.length === other.length && one.every((key, at) => key === other[at]);
}

/**
 * The keys handed, `listed`, in the order `kept` asked for, or none where
 * the order handed settles it: it stands the kept rows as asked, or as none
 * of the orders it may pass through, each read over the rows it held. The
 * kept rows fill the places the order handed stands them at, in the order
 * asked, and every other row stands where it is handed. Note that a move
 * asking for the very order handed as it was made, one taking back a move
 * not yet handed back, is settled by no order but one handed since, since
 * the earlier move's write may yet pass through.
 */
function keptKeys(listed: readonly string[], kept: KeptOrder): readonly string[] | undefined {
  const handed = new Set(listed);
  const keeps = new Set(kept.asked);
  const standing = listed.filter((key) => keeps.has(key));
  const asked = kept.asked.filter((key) => handed.has(key));

  if (sameOrder(standing, asked) && !sameOrder(listed, kept.handed)) return undefined;

  const passes = (order: readonly string[]) => {
    const held = new Set(order);

    return sameOrder(
      standing.filter((key) => held.has(key)),
      order.filter((key) => keeps.has(key) && handed.has(key)),
    );
  };

  if (!sameOrder(standing, asked) && !kept.passing.some(passes)) return undefined;
  const next = asked.values();

  return listed.map((key) => (keeps.has(key) ? (next.next().value ?? key) : key));
}

/**
 * A list's items, `listed`, each known by `keyOf`, drawn in the order its
 * last move asked for until the order handed says so. `keyOf` names an
 * item by what the list keys its row by, and is a function of the module's
 * rather than one made in the draw, so what is drawn is the same array from
 * one draw to the next while the order is, and a list memoizing what it
 * draws from it draws again only as the order changes.
 */
export function useDroppedOrder<Item>(
  listed: readonly Item[],
  keyOf: (item: Item) => string,
): DroppedOrder<Item> {
  const [kept, keep] = useState<KeptOrder | undefined>(undefined);
  const keys = useMemo(() => listed.map(keyOf), [listed, keyOf]);

  const order = useMemo(
    () => (kept === undefined ? undefined : keptKeys(keys, kept)),
    [keys, kept],
  );

  // Note that an order the list's handed order settles is let go in that same draw, so it is never drawn again should the list later be handed the order it left.
  if (kept !== undefined && order === undefined) keep(undefined);

  useEffect(() => {
    if (kept === undefined) return;
    const timer = setTimeout(() => keep((now) => (now === kept ? undefined : now)), HOLD_LIMIT_MS);

    return () => clearTimeout(timer);
  }, [kept]);

  const drawn = useMemo(() => {
    if (order === undefined) return listed;
    const byKey = new Map(listed.map((item) => [keyOf(item), item]));

    return order.flatMap((key) => byKey.get(key) ?? []);
  }, [listed, order, keyOf]);

  const move = (from: number, to: number) => {
    const asked = drawn.map(keyOf);
    const [moved] = asked.splice(from, 1);

    if (moved === undefined || from === to) return;
    asked.splice(Math.max(0, Math.min(to, asked.length)), 0, moved);
    keep({
      asked,
      handed: keys,
      passing: kept === undefined ? [keys] : [...kept.passing, kept.asked, keys],
    });
  };

  return { drawn, move };
}
