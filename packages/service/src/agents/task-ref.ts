/**
 * task-ref.ts -- the task a tool's input names by its id or its key, found in the caller's workspace, a key of another workspace's prefix refused.
 *
 * A tool names a task by the id `list_tasks` answered or by its key, such as
 * `ACME-42` (`cliTaskRefOf`). A key's number names a task of one workspace
 * alone, so a key is read in the caller's workspace only where its prefix is
 * that workspace's (`taskKeyPrefix`, read off its name as every key is):
 * `ACME-42` read in a workspace keyed STAG would otherwise answer STAG-42,
 * a task the caller never named. The prefix is held to whatever its case; a
 * bare number has none to hold. An id is answered as written, so a caller
 * still checks that the task it reads stands in its workspace.
 */

import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import { taskIdOfNumber } from "@repo/database/models/task-number-store";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import { cliTaskRefOf, taskRefSchema } from "@repo/features/cli-task-ref";
import { taskKeyPrefix } from "@repo/features/workspace-key";
import { Effect, Match, Option, Result } from "effect";
import { workspaceNamingOf } from "./written-mentions.js";

/** A task a tool's input names, by its id or its key, read by `taskIdOfRef`. */
export const TASK_REF_INPUT = taskRefSchema;

/** How a tool's input words a task it names, after "by". */
export const TASK_REF_WORDS = `the id ${AGENT_TOOL.LIST_TASKS} answered or its key, such as ACME-42`;

/** Why a task's id or key names no task of the caller's workspace. */
export const TASK_REF_MISS = {
  /** Neither an id, a number, nor a key. */
  UNREADABLE: "unreadable",
  /** A key whose prefix is not the workspace's. */
  OTHER_PREFIX: "other-prefix",
  /** A number or key no task of the workspace holds. */
  NO_TASK: "no-task",
} as const;

/** Why a ref found no task: with a key of another prefix, the prefix the workspace's keys open with and the key as the caller meant it there. */
export type TaskRefMiss =
  | { readonly kind: typeof TASK_REF_MISS.UNREADABLE | typeof TASK_REF_MISS.NO_TASK }
  | {
      readonly kind: typeof TASK_REF_MISS.OTHER_PREFIX;
      readonly prefix: string;
      readonly key: string;
    };

/** The task an id or key names in the workspace, or why it names none there. */
export function taskIdOfRef(
  userId: string,
  workspaceId: string,
  written: string,
): Effect.Effect<Result.Result<string, TaskRefMiss>, StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const ref = cliTaskRefOf(written);

    if (ref === undefined) return Result.fail({ kind: TASK_REF_MISS.UNREADABLE });

    if ("id" in ref) return Result.succeed(ref.id);

    const { name } = yield* workspaceNamingOf(userId, workspaceId);
    const prefix = taskKeyPrefix(name);

    // Note that a key of another prefix is refused rather than read by its number, which names another task here.
    if (ref.prefix !== undefined && ref.prefix.toLocaleUpperCase() !== prefix) {
      return Result.fail({
        kind: TASK_REF_MISS.OTHER_PREFIX,
        prefix,
        key: `${prefix}-${ref.number}`,
      });
    }

    const taskId = yield* taskIdOfNumber(userId, workspaceId, ref.number);

    return Option.match(taskId, {
      onNone: () => Result.fail({ kind: TASK_REF_MISS.NO_TASK }),
      onSome: (id) => Result.succeed(id),
    });
  });
}

/**
 * Why a task a tool's input names is none of the caller's workspace, in the
 * tool's own opening (such as "Not run") and naming the input it read, so one
 * retry fixes the call.
 */
export function taskRefRefusal(opening: string, field: string, miss: TaskRefMiss): string {
  return Match.value(miss).pipe(
    Match.discriminatorsExhaustive("kind")({
      [TASK_REF_MISS.UNREADABLE]: () =>
        `${opening}: name the task in ${field} by ${TASK_REF_WORDS}.`,
      [TASK_REF_MISS.NO_TASK]: () =>
        `${opening}: no task of your workspace has the id or key ${field} names; ` +
        `${AGENT_TOOL.LIST_TASKS} names them.`,
      [TASK_REF_MISS.OTHER_PREFIX]: ({ prefix, key }) =>
        `${opening}: the key in ${field} names no task of your workspace, whose keys open with ` +
        `${prefix}-; name it by a key such as ${key}, or by the id ${AGENT_TOOL.LIST_TASKS} answered.`,
    }),
  );
}

/** The task a tool's input names in one of its fields, by id or key, as its id; or the refusal, in the tool's opening. */
export function taskIdOfInput(
  userId: string,
  workspaceId: string,
  named: { readonly opening: string; readonly field: string },
  written: string,
): Effect.Effect<Result.Result<string, string>, StoreFailure, DatabaseServices> {
  return Effect.map(
    taskIdOfRef(userId, workspaceId, written),
    Result.mapError((miss) => taskRefRefusal(named.opening, named.field, miss)),
  );
}

/** The tasks a tool's input names in one of its fields, by id or key, as ids in their order; or the first one's refusal, in the tool's opening. */
export function taskIdsOfInput(
  userId: string,
  workspaceId: string,
  named: { readonly opening: string; readonly field: string },
  written: readonly string[],
): Effect.Effect<Result.Result<string[], string>, StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const ids: string[] = [];

    for (const one of written) {
      const id = yield* taskIdOfInput(userId, workspaceId, named, one);

      if (Result.isFailure(id)) return Result.fail(id.failure);
      ids.push(id.success);
    }

    return Result.succeed(ids);
  });
}
