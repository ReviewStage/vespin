/**
 * use-settled-pages.ts -- the Tasks page's reads of a workspace's settled tasks a page at a time, from the service into the task list, while the page shows finished work past what the list holds.
 *
 * The task list a window holds keeps the work under way and what was
 * touched lately; Done and Canceled tasks older than that stand only on the
 * service. While the page shows settled tasks in full, its completed window
 * at All or its Status filter naming Done or Canceled, it asks the host for
 * the newest page of them (`TASKS_SETTLED_PAGE`), which reads them into the
 * list beside its own as cold tasks (`task-list-collections.ts`), and asks
 * for the page after it each time its scroller comes to its end, until a
 * page answers none after it. A page a task the list holds already draws as
 * the list holds it, so nothing moves while the list holds every task.
 *
 * What was read stands in the list for the session, so the page reads a
 * workspace's first page again only as it comes back to it, and a page the
 * service did not answer is asked again at the next end.
 */

import { ACT_KIND } from "@repo/host/acts";
import { useEffect, useRef } from "react";
import { askAct } from "../act.js";

/** Where a workspace's paging stands: the cursor the next page reads past, or that it has read the last, and whether a page is out now. */
interface SettledPaging {
  readonly workspaceId: string;
  next: { readonly finishedAt: number; readonly taskId: string } | undefined;
  last: boolean;
  reading: boolean;
}

/** The pages read of a workspace's settled tasks while `shown`, and what hears the page's scroller come to its end, which reads the next. */
export function useSettledPages(
  workspaceId: string | undefined,
  shown: boolean,
): (atEnd: boolean) => void {
  const paging = useRef<SettledPaging | undefined>(undefined);

  // A page asked, its answer kept only while the page still pages the workspace that asked.
  const read = (held: SettledPaging) => {
    if (held.reading || held.last) return;
    held.reading = true;

    const before = held.next;

    void askAct(ACT_KIND.TASKS_SETTLED_PAGE, {
      workspaceId: held.workspaceId,
      ...(before === undefined ? undefined : { before }),
    })
      .then((answer) => {
        if ("failure" in answer) return;
        held.next = answer.next;
        held.last = answer.next === undefined;
      })
      .catch(() => undefined)
      .finally(() => {
        held.reading = false;
      });
  };

  // Note that a workspace shown anew reads from its newest page, and one let go stops paging.
  useEffect(() => {
    if (!shown || workspaceId === undefined) {
      paging.current = undefined;

      return;
    }

    if (paging.current?.workspaceId === workspaceId) return;
    const held: SettledPaging = { workspaceId, next: undefined, last: false, reading: false };
    paging.current = held;
    read(held);
  });

  return (atEnd) => {
    const held = paging.current;

    if (!atEnd || held === undefined) return;
    read(held);
  };
}
