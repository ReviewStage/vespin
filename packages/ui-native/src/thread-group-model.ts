// thread-group-model.ts -- a thread's messages in runs, as Messages and Slack group them: one writer's messages sent close together stand under one head.

/** How long after a message the same writer's next one still joins its run: five minutes, as Slack groups a speaker's lines. */
const RUN_REACH_MS = 5 * 60 * 1000;

/** What a message is grouped by: who wrote it, and when. */
type Grouped = {
  readonly writer: { readonly name: string; readonly agent: boolean };
  readonly at: number;
};

/** Whether `next` joins the run `last` ends: the same writer, the agent or the same member, within `RUN_REACH_MS` of it. */
function joins(last: Grouped, next: Grouped): boolean {
  const sameWriter =
    last.writer.agent === next.writer.agent && last.writer.name === next.writer.name;

  return sameWriter && next.at >= last.at && next.at - last.at <= RUN_REACH_MS;
}

/**
 * The messages in runs, in the order given: a new run starts at another
 * writer, or where the same writer comes back more than `RUN_REACH_MS`
 * later, so each run's head names who wrote it and when once, and the
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
