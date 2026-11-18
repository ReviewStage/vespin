/**
 * task-relation-tools.ts -- `change_task_relation`: one relation of a task moved to another kind, for the member an outside agent acts for.
 *
 * A relation's move is the one the task head's menu and `tasks.relation`
 * make (`moveTaskRelation`), in one transaction, answered as `update_task`
 * answers a change of the task's parent and blocks.
 */

import { readTask } from "@repo/database/models/task-store";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import { MEMBER_MCP_TOOL } from "@repo/features/member-mcp-tool";
import { TASK_RELATION_KIND, taskRelationChangeRequestSchema } from "@repo/features/task-wire";
import { describeWire } from "@repo/wire/effect";
import { Effect, Option, Result, Schema } from "effect";
import type { UnparsedWireValue, WireRecord } from "../core.js";
import { moveTaskRelation } from "../tasks/task-relation.js";
import {
  type AgentCall,
  type AgentToolServices,
  agentToolRejected,
  callerUserId,
  callerWorkspace,
  orStoreRefusal,
  taskUpdateAnswer,
  UPDATE_TASK_REFUSAL,
} from "./agent-tools.js";
import { TASK_REF_INPUT, taskIdOfInput } from "./task-ref.js";

/** Why a relation's move changed nothing, in words the model can act on. */
const CHANGE_TASK_RELATION_REFUSAL = {
  UNREADABLE:
    `Not run: name the task and the other task by the ids ${AGENT_TOOL.LIST_TASKS} answered or their keys, ` +
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

/** A relation's move names the task, the other task, and the kinds the other stands to it in before and after. */
export const CHANGE_TASK_RELATION_INPUT = Schema.Struct({
  taskId: describeWire(
    TASK_REF_INPUT,
    `The task whose relation to move, by the id ${MEMBER_MCP_TOOL.LIST_TASKS} answered, or by ` +
      "its key, such as ACME-42, with the workspace it stands in.",
  ),
  otherTaskId: describeWire(
    TASK_REF_INPUT,
    `The other task of the relation, in the same workspace, by the id ${MEMBER_MCP_TOOL.LIST_TASKS} ` +
      "answered or by its key.",
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

  const { from, to } = asked.success;

  return orStoreRefusal(
    Effect.gen(function* () {
      const userId = callerUserId(call.caller);
      const workspace = yield* callerWorkspace(call.caller);

      if (Option.isNone(workspace)) return agentToolRejected(UPDATE_TASK_REFUSAL.NO_TASK);

      // Each task may be named by its key, read in the caller's workspace alone.
      const named = yield* taskIdOfInput(
        userId,
        workspace.value,
        { opening: "Not run", field: "taskId" },
        asked.success.taskId,
      );

      if (Result.isFailure(named)) return agentToolRejected(named.failure);

      const other = yield* taskIdOfInput(
        userId,
        workspace.value,
        { opening: "Not run", field: "otherTaskId" },
        asked.success.otherTaskId,
      );

      if (Result.isFailure(other)) return agentToolRejected(other.failure);
      const taskId = named.success;
      const otherTaskId = other.success;
      const read = yield* readTask(userId, taskId);

      if (Option.isNone(read) || read.value.task.workspaceId !== workspace.value) {
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
