// chip-marks.ts -- what the app holds of the entities a chip in a line of words can name, read once for every chip: a task's status, an agent's model or a Manager's face, a member's face, a workspace's tile.

import type { AgentStatus } from "@repo/features/agent-wire";
import { agentGlyphState, GLYPH_STATE } from "@repo/features/glyph-state";
import type { ManagerFace } from "@repo/features/manager-face";
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

/** Whether a Manager's face is the same, character, color and emoji, whatever object carries it. */
function sameFace(one: ManagerFace | undefined, other: ManagerFace | undefined): boolean {
  return (
    one?.character === other?.character &&
    one?.color === other?.color &&
    one?.emoji === other?.emoji
  );
}

/** Whether an agent's status says the same of whether it works, all a Manager's face shows of it. */
function sameWorking(one: AgentStatus, other: AgentStatus): boolean {
  return isWorking(one) === isWorking(other);
}

/** Whether an agent at `status` is at work, which a Manager's face wears. */
function isWorking(status: AgentStatus): boolean {
  return agentGlyphState(status) === GLYPH_STATE.WORKING;
}

/**
 * A count moved each time a row of `collection` comes, goes, or changes its
 * `field`, by `same` where given, so what reads that field of a few rows by
 * key is made again only then, with nothing built over the rows as it mounts.
 */
function useFieldMoves<Row extends object, Field extends keyof Row>(
  collection: Collection<Row, string>,
  field: Field,
  same: (one: Row[Field], other: Row[Field]) => boolean = Object.is,
): number {
  const moves = useRef(0);

  const subscribe = useCallback(
    (heard: () => void) => {
      const subscription = collection.subscribeChanges((changes) => {
        const moved = changes.some(
          (change) =>
            change.type !== "update" ||
            change.previousValue === undefined ||
            !same(change.previousValue[field], change.value[field]),
        );

        if (!moved) return;
        moves.current += 1;
        heard();
      });

      return () => subscription.unsubscribe();
    },
    [collection, field, same],
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

  // Note that a chip's task and agent are read by key as it draws, and the marks, which every message's words read, are made again only as a task's status, an agent's model, or a Manager's face or whether it works moves, all a chip shows of each, so nothing is read over the account's thousands of rows as the root mounts, and a step of a working agent's turn makes none again.
  const statusMoves = useFieldMoves(collections.tasks, "status");
  const modelMoves = useFieldMoves(collections.agents, "model");
  const faceMoves = useFieldMoves(collections.agents, "face", sameFace);
  const workingMoves = useFieldMoves(collections.agents, "status", sameWorking);

  const { data: workspaces } = useQuery({ ...appStateQuery, select: selectWorkspaces });
  const { data: photos } = useQuery({ ...appStateQuery, select: selectPhotos });
  const member = useMemberFaces();

  return useMemo(() => {
    const { tasks, agents } = collections;

    return (entity) =>
      chipMarkOf(entity, {
        taskStatus: (taskId) => tasks.get(taskId)?.status,
        agentModel: (agentId) => agents.get(agentId)?.model,
        managerFace: (agentId) => {
          const agent = agents.get(agentId);

          return agent?.face === undefined
            ? undefined
            : { face: agent.face, working: isWorking(agent.status) };
        },
        member,
        workspace: (slug) => {
          const listed = workspaceOfSlug(workspaces ?? [], slug);

          return listed === undefined ? undefined : switcherWorkspace(listed, false, photos);
        },
      });
  }, [collections, statusMoves, modelMoves, faceMoves, workingMoves, workspaces, photos, member]);
}
