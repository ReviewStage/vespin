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
 * out and until the words are read again, and as the words have it where
 * GitHub refused, whose words stand under the words they were on.
 * Outside a tab, or where the read named no id for what they are on, the
 * boxes stand read-only.
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

/** One task item's box the member can tick, standing as pressed while its write is out and once GitHub took it. */
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
      checked: ticked,
    }).then((outcome) => {
      if (!outcome.done) setAsked(undefined);
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
 * outside a tab or without a subject.
 */
export function useTaskTicks(subject: string | undefined): TaskTicks {
  const writing = useThreadWriting();
  const writes = usePullRequestWrites(writing?.agentId ?? "", writing?.onWritten ?? noop);
  const { write } = writes;

  const draw = useCallback<MarkdownTaskTick>(
    (item) =>
      subject === undefined ? null : <TickedTaskBox item={item} subject={subject} write={write} />,
    [subject, write],
  );

  const tickable = writing !== undefined && subject !== undefined;

  return {
    taskTick: tickable ? draw : undefined,
    note: <PullRequestWriteNote writes={writes} className="pull-request-task-note" />,
  };
}
