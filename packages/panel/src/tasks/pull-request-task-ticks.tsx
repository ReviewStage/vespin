/**
 * pull-request-task-ticks.tsx -- the task items of a pull request's words (`- [ ]`) ticked from its tab, as GitHub's own checkbox ticks them: each box writes its item's mark into the words on GitHub, on the member's own sign-in.
 *
 * A comment, a review, a review comment, or the description drawn in a tab
 * that may change its pull request draws its task items' boxes as boxes the
 * member can tick, each named by its place among the words' boxes, which is
 * the order GitHub rendered them in; ticking one asks the service to tick
 * that item in the words GitHub holds (`PULL_REQUEST_ACTION.TICK_TASK`),
 * which is how a bot that offers a box to tick (a review bot's "Trigger
 * review") hears it ticked. The box stands as pressed while the write is
 * out and until the words are read again, then as the words have it, and
 * where GitHub refused, its words stand under the words they were on. The
 * write names how many boxes the reader saw, which the service holds the
 * words to, so a tick on words changed since never lands on another item.
 * Outside a tab, where the read named no id for what they are on, or where
 * GitHub says the member may not edit the words, the boxes stand read-only,
 * as GitHub grays them out.
 */

import { PULL_REQUEST_ACTION } from "@repo/features/pull-request-write-wire";
import { type MarkdownTaskTick, TaskBox, type TaskBoxOrdinal } from "@repo/ui/markdown";
import { type ReactNode, useCallback, useState } from "react";
import { noop, useThreadWriting } from "./pull-request-thread-actions.js";
import {
  PullRequestWriteNote,
  type PullRequestWrites,
  usePullRequestWrites,
} from "./pull-request-writes.js";

/** One task item's box the member can tick, standing as pressed while its write and the read after it are out, then as the words read again have it. */
function TickedTaskBox({
  item,
  subject,
  write,
}: {
  item: TaskBoxOrdinal;
  subject: string;
  write: PullRequestWrites["write"];
}): React.JSX.Element {
  const [asked, setAsked] = useState<boolean | undefined>(undefined);

  const run = (ticked: boolean) => {
    setAsked(ticked);
    void write({
      action: PULL_REQUEST_ACTION.TICK_TASK,
      subject,
      index: item.index,
      count: item.count,
      checked: ticked,
    }).then(() => {
      // Note that the write settles once the words are read again, so the box then stands as GitHub has it, as where a bot clears its own box at once.
      setAsked(undefined);
    });
  };

  return <TaskBox label={item.label} checked={item.checked} write={{ run, asked }} />;
}

/** How words draw their task items' boxes (`taskTick`, none where they stand read-only), and what the last tick left to say under them (`note`). */
export interface TaskTicks {
  readonly taskTick: MarkdownTaskTick | undefined;
  readonly note: ReactNode;
}

/**
 * How the words on what `subject` names draw their task items' boxes, and
 * what the last tick left to say under them; boxes the member cannot tick
 * outside a tab, without a subject, or where GitHub says they may not edit
 * the words (`editable` false), as GitHub grays a box out for them. Where
 * that is not known the boxes stand tickable, and GitHub's refusal, if
 * any, says why under the words.
 */
export function useTaskTicks(
  subject: string | undefined,
  editable: boolean | undefined,
): TaskTicks {
  const writing = useThreadWriting();
  const writes = usePullRequestWrites(writing?.agentId ?? "", writing?.onWritten ?? noop);
  const { write } = writes;

  const draw = useCallback<MarkdownTaskTick>(
    (item) =>
      subject === undefined ? null : <TickedTaskBox item={item} subject={subject} write={write} />,
    [subject, write],
  );

  const tickable = writing !== undefined && subject !== undefined && editable !== false;

  return {
    taskTick: tickable ? draw : undefined,
    note: <PullRequestWriteNote writes={writes} className="pull-request-task-note" />,
  };
}
