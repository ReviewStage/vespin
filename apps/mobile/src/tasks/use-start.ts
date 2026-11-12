/**
 * use-start.ts -- what New agent and New task start from: the models the account may start an agent on and the model and effort picked among them, the repositories a workspace reaches and the one a task starts in, where its agent runs, and the two starts themselves.
 *
 * Each read is the panel's, followed on the host while a sheet holds it
 * (`ACT_KIND.AGENTS_MODELS_FOLLOW`, `ACT_KIND.TASKS_REPOSITORIES_FOLLOW`)
 * and read from the document the host writes it into. Each start is the act
 * the panel sends: New agent's `AGENTS_START` on the task, and New task's
 * one `TASKS_START`, which makes the task and starts its agent together, as
 * Home's composer does, the pictures attached going with its words as the
 * panel's attachments do, and in the relation picked, as New task's rows
 * start one. File for later is the same act with no agent, the task filed
 * in the Backlog under its words. A start names a model only
 * where one was picked, so an untouched sheet starts on the account's
 * default at the moment it goes, as the panel's does. A read that could not
 * be read before it listed anything says so, in the panel's words, with Try
 * again, which asks the host to read it again (`AGENTS_MODELS_RETRY`,
 * `TASKS_REPOSITORIES_RETRY`), as the panel's menus do.
 */

import { signedInAccountId } from "@repo/credentials/snapshot";
import {
  localAgentRefusalWords,
  type RefusedCall,
  startFailureWords,
} from "@repo/features/agent-refusal-words";
import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
import { AGENT_MACHINE, type AgentAttachment } from "@repo/features/agent-wire";
import { effortFor, effortLabel, effortsOf } from "@repo/features/model-effort";
import { modelLabel } from "@repo/features/model-label";
import {
  type CatalogModel,
  type MacOffer,
  MODEL_SPEED,
  type ModelChoice,
  type ModelsAnswer,
  modelSpeedOf,
} from "@repo/features/models-wire";
import { RUNS_ON_WORDS } from "@repo/features/task-agents-model";
import {
  TASK_CREATE_RELATION_KIND,
  TASK_STATUS,
  type TaskCreateRelation,
} from "@repo/features/task-wire";
import {
  type FiledTask,
  recentRepositories,
  repositoryFailureNote,
  startFailureNote,
  workspaceReaches,
} from "@repo/features/tasks-model";
import { TASK_CALL_FAILURE } from "@repo/features/tasks-view";
import { readFailedWords } from "@repo/features/words";
import type { Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppHostRead, AppStateSnapshot } from "@repo/host/app-state";
import {
  selectAccount,
  selectAgentDefault,
  selectModels,
  selectRepositoryList,
  selectTasks,
} from "@repo/host/app-state-reads";
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
  /** Why the models could not be read, where they listed nothing; none while they read or were read. */
  readonly failed: string | undefined;
  /** Reads the models again. */
  readonly retry: () => void;
}

/** What a sheet's models say where they could not be read, in the panel's words. */
const MODELS_READ_FAILED = readFailedWords("the models");

/** Says on the console a Try again the host refused, which leaves the read as it stood. */
function retryRefused(what: string): (cause: unknown) => void {
  return (cause) => console.error(`Reading ${what} again did not land.`, cause);
}

/** The models a picker offers, each once at standard speed, its fast versions folded under it as the panel's menu folds them, named as the panel names them (`modelLabel`). */
export function modelOptions(catalog: readonly CatalogModel[]): readonly PickOption[] {
  return catalog.flatMap((model) =>
    modelSpeedOf(model.id) === MODEL_SPEED.STANDARD
      ? [{ id: model.id, label: modelLabel(model.id, catalog) }]
      : [],
  );
}

/** The efforts a picker offers for the model, as the catalog lists them; none before a model is known. */
export function effortOptions(
  catalog: readonly CatalogModel[],
  model: string | undefined,
): readonly PickOption[] {
  return (model === undefined ? [] : effortsOf(catalog, model)).map((effort) => ({
    id: effort,
    label: effortLabel(effort),
  }));
}

/** The models the account may start an agent on, followed while the screen that reads them stands, and the read itself: none before it lands. */
export function useModelCatalog(): ModelsAnswer | undefined {
  return useModelsRead()?.rows;
}

/** The models' read as the host holds it, followed while the screen that reads it stands: its rows once read, and whether it failed. */
function useModelsRead(): AppHostRead<ModelsAnswer> | undefined {
  const acts = useHostActs();
  const { data: account } = useQuery({ ...appStateQuery, select: selectAccount });
  useLiveFollow(signedInAccountId(account), () => acts[ACT_KIND.AGENTS_MODELS_FOLLOW]());

  return useQuery({ ...appStateQuery, select: selectModels }).data;
}

/**
 * The models the account may start an agent on, followed while the sheet
 * stands, and the model and effort picked among them: the account's default
 * until a pick is made, and on a change of model the effort the panel's
 * menu keeps (`effortFor`).
 */
export function useModelPick(): ModelPick {
  const acts = useHostActs();
  const held = useModelsRead();
  const read = held?.rows;
  const { data: fallback } = useQuery({ ...appStateQuery, select: selectAgentDefault });
  const [picked, setPicked] = useState<ModelChoice | undefined>(undefined);
  const catalog = read?.models ?? NO_MODELS;
  const shown = picked ?? fallback;
  const models = useMemo(() => modelOptions(catalog), [catalog]);

  return {
    models,
    efforts: effortOptions(catalog, shown?.model),
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
    devices: (read?.macs ?? NO_DEVICES).filter((device) => device.setup === undefined),
    failed: held?.failed === true && read === undefined ? MODELS_READ_FAILED : undefined,
    retry: () => {
      acts[ACT_KIND.AGENTS_MODELS_RETRY]().catch(retryRefused("the models"));
    },
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
  /** Whether the repositories were read, so none listed means the workspace reaches none. */
  readonly read: boolean;
  /** Why the repositories could not be read, where they listed nothing; none while they read or were read. */
  readonly failed: string | undefined;
  /** Reads the workspace's repositories again. */
  readonly retry: () => void;
}

/** The repositories a workspace's GitHub reaches, by full name, whether their list has been read or could not be, and what reads it again. */
export interface WorkspaceRepositories {
  readonly listed: readonly string[];
  readonly read: boolean;
  /** Whether the list could not be read before it listed anything. */
  readonly failed: boolean;
  /** Reads the workspace's repositories again. */
  readonly retry: () => void;
}

/** No repositories read yet. */
const NO_REPOSITORIES: readonly string[] = [];

/**
 * The repositories the workspace's GitHub reaches, followed while the
 * screen that reads them stands, as the panel's chooser follows them
 * (`TASKS_REPOSITORIES_FOLLOW`); none before a workspace is named.
 */
export function useWorkspaceRepositories(workspaceId: string | undefined): WorkspaceRepositories {
  const acts = useHostActs();
  useLiveFollow(workspaceId, (id) => acts[ACT_KIND.TASKS_REPOSITORIES_FOLLOW]({ workspaceId: id }));

  const select = useMemo(() => {
    const list = selectRepositoryList(workspaceId ?? "");

    return (state: AppStateSnapshot) => list(state)?.rows;
  }, [workspaceId]);

  const failedSelect = useMemo(() => {
    const list = selectRepositoryList(workspaceId ?? "");

    return (state: AppStateSnapshot) => list(state)?.failed === true;
  }, [workspaceId]);

  const { data: rows } = useQuery({ ...appStateQuery, select });
  const { data: failed = false } = useQuery({ ...appStateQuery, select: failedSelect });

  return useMemo(
    () => ({
      listed: rows?.repositories.map(({ fullName }) => fullName) ?? NO_REPOSITORIES,
      read: rows !== undefined,
      failed: failed && rows === undefined,
      retry: () => {
        if (workspaceId === undefined) return;
        acts[ACT_KIND.TASKS_REPOSITORIES_RETRY]({ workspaceId }).catch(
          retryRefused("the repositories"),
        );
      },
    }),
    [rows, failed, workspaceId, acts],
  );
}

/**
 * The repositories the workspace's GitHub reaches, followed while the sheet
 * stands, and the one a task starts in: the pick, else the newest the
 * account's tasks were about that the workspace reaches, else the first it
 * lists, as Home's chip starts. A draft's repository (`drafted`) stands as
 * the first pick while the workspace reaches it, and gives way otherwise.
 */
export function useRepositoryPick(
  workspace: Workspace | undefined,
  drafted?: string | undefined,
): RepositoryPick {
  const { listed, read, failed, retry } = useWorkspaceRepositories(workspace?.id);
  const { data: tasks } = useQuery({ ...appStateQuery, select: selectTasks });
  const [picked, setPicked] = useState<string | undefined>(drafted);
  const recent = useMemo(() => recentRepositories(tasks?.tasks ?? []), [tasks]);

  const reached = (repository: string) =>
    workspace !== undefined &&
    workspaceReaches(workspace, repository) &&
    (!read || listed.includes(repository));

  const starting = recent.find(reached) ?? listed[0];
  // Note that a draft's repository may be one the workspace it opens in no longer reaches, so it stands only while it does.
  const kept = picked !== undefined && picked === drafted && !reached(picked) ? undefined : picked;

  return {
    options: listed.map((repository) => ({ id: repository, label: repository })),
    picked: kept ?? starting,
    pick: setPicked,
    read,
    failed: failed ? repositoryFailureNote(TASK_CALL_FAILURE.UNANSWERED) : undefined,
    retry,
  };
}

/* ----- The starts ----- */

/** The words, pictures, and choices a start carries. */
interface StartAsk {
  readonly prompt: string;
  /** The pictures attached, in the order attached; none where nothing is. */
  readonly attachments: readonly AgentAttachment[] | undefined;
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

  return async ({ prompt, attachments, picked, runsOn }) => {
    const answer = await acts[ACT_KIND.AGENTS_START]({
      taskId,
      idempotencyKey: key,
      prompt,
      ...(attachments === undefined ? undefined : { attachments: [...attachments] }),
      ...(picked === undefined ? undefined : { model: picked.model, effort: picked.effort }),
      ...(runsOn === CLOUD ? undefined : { runsOn: runsOnOf(runsOn) }),
    }).catch(unanswered("The agent's start"));

    if ("failure" in answer) return { refused: startRefusalWords(answer) };

    return { agentId: answer.agent.id, taskId };
  };
}

/** Where a new task stands: the workspace and repository it starts in, and the relation it starts in where one was picked. */
interface TaskPlace {
  readonly repository: string | undefined;
  readonly relation: TaskCreateRelation | undefined;
}

/** Whether a relation puts the new task in another's tree, which works in that task's repository. */
export function inTree(relation: TaskCreateRelation | undefined): boolean {
  return (
    relation?.kind === TASK_CREATE_RELATION_KIND.SUB_TASK_OF ||
    relation?.kind === TASK_CREATE_RELATION_KIND.PARENT_OF
  );
}

/** What a start names of where its task stands: its workspace, its repository but in another's tree, whose repository the service takes, and its relation. */
function placeOf(workspaceId: string | undefined, { repository, relation }: TaskPlace) {
  return {
    ...(workspaceId === undefined ? undefined : { workspaceId }),
    ...(repository === undefined || inTree(relation) ? undefined : { repository }),
    ...(relation === undefined ? undefined : { relations: [relation] }),
  };
}

/** A start the host refused or never answered, said as the panel's note says it. */
function unanswered(what: string) {
  return (cause: unknown) => {
    console.error(`${what} did not go.`, cause);

    return { failure: AGENT_CALL_FAILURE.UNANSWERED } as const;
  };
}

/**
 * New task's one start, as Home's composer sends it (`TASKS_START`): the
 * task in the workspace and repository picked, in the relation picked, and
 * its agent on the words, under one key for the sheet. A task made whose
 * agent was refused stands, with why its agent did not start.
 */
export function useStartTask(
  workspaceId: string | undefined,
): (ask: StartAsk & TaskPlace) => Promise<StartAnswer> {
  const acts = useHostActs();
  const [key] = useState(randomUUID);

  return async ({ prompt, attachments, picked, runsOn, ...place }) => {
    const answer = await acts[ACT_KIND.TASKS_START]({
      ...placeOf(workspaceId, place),
      planning: false,
      agent: {
        idempotencyKey: key,
        prompt,
        ...(attachments === undefined ? undefined : { attachments: [...attachments] }),
        ...(picked === undefined ? undefined : { model: picked.model, effort: picked.effort }),
        ...(runsOn === CLOUD ? undefined : { runsOn: runsOnOf(runsOn) }),
      },
    }).catch(unanswered("The task's start"));

    if ("failure" in answer) return { refused: startFailureNote(answer.failure) };
    const started = answer.agentStart;

    if (started === undefined) return { taskId: answer.planId };

    if ("failure" in started) {
      return { taskId: answer.planId, note: startRefusalWords(started) };
    }

    return { agentId: started.agent.id, taskId: answer.planId };
  };
}

/**
 * File for later: the same start with no agent (`TASKS_START` without
 * `agent`), the task filed in the Backlog, named by the words' first line
 * and handed them whole as its brief (`filedTaskOf`, which the sheet reads
 * so it offers the act only on words), in the workspace,
 * repository, and relation picked, for an agent to be started on later.
 */
export function useFileTask(
  workspaceId: string | undefined,
): (ask: { readonly filed: FiledTask } & TaskPlace) => Promise<StartAnswer> {
  const acts = useHostActs();

  return async ({ filed, ...place }) => {
    const answer = await acts[ACT_KIND.TASKS_START]({
      ...placeOf(workspaceId, place),
      ...filed,
      status: TASK_STATUS.BACKLOG,
      planning: false,
    }).catch(unanswered("The task's filing"));

    if ("failure" in answer) return { refused: startFailureNote(answer.failure) };

    return { taskId: answer.planId };
  };
}
