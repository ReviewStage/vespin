/**
 * use-settled-pages.ts -- the Tasks page's reads of a workspace's settled tasks a page at a time, from the service into the task list, while the page shows finished work past what the list holds.
 *
 * The paging itself is the one every client's list reads by
 * (`@repo/features/settled-paging`): this hands it the window's act port and
 * tells it, each draw, the workspace the page shows settled tasks in full
 * for, its completed window at All or its Status filter naming Done or
 * Canceled, once the list it reads has been read. The page's runs of rows
 * tell it as they come to their end (`onRunEnd`) and whether they draw a
 * settled task's row at all (`onDrawn`).
 */

import {
  type SettledPages,
  settledPaging,
  tasksSettledPageAsk,
} from "@repo/features/settled-paging";
import { ACT_KIND } from "@repo/host/acts";
import { useEffect, useState } from "react";
import { askAct } from "../act.js";

/** The pages read of a workspace's settled tasks while `shown`, and what the view tells the paging, which reads the next. */
export function useSettledPages(workspaceId: string | undefined, shown: boolean): SettledPages {
  const [paging] = useState(() =>
    settledPaging(tasksSettledPageAsk((page) => askAct(ACT_KIND.TASKS_SETTLED_PAGE, page))),
  );

  // Note that a workspace shown anew reads from its newest page, and one let go stops paging.
  useEffect(() => {
    paging.show(shown ? workspaceId : undefined);
  });

  // Note that a page let go stops paging, so an answer landing after it reads no page more.
  useEffect(() => () => paging.show(undefined), [paging]);

  return paging;
}
