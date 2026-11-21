// chip-marks.ts -- what the app holds of the entities a chip in a line of words can name, read once for every chip: a task's status, an agent's model, a member's face, a workspace's tile.

import { workspaceOfSlug } from "@repo/features/workspace-wire";
import { selectWorkspaces } from "@repo/host/app-state-reads";
import { type ChipMarkOf, chipMarkOf } from "@repo/ui-native";
import type { Collection } from "@tanstack/react-db";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useTaskListCollections } from "../host/host-provider.js";
import { useMemberFaces } from "../member-pictures.js";
import { selectPhotos, switcherWorkspace } from "../workspace-switcher.js";

/**
 * A count moved each time a row of `collection` comes, goes, or changes its
 * `field`, so what reads that field of a few rows by key is made again only
 * then, with nothing built over the rows as it mounts.
 */
function useFieldMoves<Row extends object>(
  collection: Collection<Row, string>,
  field: keyof Row,
): number {
  const moves = useRef(0);

  const subscribe = useCallback(
    (heard: () => void) => {
      const subscription = collection.subscribeChanges((changes) => {
        const moved = changes.some(
          (change) =>
            change.type !== "update" ||
            change.previousValue === undefined ||
            change.previousValue[field] !== change.value[field],
        );

        if (!moved) return;
        moves.current += 1;
        heard();
      });

      return () => subscription.unsubscribe();
    },
    [collection, field],
  );

  return useSyncExternalStore(subscribe, () => moves.current);
}

/**
 * The mark each chip leads with, as the panel's chips do (`entity-mark.tsx`),
 * from the task list, its agents, the chosen workspace's members, and the
 * account's workspaces the app already holds, so a chip reads no
 * more than the screens around it. A chip whose entity the app holds none of
 * keeps its kind's glyph.
 */
export function useChipMarks(): ChipMarkOf {
  const collections = useTaskListCollections();

  // Note that a chip's task and agent are read by key as it draws, and the marks, which every message's words read, are made again only as a task's status or an agent's model moves, the one field a chip shows of each, so nothing is read over the account's thousands of rows as the root mounts, and a step of a working agent's turn makes none again.
  const statusMoves = useFieldMoves(collections.tasks, "status");
  const modelMoves = useFieldMoves(collections.agents, "model");

  const { data: workspaces } = useQuery({ ...appStateQuery, select: selectWorkspaces });
  const { data: photos } = useQuery({ ...appStateQuery, select: selectPhotos });
  const member = useMemberFaces();

  return useMemo(() => {
    const { tasks, agents } = collections;

    return (entity) =>
      chipMarkOf(entity, {
        taskStatus: (taskId) => tasks.get(taskId)?.status,
        agentModel: (agentId) => agents.get(agentId)?.model,
        member,
        workspace: (slug) => {
          const listed = workspaceOfSlug(workspaces ?? [], slug);

          return listed === undefined ? undefined : switcherWorkspace(listed, false, photos);
        },
      });
  }, [collections, statusMoves, modelMoves, workspaces, photos, member]);
}
