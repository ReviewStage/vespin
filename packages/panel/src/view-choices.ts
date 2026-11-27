import { signedInAccountId } from "@repo/credentials/snapshot";
import {
  type ViewChoiceLiveRow,
  viewChoiceOf,
  viewChoiceWrite,
} from "@repo/features/view-choice-live";
import type { ViewChoiceKey, ViewChoiceValue } from "@repo/features/view-choice-wire";
import { ACT_KIND } from "@repo/host/acts";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createStore, type Store, useSelector } from "@tanstack/react-store";
import { Option } from "effect";
import { useEffect, useMemo, useRef, useState } from "react";
import { actMutation, pressMutation } from "./act-mutations.js";
import { viewChoicesQuery } from "./live-reads.js";
import { selectAccount, useAppStateSlice } from "./use-app-state.js";

/**
 * view-choices.ts -- one of the account's view choices (a sort, a filter, a fold) as a surface reads and makes it, kept on the account so it follows the member to every device.
 *
 * The choices are the account's live read (`viewChoicesQuery`), held while a
 * surface reads one, each declared once with the Schema its value reads
 * through (`@repo/features/view-choice-wire`'s `VIEW_CHOICE`). A choice made
 * is drawn at once over the read (`VIEW_CHOICE_WRITE`), under the id of the
 * row standing in its place, or an id of the window's own where none
 * stands, so the service writes over the one choice in each place.
 *
 * A choice this window kept in its own storage before the account kept it
 * (`use-kept.ts`) moves up once (`useKeptMovedUp`): where the account keeps
 * none in its place, the window's is kept on the account, and the window's
 * own is let go either way, so the first device to read a choice it kept
 * hands it to every other.
 *
 * A surface reads a choice through `useAccountChoice`, which draws the
 * account's choice, the window's own while it waits to move up, or the
 * surface's default; and holds a choice in the window alone, never kept,
 * where it keeps none on the account: in a fixture run, whose frames never
 * wear a developer's choices, and in a window no account is signed in to.
 */

/** One view choice as a surface reads it: its value, none where the account keeps none or keeps one this build cannot read; whether the read has answered; and the press that makes another, or forgets it with null. */
export interface ViewChoiceControl<Key extends ViewChoiceKey> {
  readonly value: Option.Option<ViewChoiceValue<Key>>;
  readonly answered: boolean;
  /** Keeps `value`, or forgets the choice with null, telling `settled` once the write has gone or been refused. */
  readonly choose: (value: ViewChoiceValue<Key> | null, settled?: () => void) => void;
}

/** No choices, one list for every draw. */
const NO_CHOICES: readonly ViewChoiceLiveRow[] = [];

/**
 * The account's choice of `key`, in `workspaceId` for a workspace's choice
 * and in none for the account's own. A surface with no place yet, a
 * workspace not read, passes `undefined`, which reads nothing and holds no
 * read.
 */
export function useViewChoice<Key extends ViewChoiceKey>(
  key: Key,
  workspaceId: string | null | undefined,
): ViewChoiceControl<Key> {
  const accountId = signedInAccountId(useAppStateSlice(selectAccount));
  const read = useQuery(viewChoicesQuery(workspaceId === undefined ? undefined : accountId));
  const writing = useMutation(pressMutation(ACT_KIND.VIEW_CHOICE_WRITE));
  const rows = read.data ?? NO_CHOICES;

  // Note that the value is decoded once for the rows read, so a record or a list stands as one object across draws until the rows move, and an effect over it runs only then.
  const value = useMemo(
    () => (workspaceId === undefined ? Option.none() : viewChoiceOf(rows, key, workspaceId)),
    [rows, key, workspaceId],
  );

  return {
    value,
    answered: workspaceId !== undefined && read.data !== undefined,
    choose: (value, settled) => {
      if (workspaceId === undefined) return;
      const write = viewChoiceWrite(rows, key, workspaceId, value, crypto.randomUUID());

      if (settled === undefined) {
        writing.mutate(write);

        return;
      }

      // Note that the write is followed by its promise rather than a callback of the press's, which the library drops once the surface that pressed it goes, so `settled` is told either way.
      writing.mutateAsync(write).then(settled, settled);
    },
  };
}

/** Places a choice is kept in (a workspace, or none for the account's own), by the account they were met under. */
type Places = Map<string, Set<string | null>>;

/** Whether `places` holds `workspaceId` under `accountId`. */
function holdsPlace(places: Places, accountId: string, workspaceId: string | null): boolean {
  return places.get(accountId)?.has(workspaceId) === true;
}

/** Adds `workspaceId` to `places` under `accountId`. */
function addPlace(places: Places, accountId: string, workspaceId: string | null): void {
  const held = places.get(accountId) ?? new Set<string | null>();
  held.add(workspaceId);
  places.set(accountId, held);
}

/**
 * Moves a choice this window kept itself up to the account, once the
 * account's read has answered: kept there where the account keeps none in
 * its place, and let go here through `forget` once the account kept it, or
 * at once where the account already keeps one, since another device made it
 * since. Note that it is tried once a mount for each account and place, so a
 * surface that moves to another workspace moves that workspace's choice too, and that a write refused or
 * unanswered leaves the window's copy where it was, since the host takes the
 * write back and nothing else would keep the choice; the next launch tries
 * again.
 */
export function useKeptMovedUp<Key extends ViewChoiceKey>(
  key: Key,
  workspaceId: string | null | undefined,
  choice: ViewChoiceControl<Key>,
  kept: ViewChoiceValue<Key> | undefined,
  forget: () => void,
): void {
  const accountId = signedInAccountId(useAppStateSlice(selectAccount));
  const rows = useQuery(viewChoicesQuery(workspaceId === undefined ? undefined : accountId)).data;
  const { mutateAsync: moveUp } = useMutation(actMutation(ACT_KIND.VIEW_CHOICE_WRITE));
  const { answered, value } = choice;
  const unkept = Option.isNone(value);
  // The places this mount sent a move up for, and those whose move is still on its way, each by the account it was sent under.
  const tried = useRef<Places>(new Map());
  const moving = useRef<Places>(new Map());

  useEffect(() => {
    if (!answered || kept === undefined || workspaceId === undefined || rows === undefined) return;

    if (accountId === undefined) return;

    // Note that the account's choice drawn while the move up is on its way is the move's own, so the window's copy waits for its answer.
    if (!unkept) {
      if (!holdsPlace(moving.current, accountId, workspaceId)) forget();

      return;
    }

    // Note that each place moves up once a mount, so a refused move waits for the next launch rather than being sent again as the read takes it back.
    if (holdsPlace(tried.current, accountId, workspaceId)) return;
    addPlace(tried.current, accountId, workspaceId);
    addPlace(moving.current, accountId, workspaceId);

    void moveUp(viewChoiceWrite(rows, key, workspaceId, kept, crypto.randomUUID()))
      .then(forget, () => undefined)
      .finally(() => {
        moving.current.get(accountId)?.delete(workspaceId);
      });
  }, [answered, kept, unkept, key, workspaceId, rows, forget, moveUp, accountId]);
}

/** What this window kept of a choice in its own storage, waiting to move up to the account, read as the account reads it; and the door that lets it go here (`use-kept.ts`'s `useKeptLeaving`, for one kept whole under a name of its own). */
export type KeptEarlier<Value> = readonly [Value | undefined, () => void];

/** A choice made over the one standing as it is pressed, such as a fold toggled. */
type ChoiceChange<Key extends ViewChoiceKey> = (
  standing: ViewChoiceValue<Key>,
) => ViewChoiceValue<Key>;

/** One view choice as a surface draws it: its value; the press that makes another; and the press that makes one over the choice standing as it is pressed. */
export interface AccountChoice<Key extends ViewChoiceKey> {
  readonly value: ViewChoiceValue<Key>;
  readonly choose: (next: ViewChoiceValue<Key>) => void;
  readonly change: (changed: ChoiceChange<Key>) => void;
}

/** The choices a window holds for itself, by key and then place, none of them kept. */
type HeldChoices = ReadonlyMap<ViewChoiceKey, ReadonlyMap<string | null, unknown>>;

/** Each window's held choices, by the window's one Query client, so they go with the window. */
const HELD = new WeakMap<QueryClient, Store<HeldChoices>>();

/** Each window's choices made on the account whose writes are still out, drawn over the account's until they settle. */
const PENDING = new WeakMap<QueryClient, Store<HeldChoices>>();

/** The choices `client`'s window holds in `stores`, one store for the window. */
function windowChoices(
  stores: WeakMap<QueryClient, Store<HeldChoices>>,
  client: QueryClient,
): Store<HeldChoices> {
  const standing = stores.get(client);

  if (standing !== undefined) return standing;
  const made = createStore<HeldChoices>(new Map());
  stores.set(client, made);

  return made;
}

/** `all` with the choice of `key` in `place` held as `value`, or let go where it is undefined. */
function heldWith<Key extends ViewChoiceKey>(
  all: HeldChoices,
  key: Key,
  place: string | null,
  value: ViewChoiceValue<Key> | undefined,
): HeldChoices {
  const inKey = new Map(all.get(key));

  if (value === undefined) inKey.delete(place);
  else inKey.set(place, value);

  return new Map(all).set(key, inKey);
}

/** The choice of `key` the window holds for itself in `place`, none until one is made. */
function heldIn<Key extends ViewChoiceKey>(
  all: HeldChoices,
  key: Key,
  place: string | null,
): ViewChoiceValue<Key> | undefined {
  // SAFETY: a choice is held under its key only as `useAccountChoice` holds it, a value of that key's.
  return all.get(key)?.get(place) as ViewChoiceValue<Key> | undefined;
}

/**
 * The choice of `key` in `place` (a workspace's id for a workspace's
 * choice, null for the account's own, undefined while the surface has no
 * place yet) as the surface draws it, and the presses that make another.
 * Where an account is signed in and the run is not `staged` (a fixture
 * run's), it is the account's choice, kept there as each is made; the
 * window's own `earlier` choice while it waits to move up
 * (`useKeptMovedUp`); and `fallback` where neither is. Otherwise the window
 * holds it alone, drawn in every surface reading it until the window goes,
 * and keeps nothing. Note that `change` reads the choice standing as it is
 * pressed, rather than the one last drawn, so a press a surface held from
 * an earlier draw (a menu standing open) never undoes one made since; and
 * that a change made before the account's read answered waits for it,
 * drawn meanwhile, and is then laid over the account's choice, so a list
 * kept whole is never written over with one built on the default.
 */
export function useAccountChoice<Key extends ViewChoiceKey>(
  key: Key,
  place: string | null | undefined,
  fallback: ViewChoiceValue<Key>,
  staged: boolean,
  earlier: KeptEarlier<ViewChoiceValue<Key>>,
): AccountChoice<Key> {
  const client = useQueryClient();
  const accountId = signedInAccountId(useAppStateSlice(selectAccount));
  const onAccount = staged || accountId === undefined ? undefined : place;
  const choice = useViewChoice(key, onAccount);
  const held = windowChoices(HELD, client);
  const pending = windowChoices(PENDING, client);
  const where = place ?? null;
  const heldNow = useSelector(held, (all) => heldIn(all, key, where));
  const pendingNow = useSelector(pending, (all) => heldIn(all, key, where));
  const [left, forgetLeft] = earlier;

  const [waiting, setWaiting] = useState<readonly ChoiceChange<Key>[]>([]);

  useKeptMovedUp(key, onAccount, choice, left, forgetLeft);

  const own = staged ? undefined : left;

  const drawn =
    onAccount === undefined
      ? (heldNow ?? own ?? fallback)
      : (pendingNow ?? Option.getOrElse(choice.value, () => own ?? fallback));

  const value = waiting.reduce((was, changed) => changed(was), drawn);

  // Note that a choice made on the account is drawn at once, in the frame it is pressed, and stands until its write settles, by when the account's read carries it, or has taken it back where it was refused.
  const choose = (next: ViewChoiceValue<Key>) => {
    if (place === undefined) return;

    if (onAccount === undefined) {
      held.setState((all) => heldWith(all, key, place, next));

      return;
    }

    pending.setState((all) => heldWith(all, key, place, next));

    // Note that a press made since stands until its own write settles.
    choice.choose(next, () =>
      pending.setState((all) =>
        heldIn(all, key, place) === next ? heldWith(all, key, place, undefined) : all,
      ),
    );
  };

  // The choice standing as a change is pressed: the window's own, or the account's as the window reads it now.
  const standing = (): ViewChoiceValue<Key> => {
    if (onAccount === undefined) return heldIn(held.state, key, where) ?? own ?? fallback;
    const rows = client.getQueryData(viewChoicesQuery(accountId).queryKey) ?? NO_CHOICES;

    return (
      heldIn(pending.state, key, where) ??
      Option.getOrElse(viewChoiceOf(rows, key, onAccount), () => own ?? fallback)
    );
  };

  const { answered } = choice;
  const unread = onAccount !== undefined && !answered;

  // Note that the changes made before the account's read answered are laid over the account's choice once it does, and written once, since one written over the default then would stand over the choice another device kept.
  useEffect(() => {
    if (unread || waiting.length === 0) return;
    setWaiting([]);
    choose(waiting.reduce((was, changed) => changed(was), standing()));
  });

  const change = (changed: ChoiceChange<Key>) => {
    if (place === undefined) return;

    if (unread) {
      setWaiting((was) => [...was, changed]);

      return;
    }

    choose(changed(standing()));
  };

  return { value, choose, change };
}
