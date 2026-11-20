/**
 * manager-overview.tsx -- a Manager's page's main panel: what the Manager is doing, beside its chat.
 *
 * A Manager's page (`desktop-agent-page.tsx`) stands its chat in a column at
 * its right and this panel in the room it leaves, under the page's head,
 * which names the Manager, so the panel draws no title of its own: it is a
 * page under the window's toolbar (`PAGE_FRAME.TOOLBAR`), named for a
 * reader by its label, its content across the whole room it has. It is
 * dense, every row one line, so a Manager's whole state stands on one
 * screen beside the open sidebar.
 *
 * It opens on one line of counts: what waits on the reader, its agents at
 * work, its pull requests open, and its tasks done this week, each read
 * from what the window already follows live (`manager-overview-model.ts`).
 * Under it stands Waiting on you, the Manager's own threads that wait on
 * the reader, each the row the line over its box lists (`NeedsYouRow`): an
 * ask of two short options answered from its buttons, any other opening its
 * thread in the window's Inbox; nothing while none waits. A list longer than
 * its cap shows its first rows and the rest on a press (`ShowMoreRow`).
 */

import type { ListedAgent } from "@repo/features/agent-wire";
import { managerOverview } from "@repo/features/manager-overview-model";
import { TERM } from "@repo/features/words";
import {
  CountLine,
  DetailPage,
  GAP,
  LIST_INSET,
  List,
  PAGE_FRAME,
  PAGE_WIDTH,
  ShowMoreRow,
  STATUS_TONE,
  Stack,
  useMinute,
} from "@repo/ui";
import { ReplayMask, ReplayUnmask } from "@repo/ui/session-replay-marks";
import { useMemo, useState } from "react";
import { MemberDirectory } from "../member-directory.js";
import { NAMED_ORDER, useNamedTasks } from "../task-list-collections.js";
import { type AgentThreads, NeedsYouRow } from "../tasks/threads-dock.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { PersonSectionFrame } from "./person-frame.js";

/** What the panel is called, said to a reader as its region's name. */
const OVERVIEW = "Overview";

/** What the panel's sections and counts say. */
const OVERVIEW_WORDS = {
  COUNTS: "At a glance",
  WAITING: "Waiting on you",
  WAITING_COUNT: "waiting on you",
  WORKING: "agents working",
  PULL_REQUESTS_OPEN: "pull requests open",
  DONE_THIS_WEEK: "done this week",
} as const;

/** The most threads Waiting on you lists before its foot shows the rest. */
const WAITING_ROWS = 3;

/** A list's rows standing under its cap, and the foot that lifts it. */
interface Capped<Row> {
  readonly shown: readonly Row[];
  readonly foot: React.JSX.Element | null;
}

/** The first `cap` of `rows`, or every one once its foot was pressed, and the foot that shows or puts back the rest. */
function useCapped<Row>(rows: readonly Row[], cap: number): Capped<Row> {
  const [lifted, setLifted] = useState(false);

  return {
    shown: lifted ? rows : rows.slice(0, cap),
    foot: (
      <ShowMoreRow
        more={rows.length - cap}
        shown={lifted}
        onToggle={() => setLifted((was) => !was)}
      />
    ),
  };
}

/** Waiting on you: the Manager's threads that wait on the reader, each answered or opened from its row; nothing while none waits. */
function WaitingOnYou({ threads }: { threads: AgentThreads }): React.JSX.Element | null {
  const { shown, foot } = useCapped(threads.waiting, WAITING_ROWS);

  if (threads.waiting.length === 0) return null;

  return (
    <PersonSectionFrame
      label={OVERVIEW_WORDS.WAITING}
      title={OVERVIEW_WORDS.WAITING}
      count={threads.waiting.length}
      noun={TERM.INBOX_ITEM}
      tone={STATUS_TONE.ATTENTION}
    >
      <ReplayMask>
        <List label={OVERVIEW_WORDS.WAITING} inset={LIST_INSET.ROW}>
          {shown.map((item) => (
            <NeedsYouRow key={item.id} item={item} threads={threads} />
          ))}
          {foot}
        </List>
      </ReplayMask>
    </PersonSectionFrame>
  );
}

/** A Manager's overview, under the page's head and beside its chat. */
export function ManagerOverview({
  tasks,
  manager,
  threads,
}: {
  tasks: TasksControl;
  manager: ListedAgent;
  /** The threads the Manager posted, as the line over its box reads them; none while it posted none. */
  threads: AgentThreads | undefined;
}): React.JSX.Element {
  const now = useMinute();
  const listed = useNamedTasks(tasks.typedNames, NAMED_ORDER.PINNED_FIRST, tasks.workspace?.id);
  const { liveAgents, listedPullRequests } = tasks;

  const overview = useMemo(
    () =>
      managerOverview({
        managerId: manager.id,
        tasks: listed,
        agents: liveAgents,
        pullRequests: listedPullRequests,
        now,
      }),
    [manager.id, listed, liveAgents, listedPullRequests, now],
  );

  const waiting = threads?.waiting.length ?? 0;

  return (
    <MemberDirectory workspace={tasks.workspace} readerId={tasks.me}>
      <DetailPage frame={PAGE_FRAME.TOOLBAR} label={OVERVIEW} width={PAGE_WIDTH.FULL}>
        {/* Note that the counts and the sections' heads show in a screen recording, while each section masks its rows. */}
        <ReplayUnmask>
          <Stack gap={GAP.SECTION}>
            <CountLine
              label={OVERVIEW_WORDS.COUNTS}
              counts={[
                {
                  value: waiting,
                  words: OVERVIEW_WORDS.WAITING_COUNT,
                  tone: STATUS_TONE.ATTENTION,
                },
                { value: overview.working, words: OVERVIEW_WORDS.WORKING },
                { value: overview.openPullRequests, words: OVERVIEW_WORDS.PULL_REQUESTS_OPEN },
                { value: overview.doneThisWeek.length, words: OVERVIEW_WORDS.DONE_THIS_WEEK },
              ]}
            />
            {threads === undefined ? null : <WaitingOnYou threads={threads} />}
          </Stack>
        </ReplayUnmask>
      </DetailPage>
    </MemberDirectory>
  );
}
