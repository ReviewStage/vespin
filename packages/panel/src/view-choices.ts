import { signedInAccountId } from "@repo/credentials/snapshot";
import {
  type ViewChoiceLiveRow,
  viewChoiceOf,
  viewChoiceWrite,
} from "@repo/features/view-choice-live";
import type { ViewChoiceKey, ViewChoiceValue } from "@repo/features/view-choice-wire";
import { ACT_KIND } from "@repo/host/acts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Option } from "effect";
import { useEffect } from "react";
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
 */

/** One view choice as a surface reads it: its value, none where the account keeps none or keeps one this build cannot read; whether the read has answered; and the press that makes another, or forgets it with null. */
export interface ViewChoiceControl<Key extends ViewChoiceKey> {
  readonly value: Option.Option<ViewChoiceValue<Key>>;
  readonly answered: boolean;
  readonly choose: (value: ViewChoiceValue<Key> | null) => void;
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
