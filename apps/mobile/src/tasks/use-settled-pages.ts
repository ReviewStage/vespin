/**
 * use-settled-pages.ts -- the Tasks tab's reads of a workspace's settled tasks a page at a time, from the service into the task list, while its view shows finished work past what the list holds, as the panel's Tasks page reads them.
 *
 * The paging itself is the one every client's list reads by
 * (`@repo/features/settled-paging`): this hands it the host's act port and
 * tells it, each draw, the workspace the tab shows settled tasks in full
 * for, its completed window at All or its statuses naming Done or Canceled,
 * once the list it reads has been read, and whether the tree draws a row a
 * settled task may stand in at all, since a tree that draws none has no run
 * to come to its end (`onDrawn`). The tree's groups tell it as their last row
 * comes and goes (`RowForEach`'s `onAtEnd`).
 */

import {
  type SettledPages,
  settledPaging,
  tasksSettledPageAsk,
} from "@repo/features/settled-paging";
import {
  type TaskTree,
  type TaskTreeView,
  treeDrawsSettled,
  treeShowsSettledInFull,
} from "@repo/features/task-tree-model";
import { TASKS_READ } from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import { useEffect, useState } from "react";
import { useHostActs, useWholeListRead } from "../host/host-provider.js";
import { useTasksReadStatus } from "./use-tasks.js";

/** What the tab's tree stands for: the workspace it lists, the view the reader chose, and the tree it draws. */
interface TreeShown {
  readonly workspaceId: string | undefined;
  readonly treeView: TaskTreeView;
  readonly tree: TaskTree;
}

/** The pages read of the tab's workspace's settled tasks while its view shows them in full, and what the tree's groups tell the paging, which reads the next. */
export function useTreeSettledPages({ workspaceId, treeView, tree }: TreeShown): SettledPages {
  const acts = useHostActs();
  const reading = useWholeListRead();
  const status = useTasksReadStatus();
  const shown = reading && status === TASKS_READ.READY && treeShowsSettledInFull(treeView);

  const [paging] = useState(() =>
    settledPaging(tasksSettledPageAsk((page) => acts[ACT_KIND.TASKS_SETTLED_PAGE](page))),
  );

  const drawsSettled = treeDrawsSettled(tree);

  // Note that the tree tells what it draws before the paging starts, as the panel's list does before its page, so a first page that draws none reads on as it lands.
  useEffect(() => {
    paging.onDrawn(drawsSettled);
  }, [drawsSettled, tree, paging]);

  // Note that a workspace shown anew reads from its newest page, and one let go stops paging.
  useEffect(() => {
    paging.show(shown ? workspaceId : undefined);
  });

  // Note that a tab let go stops paging, so an answer landing after it reads no page more.
  useEffect(() => () => paging.show(undefined), [paging]);

  return paging;
}
