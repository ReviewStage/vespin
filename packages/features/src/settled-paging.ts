/**
 * settled-paging.ts -- where a list's reads of its settled rows a page at a time stand, from the service into what the host holds, while the list shows finished work past what it holds: the one paging every client's Tasks list reads a workspace's settled tasks by.
 *
 * The task list a client holds keeps the work under way and what was
 * touched lately; Done and Canceled tasks older than that stand only on the
 * service. While the list shows settled tasks in full, and the list it reads
 * has been read, it asks the host for the newest page of them
 * (`TASKS_SETTLED_PAGE`), which reads them into the list beside its own as
 * cold tasks, and asks for the page after it each time a run of its rows
 * comes to its end, until a page answers none after it. A page a task the
 * list holds already draws as the list holds it, so nothing moves while the
 * list holds every task.
 *
 * Two things say the view wants the next page, each told apart, so neither
 * clears the other: a run of rows a settled task may stand in at its end
 * (`onRunEnd`), and a view that draws no such row at all, as a filter none of
 * the pages read so far matches, which has no run to come to its end
 * (`onDrawn`). Either, heard while a page is out, reads the next once it
 * lands, since a page that draws no row the view shows moves nothing that
 * would tell it again.
 *
 * What was read stands in the list for the session, so the paging reads a
 * workspace's first page again only as the list comes back to it. A page the
 * service did not answer reads on from nothing it heard meanwhile, so a
 * service that does not answer is asked again only at the next end. A page's
 * cursor is the read's own, which the paging only hands back. It holds
 * no React: each client's hook (the panel's and the iOS app's
 * `use-settled-pages.ts`) tells it what its list shows and hands it the host's
 * act to ask by.
 */

import type { tasksSettledPageAnswerSchema, tasksSettledPageParamsSchema } from "./tasks-view.js";

/** A page's answer: the cursor the next reads past, none after the last, or a failure, such as that the service did not answer, which reads on from nothing. */
export type SettledPageAnswer<Cursor> =
  | { readonly next?: Cursor | undefined }
  | { readonly failure: string };

/** Asks the host for a page of the settled under `scope`, such as a workspace's tasks: the newest where `before` is none, else the one past it. */
export type SettledPageAsk<Cursor> = (
  scope: string,
  before: Cursor | undefined,
) => Promise<SettledPageAnswer<Cursor>>;

/** Where a scope's paging stands: the cursor the next page reads past, or that it has read the last, whether a page is out now, and whether a run stood at its end while it was. */
interface ScopePaging<Cursor> {
  readonly scope: string;
  next: Cursor | undefined;
  last: boolean;
  reading: boolean;
  endWhileReading: boolean;
}

/** What the view tells the paging: a run of rows a settled task may stand in at its end or not, and whether it draws any such row. */
export interface SettledPages {
  readonly onRunEnd: (atEnd: boolean) => void;
  readonly onDrawn: (drawsSettled: boolean) => void;
}

/** A list's paging: the doors its view tells, and `show`, told the scope the list shows its settled in full for, such as its workspace, or none while it does not. */
export interface SettledPaging extends SettledPages {
  readonly show: (scope: string | undefined) => void;
}

/** A list's paging of its settled rows, each page asked through `ask`, a failure or a throw read as a page the service did not answer. */
export function settledPaging<Cursor>(ask: SettledPageAsk<Cursor>): SettledPaging {
  let paging: ScopePaging<Cursor> | undefined;
  // Note that the view tells what it draws before its list starts paging, as a child's effect runs before its parent's, so it is kept apart from any one scope's paging.
  let drawsNone = false;

  // A page asked, its answer kept only while the list still pages the scope that asked.
  const read = (held: ScopePaging<Cursor>): void => {
    if (held.reading || held.last) return;
    held.reading = true;
    held.endWhileReading = false;

    const before = held.next;

    void ask(held.scope, before)
      .then((answer) => ("failure" in answer ? false : answer))
      .catch(() => false as const)
      .then((answer) => {
        held.reading = false;

        if (answer === false) return;
        held.next = answer.next;
        held.last = answer.next === undefined;
        const wants = held.endWhileReading || drawsNone;

        if (wants && paging === held) read(held);
      });
  };

  // Note that a scope shown anew reads from its newest page, and one let go stops paging, so an answer landing after it reads no page more.
  const show = (scope: string | undefined): void => {
    if (scope === undefined) {
      paging = undefined;

      return;
    }

    if (paging?.scope === scope) return;

    const held: ScopePaging<Cursor> = {
      scope,
      next: undefined,
      last: false,
      reading: false,
      endWhileReading: false,
    };

    paging = held;
    read(held);
  };

  const onRunEnd = (atEnd: boolean): void => {
    const held = paging;

    if (held === undefined) return;

    if (held.reading) {
      held.endWhileReading = atEnd;

      return;
    }

    if (atEnd) read(held);
  };

  const onDrawn = (drawsSettled: boolean): void => {
    drawsNone = !drawsSettled;
    const held = paging;

    if (drawsSettled || held === undefined) return;
    read(held);
  };

  return { show, onRunEnd, onDrawn };
}

/** A page of a workspace's settled tasks asked of the host (`TASKS_SETTLED_PAGE`). */
type TasksSettledPage = typeof tasksSettledPageParamsSchema.Type;

/** The paging's ask of a workspace's settled tasks, through `act`, the host's `TASKS_SETTLED_PAGE` as the client calls it. */
export function tasksSettledPageAsk(
  act: (page: TasksSettledPage) => Promise<typeof tasksSettledPageAnswerSchema.Type>,
): SettledPageAsk<TasksSettledPage["before"]> {
  return (workspaceId, before) =>
    act({ workspaceId, ...(before === undefined ? undefined : { before }) });
}
