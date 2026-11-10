/**
 * task-repository-menus.ts -- the repository chip's list for a workspace, and the asks that open a task's repository and relation menus.
 *
 * The chip's list reads the account's tasks and workspaces straight from
 * app state; the menus' asks are composed by `useTasksTab`, whose doors
 * open the task they are about first.
 */

import type { TaskRelationKind } from "@repo/features/task-wire";
import { recentRepositories, workspaceReaches } from "@repo/features/tasks-model";
import { TASKS_READ } from "@repo/features/tasks-view";
import { managesWorkspace } from "@repo/features/workspace-role";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { appPlatform } from "../app-platform.js";
import { useRepositoryPictures } from "../repository-pictures.js";
import { appStateQuery, selectListedTasks } from "../use-app-state.js";
import type { RepositoryChooser } from "./repository-chip.js";

/** The ask standing for the open task's chip to open its menu: which task it is about, and how many asks so far. */
export type RepositoryMenuAsk = { readonly taskId: string; readonly request: number };

/** The ask standing for the open task's head to open the add menu on a kind: which task it is about, the kind, and how many asks so far. */
export type RelationMenuAsk = {
  readonly taskId: string;
  readonly kind: TaskRelationKind;
  readonly request: number;
};

/** Opens a page of GitHub's in the browser, such as a repository's own, through the platform as it answers at the call. */
export function openRepositoryOnGitHub(url: string): void {
  appPlatform().openGitHub(url);
}

/**
 * The repository chip's list for one workspace: the repositories its tasks
 * were about lately that its GitHub reaches, newest first, so a task never
 * starts on another workspace's nor on one a task stranded there by #2524
 * still names; a read of every repository its GitHub reaches; whether the
 * account manages it, so can connect its GitHub; and whether it has a
 * GitHub connected, so a read finding none installed says GitHub removed
 * or suspended it. A workspace not yet read is taken as managed, so the
 * chip still points somewhere, and its recent repositories are left to the
 * service's read to judge; and whether the tasks are still being read, so
 * the chip asks for no pick before its default could be known.
 */
export function useRepositoriesIn(): (workspaceId: string | undefined) => RepositoryChooser {
  const listed = useQuery({ ...appStateQuery, select: selectListedTasks }).data;
  const pictures = useRepositoryPictures();
  const workspaces = listed?.workspaces;
  const tasks = listed?.tasks;
  const listStatus = listed?.listStatus;
  return useCallback(
    (workspaceId: string | undefined): RepositoryChooser => {
      const workspace = workspaces?.find((each) => each.id === workspaceId);
      const own =
        workspaceId === undefined
          ? (tasks ?? [])
          : (tasks ?? []).filter((task) => task.workspaceId === workspaceId);
      // Note that the tasks are filtered before the recent ones are counted,
      // because a few newer stranded tasks would otherwise crowd out an older
      // repository the workspace does reach.
      const offered =
        workspace === undefined
          ? own
          : own.filter(
              (task) => task.repository !== null && workspaceReaches(workspace, task.repository),
            );
      return {
        recent: recentRepositories(offered),
        reading: listStatus !== TASKS_READ.READY && listStatus !== TASKS_READ.FAILED,
        openGitHub: openRepositoryOnGitHub,
        pictures,
        scope: workspaceId,
        manages: workspace === undefined || managesWorkspace(workspace),
        ...(workspace?.github == null ? undefined : { connected: true }),
      };
    },
    [workspaces, tasks, listStatus, pictures],
  );
}

/** The repository chip's list for one workspace, made again only as what it lists from moves. */
export function useRepositoryChooser(workspaceId: string | undefined): RepositoryChooser {
  const repositoriesIn = useRepositoriesIn();
  return useMemo(() => repositoriesIn(workspaceId), [repositoriesIn, workspaceId]);
}

/** The asks that open a task's repository and relation menus, and the doors that make them. */
export interface TaskMenus {
  readonly repositoryMenu: RepositoryMenuAsk | undefined;
  readonly relationMenu: RelationMenuAsk | undefined;
  readonly onChangeRepository: (taskId: string) => void;
  readonly onAddRelation: (taskId: string, kind: TaskRelationKind) => void;
}

/**
 * The repository chip's and the add menu's asks. The chip's menu stands on
 * the open task's toolbar, so another task's is opened first (`select`);
 * the add menu hangs from the task's head, so the task opens first and
 * comes out from under a page standing in its place, such as the Board
 * whose card asked (`showTask`). Each ask is counted so each press opens
 * its menu again.
 */
export function useTaskMenus(doors: {
  readonly activeTaskId: string | undefined;
  readonly select: (taskId: string) => void;
  readonly showTask: (taskId: string) => void;
}): TaskMenus {
  const [repositoryMenu, setRepositoryMenu] = useState<RepositoryMenuAsk | undefined>(undefined);
  const [relationMenu, setRelationMenu] = useState<RelationMenuAsk | undefined>(undefined);
  const { activeTaskId, select, showTask } = doors;
  return {
    repositoryMenu,
    relationMenu,
    onChangeRepository: (taskId) => {
      if (taskId !== activeTaskId) select(taskId);
      setRepositoryMenu((held) => ({ taskId, request: (held?.request ?? 0) + 1 }));
    },
    onAddRelation: (taskId, kind) => {
      showTask(taskId);
      setRelationMenu((held) => ({ taskId, kind, request: (held?.request ?? 0) + 1 }));
    },
  };
}
