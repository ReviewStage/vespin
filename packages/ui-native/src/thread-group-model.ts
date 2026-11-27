// thread-group-model.ts -- a thread's messages in runs, as Messages and Slack group them: one writer's messages sent close together stand under one head.

/** How long after a message the same writer's next one still joins its run: five minutes, as Slack groups a speaker's lines. */
const RUN_REACH_MS = 5 * 60 * 1000;

/** What a message is grouped by: who wrote it, when, whether it is the reader's own pending comment, and what happened to the thread after it. */
type Grouped = {
  readonly writer: {
    readonly name: string;
    readonly agent: boolean;
    readonly id?: string | undefined;
  };
  readonly at: number;
  readonly pending?: boolean | undefined;
  readonly after?: readonly unknown[] | undefined;
};

/** Whether two messages share a writer: by their ids where both are known, so two members of one name stand apart, and by their names where one isn't. */
function sameWriter(last: Grouped["writer"], next: Grouped["writer"]): boolean {
  if (last.agent !== next.agent) return false;

  if (last.id !== undefined && next.id !== undefined) return last.id === next.id;

  return last.name === next.name;
}

/** Whether `next` joins the run `last` ends: the same writer within `RUN_REACH_MS` of it, with no line of what happened, such as a resolve, standing between them, and both published or both pending, since a pending comment's head is what tags it Pending. */
function joins(last: Grouped, next: Grouped): boolean {
  if ((last.after?.length ?? 0) > 0) return false;

  if ((last.pending === true) !== (next.pending === true)) return false;

  return (
    sameWriter(last.writer, next.writer) && next.at >= last.at && next.at - last.at <= RUN_REACH_MS
  );
}

/**
 * The messages in runs, in the order given: a new run starts at another
 * writer, after a line of what happened to the thread, where a comment
 * pending in the reader's review meets a published one, or where the same
 * writer comes back more than `RUN_REACH_MS` later, so each run's head names who wrote it and when once, and the
 * messages after its first stand under it with no head of their own.
 */
export function threadRuns<Message extends Grouped>(
  messages: readonly Message[],
): readonly (readonly Message[])[] {
  const runs: Message[][] = [];

  for (const message of messages) {
    const run = runs.at(-1);
    const last = run?.at(-1);

    if (run !== undefined && last !== undefined && joins(last, message)) run.push(message);
    else runs.push([message]);
  }

  return runs;
}

/**
 * A thread's newest runs holding at least `least` messages, whole, so no
 * run's head moves when the runs before them are drawn above; every run
 * where they hold fewer. A thread opens at its newest message, so its first
 * frame draws these, and the older follow a render later.
 */
export function newestRuns<Message>(
  runs: readonly (readonly Message[])[],
  least: number,
): readonly (readonly Message[])[] {
  let held = 0;
  let from = runs.length;

  while (from > 0 && held < least) {
    from -= 1;
    held += runs[from]?.length ?? 0;
  }

  return from === 0 ? runs : runs.slice(from);
}
