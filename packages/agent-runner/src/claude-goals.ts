/**
 * claude-goals.ts -- Claude Code's `/goal` settling, read off the transcript the SDK mirrors to the service's store, for the launch to post as a GOAL event ahead of the `result` it settled in.
 *
 * The CLI says a goal's verdicts as it goes, on its stream, as a `Stop hook
 * feedback` line each time the checker finds the goal not met; but where the
 * goal is met, or judged impossible, it says so only in its transcript, as a
 * `goal_status` attachment. The SDK mirrors the transcript to the store in
 * batches and flushes the batch before it hands on a `result`, so the store's
 * appends see the settling before the launch sees the `result`, and the
 * launch posts what was held then (`runner.ts`). Only the main transcript is
 * read: a subagent's carries no goal of the session's.
 */

import { readFile, stat } from "node:fs/promises";
import type {
  HookCallback,
  HookCallbackMatcher,
  HookEvent,
  SessionStore,
  SessionStoreEntry,
} from "@anthropic-ai/claude-agent-sdk";
import { GOAL_EVENT } from "@repo/wire/ui-messages";
import { MutableRef, Option, Schema } from "effect";
import { RUNNER_EVENT, type RunnerGoal } from "./protocol.js";

/** The transcript entry the CLI writes where a goal moved, as its attachment spells it. */
const GOAL_STATUS = "goal_status";

/** The byte a transcript file ends each of its lines with. */
const NEWLINE = 0x0a;

const GoalStatusEntrySchema = Schema.Struct({
  type: Schema.Literal("attachment"),
  attachment: Schema.Struct({
    type: Schema.Literal(GOAL_STATUS),
    condition: Schema.String,
    met: Schema.optionalKey(Schema.Boolean),
    failed: Schema.optionalKey(Schema.Boolean),
    /** The entry the CLI writes as a goal is set, which settles nothing. */
    sentinel: Schema.optionalKey(Schema.Boolean),
    reason: Schema.optionalKey(Schema.String),
    iterations: Schema.optionalKey(Schema.Number),
    tokens: Schema.optionalKey(Schema.Number),
  }),
});

const readGoalStatus = Schema.decodeUnknownOption(GoalStatusEntrySchema);

/** A line of the CLI's own transcript file, where it holds a goal's status. */
const readGoalStatusLine = Schema.decodeUnknownOption(Schema.fromJsonString(GoalStatusEntrySchema));

/** The GOAL event a transcript entry settles, met or judged impossible; none for any other entry, a verdict that it is not met yet among them. */
export function settledGoal(entry: SessionStoreEntry): RunnerGoal | undefined {
  return goalSettledBy(readGoalStatus(entry));
}

/** The GOAL event a goal status the transcript holds settles; none where it holds none, or one that settles nothing. */
function goalSettledBy(
  read: Option.Option<typeof GoalStatusEntrySchema.Type>,
): RunnerGoal | undefined {
  if (Option.isNone(read)) return undefined;
  const status = read.value.attachment;

  if (status.sentinel === true) return undefined;

  const event =
    status.met === true
      ? GOAL_EVENT.MET
      : status.failed === true
        ? GOAL_EVENT.IMPOSSIBLE
        : undefined;

  if (event === undefined) return undefined;

  return {
    type: RUNNER_EVENT.GOAL,
    event,
    condition: status.condition,
    reason: status.reason ?? null,
    turns: status.iterations ?? null,
    tokens: status.tokens ?? null,
    tokenBudget: null,
  };
}

/** The store, its appends to the main transcript also holding every goal they settle in `held`, for the launch to post at the next `result`. */
export function goalWatchedStore<Store extends Pick<SessionStore, "append">>(
  store: Store,
  held: MutableRef.MutableRef<readonly RunnerGoal[]>,
): Store {
  return {
    ...store,
    // Note that the goals are held once the append went through, because the SDK retries a batch the store refused, which would hold them again.
    append: async (key, entries) => {
      await store.append(key, entries);

      if (key.subpath !== undefined) return;
      const settled = entries.flatMap((entry) => settledGoal(entry) ?? []);

      if (settled.length > 0) MutableRef.update(held, (was) => [...was, ...settled]);
    },
  };
}

/** A watch on the CLI's own transcript file, where a launch keeps no store for the SDK to mirror it to (`goalWatchedFile`). */
export interface GoalWatchedFile {
  readonly hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
  /** Holds every goal the lines written since the last read settle, for the launch to post at the `result` it reads them at. */
  readonly settle: () => Promise<void>;
}

/**
 * The CLI's own transcript file, watched for the goals it settles where the
 * launch keeps no store (a Mac resuming a session from its disk, or one whose
 * release keeps no transcripts): the session's start names the file, which is
 * read from its end then, so a goal an earlier launch settled is never said
 * again, and each `result` holds the goals the lines written since settle in
 * `held`. Note that a line not yet ended is left for the next read.
 */
export function goalWatchedFile(
  held: MutableRef.MutableRef<readonly RunnerGoal[]>,
): GoalWatchedFile {
  let path: string | undefined;
  let read = 0;

  const onSessionStart: HookCallback = async (hook) => {
    if (hook.hook_event_name === "SessionStart" && path === undefined) {
      path = hook.transcript_path;
      read = await stat(path).then(
        (found) => found.size,
        () => 0,
      );
    }

    return { continue: true };
  };

  const settle = async () => {
    if (path === undefined) return;
    const written = await readFile(path).catch(() => undefined);

    if (written === undefined || written.length <= read) return;
    const fresh = written.subarray(read);
    const ended = fresh.lastIndexOf(NEWLINE);

    if (ended < 0) return;
    read += ended + 1;
    const lines = fresh.subarray(0, ended).toString("utf8").split("\n");
    const settled = lines.flatMap((line) => goalSettledBy(readGoalStatusLine(line)) ?? []);

    if (settled.length > 0) MutableRef.update(held, (was) => [...was, ...settled]);
  };

  return { hooks: { SessionStart: [{ hooks: [onSessionStart] }] }, settle };
}
