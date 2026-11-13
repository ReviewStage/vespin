/**
 * use-settled-pages.ts -- the Tasks page's reads of a workspace's settled tasks a page at a time, from the service into the task list, while the page shows finished work past what the list holds.
 *
 * The task list a window holds keeps the work under way and what was
 * touched lately; Done and Canceled tasks older than that stand only on the
 * service. While the page shows settled tasks in full, its completed window
 * at All or its Status filter naming Done or Canceled, and the list it reads
 * has been read, it asks the host for the newest page of them
 * (`TASKS_SETTLED_PAGE`), which reads them into the list beside its own as
 * cold tasks (`task-list-collections.ts`), and asks for the page after it
 * each time a run of its rows comes to its end, until a page answers none
 * after it. A page a task the list holds already draws as the list holds it,
 * so nothing moves while the list holds every task.
 *
 * Two things say the view wants the next page, each told apart, so neither
 * clears the other: a run of rows a settled task may stand in at its end
 * (`onRunEnd`), and a view that draws no such row at all, as a filter none of
 * the pages read so far matches, which has no run to come to its end
 * (`onDrawn`). Either, heard while a page is out, reads the next once it
 * lands, since a page that draws no row the view shows moves nothing that
 * would tell it again.
 *
 * What was read stands in the list for the session, so the page reads a
 * workspace's first page again only as it comes back to it. A page the
 * service did not answer reads on from nothing it heard meanwhile, so a
 * service that does not answer is asked again only at the next end.
 */

import { ACT_KIND } from "@repo/host/acts";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { askAct } from "../act.js";

/** Where a workspace's paging stands: the cursor the next page reads past, or that it has read the last, whether a page is out now, and whether a run stood at its end while it was. */
interface SettledPaging {
  readonly workspaceId: string;
  next: { readonly finishedAt: number; readonly taskId: string } | undefined;
  last: boolean;
  reading: boolean;
  endWhileReading: boolean;
}

/** What the view tells the paging: a run of rows a settled task may stand in at its end or not, and whether it draws any such row. */
export interface SettledPages {
  readonly onRunEnd: (atEnd: boolean) => void;
  readonly onDrawn: (drawsSettled: boolean) => void;
}

/** The pages read of a workspace's settled tasks while `shown`, and what the view tells the paging, which reads the next. */
export function useSettledPages(workspaceId: string | undefined, shown: boolean): SettledPages {
  const paging = useRef<SettledPaging | undefined>(undefined);
  // Note that the view tells what it draws before its page starts paging, as a child's effect runs before its parent's, so it is kept apart from any one page.
  const drawsNone = useRef(false);

  // A page asked, its answer kept only while the page still pages the workspace that asked.
  const read = useCallback((held: SettledPaging) => {
    if (held.reading || held.last) return;
    held.reading = true;
    held.endWhileReading = false;

    const before = held.next;

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
        const wants = held.endWhileReading || drawsNone.current;

        if (wants && paging.current === held) read(held);
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
  });

  // Note that both doors stand across draws, so a view that tells what it draws as its groups move tells it only as they do.
  const onRunEnd = useCallback(
    (atEnd: boolean) => {
      const held = paging.current;

      if (held === undefined) return;

      if (held.reading) {
        held.endWhileReading = atEnd;

        return;
      }

      if (atEnd) read(held);
    },
    [read],
  );

  const onDrawn = useCallback(
    (drawsSettled: boolean) => {
      drawsNone.current = !drawsSettled;
      const held = paging.current;

      if (drawsSettled || held === undefined) return;
      read(held);
    },
    [read],
  );

  return useMemo(() => ({ onRunEnd, onDrawn }), [onRunEnd, onDrawn]);
}
