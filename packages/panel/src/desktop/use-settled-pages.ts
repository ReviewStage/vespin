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
 * service did not answer is asked again at the next end. An end heard while
 * a page is out is kept, and reads the next once it lands, since a page that
 * draws no row the view shows moves nothing that would tell the end again.
 */

import { ACT_KIND } from "@repo/host/acts";
import { useCallback, useEffect, useRef } from "react";
import { askAct } from "../act.js";

/** Where a workspace's paging stands: the cursor the next page reads past, or that it has read the last, whether a page is out now, and whether the view last stood at its end while it was. */
interface SettledPaging {
  readonly workspaceId: string;
  next: { readonly finishedAt: number; readonly taskId: string } | undefined;
  last: boolean;
  reading: boolean;
  endWhileReading: boolean;
}

/** The pages read of a workspace's settled tasks while `shown`, and what hears the page's scroller come to its end, which reads the next. */
export function useSettledPages(
  workspaceId: string | undefined,
  shown: boolean,
): (atEnd: boolean) => void {
  const paging = useRef<SettledPaging | undefined>(undefined);
  // Note that the view's end is heard before its page starts paging, as a child's effect runs before its parent's, so the latest is kept to read past the first page.
  const atEndHeard = useRef(false);

  // A page asked, its answer kept only while the page still pages the workspace that asked.
  const read = useCallback((held: SettledPaging) => {
    if (held.reading || held.last) return;
    held.reading = true;
    held.endWhileReading = false;

    const before = held.next;

    // Note that only a page the service answered reads on past an end heard meanwhile, so a service that does not answer is not asked again and again.
    void askAct(ACT_KIND.TASKS_SETTLED_PAGE, {
      workspaceId: held.workspaceId,
      ...(before === undefined ? undefined : { before }),
    })
      .then((answer) => ("failure" in answer ? false : answer))
      .catch(() => false as const)
      .then((answer) => {
        held.reading = false;

        if (answer === false) return;
        held.next = answer.next;
        held.last = answer.next === undefined;

        if (held.endWhileReading && paging.current === held) read(held);
      });
  }, []);

  // Note that a workspace shown anew reads from its newest page, and one let go stops paging.
  useEffect(() => {
    if (!shown || workspaceId === undefined) {
      paging.current = undefined;

      return;
    }

    if (paging.current?.workspaceId === workspaceId) return;
    const held: SettledPaging = {
      workspaceId,
      next: undefined,
      last: false,
      reading: false,
      endWhileReading: false,
    };

    paging.current = held;
    read(held);

    held.endWhileReading = atEndHeard.current;
  });

  // Note that the door stands across draws, so a view that asks on its own as its groups move asks only as they do.
  return useCallback(
    (atEnd: boolean) => {
      const held = paging.current;
      atEndHeard.current = atEnd;

      if (held === undefined) return;

      if (held.reading) {
        held.endWhileReading = atEnd;

        return;
      }

      if (atEnd) read(held);
    },
    [read],
  );
}
