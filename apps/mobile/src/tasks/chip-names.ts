// chip-names.ts -- what the app holds of the one entity a chip in a line of words names, read by key as the chip draws: a task's name, found by its number where a link names it so, an agent's, and a member's, as the panel's chip reads the window's (`useNamesOf`).

import type { Entity, KnownNames } from "@repo/features/entity-kind";
import { LINK_DESTINATION, taskNumberOf } from "@repo/features/link-grammar";
import { agentName } from "@repo/features/model-label";
import { useMemo } from "react";
import { useTaskListCollections, useTaskListRow } from "../host/host-provider.js";
import { useMemberFaces } from "../member-pictures.js";
import { useFoundTask } from "./use-found-task.js";

/** No names of a kind. */
const NONE: ReadonlyMap<string, string> = new Map();

/** The ids an entity names rows of the task list and members by. */
function namedIdsOf(entity: Entity | undefined) {
  return {
    taskId: entity !== undefined && "taskId" in entity ? entity.taskId : undefined,
    agentId: entity !== undefined && "agentId" in entity ? entity.agentId : undefined,
    userId: entity !== undefined && "userId" in entity ? entity.userId : undefined,
  };
}

/** One name under the id its entity names it by; none where the app holds no name. */
function oneName(id: string | undefined, name: string | undefined): ReadonlyMap<string, string> {
  return id === undefined || name === undefined ? NONE : new Map([[id, name]]);
}

/**
 * The names the app holds for the entity a chip names, under `workspace`,
 * the one its link was written in: its task's name, from the task list by
 * its id, or by its number as the list or the service finds it (`useFoundTask`),
 * keyed by the step the link names it by, so a link by number says the title
 * as one by id does; its agent's, as its tab names it; and a member's, of
 * the chosen workspace. None where the app holds none of them, so the chip
 * keeps its words or its kind: while a number is found, for a task the
 * reader may not open, and for one deleted. Note that a task named by its id
 * is read from the list alone, as the panel's chip reads it, and only a
 * number is asked of the service.
 */
export function useChipNames(
  entity: Entity | undefined,
  workspace: string | undefined,
): KnownNames | undefined {
  const { tasks, agents } = useTaskListCollections();
  const ids = namedIdsOf(entity);

  const numbered =
    ids.taskId !== undefined &&
    taskNumberOf({ kind: LINK_DESTINATION.TASK, taskId: ids.taskId }) !== undefined;

  const found = useFoundTask(numbered ? ids.taskId : undefined, workspace);
  const task = useTaskListRow(tasks, numbered ? found.taskId : ids.taskId);
  const agent = useTaskListRow(agents, ids.agentId);
  const member = useMemberFaces();
  const person = ids.userId === undefined ? undefined : member(ids.userId)?.name;
  const taskName = task?.name;
  const agentNamed = agent === undefined ? undefined : agentName(agent);

  return useMemo(() => {
    if (taskName === undefined && agentNamed === undefined && person === undefined) {
      return undefined;
    }

    return {
      tasks: oneName(ids.taskId, taskName),
      agents: oneName(ids.agentId, agentNamed),
      agentModels: NONE,
      pages: NONE,
      pagesTaskId: undefined,
      inboxItems: NONE,
      people: oneName(ids.userId, person),
      automations: NONE,
    };
  }, [ids.taskId, ids.agentId, ids.userId, taskName, agentNamed, person]);
}
