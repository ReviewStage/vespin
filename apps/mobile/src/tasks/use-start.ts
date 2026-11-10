/**
 * use-start.ts -- what New agent and New task start from: the models the account may start an agent on and the model and effort picked among them, the repositories a workspace reaches and the one a task starts in, where its agent runs, and the two starts themselves.
 *
 * Each read is the panel's, followed on the host while a sheet holds it
 * (`ACT_KIND.AGENTS_MODELS_FOLLOW`, `ACT_KIND.TASKS_REPOSITORIES_FOLLOW`)
 * and read from the document the host writes it into. Each start is the act
 * the panel sends: New agent's `AGENTS_START` on the task, and New task's
 * one `TASKS_START`, which makes the task and starts its agent together, as
 * Home's composer does. A start names a model only where one was picked, so
 * an untouched sheet starts on the account's default at the moment it goes,
 * as the panel's does.
 */

import { signedInAccountId } from "@repo/credentials/snapshot";
import {
  extraRepositoryRefusalWords,
  localAgentRefusalWords,
  type RefusedCall,
  startFailureWords,
} from "@repo/features/agent-refusal-words";
import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
import { AGENT_MACHINE } from "@repo/features/agent-wire";
import { effortFor, effortLabel, effortsOf } from "@repo/features/model-effort";
import { modelLabel } from "@repo/features/model-label";
import {
  type CatalogModel,
  type MacOffer,
  MODEL_SPEED,
  type ModelChoice,
  modelSpeedOf,
} from "@repo/features/models-wire";
import { RUNS_ON_WORDS } from "@repo/features/task-agents-model";
import { recentRepositories, startFailureNote, workspaceReaches } from "@repo/features/tasks-model";
import type { Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import {
  selectAccount,
  selectAgentDefault,
  selectExperiment,
  selectModels,
  selectRepositoryList,
  selectTasks,
} from "@repo/host/app-state-reads";
import { EXPERIMENT } from "@repo/settings";
import type { PickOption } from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { useMemo, useState } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import { useLiveFollow } from "../host/live-follow.js";

/** No models read yet. */
const NO_MODELS: readonly CatalogModel[] = [];

/** No devices read yet. */
const NO_DEVICES: readonly MacOffer[] = [];

/** The row Runs on picks for the cloud, beside each device's id. */
export const CLOUD = "cloud";

/** What a start that did not go says, or the agent or task it started. */
export type StartAnswer =
  | { readonly agentId: string; readonly taskId: string }
  | { readonly taskId: string; readonly agentId?: undefined; readonly note?: string | undefined }
  | { readonly refused: string };

/** What a refused agent Start says, by why, naming the device that would not take it where the service said, as the panel's note says it. */
function startRefusalWords(refused: RefusedCall): string {
  if (refused.failure === AGENT_CALL_FAILURE.LOCAL_AGENT_REFUSED) {
    return localAgentRefusalWords(refused.localAgentRefusal, refused.refusedDevice);
  }
  if (refused.failure === AGENT_CALL_FAILURE.EXTRA_REPOSITORY_REFUSED) {
    return extraRepositoryRefusalWords(refused.extraRepositoryRefusal, refused.refusedRepository);
  }
  return startFailureWords(refused.failure);
}

/* ----- The model and effort ----- */

/** The model and effort a sheet starts on, and the pickers that change them. */
export interface ModelPick {
  /** The models offered, each once, its fast versions folded under it as the panel's menu folds them. */
  readonly models: readonly PickOption[];
  readonly efforts: readonly PickOption[];
  /** What the pickers show: the pick, or the account's default where none was made. */
  readonly shown: ModelChoice | undefined;
  /** What a start names: the pick, or none where nothing was picked. */
  readonly picked: ModelChoice | undefined;
  readonly pickModel: (model: string) => void;
  readonly pickEffort: (effort: string) => void;
  /** The devices that may run an agent, where the account may run one on its own device; none otherwise. */
  readonly devices: readonly MacOffer[];
}

/**
 * The models the account may start an agent on, followed while the sheet
 * stands, and the model and effort picked among them: the account's default
 * until a pick is made, and on a change of model the effort the panel's
 * menu keeps (`effortFor`).
 */
export function useModelPick(): ModelPick {
  const acts = useHostActs();
  const { data: account } = useQuery({ ...appStateQuery, select: selectAccount });
  useLiveFollow(signedInAccountId(account), () => acts[ACT_KIND.AGENTS_MODELS_FOLLOW]());
  const { data: read } = useQuery({ ...appStateQuery, select: selectModels });
  const { data: fallback } = useQuery({ ...appStateQuery, select: selectAgentDefault });
  const { data: ownHosts = false } = useQuery({
    ...appStateQuery,
    select: selectExperiment(EXPERIMENT.BRING_YOUR_OWN_HOST),
  });
  const [picked, setPicked] = useState<ModelChoice | undefined>(undefined);
  const catalog = read?.rows?.models ?? NO_MODELS;
  const shown = picked ?? fallback;
  const models = useMemo(
    () =>
      catalog
        .filter((model) => modelSpeedOf(model.id) === MODEL_SPEED.STANDARD)
        .map((model) => ({ id: model.id, label: modelLabel(model.id, catalog) })),
    [catalog],
  );
  const efforts = (shown === undefined ? [] : effortsOf(catalog, shown.model)).map((effort) => ({
    id: effort,
    label: effortLabel(effort),
  }));
  return {
    models,
    efforts,
    shown,
    picked,
    pickModel: (model) => {
      const effort = effortFor(effortsOf(catalog, model), shown?.effort);
      if (effort !== undefined) setPicked({ model, effort });
    },
    pickEffort: (effort) => {
      if (shown !== undefined) setPicked({ model: shown.model, effort });
    },
    // Note that a device still setting itself up takes no agent, so it is not offered.
    devices: ownHosts
      ? (read?.rows?.macs ?? NO_DEVICES).filter((device) => device.setup === undefined)
      : NO_DEVICES,
  };
}

/** Runs on's options: Cloud, then each device that may run the agent, by its name. */
export function runsOnOptions(devices: readonly MacOffer[]): readonly PickOption[] {
  return [
    { id: CLOUD, label: RUNS_ON_WORDS.CLOUD },
    ...devices.map((device) => ({ id: device.deviceId, label: device.name })),
  ];
}

/** Where a start runs its agent, as it names it: the cloud, or a device by its id. */
function runsOnOf(place: string) {
  return place === CLOUD
    ? { machine: AGENT_MACHINE.VERCEL }
    : { machine: AGENT_MACHINE.DEVICE, deviceId: place };
}

/* ----- The repository ----- */

/** The repositories a task may start in, and the one it starts in until another is picked. */
export interface RepositoryPick {
  readonly options: readonly PickOption[];
  readonly picked: string | undefined;
  readonly pick: (repository: string) => void;
}

/**
 * The repositories the workspace's GitHub reaches, followed while the sheet
 * stands, and the one a task starts in: the pick, else the newest the
 * account's tasks were about that the workspace reaches, else the first it
 * lists, as Home's chip starts.
 */
export function useRepositoryPick(workspace: Workspace | undefined): RepositoryPick {
  const acts = useHostActs();
  const workspaceId = workspace?.id;
  useLiveFollow(workspaceId, (id) => acts[ACT_KIND.TASKS_REPOSITORIES_FOLLOW]({ workspaceId: id }));
  const select = useMemo(() => selectRepositoryList(workspaceId ?? ""), [workspaceId]);
  const { data: read } = useQuery({ ...appStateQuery, select });
  const { data: tasks } = useQuery({ ...appStateQuery, select: selectTasks });
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const listed = useMemo(
    () => (read?.rows?.repositories ?? []).map(({ fullName }) => fullName),
    [read],
  );
  const recent = useMemo(() => recentRepositories(tasks?.tasks ?? []), [tasks]);
  const reached = (repository: string) =>
    workspace !== undefined &&
    workspaceReaches(workspace, repository) &&
    (read?.rows === undefined || listed.includes(repository));
  const starting = recent.find(reached) ?? listed[0];
  return {
    options: listed.map((repository) => ({ id: repository, label: repository })),
    picked: picked ?? starting,
    pick: setPicked,
  };
}

/* ----- The starts ----- */

/** The words and choices a start carries. */
interface StartAsk {
  readonly prompt: string;
  readonly picked: ModelChoice | undefined;
  readonly runsOn: string;
}

/**
 * New agent's start on a task, as the panel's draft sends it
 * (`AGENTS_START`): under one key for the sheet, so a retry after no answer
 * starts the agent once.
 */
export function useStartAgent(taskId: string): (ask: StartAsk) => Promise<StartAnswer> {
  const acts = useHostActs();
  const [key] = useState(randomUUID);
  return async ({ prompt, picked, runsOn }) => {
    const answer = await acts[ACT_KIND.AGENTS_START]({
      taskId,
      idempotencyKey: key,
      prompt,
      ...(picked === undefined ? undefined : { model: picked.model, effort: picked.effort }),
      ...(runsOn === CLOUD ? undefined : { runsOn: runsOnOf(runsOn) }),
    }).catch((error: unknown) => {
      console.error("The agent's start did not go.", error);
      return { failure: AGENT_CALL_FAILURE.UNANSWERED } as const;
    });
    if ("failure" in answer) return { refused: startRefusalWords(answer) };
    return { agentId: answer.agent.id, taskId };
  };
}

/**
 * New task's one start, as Home's composer sends it (`TASKS_START`): the
 * task in the workspace and repository picked, and its agent on the words,
 * under one key for the sheet. A task made whose agent was refused stands,
 * with why its agent did not start.
 */
export function useStartTask(
  workspaceId: string | undefined,
): (ask: StartAsk & { readonly repository: string | undefined }) => Promise<StartAnswer> {
  const acts = useHostActs();
  const [key] = useState(randomUUID);
  return async ({ prompt, picked, runsOn, repository }) => {
    const answer = await acts[ACT_KIND.TASKS_START]({
      ...(workspaceId === undefined ? undefined : { workspaceId }),
      ...(repository === undefined ? undefined : { repository }),
      planning: false,
      agent: {
        idempotencyKey: key,
        prompt,
        ...(picked === undefined ? undefined : { model: picked.model, effort: picked.effort }),
        ...(runsOn === CLOUD ? undefined : { runsOn: runsOnOf(runsOn) }),
      },
    }).catch((error: unknown) => {
      console.error("The task's start did not go.", error);
      return { failure: AGENT_CALL_FAILURE.UNANSWERED } as const;
    });
    if ("failure" in answer) return { refused: startFailureNote(answer.failure) };
    const started = answer.agentStart;
    if (started === undefined) return { taskId: answer.planId };
    if ("failure" in started) {
      return { taskId: answer.planId, note: startRefusalWords(started) };
    }
    return { agentId: started.agent.id, taskId: answer.planId };
  };
}
