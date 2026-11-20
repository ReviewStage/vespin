import type { InboxAnyHolder, InboxListed } from "@repo/features/inbox-list-model";
import { LIST_INSET, List, usePageScroll } from "@repo/ui";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { type RefObject, useMemo, useState } from "react";
import { useInboxRowDrafts } from "../composer-drafts.js";
import { useFindOpen } from "../find-in-tab.js";
import { useInboxDoor } from "../places/routed-doors.js";
import { useSteadyDoor } from "../steady-door.js";
import { useInboxResolver } from "./inbox-close.js";
import { useInboxRowPresses } from "./inbox-columns.js";
import { INBOX_ROW_ESTIMATE_PX, InboxItemRow, inboxRowDraft } from "./inbox-list.js";
import { useInboxRowActs } from "./inbox-row-acts.js";
import { choiceOf, onTask } from "./use-inbox-listing.js";
import { useInboxReadMarks } from "./use-inbox-read-marks.js";
import type { TasksControl } from "./use-tasks-tab.js";

/**
 * inbox-item-rows.tsx -- Inbox items listed outside the Inbox, as Home and a person's page list what waits: the Inbox's own rows, acting as its list's do.
 *
 * Each row is the Inbox's (`InboxItemRow`), its press opening the Inbox on
 * its item, and its menu the one the Inbox's list offers, over the same
 * doors (`useInboxRowActs`): Copy link where the page hands down a workspace
 * to write it under, Mark as read or unread, Remind me, and Resolve, at
 * once with Undo. No row here is chosen, so U, H, and E, which act on the
 * chosen item, are the Inbox's alone. The rows stay masked in a screen recording
 * but for the words a row unmasks itself. They stand among task rows, so
 * they stand their words at a task row's inset (`LIST_INSET.ROW`), their
 * marks starting and their times ending where the task rows' do.
 *
 * The rows are a run of the page's scroller (`usePageScroll`), drawing only
 * those near the view as the Inbox's own list does, and every row while a
 * find bar stands open, so a page listing hundreds of items costs a pointer
 * moving over it what a page listing a few does: the browser tests every
 * row drawn after the one under the pointer on each move, however far
 * from the view it stands. A walk the rows join reaches the rows left
 * undrawn where it reads the run (`reachAcrossRuns`).
 */

/** The room between two rows, in pixels: a list's (`--ui-list-gap`), which the run places its rows by, since it stands them out of the list's flow. */
const ROW_GAP_PX = 2;

/** The listed workspace's items `listed` as the Inbox's rows, in a list named `label` that joins the page's walk or moves its rows where said. */
export function InboxItemRows({
  label,
  listed,
  tasks,
  needsYouShown = false,
  joinsWalk = false,
  moves = false,
}: {
  label: string;
  listed: readonly InboxListed[];
  tasks: TasksControl;
  /** Whether the rows stand under a name that already says Needs you. */
  needsYouShown?: boolean;
  /** Whether the rows join the walk of a `useRovingKeys` box around the list. */
  joinsWalk?: boolean;
  /** Whether the rows move as they arrive, leave, and change places. */
  moves?: boolean;
}): React.JSX.Element {
  const drafts = useInboxRowDrafts();
  const rows = useInboxRowPresses();
  const { scroller, shiftedBy } = usePageScroll();
  // Note that the run draws every row while a find bar stands open over the page, so the find covers them.
  const finding = useFindOpen();
  const keys = useMemo(() => listed.map(({ item }) => item.id), [listed]);

  // Note that the picker opens beside a row, so the rows themselves are the room it needs standing, there being no box of the list's own.
  const [room] = useState(
    (): RefObject<HTMLElement | null> => ({
      get current() {
        return rows.first() ?? null;
      },
    }),
  );

  const marks = useInboxReadMarks({ workspaceId: tasks.workspace?.id, readerId: tasks.me });
  const resolve = useInboxResolver();

  const acts = useInboxRowActs({
    doors: {
      onMark: (each, unread, saying) => marks.onMark(each.item, unread, saying),
      onResolve: resolve,
      onRemind: marks.onRemind,
    },
    room,
    rowOf: rows.find,
    chosen: undefined,
    shown: tasks.shown,
  });

  // Note that the press stands across draws, as the acts' doors do, so a row is drawn again only where its item moves.
  const inbox = useInboxDoor(tasks);

  // Note that these rows list only threads on a task (`openItems` over the tasks' groups), so one on no task opens nothing here.
  const open = useSteadyDoor((each: InboxListed<InboxAnyHolder>) => {
    const held = onTask(each);

    if (held !== undefined) inbox.openItem(choiceOf(held));
  });

  return (
    <>
      <ReplayMask>
        <List
          label={label}
          inset={LIST_INSET.ROW}
          joinsWalk={joinsWalk}
          moves={moves}
          run={{
            scroller,
            shiftedBy,
            keys,
            estimate: INBOX_ROW_ESTIMATE_PX,
            gap: ROW_GAP_PX,
            overscan: finding ? keys.length : undefined,
            row: (index, place) => {
              const each = listed[index];

              return each === undefined ? null : (
                <InboxItemRow
                  key={each.item.id}
                  ref={rows.hold(each.item.id)}
                  place={place}
                  listed={each}
                  chosen={false}
                  {...inboxRowDraft(drafts.get(each.item.id), each.item, false)}
                  models={tasks.agents.models}
                  readerId={tasks.me}
                  needsYouShown={needsYouShown}
                  onChoose={open}
                  {...acts.row}
                />
              );
            },
          }}
        />
      </ReplayMask>
      {acts.layers}
    </>
  );
}
