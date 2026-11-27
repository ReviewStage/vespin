/**
 * fold-list.ts -- one of the account's lists of folds (the sidebar's folded groups and sections, the tasks it opened, the Inbox's folded runs) as a screen reads it on the phone, and the press that folds one id in or out, held until the account's list is read.
 *
 * Each such list is one view choice kept whole (`../view-choices.ts`), so a
 * press made before the phone read the account's list would write a list of
 * that press alone over every fold another device kept. A press is
 * therefore one id folded in or out, drawn at once, and laid over the
 * account's list once it is read (`@repo/features/view-choice-folds`'s
 * `foldsToWrite`); it waits with the account that made it, and is dropped
 * once another account is signed in (`pressesFor`). A list an earlier build
 * kept in this device's `NSUserDefaults` is drawn meanwhile, and moves up
 * once the account's is read where the account keeps none, the presses that
 * waited laid over it, in one write.
 */

import { signedInAccountId } from "@repo/credentials/snapshot";
import {
  type FoldsWaiting,
  foldsPressed,
  foldsToWrite,
  pressesFor,
} from "@repo/features/view-choice-folds";
import type { VIEW_CHOICE_KEY, ViewChoiceValue } from "@repo/features/view-choice-wire";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { heldValue, useHeldValue } from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { Option } from "effect";
import { useEffect, useMemo } from "react";
import { Settings } from "react-native";
import { appStateQuery } from "./host/app-state-query.js";
import { type DeviceKept, useViewChoice } from "./view-choices.js";

/** The keys the account keeps a list of folds under, each by its ids. */
export type ListFoldKey =
  | typeof VIEW_CHOICE_KEY.SIDEBAR_FOLDED_SECTIONS
  | typeof VIEW_CHOICE_KEY.SIDEBAR_FOLDED_GROUPS
  | typeof VIEW_CHOICE_KEY.SIDEBAR_OPENED_TASKS
  | typeof VIEW_CHOICE_KEY.INBOX_FOLDED_RUNS;

/** What a list of folds keeps each fold by: a section's or a task's id, a repository's full name (null for none), or an Inbox run. */
export type FoldId<Key extends ListFoldKey> = ViewChoiceValue<Key>[number];

/** One of the account's lists of folds, and the press that folds one id in or out of it. */
export type FoldList<Id> = readonly [readonly Id[], (id: Id, on: boolean) => void];

/** How a list is read and written: what its refusal says, the bound its writes are held to, and the list an earlier build kept on this device, where one did. */
export interface FoldListOptions<Key extends ListFoldKey> {
  readonly refused: string;
  readonly bounded?: ((ids: readonly FoldId<Key>[]) => readonly FoldId<Key>[]) | undefined;
  readonly kept?: DeviceKept<ViewChoiceValue<Key>> | undefined;
}

/** A value held outside React, which every screen reads and is told of as it changes. */
type Held<T> = ReturnType<typeof heldValue<T>>;

/** No fold. */
const NONE: readonly never[] = [];

/** No press waiting for the account's folds. */
const NOTHING_WAITING: FoldsWaiting<never> = { accountId: undefined, presses: NONE };

/** No list kept on the device, for a key no earlier build kept. */
const NOTHING_KEPT = heldValue<undefined>(undefined);

/**
 * The presses waiting for each list, by its key: one queue for the phone,
 * whatever screens read the list, so every screen draws a press made on
 * any, and the first to see the account's list read writes them once.
 */
const WAITING = new Map<ListFoldKey, Held<FoldsWaiting<unknown>>>();

/** The presses waiting for `key`'s list, one queue for every screen reading it. */
function waitingFor<Key extends ListFoldKey>(key: Key): Held<FoldsWaiting<FoldId<Key>>> {
  const standing = WAITING.get(key) ?? heldValue<FoldsWaiting<unknown>>(NOTHING_WAITING);
  WAITING.set(key, standing);

  // SAFETY: a key's queue is only ever filled with that key's ids (`useFoldList`'s `press`), so what it holds is a queue of them.
  return standing as Held<FoldsWaiting<FoldId<Key>>>;
}

/** The account signed in, as a `select`; none while nobody is. */
function selectAccountId(state: AppStateSnapshot): string | undefined {
  return signedInAccountId(state.account);
}

/** A list kept as it is, its key bounding nothing. */
function unbounded<Id>(ids: readonly Id[]): readonly Id[] {
  return ids;
}

/**
 * The account's list of folds under `key`, the device's earlier list while
 * the account's is unread and none where neither is, each press drawn over
 * it at once; and the press that folds one id in or out. A press made
 * before the account's list is read waits for it, and is then laid over it
 * (`foldsToWrite`), as is a list the device kept where the account keeps
 * none, in one write. Note that the presses and the device's list are one
 * for the phone, and the first screen to see the account's list read takes
 * both as they stand then, never as it last drew them, so two screens
 * reading one list never write it twice, one over the other.
 */
export function useFoldList<Key extends ListFoldKey>(
  key: Key,
  { refused, bounded = unbounded, kept }: FoldListOptions<Key>,
): FoldList<FoldId<Key>> {
  const { value, answered, choose } = useViewChoice(key, null, refused);
  const { data: accountId } = useQuery({ ...appStateQuery, select: selectAccountId });
  const left = useHeldValue(kept?.left ?? NOTHING_KEPT);
  const queue = waitingFor(key);
  const waiting = useHeldValue(queue);
  const presses = pressesFor(waiting, accountId);
  // SAFETY: each list key's value is a list of its ids (`ListFoldKey`).
  const saved = Option.getOrElse(value, () => left ?? NONE) as readonly FoldId<Key>[];
  const unkept = Option.isNone(value);
  const drawn = useMemo(() => foldsPressed(saved, presses), [saved, presses]);

  // Note that once the account's list is read, the presses that waited and the device's earlier list are taken as they stand now and let go before the write, so a screen whose draw is older finds nothing left to write; presses another account made, before a sign-out, are dropped.
  useEffect(() => {
    const queued = queue.read();
    const keptNow = kept?.left.read();
    const pressed = pressesFor(queued, accountId);

    if (queued.presses.length > 0 && pressed.length === 0) {
      queue.set(NOTHING_WAITING);

      return;
    }

    if (!answered || (keptNow === undefined && pressed.length === 0)) return;
    queue.set(NOTHING_WAITING);

    if (kept !== undefined && keptNow !== undefined) {
      Settings.set({ [kept.name]: null });
      kept.left.set(undefined);
    }

    // SAFETY: each list key's value is a list of its ids (`ListFoldKey`).
    const base = Option.getOrElse(value, () => keptNow ?? NONE) as readonly FoldId<Key>[];

    if (unkept || pressed.length > 0) choose(bounded(foldsPressed(base, pressed)));
  }, [answered, value, unkept, kept, queue, accountId, waiting, left, choose, bounded]);

  const press = (id: FoldId<Key>, on: boolean) => {
    const written =
      left === undefined && presses.length === 0
        ? foldsToWrite({ answered, saved }, [{ id, on }])
        : undefined;

    if (written !== undefined) {
      choose(bounded(written));

      return;
    }

    const was = queue.read();
    queue.set({ accountId, presses: [...pressesFor(was, accountId), { id, on }] });
  };

  return [drawn, press];
}
