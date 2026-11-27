/**
 * view-choices.ts -- one of the account's view choices (a sort, a filter, a fold) as a screen reads and makes it on the phone, kept on the account so it follows the member to every device, as the panel's `view-choices.ts` reads it.
 *
 * The account's choices are followed while a screen reads one
 * (`VIEW_CHOICES_FOLLOW`), each declared once with the Schema its value
 * reads through (`@repo/features/view-choice-wire`'s `VIEW_CHOICE`). A
 * choice made is drawn at once over the host's read (`VIEW_CHOICE_WRITE`),
 * under the id of the row standing in its place or one minted here, and a
 * write that did not go says so in the failure notice in the screen's own
 * words.
 *
 * A choice an earlier build kept in this device's `NSUserDefaults` moves up
 * once (`useDeviceKeptMovedUp`), as the panel's `useKeptMovedUp` moves a
 * window's: where the account keeps none in its place, the device's is kept
 * on the account, and the device's own is let go either way.
 */

import { signedInAccountId } from "@repo/credentials/snapshot";
import { LIVE_READ } from "@repo/features/live-wire";
import {
  type ViewChoiceLiveRow,
  viewChoiceOf,
  viewChoiceWrite,
} from "@repo/features/view-choice-live";
import type { ViewChoiceKey, ViewChoiceValue } from "@repo/features/view-choice-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { selectAccount } from "@repo/host/app-state-reads";
import { heldValue, useHeldValue } from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { Option, Schema } from "effect";
import { randomUUID } from "expo-crypto";
import { useCallback, useEffect } from "react";
import { Settings } from "react-native";
import { appStateQuery } from "./host/app-state-query.js";
import { useHostActs } from "./host/host-provider.js";
import { useLiveFollow } from "./host/live-follow.js";
import { useWrite } from "./use-write.js";

/** No choices, one list for every draw. */
const NO_CHOICES: readonly ViewChoiceLiveRow[] = [];

/** The account's view choices the host holds, as a `select`; none until read. */
function heldChoices(accountId: string) {
  return (state: AppStateSnapshot) => state[LIVE_READ.VIEW_CHOICES][accountId]?.rows;
}

/** One view choice as a screen reads it: its value, none where the account keeps none or keeps one this build cannot read; whether the host has read the account's choices; and the press that keeps another, or forgets it with null. */
export interface ViewChoiceControl<Key extends ViewChoiceKey> {
  readonly value: Option.Option<ViewChoiceValue<Key>>;
  readonly answered: boolean;
  readonly choose: (value: ViewChoiceValue<Key> | null) => void;
}

/** A choice an earlier build kept in this device's `NSUserDefaults`: the name it is kept under, and its value as read at launch, none where none reads. */
export interface DeviceKept<Value> {
  readonly name: string;
  readonly left: ReturnType<typeof heldValue<Value | undefined>>;
}

/**
 * The account's choice of `key`, in `workspaceId` for a workspace's choice
 * and in none for the account's own, and the press that keeps another,
 * whose refusal says `refused`. A screen with no place to read yet, such
 * as a workspace not read, passes `undefined`, which holds no read.
 */
export function useViewChoice<Key extends ViewChoiceKey>(
  key: Key,
  workspaceId: string | null | undefined,
  refused: string,
): ViewChoiceControl<Key> {
  const acts = useHostActs();
  const write = useWrite();
  const account = useQuery({ ...appStateQuery, select: selectAccount }).data;
  const accountId = account === undefined ? undefined : signedInAccountId(account);
  const held = accountId ?? "";

  // Note that the choices are followed only while a screen reads one in a place, so a screen with none holds no read.
  useLiveFollow(workspaceId === undefined ? undefined : accountId, () =>
    acts[ACT_KIND.VIEW_CHOICES_FOLLOW](),
  );

  const heldRows = useQuery({
    ...appStateQuery,
    select: useCallback(heldChoices(held), [held]),
  }).data;

  const rows = heldRows ?? NO_CHOICES;

  const choose = (value: ViewChoiceValue<Key> | null) => {
    if (workspaceId === undefined) return;

    const chosen = viewChoiceWrite(rows, key, workspaceId, value, randomUUID());

    void write(() => acts[ACT_KIND.VIEW_CHOICE_WRITE](chosen), {
      refused: (answer) => ("failure" in answer ? refused : undefined),
    });
  };

  return {
    value: workspaceId === undefined ? Option.none() : viewChoiceOf(rows, key, workspaceId),
    answered: workspaceId !== undefined && heldRows !== undefined,
    choose,
  };
}

/** A choice an earlier build kept under `name` in this device's `NSUserDefaults`, read once a launch through `schema`: none where it reads as no value this build knows. */
export function deviceKept<Value>(
  name: string,
  schema: Schema.Codec<Value, unknown>,
): DeviceKept<Value> {
  const kept: unknown = Settings.get(name);

  return { name, left: heldValue(Option.getOrUndefined(Schema.decodeUnknownOption(schema)(kept))) };
}

/**
 * Moves the choice an earlier build kept on this device up to the account,
 * once the host has read the account's choices: kept there where the account
 * keeps none in its place, and let go here either way. Note that a choice
 * the account already keeps stands over the device's, since another device
 * made it since.
 */
export function useDeviceKeptMovedUp<Key extends ViewChoiceKey>(
  choice: ViewChoiceControl<Key>,
  kept: DeviceKept<ViewChoiceValue<Key>>,
): void {
  const left = useHeldValue(kept.left);
  const { answered, value, choose } = choice;
  const unkept = Option.isNone(value);

  useEffect(() => {
    if (!answered || left === undefined) return;

    if (unkept) choose(left);
    Settings.set({ [kept.name]: null });
    kept.left.set(undefined);
  }, [answered, left, unkept, choose, kept]);
}
