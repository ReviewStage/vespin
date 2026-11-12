/**
 * task-find-relation-tools.ts -- `find_task` and `change_task_relation`: a task found by its number or its key, and one relation of a task moved to another kind, for the member an outside agent acts for.
 *
 * A find reads the number off a key as the command-line tool does
 * (`cliTaskRefOf`), the prefix never checked, since it follows the
 * workspace's name, and finds the task holding that number in the caller's
 * workspace as a link's step does (`taskIdOfNumber`, `plans.find`); the task
 * is then answered as `read_task` reads it. A relation's move is the one the
 * task head's menu and `plans.relation` make (`moveTaskRelation`), in one
 * transaction, answered as `update_task` answers a change of the task's
 * parent and blocks.
 */

import { taskIdOfNumber } from "@repo/database/models/task-number-store";
import { readTask } from "@repo/database/models/task-store";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import { cliTaskRefOf } from "@repo/features/cli-task-ref";
import { MEMBER_MCP_TOOL } from "@repo/features/member-mcp-tool";
import { TASK_RELATION_KIND, taskRelationChangeRequestSchema } from "@repo/features/task-wire";
import { describeWire } from "@repo/wire/effect";
import { Effect, Option, Result, Schema } from "effect";
import { type UnparsedWireValue, type WireRecord, wireUuidSchema } from "../core.js";
import { moveTaskRelation } from "../tasks/task-relation.js";
import {
  AGENT_TOOL_REFUSAL,
  type AgentCall,
  type AgentReadCall,
  type AgentToolServices,
  agentToolRejected,
  callerUserId,
  callerWorkspace,
  orStoreRefusal,
  taskUpdateAnswer,
  UPDATE_TASK_REFUSAL,
} from "./agent-tools.js";
import { runReadTask } from "./task-tools.js";

/** The longest key a find reads: a workspace's prefix, a hyphen, and a number. */
const MAX_KEY_CHARS = 64;

/** Why a find found nothing, in words the model can act on. */
const FIND_TASK_REFUSAL = {
  UNREADABLE: "Not found: name the task by its number, such as 42, or its key, such as ACME-42.",
  NO_TASK:
    "Not found: no task of that workspace the member can open has that number; " +
    `${AGENT_TOOL.LIST_TASKS} names them.`,
} as const;

/** Why a relation's move changed nothing, in words the model can act on. */
const CHANGE_TASK_RELATION_REFUSAL = {
  UNREADABLE:
    `Not run: name the task and the other task by the ids ${AGENT_TOOL.LIST_TASKS} answered, ` +
    `and two different kinds (${Object.values(TASK_RELATION_KIND).join(", ")}) to move the ` +
    "relation from and to.",
  NO_OTHER:
    "Not run: the other task is the task itself, or no task of the task's workspace the member " +
    `can open; ${AGENT_TOOL.LIST_TASKS} names them.`,
  BLOCK_CYCLE:
    "Not run: that block would close a cycle, a task waiting on itself through the tasks it " +
    "blocks; take one of those blocks away first.",
  PARENT_CYCLE:
    "Not run: that parent would make a task descend from itself; take the task out from " +
    "under the other first.",
  PARENT_REPOSITORY:
    "Not run: a child task always works in its parent's repository, so a task cannot be put " +
    "under a parent working in another.",
} as const;

/** A find names the task by its number or its key. */
export const FIND_TASK_INPUT = Schema.Struct({
  task: describeWire(
    Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(MAX_KEY_CHARS)),
    "The task's number in the workspace, such as 42, or its key, such as ACME-42; the key's " +
      "prefix is not checked, since it follows the workspace's name.",
  ),
});

const readFindAsked = Schema.decodeUnknownResult(FIND_TASK_INPUT);

/** A relation's move names the task, the other task, and the kinds the other stands to it in before and after. */
export const CHANGE_TASK_RELATION_INPUT = Schema.Struct({
  taskId: describeWire(
    wireUuidSchema,
    `The task whose relation to move, by the id ${MEMBER_MCP_TOOL.LIST_TASKS} answered.`,
  ),
  otherTaskId: describeWire(
    wireUuidSchema,
    `The other task of the relation, in the same workspace, by the id ${MEMBER_MCP_TOOL.LIST_TASKS} answered.`,
  ),
  from: describeWire(
    taskRelationChangeRequestSchema.fields.from,
    "How the other task stands to the task now: blocked-by (the other blocks it), blocks (it " +
      "blocks the other), sub-task (the other is its child), or parent (the other is its parent).",
  ),
  to: describeWire(
    taskRelationChangeRequestSchema.fields.to,
    "How the other task stands to the task once moved, in the same words as from, and another kind than from.",
  ),
});

const readRelationAsked = Schema.decodeUnknownResult(CHANGE_TASK_RELATION_INPUT);

/** One call of `find_task`: the task holding the number in the caller's workspace, read as `read_task` reads it, or why there is none. */
export function runFindTask(
  call: AgentReadCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, AgentToolServices> {
  const asked = readFindAsked(input);
  const ref = Result.isSuccess(asked) ? cliTaskRefOf(asked.success.task) : undefined;

  if (ref === undefined || !("number" in ref)) {
    return Effect.succeed(agentToolRejected(FIND_TASK_REFUSAL.UNREADABLE));
  }

  return orStoreRefusal(
    Effect.gen(function* () {
      const workspace = yield* callerWorkspace(call.caller);

      if (Option.isNone(workspace)) return agentToolRejected(AGENT_TOOL_REFUSAL.NO_WORKSPACE);
      const found = yield* taskIdOfNumber(callerUserId(call.caller), workspace.value, ref.number);

      if (Option.isNone(found)) return agentToolRejected(FIND_TASK_REFUSAL.NO_TASK);

      return yield* runReadTask(call, { taskId: found.value });
    }),
  );
}

/**
 * One call of `change_task_relation`: one relation of a task of the
 * caller's workspace moved to another kind (`moveTaskRelation`), answered
 * with the task's parent and blocks as they then stand, or why not. A
 * relation that did not stand in the kind it leaves is left alone, and the
 * new one is added still.
 */
export function runChangeTaskRelation(
  call: AgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, AgentToolServices> {
  const asked = readRelationAsked(input);

  if (Result.isFailure(asked) || asked.success.from === asked.success.to) {
    return Effect.succeed(agentToolRejected(CHANGE_TASK_RELATION_REFUSAL.UNREADABLE));
  }

  const { taskId, otherTaskId, from, to } = asked.success;

  return orStoreRefusal(
    Effect.gen(function* () {
      const userId = callerUserId(call.caller);
      const workspace = yield* callerWorkspace(call.caller);
      const read = yield* readTask(userId, taskId);

      if (
        Option.isNone(workspace) ||
        Option.isNone(read) ||
        read.value.task.workspaceId !== workspace.value
      ) {
        return agentToolRejected(UPDATE_TASK_REFUSAL.NO_TASK);
      }

      const moved = yield* moveTaskRelation(userId, taskId, { taskId: otherTaskId, from, to }).pipe(
        Effect.map((written) =>
          Option.match(written, {
            onNone: () => Result.fail(CHANGE_TASK_RELATION_REFUSAL.NO_OTHER),
            onSome: ({ txid }) => Result.succeed(txid !== undefined),
          }),
        ),
        Effect.catchTags({
          TaskBlockSelf: () => Effect.succeed(Result.fail(CHANGE_TASK_RELATION_REFUSAL.NO_OTHER)),
          TaskBlockAcrossWorkspaces: () =>
            Effect.succeed(Result.fail(CHANGE_TASK_RELATION_REFUSAL.NO_OTHER)),
          TaskParentUnreached: () =>
            Effect.succeed(Result.fail(CHANGE_TASK_RELATION_REFUSAL.NO_OTHER)),
          TaskBlockCycle: () =>
            Effect.succeed(Result.fail(CHANGE_TASK_RELATION_REFUSAL.BLOCK_CYCLE)),
          TaskParentCycle: () =>
            Effect.succeed(Result.fail(CHANGE_TASK_RELATION_REFUSAL.PARENT_CYCLE)),
          TaskParentRepositoryDiffers: () =>
            Effect.succeed(Result.fail(CHANGE_TASK_RELATION_REFUSAL.PARENT_REPOSITORY)),
        }),
      );

      if (Result.isFailure(moved)) return agentToolRejected(moved.failure);
      // The task is read again, since a parent set or cleared changed its own row.
      const after = yield* readTask(userId, taskId);

      if (Option.isNone(after)) return agentToolRejected(UPDATE_TASK_REFUSAL.NO_TASK);

      return yield* taskUpdateAnswer(userId, after.value.task, {
        already: !moved.success,
        section: undefined,
        parentNamed: true,
        blocksNamed: true,
      });
    }),
  );
}
