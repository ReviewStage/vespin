// move-screens.tsx -- Move to workspace as a sheet over a task: the account's other workspaces, one whose GitHub cannot reach the task's repository dimmed with why, what the move does for the one chosen, and Move, as the panel's Move to workspace dialog asks it.

import { signedInAccountId } from "@repo/credentials/snapshot";
import {
  mayMoveTask,
  moveAgentsParts,
  moveChosen,
  moveGainParts,
  moveLossParts,
  movePartsText,
  moveTargetLine,
  moveTargets,
  moveTitle,
  moveVerb,
  TASK_MOVE_WORDS,
  workspaceTakesTask,
} from "@repo/features/task-move-model";
import type { TaskSummary } from "@repo/features/task-wire";
import { ACT_KIND } from "@repo/host/acts";
import { selectWorkspaces } from "@repo/host/app-state-reads";
import {
  BAR_TITLE,
  BUZZ,
  EmptyState,
  ListSection,
  Screen,
  SettingsForm,
  useColors,
  WorkspacePickRows,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useChosenWorkspace } from "../chosen-workspace.js";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import { useTaskOverview } from "../tasks/use-tasks.js";
import { useWrite } from "../use-write.js";
import { selectPhotos, switcherWorkspace } from "../workspace-switcher.js";

/** The sheet's own words. */
const WORDS = {
  CANCEL: "Cancel",
  TASK_NOT_FOUND: "Task not found",
} as const;

/** The sheet's route, which the task's ⋯ opens. */
const MOVE_ROUTE = "/move-task";

/**
 * Move to workspace as a task's ⋯ offers it: the sheet's door for a task the
 * reader may move, the task's owner while the account is in another
 * workspace, as the panel offers it; none for any other task, so the menu
 * leaves the item out.
 */
export function useMoveTaskDoor(): (task: TaskSummary) => (() => void) | undefined {
  const router = useRouter();
  const { data: workspaces = [] } = useQuery({ ...appStateQuery, select: selectWorkspaces });

  const { data: me } = useQuery({
    ...appStateQuery,
    select: (state) => signedInAccountId(state.account),
  });

  return useCallback(
    (task) =>
      mayMoveTask(task, me) && moveTargets(workspaces, task).length > 0
        ? () => router.push({ pathname: MOVE_ROUTE, params: { task: task.id } })
        : undefined,
    [router, workspaces, me],
  );
}

/**
 * The Move to workspace sheet over the task `taskId` names: the account's
 * other workspaces, each with its tile and who shares it, or why its GitHub
 * cannot take the task, the first that can chosen; under them what the move
 * does for the one chosen, as the panel's dialog says it; and Move in the
 * bar, which moves the task and closes the sheet, or keeps it up where the
 * service refused, the app's failure notice saying so. The sheet is the
 * move's confirmation, as the panel's dialog is, since a task moved
 * elsewhere leaves its workspace's members.
 */
export function MoveTaskScreen({ taskId }: { readonly taskId: string }) {
  const router = useRouter();
  const colors = useColors();
  const acts = useHostActs();
  const write = useWrite();
  const overview = useTaskOverview(taskId);
  const { data: workspaces = [] } = useQuery({ ...appStateQuery, select: selectWorkspaces });
  const { data: photos } = useQuery({ ...appStateQuery, select: selectPhotos });
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const [moving, setMoving] = useState(false);

  const task = overview?.task;
  const repository = task?.repository ?? null;
  const targets = task === undefined ? [] : moveTargets(workspaces, task);
  const chosen = moveChosen(targets, picked, repository);
  const from = workspaces.find((workspace) => workspace.id === task?.workspaceId);
  const personalId = workspaces[0]?.id;

  const { choose } = useChosenWorkspace(workspaces);
  // Note that a press is read off a ref, since a second tap can land before the render that disables Move, and the sheet's standing too, since an answer may land once it is gone.
  const sending = useRef(false);
  const standing = useRef(true);
  useEffect(() => {
    standing.current = true;

    return () => {
      standing.current = false;
    };
  }, []);

  const move = () => {
    if (task === undefined || chosen === undefined || sending.current) return;
    sending.current = true;
    setMoving(true);

    void write(() => acts[ACT_KIND.TASKS_MOVE]({ taskId: task.id, workspaceId: chosen.id }), {
      refused: (answer) => ("failure" in answer ? TASK_MOVE_WORDS.REFUSED : undefined),
      went: BUZZ.SUCCESS,
    }).then((moved) => {
      sending.current = false;

      if (!standing.current) return;
      setMoving(false);

      if (!moved) return;
      // The phone follows the task into the workspace it moved to, as the panel's list follows it, so its page names it there.
      choose(chosen.id);
      router.back();
    });
  };

  const bar = (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: TASK_MOVE_WORDS.TITLE,
          headerTintColor: colors.TEXT,
          headerTitleStyle: { ...BAR_TITLE.SCREEN, color: colors.TEXT },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.GROUPED },
          // Note that the sheet stays while the move is out, as the panel's dialog refuses to close, so its answer lands where it was asked.
          gestureEnabled: !moving,
        }}
      />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button disabled={moving} onPress={() => router.back()}>
          {WORDS.CANCEL}
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button disabled={chosen === undefined || moving} onPress={move}>
          {moving ? TASK_MOVE_WORDS.RUNNING : moveVerb(chosen)}
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
    </>
  );

  if (task === undefined) {
    return (
      <>
        {bar}
        <Screen>
          <EmptyState title={WORDS.TASK_NOT_FOUND} symbol="questionmark.folder" />
        </Screen>
      </>
    );
  }

  const effects =
    chosen === undefined
      ? undefined
      : [moveLossParts(from, chosen), moveGainParts(chosen), moveAgentsParts(chosen)]
          .map(movePartsText)
          .join("\n");

  return (
    <>
      {bar}
      <Screen>
        <SettingsForm>
          <ListSection title={moveTitle(task.name)} footer={effects}>
            <WorkspacePickRows
              options={targets.map((workspace) => ({
                workspace: switcherWorkspace(workspace, workspace.id === personalId, photos),
                line: moveTargetLine(workspace, repository, personalId),
                disabled: moving || !workspaceTakesTask(workspace, repository),
              }))}
              picked={chosen?.id}
              onPick={setPicked}
            />
          </ListSection>
        </SettingsForm>
      </Screen>
    </>
  );
}
