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
import { useEffect, useMemo, useState } from "react";
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

/** No fold. */
const NONE: readonly never[] = [];

/** No press waiting for the account's folds. */
const NOTHING_WAITING: FoldsWaiting<never> = { accountId: undefined, presses: NONE };

/** No list kept on the device, for a key no earlier build kept. */
const NOTHING_KEPT = heldValue<undefined>(undefined);

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
 * none, in one write.
 */
export function useFoldList<Key extends ListFoldKey>(
  key: Key,
  { refused, bounded = unbounded, kept }: FoldListOptions<Key>,
): FoldList<FoldId<Key>> {
  const { value, answered, choose } = useViewChoice(key, null, refused);
  const { data: accountId } = useQuery({ ...appStateQuery, select: selectAccountId });
  const left = useHeldValue(kept?.left ?? NOTHING_KEPT);
  const [waiting, setWaiting] = useState<FoldsWaiting<FoldId<Key>>>(NOTHING_WAITING);
  const presses = pressesFor(waiting, accountId);
  // SAFETY: each list key's value is a list of its ids (`ListFoldKey`).
  const saved = Option.getOrElse(value, () => left ?? NONE) as readonly FoldId<Key>[];
  const unkept = Option.isNone(value);
  const drawn = useMemo(() => foldsPressed(saved, presses), [saved, presses]);

  // Note that once the account's list is read, the device's earlier list moves up where the account keeps none and is let go either way, and the presses that waited are laid over the list standing then, in one write; those another account made, before a sign-out, are dropped.
  useEffect(() => {
    if (waiting.presses.length > 0 && presses.length === 0) {
      setWaiting(NOTHING_WAITING);

      return;
    }

    if (!answered) return;

    if (kept !== undefined && left !== undefined) {
      if (unkept || presses.length > 0) choose(bounded(foldsPressed(saved, presses)));
      Settings.set({ [kept.name]: null });
      kept.left.set(undefined);
      setWaiting(NOTHING_WAITING);

      return;
    }

    const written = foldsToWrite({ answered, saved }, presses);

    if (written === undefined) return;
    setWaiting(NOTHING_WAITING);
    choose(bounded(written));
  }, [answered, saved, unkept, left, kept, waiting, presses, choose, bounded]);

  const press = (id: FoldId<Key>, on: boolean) => {
    const written =
      left === undefined ? foldsToWrite({ answered, saved }, [{ id, on }]) : undefined;

    if (written !== undefined) {
      choose(bounded(written));

      return;
    }

    setWaiting((was) => ({ accountId, presses: [...pressesFor(was, accountId), { id, on }] }));
  };

  return [drawn, press];
}
