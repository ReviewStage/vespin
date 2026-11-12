/**
 * description-doors.ts -- the writes to a description's words, and a retry of its read, as the surface drawing it holds them.
 */

import { TASK_CALL_FAILURE } from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { sendAct } from "../act.js";
import { descriptionDocumentRetryMutation } from "../live-reads.js";
import { appStateQuery, selectFixtureStaged } from "../use-app-state.js";
import {
  type DescriptionEditMutation,
  descriptionEditMutation,
} from "./description-edit-mutation.js";

/**
 * The writes to `taskId`'s words, as each place writing them holds its own
 * mutation over them (`descriptionEditMutation`): saved, a conflict with
 * the text as it stands now, or why not; none with no task. A fixture's
 * tasks are read from nowhere, so an edit of one is never saved.
 */
export function useDescriptionEdit(
  taskId: string | undefined,
): DescriptionEditMutation | undefined {
  const fixture = useQuery({ ...appStateQuery, select: selectFixtureStaged }).data === true;

  if (taskId === undefined) return undefined;

  return descriptionEditMutation(taskId, (request) =>
    fixture
      ? Promise.resolve({ failure: TASK_CALL_FAILURE.UNANSWERED })
      : sendAct(ACT_KIND.TASKS_EDIT, { taskId, edit: request }),
  );
}

/** Reads `taskId`'s description again after its read failed; nothing with no task. */
export function useDescriptionRetry(taskId: string | undefined): () => void {
  const { mutate } = useMutation(descriptionDocumentRetryMutation());

  return useCallback(() => {
    if (taskId !== undefined) mutate({ taskId });
  }, [mutate, taskId]);
}
