/**
 * manager-sort.ts -- how each workspace's Managers are sorted in the sidebar, kept per workspace on this Mac.
 *
 * The sort is the reader's reading of a workspace's Managers, kept in the
 * renderer's own storage as the Tasks head's view is (`task-list-view.ts`),
 * so one workspace's sort never changes another's. A workspace with none
 * kept lists its Managers newest started first, as they always stood
 * (`DEFAULT_MANAGER_SORT`). A fixture run sorts so and keeps nothing, so
 * its frames never wear a developer's choice.
 */

import {
  DEFAULT_MANAGER_SORT,
  MANAGER_SORT,
  type ManagerSort,
} from "@repo/features/workspace-managers-model";
import { createStore, useSelector } from "@tanstack/react-store";
import { Schema } from "effect";
import { keptKey, useKept } from "../use-kept.js";

/** Each workspace's sort, by its id. */
const storedSorts = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.Literals(Object.values(MANAGER_SORT))),
);

type StoredSorts = typeof storedSorts.Type;

/** Where the sorts are kept in the renderer's storage. */
const KEPT = { SORTS: keptKey("app.sidebarManagerSorts", storedSorts) } as const;

/** A fixture run's sorts, which keep nothing. */
const stagedSortsStore = createStore<StoredSorts>({});

/** The listed workspace's sort, and the press that changes it. */
export interface ManagerSortControl {
  readonly sort: ManagerSort;
  readonly onSort: (sort: ManagerSort) => void;
}

/** The sort of the workspace listed, kept as each choice is made, unless the run is `staged`. */
export function useManagerSort(
  workspaceId: string | undefined,
  staged: boolean,
): ManagerSortControl {
  const [kept, keep] = useKept<StoredSorts>(KEPT.SORTS, {});
  const stagedSorts = useSelector(stagedSortsStore);
  const sorts = staged ? stagedSorts : kept;
  const sort = (workspaceId === undefined ? undefined : sorts[workspaceId]) ?? DEFAULT_MANAGER_SORT;

  const onSort = (next: ManagerSort) => {
    if (workspaceId === undefined) return;
    const all = { ...sorts, [workspaceId]: next };

    if (staged) {
      stagedSortsStore.setState(() => all);

      return;
    }

    keep(all);
  };

  return { sort, onSort };
}
