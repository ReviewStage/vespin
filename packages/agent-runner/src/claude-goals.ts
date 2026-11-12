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

import type { SessionStore } from "@anthropic-ai/claude-agent-sdk";
import { GOAL_EVENT } from "@repo/wire/ui-messages";
import { MutableRef, Option, Schema } from "effect";
import { RUNNER_EVENT, type RunnerGoal } from "./protocol.js";

/** The transcript entry the CLI writes where a goal moved, as its attachment spells it. */
const GOAL_STATUS = "goal_status";

const readGoalStatus = Schema.decodeUnknownOption(
  Schema.Struct({
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
  }),
);

/** The GOAL event a transcript entry settles, met or judged impossible; none for any other entry, a verdict that it is not met yet among them. */
export function settledGoal(entry: unknown): RunnerGoal | undefined {
  const read = readGoalStatus(entry);

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
