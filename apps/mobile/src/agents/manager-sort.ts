/**
 * manager-sort.ts -- how the chosen workspace's Managers are sorted on the phone, the account's own choice, so the phone lists them as every other device does.
 *
 * The sort is one of the account's view choices
 * (`VIEW_CHOICE_KEY.MANAGER_SORT`), kept per workspace on the account and
 * followed while the account is signed in (`VIEW_CHOICES_FOLLOW`), as the
 * desktop's sidebar reads it (`@repo/panel`'s `manager-sort.ts`). A choice
 * made here is drawn at once over the host's read (`VIEW_CHOICE_WRITE`),
 * under the id of the row standing in its place or one minted here, and a
 * workspace with none kept lists its Managers newest started first
 * (`DEFAULT_MANAGER_SORT`).
 */

import { signedInAccountId } from "@repo/credentials/snapshot";
import { LIVE_READ } from "@repo/features/live-wire";
import {
  type ViewChoiceLiveRow,
  viewChoiceOf,
  viewChoiceWrite,
} from "@repo/features/view-choice-live";
import { VIEW_CHOICE_KEY } from "@repo/features/view-choice-wire";
import { DEFAULT_MANAGER_SORT, type ManagerSort } from "@repo/features/workspace-managers-model";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { selectAccount } from "@repo/host/app-state-reads";
import { useQuery } from "@tanstack/react-query";
import { Option } from "effect";
import { randomUUID } from "expo-crypto";
import { useCallback } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import { useLiveFollow } from "../host/live-follow.js";
import { useWrite } from "../use-write.js";

/** What a sort that did not keep says in the failure notice. */
const SORT_REFUSED = "Couldn't change how Managers are sorted.";

/** No choices, one list for every draw. */
const NO_CHOICES: readonly ViewChoiceLiveRow[] = [];

/** The account's view choices the host holds, as a `select`; none until read. */
function heldChoices(accountId: string) {
  return (state: AppStateSnapshot) => state[LIVE_READ.VIEW_CHOICES][accountId]?.rows;
}

/** The listed workspace's sort, and the press that changes it. */
export interface ManagerSortControl {
  readonly sort: ManagerSort;
  readonly onSort: (sort: ManagerSort) => void;
}

/** The sort of `workspaceId`'s Managers, the account's, and the press that keeps another on the account; the default, holding no read, where no workspace's Managers are listed. */
export function useManagerSort(workspaceId: string | undefined): ManagerSortControl {
  const acts = useHostActs();
  const write = useWrite();
  const account = useQuery({ ...appStateQuery, select: selectAccount }).data;
  const accountId = account === undefined ? undefined : signedInAccountId(account);
  const key = accountId ?? "";
  // Note that the choices are followed only while a workspace's Managers are listed, so a workspace with the Managers experiment off holds no read.
  useLiveFollow(workspaceId === undefined ? undefined : accountId, () =>
    acts[ACT_KIND.VIEW_CHOICES_FOLLOW](),
  );

  const rows =
    useQuery({ ...appStateQuery, select: useCallback(heldChoices(key), [key]) }).data ?? NO_CHOICES;

  const kept =
    workspaceId === undefined
      ? Option.none()
      : viewChoiceOf(rows, VIEW_CHOICE_KEY.MANAGER_SORT, workspaceId);

  const onSort = (next: ManagerSort) => {
    if (workspaceId === undefined) return;

    const chosen = viewChoiceWrite(
      rows,
      VIEW_CHOICE_KEY.MANAGER_SORT,
      workspaceId,
      next,
      randomUUID(),
    );

    void write(() => acts[ACT_KIND.VIEW_CHOICE_WRITE](chosen), {
      refused: (answer) => ("failure" in answer ? SORT_REFUSED : undefined),
    });
  };

  return { sort: Option.getOrElse(kept, () => DEFAULT_MANAGER_SORT), onSort };
}
