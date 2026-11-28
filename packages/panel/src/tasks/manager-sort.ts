/**
 * manager-sort.ts -- how each workspace's Managers are sorted in the sidebar, kept per workspace on the account, so every device lists them alike.
 *
 * The sort is the reader's reading of a workspace's Managers, one of the
 * account's view choices (`VIEW_CHOICE_KEY.MANAGER_SORT`, `view-choices.ts`),
 * so one workspace's sort never changes another's and a sort chosen on one
 * device stands on every other. A workspace with none kept lists its
 * Managers newest started first, as they always stood
 * (`DEFAULT_MANAGER_SORT`). A sort this window kept itself before the
 * account kept it moves up to the account once (`useKeptMovedUp`). A
 * fixture run sorts so and keeps nothing, so its frames never wear a
 * developer's choice.
 */

import { VIEW_CHOICE_KEY } from "@repo/features/view-choice-wire";
import {
  DEFAULT_MANAGER_SORT,
  MANAGER_SORT,
  type ManagerSort,
} from "@repo/features/workspace-managers-model";
import { createStore, useSelector } from "@tanstack/react-store";
import { Option, Schema } from "effect";
import { useCallback } from "react";
import { keptKey, useKept } from "../use-kept.js";
import { useKeptMovedUp, useViewChoice } from "../view-choices.js";

/** Each workspace's sort, by its id. */
const storedSorts = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.Literals(Object.values(MANAGER_SORT))),
);

type StoredSorts = typeof storedSorts.Type;

/** Where an earlier build kept the sorts in the renderer's storage, each moved up to the account as its workspace is listed. */
const KEPT = { SORTS: keptKey("app.sidebarManagerSorts", storedSorts) } as const;

/** A fixture run's sorts, which keep nothing. */
const stagedSortsStore = createStore<StoredSorts>({});

/** The listed workspace's sort, and the press that changes it. */
export interface ManagerSortControl {
  readonly sort: ManagerSort;
  readonly onSort: (sort: ManagerSort) => void;
}

/** The sort of the workspace listed, kept on the account as each choice is made, unless the run is `staged`. */
export function useManagerSort(
  workspaceId: string | undefined,
  staged: boolean,
): ManagerSortControl {
  const place = staged ? undefined : workspaceId;
  const choice = useViewChoice(VIEW_CHOICE_KEY.MANAGER_SORT, place);
  const [kept, , changeKept] = useKept<StoredSorts>(KEPT.SORTS, {});
  const stagedSorts = useSelector(stagedSortsStore);

  const forgetKept = useCallback(() => {
    if (place === undefined) return;
    changeKept(({ [place]: _moved, ...rest }) => rest);
  }, [place, changeKept]);

  useKeptMovedUp(
    VIEW_CHOICE_KEY.MANAGER_SORT,
    place,
    choice,
    place === undefined ? undefined : kept[place],
    forgetKept,
  );

  const stagedSort = workspaceId === undefined ? undefined : stagedSorts[workspaceId];
  const chosen = staged ? stagedSort : Option.getOrUndefined(choice.value);

  const onSort = (next: ManagerSort) => {
    if (workspaceId === undefined) return;

    if (staged) {
      stagedSortsStore.setState((sorts) => ({ ...sorts, [workspaceId]: next }));

      return;
    }

    choice.choose(next);
  };

  return { sort: chosen ?? DEFAULT_MANAGER_SORT, onSort };
}
