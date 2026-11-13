// chip-marks.ts -- what the app holds of the entities a chip in a line of words can name, read once for every chip: a task's status, an agent's model, a member's face, a thread's ask, a workspace's tile.

import { workspaceOfSlug } from "@repo/features/workspace-wire";
import { selectTasks, selectWorkspaces } from "@repo/host/app-state-reads";
import { type ChipMarkOf, chipMarkOf } from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useChosenInbox } from "../inbox/use-inbox.js";
import { useMemberFaces } from "../member-pictures.js";
import { selectPhotos, switcherWorkspace } from "../workspace-switcher.js";

/**
 * The mark each chip leads with, as the panel's chips do (`entity-mark.tsx`),
 * from the task list, its agents, the chosen workspace's members, its Inbox,
 * and the account's workspaces the app already holds, so a chip reads no
 * more than the screens around it. A chip whose entity the app holds none of
 * keeps its kind's glyph.
 */
export function useChipMarks(): ChipMarkOf {
  const { data: view } = useQuery({ ...appStateQuery, select: selectTasks });
  const { data: workspaces } = useQuery({ ...appStateQuery, select: selectWorkspaces });
  const { data: photos } = useQuery({ ...appStateQuery, select: selectPhotos });
  const { groups } = useChosenInbox();
  const member = useMemberFaces();

  return useMemo(() => {
    const statuses = new Map((view?.tasks ?? []).map((task) => [task.id, task.status]));
    const models = new Map((view?.taskAgents ?? []).map((agent) => [agent.id, agent.model]));
    const items = new Map(groups.flatMap((group) => group.items.map((item) => [item.id, item])));

    return (entity) =>
      chipMarkOf(entity, {
        taskStatus: (taskId) => statuses.get(taskId),
        agentModel: (agentId) => models.get(agentId),
        member,
        inboxItem: (itemId) => items.get(itemId),
        workspace: (slug) => {
          const listed = workspaceOfSlug(workspaces ?? [], slug);

          return listed === undefined ? undefined : switcherWorkspace(listed, false, photos);
        },
      });
  }, [view, workspaces, photos, groups, member]);
}
