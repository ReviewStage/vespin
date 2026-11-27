// preview-link-names.ts -- what the app holds to say each place of ours an Inbox row's line spells bare by its chip's name, as the panel's row says it (`usePlainLinkNames`): read by key for the places that line names alone.

import type { InboxRow } from "@repo/features/inbox-digest";
import { inboxPreviewPlaces } from "@repo/features/inbox-list-model";
import { LINK_DESTINATION, taskNumberOf } from "@repo/features/link-grammar";
import { agentName } from "@repo/features/model-label";
import type { PlainLinkNames } from "@repo/features/place-chip-model";
import { workspaceOfSlug } from "@repo/features/workspace-wire";
import { selectWorkspaces } from "@repo/host/app-state-reads";
import { windowRows } from "@repo/host/read-window";
import { inArray } from "@tanstack/react-db";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useTaskListCollections, useTaskListRowsOf } from "../host/host-provider.js";
import { useWindow } from "../host/use-window.js";
import { useMemberFaces } from "../member-pictures.js";

/** No names of a kind. */
const NONE: ReadonlyMap<string, string> = new Map();

/** The ids a line's places name the task list's rows and members by: tasks by id, tasks by number, agents, and people. */
interface LineIds {
  readonly tasks: readonly string[];
  readonly numbers: readonly number[];
  readonly agents: readonly string[];
  readonly people: readonly string[];
}

/** The ids `places` names, each kind's apart. */
function lineIdsOf(places: ReturnType<typeof inboxPreviewPlaces>): LineIds {
  const tasks: string[] = [];
  const numbers: number[] = [];
  const agents: string[] = [];
  const people: string[] = [];

  for (const { place } of places) {
    const number = taskNumberOf(place);

    if (number !== undefined) numbers.push(number);
    else if ("taskId" in place) tasks.push(place.taskId);

    if ("agentId" in place) agents.push(place.agentId);

    if (place.kind === LINK_DESTINATION.PERSON) people.push(place.userId);
  }

  return { tasks, numbers, agents, people };
}

/**
 * The names an Inbox row's line says each place of ours it spells bare by
 * (`inboxPreview`'s `links`): a task's name by its id or by its number in
 * the workspace its link names, an agent's as its tab names it, and a
 * member's of the chosen workspace, read by key for the places the line
 * names alone, so a row naming none reads nothing. None where the line
 * spells no place of ours. A task the app does not list is said by its
 * kind, as the panel's row says one.
 */
export function usePreviewLinkNames(item: InboxRow): PlainLinkNames | undefined {
  const { tasks, agents } = useTaskListCollections();
  const places = useMemo(() => inboxPreviewPlaces(item), [item]);
  const ids = useMemo(() => lineIdsOf(places), [places]);
  const byId = useTaskListRowsOf(tasks, ids.tasks);
  const agentRows = useTaskListRowsOf(agents, ids.agents);
  const { data: workspaces } = useQuery({ ...appStateQuery, select: selectWorkspaces });
  const member = useMemberFaces();

  const byNumber = windowRows(
    useWindow((q) =>
      ids.numbers.length === 0
        ? undefined
        : q
            .from({ task: tasks })
            .where(({ task }) => inArray(task.number, [...ids.numbers]))
            .select(({ task }) => ({
              id: task.id,
              name: task.name,
              number: task.number,
              workspaceId: task.workspaceId,
            })),
    ),
  );

  return useMemo(() => {
    if (places.length === 0) return undefined;
    const taskNames = new Map([...byId, ...byNumber].map((task) => [task.id, task.name]));

    const people = new Map(
      ids.people.flatMap((userId) => {
        const name = member(userId)?.name;

        return name === undefined ? [] : [[userId, name] as const];
      }),
    );

    return {
      known: {
        tasks: taskNames,
        agents: new Map(agentRows.map((agent) => [agent.id, agentName(agent)])),
        agentModels: NONE,
        pages: NONE,
        pagesTaskId: undefined,
        inboxItems: NONE,
        people,
        automations: NONE,
      },
      taskIdOf: ({ workspace, number }) => {
        const named = workspaceOfSlug(workspaces ?? [], workspace);

        return byNumber.find((task) => task.workspaceId === named?.id && task.number === number)
          ?.id;
      },
    };
  }, [places, byId, byNumber, agentRows, ids.people, member, workspaces]);
}
