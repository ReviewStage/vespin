// chip-marks.ts -- what the app holds of the entities a chip in a line of words can name, read once for every chip: a task's status, an agent's model, a member's face, a workspace's tile.

import { workspaceOfSlug } from "@repo/features/workspace-wire";
import { selectWorkspaces } from "@repo/host/app-state-reads";
import { type ChipMarkOf, chipMarkOf } from "@repo/ui-native";
import { useLiveQuery } from "@tanstack/react-db";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useTaskListCollections } from "../host/host-provider.js";
import { useMemberFaces } from "../member-pictures.js";
import { selectPhotos, switcherWorkspace } from "../workspace-switcher.js";

/**
 * The mark each chip leads with, as the panel's chips do (`entity-mark.tsx`),
 * from the task list, its agents, the chosen workspace's members, and the
 * account's workspaces the app already holds, so a chip reads no
 * more than the screens around it. A chip whose entity the app holds none of
 * keeps its kind's glyph.
 */
export function useChipMarks(): ChipMarkOf {
  const collections = useTaskListCollections();

  // Note that each list is read as the one field a chip shows, a task's status and an agent's model, so a change to any other field, as each step of a working agent's turn makes, moves neither query, and the marks, which every message's words read, are not made again.
  const tasks = useLiveQuery((q) =>
    q
      .from({ task: collections.tasks })
      .select(({ task }) => ({ id: task.id, status: task.status })),
  ).data;

  const agents = useLiveQuery((q) =>
    q
      .from({ agent: collections.agents })
      .select(({ agent }) => ({ id: agent.id, model: agent.model })),
  ).data;

  const { data: workspaces } = useQuery({ ...appStateQuery, select: selectWorkspaces });
  const { data: photos } = useQuery({ ...appStateQuery, select: selectPhotos });
  const member = useMemberFaces();

  return useMemo(() => {
    const statuses = new Map(tasks.map((task) => [task.id, task.status]));
    const models = new Map(agents.map((agent) => [agent.id, agent.model]));

    return (entity) =>
      chipMarkOf(entity, {
        taskStatus: (taskId) => statuses.get(taskId),
        agentModel: (agentId) => models.get(agentId),
        member,
        workspace: (slug) => {
          const listed = workspaceOfSlug(workspaces ?? [], slug);

          return listed === undefined ? undefined : switcherWorkspace(listed, false, photos);
        },
      });
  }, [tasks, agents, workspaces, photos, member]);
}
