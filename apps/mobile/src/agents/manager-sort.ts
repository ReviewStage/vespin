/**
 * manager-sort.ts -- how the chosen workspace's Managers are sorted on the phone, the account's own choice, so the phone lists them as every other device does.
 *
 * The sort is one of the account's view choices
 * (`VIEW_CHOICE_KEY.MANAGER_SORT`, read through `../view-choices.ts`), kept per workspace on the account and
 * followed while the account is signed in (`VIEW_CHOICES_FOLLOW`), as the
 * desktop's sidebar reads it (`@repo/panel`'s `manager-sort.ts`). A choice
 * made here is drawn at once over the host's read (`VIEW_CHOICE_WRITE`),
 * under the id of the row standing in its place or one minted here, and a
 * workspace with none kept lists its Managers newest started first
 * (`DEFAULT_MANAGER_SORT`).
 */

import { VIEW_CHOICE_KEY } from "@repo/features/view-choice-wire";
import { DEFAULT_MANAGER_SORT, type ManagerSort } from "@repo/features/workspace-managers-model";
import { Option } from "effect";
import { useViewChoice } from "../view-choices.js";

/** What a sort that did not keep says in the failure notice. */
const SORT_REFUSED = "Couldn't change how Managers are sorted.";

/** The listed workspace's sort, and the press that changes it. */
export interface ManagerSortControl {
  readonly sort: ManagerSort;
  readonly onSort: (sort: ManagerSort) => void;
}

/** The sort of `workspaceId`'s Managers, the account's, and the press that keeps another on the account; the default, holding no read, where no workspace's Managers are listed. */
export function useManagerSort(workspaceId: string | undefined): ManagerSortControl {
  const { value, choose } = useViewChoice(VIEW_CHOICE_KEY.MANAGER_SORT, workspaceId, SORT_REFUSED);

  return { sort: Option.getOrElse(value, () => DEFAULT_MANAGER_SORT), onSort: choose };
}
