// use-setup-gate.ts -- whether the app owes the account signed in its setup (`@repo/settings`' `setupGate`), as the panel's window reads it: what the account finished or started on any device, whether it is new, a team's invitation, and whether an agent is connected.

import { signedInAccountId } from "@repo/credentials/snapshot";
import { TASKS_READ } from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import {
  selectAccount,
  selectAppSettingsView,
  selectModels,
  selectWorkspaces,
} from "@repo/host/app-state-reads";
import { SETUP_GATE, type SetupGate, setupGate, setupPlaceFrom } from "@repo/settings";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs, useTaskListCollections, useTaskListHoldsAny } from "../host/host-provider.js";
import { useLiveFollow } from "../host/live-follow.js";

/** Whether the task list's read landed. */
const selectListRead = (state: AppStateSnapshot) => state.tasks.listStatus === TASKS_READ.READY;

/** The workspaces the service said the account ever had a task in; none until it has said. */
const selectTaskWorkspaces = (state: AppStateSnapshot) => state.tasks.taskWorkspaces;

/** Whether the read of the account's workspaces failed. */
const selectWorkspacesFailed = (state: AppStateSnapshot) =>
  state.tasks.workspacesStatus === TASKS_READ.FAILED;

/**
 * What the app does about setup for the account signed in, as the panel's
 * `useSetupGate` reads it: finished is the account's (`setupFinished`), drawn
 * as its write lands, so Finish lets the app in at once; started is the
 * account's kept place, or setup having stood in this launch, which then
 * stays until finished whatever it connects meanwhile; new is a task list
 * read that holds no task and names no workspace the account had one in, as
 * the panel's `welcomed` says; invited is any workspace of a team's, none
 * where the workspaces could not be read; and an agent is a model the
 * account may start one on, taken as standing where the models could not be
 * read, so a hitch never stands setup before an account that has worked.
 * Note that the models are followed only for an account that could still
 * be owed setup, so an account that has worked holds no follow open.
 */
export function useSetupGate(signedIn: boolean): SetupGate {
  const acts = useHostActs();
  const { tasks } = useTaskListCollections();
  const [startedHere, setStartedHere] = useState<string>();
  const account = useQuery({ ...appStateQuery, select: selectAccount }).data;
  const accountId = signedIn ? signedInAccountId(account) : undefined;
  const settings = useQuery({ ...appStateQuery, select: selectAppSettingsView }).data;
  const { data: listRead = false } = useQuery({ ...appStateQuery, select: selectListRead });
  const { data: taskWorkspaces } = useQuery({ ...appStateQuery, select: selectTaskWorkspaces });
  const { data: workspaces = [] } = useQuery({ ...appStateQuery, select: selectWorkspaces });

  const { data: workspacesFailed = false } = useQuery({
    ...appStateQuery,
    select: selectWorkspacesFailed,
  });

  const { data: models } = useQuery({ ...appStateQuery, select: selectModels });
  // Note that the list is asked only whether it holds a task, with no query over its rows, since this stands at the root as the launch draws.
  const listed = useTaskListHoldsAny(tasks);

  const finished = settings?.setupFinished === true;

  const started =
    accountId !== undefined &&
    (startedHere === accountId || setupPlaceFrom(settings?.setupPlace) !== undefined);

  // Note that the list may hold none of an account's old and finished tasks, so the service's word on where it had them stands beside it.
  const fresh =
    accountId !== undefined && listRead && !listed && (taskWorkspaces ?? []).length === 0;

  const invited =
    workspaces.length === 0
      ? workspacesFailed
        ? false
        : undefined
      : workspaces.some((workspace) => workspace.personal !== true);

  const agent =
    models?.rows !== undefined
      ? models.rows.models.some((model) => model.credentialMissing !== true)
      : models?.failed === true
        ? true
        : undefined;

  const owable = !finished && (fresh || started || invited === true);
  useLiveFollow(owable ? accountId : undefined, () => acts[ACT_KIND.AGENTS_MODELS_FOLLOW]());

  const gate = setupGate({
    id: accountId,
    fresh,
    finished,
    accountRead: settings?.accountRead === true,
    started,
    invited,
    agent,
  });

  // Setup once standing in this launch stays until finished, though the account keeps its place only from its first move.
  useEffect(() => {
    if (gate === SETUP_GATE.OWED && accountId !== undefined) setStartedHere(accountId);
  }, [gate, accountId]);

  return gate;
}
