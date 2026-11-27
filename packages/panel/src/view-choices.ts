import { signedInAccountId } from "@repo/credentials/snapshot";
import {
  type ViewChoiceLiveRow,
  viewChoiceOf,
  viewChoiceWrite,
} from "@repo/features/view-choice-live";
import type { ViewChoiceKey, ViewChoiceValue } from "@repo/features/view-choice-wire";
import { ACT_KIND } from "@repo/host/acts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createStore, useSelector } from "@tanstack/react-store";
import { Option } from "effect";
import { useEffect } from "react";
import { actMutation, pressMutation } from "./act-mutations.js";
import { viewChoicesQuery } from "./live-reads.js";
import { selectAccount, selectFixtureStaged, useAppStateSlice } from "./use-app-state.js";
import { type KeptKey, useKeptLeaving } from "./use-kept.js";

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
 * A choice of the account's own, kept once for every place it is drawn,
 * reads through `useAccountChoice`, which moves the window's own up and
 * reads and keeps nothing in a fixture run, so its frames never wear a
 * developer's choice.
 */

/** One view choice as a surface reads it: its value, none where the account keeps none or keeps one this build cannot read; whether the read has answered; and the press that makes another, or forgets it with null. */
export interface ViewChoiceControl<Key extends ViewChoiceKey> {
  readonly value: Option.Option<ViewChoiceValue<Key>>;
  readonly answered: boolean;
  readonly choose: (value: ViewChoiceValue<Key> | null) => void;
}

/** What an earlier build kept of a choice in this window's storage, and the choice it reads as on the account. */
export interface KeptEarlier<Key extends ViewChoiceKey, A> {
  readonly kept: KeptKey<A>;
  readonly moved: (kept: A) => ViewChoiceValue<Key>;
}

/** One of the account's own choices as a surface draws it: its value, the surface's default where the account keeps none; the press that keeps another; and the press that keeps one made over the choice held now. */
export interface AccountChoice<Key extends ViewChoiceKey> {
  readonly value: ViewChoiceValue<Key>;
  readonly choose: (next: ViewChoiceValue<Key>) => void;
  readonly change: (changed: (held: ViewChoiceValue<Key>) => ViewChoiceValue<Key>) => void;
}

/** The choices a fixture run made, by key, which keep nothing. */
const stagedChoices = createStore<{ readonly [Key in ViewChoiceKey]?: ViewChoiceValue<Key> }>({});

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

  return {
    value: workspaceId === undefined ? Option.none() : viewChoiceOf(rows, key, workspaceId),
    answered: workspaceId !== undefined && read.data !== undefined,
    choose: (value) => {
      if (workspaceId === undefined) return;
      writing.mutate(viewChoiceWrite(rows, key, workspaceId, value, crypto.randomUUID()));
    },
  };
}

/**
 * Moves a choice this window kept itself up to the account, once the
 * account's read has answered: kept there where the account keeps none in
 * its place, and let go here either way through `forget`. Note that a
 * choice the account already keeps stands over the window's, since another
 * device made it since.
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
  const { mutate: moveUp } = useMutation(actMutation(ACT_KIND.VIEW_CHOICE_WRITE));
  const { answered, value } = choice;
  const unkept = Option.isNone(value);

  useEffect(() => {
    if (!answered || kept === undefined || workspaceId === undefined || rows === undefined) return;

    if (unkept) moveUp(viewChoiceWrite(rows, key, workspaceId, kept, crypto.randomUUID()));
    forget();
  }, [answered, kept, unkept, key, workspaceId, rows, forget, moveUp]);
}

/**
 * The account's own choice of `key` (one kept for no workspace), `fallback`
 * where it keeps none, and the presses that keep another on the account. The
 * choice this window kept itself before (`earlier`) moves up once
 * (`useKeptMovedUp`). A fixture run reads `fallback` and holds what it
 * chooses in memory alone. Note that `change` reads the choice the window
 * holds as it is pressed, rather than the one last drawn, so a press a
 * surface held from an earlier draw (a menu standing open) never undoes
 * one made since.
 */
export function useAccountChoice<Key extends ViewChoiceKey, A>(
  key: Key,
  fallback: ViewChoiceValue<Key>,
  earlier: KeptEarlier<Key, A>,
): AccountChoice<Key> {
  const client = useQueryClient();
  const accountId = signedInAccountId(useAppStateSlice(selectAccount));
  const staged = useAppStateSlice(selectFixtureStaged) === true;
  const place = staged ? undefined : null;
  const choice = useViewChoice(key, place);
  const [left, forgetLeft] = useKeptLeaving(earlier.kept);
  const stagedHeld = useSelector(stagedChoices)[key];

  useKeptMovedUp(
    key,
    place,
    choice,
    left === undefined ? undefined : earlier.moved(left),
    forgetLeft,
  );

  const choose = (next: ViewChoiceValue<Key>) => {
    if (!staged) {
      choice.choose(next);

      return;
    }

    stagedChoices.setState((held) => ({ ...held, [key]: next }));
  };

  const heldNow = (): ViewChoiceValue<Key> | undefined => {
    if (staged) return stagedChoices.state[key];
    const rows = client.getQueryData(viewChoicesQuery(accountId).queryKey) ?? NO_CHOICES;

    return Option.getOrUndefined(viewChoiceOf(rows, key, null));
  };

  const chosen = staged ? stagedHeld : Option.getOrUndefined(choice.value);

  return {
    value: chosen ?? fallback,
    choose,
    change: (changed) => choose(changed(heldNow() ?? fallback)),
  };
}
