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
 * start one. Fast, the panel's switch, moves the pick onto its model's fast
 * version or back, offered only where the catalog lists one, and a pick of
 * another model keeps the speed where that model has it. A start names a model only
 * where one was picked, so an untouched sheet starts on the account's
 * default at the moment it goes, as the panel's does. A read that could not
 * be read before it listed anything says so, in the panel's words, with Try
 * again, which asks the host to read it again (`AGENTS_MODELS_RETRY`,
 * `TASKS_REPOSITORIES_RETRY`), as the panel's menus do.
 */

import { signedInAccountId } from "@repo/credentials/snapshot";
import { type AgentFork, forkStart } from "@repo/features/agent-fork-model";
import {
  billingRequiredWords,
  localAgentRefusalWords,
  type RefusedCall,
  startFailureWords,
} from "@repo/features/agent-refusal-words";
import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
import {
  AGENT_MACHINE,
  type AgentAttachment,
  type AgentRunsOnRequest,
} from "@repo/features/agent-wire";
import type { DevicePlatform } from "@repo/features/device-agent-wire";
import { effortFor, effortLabel, effortsOf } from "@repo/features/model-effort";
import { modelLabel } from "@repo/features/model-label";
import {
  type CatalogModel,
  type MacOffer,
  MODEL_SPEED,
  MODEL_SPEED_SUFFIX,
  type ModelChoice,
  type ModelsAnswer,
  modelSpeedOf,
  standardModelIdOf,
} from "@repo/features/models-wire";
import {
  everyPlace,
  type RunsOnPlace,
  type RunsOnPlaces,
  runsOnPlaces,
} from "@repo/features/runs-on-places";
import { TASK_CREATE_RELATION_KIND, type TaskCreateRelation } from "@repo/features/task-wire";
import {
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
} from "@repo/host/app-state-reads";
import {
  CHOICE_MARK,
  type Glyph,
  type PickOption,
  runsOnGlyph,
  useServiceReached,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { useMemo, useState } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs, useListedTasks } from "../host/host-provider.js";
import { useLiveFollow } from "../host/live-follow.js";
import { useMenuRepositoryPictures } from "../menu-photos.js";
import { useOfferedWorkspaceMachines } from "../workspace-machines.js";

/** No models read yet. */
const NO_MODELS: readonly CatalogModel[] = [];

/** No devices read yet. */
const NO_DEVICES: readonly MacOffer[] = [];

/** What a start that did not go says, or the agent or task it started. */
export type StartAnswer =
  | { readonly agentId: string; readonly taskId: string }
  | { readonly taskId: string; readonly agentId?: undefined; readonly note?: string | undefined }
  | { readonly refused: string };

/** What a refused agent Start says, by why, naming the device that would not take it where the service said, as the panel's note says it. */
export function startRefusalWords(refused: RefusedCall): string {
  if (refused.failure === AGENT_CALL_FAILURE.LOCAL_AGENT_REFUSED) {
    return localAgentRefusalWords(refused.localAgentRefusal, refused.refusedDevice);
  }

  if (refused.failure === AGENT_CALL_FAILURE.BILLING_REQUIRED) {
    return billingRequiredWords(refused.billingRefusal, refused.billingManager);
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
  /** The model shown, by its standard version's id, as the models are listed; none before the default is read. */
  readonly model: string | undefined;
  readonly pickModel: (model: string) => void;
  readonly pickEffort: (effort: string) => void;
  /** Fast: whether the pick is its model's fast version, and the switch; none where the catalog lists no fast version of it. */
  readonly fast: { readonly on: boolean; readonly toggle: () => void } | undefined;
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
      ? [
          {
            id: model.id,
            label: modelLabel(model.id, catalog),
            lead: { kind: CHOICE_MARK.HARNESS, provider: model.provider },
          },
        ]
      : [],
  );
}

/** The catalog id a pick of a model names: its version at the speed `running` is, where the catalog offers one, else the model's own. */
export function atSpeed(offered: readonly CatalogModel[], model: string, running: string): string {
  const speed = modelSpeedOf(running);

  if (speed === MODEL_SPEED.STANDARD) return model;
  const version = `${model}${MODEL_SPEED_SUFFIX[speed]}`;

  return offered.some(({ id }) => id === version) ? version : model;
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

/**
 * The platform of one of the account's devices, by its id, as the models'
 * read lists the devices a task may run its agents on; none while that read
 * hasn't landed, or for a device it doesn't name. Note that the read is
 * followed only while a device is named, so a row of a cloud agent reads
 * nothing, and a row of a device's agent draws its platform's mark on a
 * cold launch without waiting for a sheet to read the devices.
 */
export function useDevicePlatform(deviceId: string | undefined): DevicePlatform | undefined {
  const acts = useHostActs();
  const { data: account } = useQuery({ ...appStateQuery, select: selectAccount });
  const following = deviceId === undefined ? undefined : signedInAccountId(account);
  useLiveFollow(following, () => acts[ACT_KIND.AGENTS_MODELS_FOLLOW]());
  const { data } = useQuery({ ...appStateQuery, select: selectModels });

  if (deviceId === undefined) return undefined;

  return data?.rows?.macs?.find((device) => device.deviceId === deviceId)?.platform;
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
 * menu keeps (`effortFor`). A sheet opened from a suggestion starts on the
 * suggestion's model and effort (`seed`), as the panel's draft lays them on
 * its chip.
 */
export function useModelPick(seed?: ModelChoice): ModelPick {
  const acts = useHostActs();
  const held = useModelsRead();
  const reached = useServiceReached();
  const read = held?.rows;
  const { data: fallback } = useQuery({ ...appStateQuery, select: selectAgentDefault });
  const [picked, setPicked] = useState<ModelChoice | undefined>(seed);
  const catalog = read?.models ?? NO_MODELS;
  const shown = picked ?? fallback;
  const models = useMemo(() => modelOptions(catalog), [catalog]);
  const model = shown === undefined ? undefined : standardModelIdOf(shown.model);

  const fastId =
    model === undefined ? undefined : `${model}${MODEL_SPEED_SUFFIX[MODEL_SPEED.FAST]}`;

  // Note that a move between models or speeds keeps the effort where the new one lists it, else the nearest it lists, as the panel's menu does.
  const pickAt = (id: string) => {
    const effort = effortFor(effortsOf(catalog, id), shown?.effort);

    if (effort !== undefined) setPicked({ model: id, effort });
  };

  return {
    models,
    efforts: effortOptions(catalog, shown?.model),
    shown,
    picked,
    model,
    pickModel: (picked) =>
      pickAt(shown === undefined ? picked : atSpeed(catalog, picked, shown.model)),
    pickEffort: (effort) => {
      if (shown !== undefined) setPicked({ model: shown.model, effort });
    },
    fast:
      shown === undefined ||
      model === undefined ||
      fastId === undefined ||
      !catalog.some(({ id }) => id === fastId)
        ? undefined
        : {
            on: shown.model === fastId,
            toggle: () => pickAt(shown.model === fastId ? model : fastId),
          },
    // Note that a device still setting itself up takes no agent, so it is not offered.
    devices: (read?.macs ?? NO_DEVICES).filter((device) => device.setup === undefined),
    // Note that a read that failed while the phone does not reach the service says nothing, since the app's one offline notice said why.
    failed: reached && held?.failed === true && read === undefined ? MODELS_READ_FAILED : undefined,
    retry: () => {
      acts[ACT_KIND.AGENTS_MODELS_RETRY]().catch(retryRefused("the models"));
    },
  };
}

/** The glyph a place leads with: the cloud's, or its machine's platform's. */
export function placeGlyph(place: RunsOnPlace): Glyph {
  return runsOnGlyph({
    cloud: place.runsOn.machine === AGENT_MACHINE.VERCEL,
    platform: place.platform,
  });
}

/** Runs on's places as a picker's options, each led by its glyph, in the order they are listed. */
export function runsOnOptions(places: RunsOnPlaces): readonly PickOption[] {
  return everyPlace(places).map((place) => ({
    id: place.id,
    label: place.label,
    symbol: placeGlyph(place),
  }));
}

/** Runs on's places for a start in `workspaceId`: Cloud, the member's devices `pick` read, and the machines that workspace owns, followed while the sheet stands. */
export function useRunsOnPlaces(pick: ModelPick, workspaceId: string | undefined): RunsOnPlaces {
  return runsOnPlaces(pick.devices, useOfferedWorkspaceMachines(workspaceId));
}

/** What a start names of where its agent runs: nothing for the cloud, as an untouched sheet starts there, and the place otherwise. */
function runsOnNamed(runsOn: AgentRunsOnRequest) {
  return runsOn.machine === AGENT_MACHINE.VERCEL ? undefined : { runsOn };
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
  const reached = useServiceReached();

  return useMemo(
    () => ({
      listed: rows?.repositories.map(({ fullName }) => fullName) ?? NO_REPOSITORIES,
      read: rows !== undefined,
      // Note that a read that failed while the phone does not reach the service says nothing, since the app's one offline notice said why.
      failed: reached && failed && rows === undefined,
      retry: () => {
        if (workspaceId === undefined) return;
        acts[ACT_KIND.TASKS_REPOSITORIES_RETRY]({ workspaceId }).catch(
          retryRefused("the repositories"),
        );
      },
    }),
    [rows, failed, reached, workspaceId, acts],
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
  const pictureOf = useMenuRepositoryPictures(listed);
  const tasks = useListedTasks();
  const [picked, setPicked] = useState<string | undefined>(drafted);
  const recent = useMemo(() => recentRepositories(tasks), [tasks]);

  const reached = (repository: string) =>
    workspace !== undefined &&
    workspaceReaches(workspace, repository) &&
    (!read || listed.includes(repository));

  const starting = recent.find(reached) ?? listed[0];
  // Note that a draft's repository may be one the workspace it opens in no longer reaches, so it stands only while it does.
  const kept = picked !== undefined && picked === drafted && !reached(picked) ? undefined : picked;

  return {
    options: listed.map((repository) => ({
      id: repository,
      label: repository,
      lead: { kind: CHOICE_MARK.REPOSITORY, repository, picture: pictureOf(repository) },
    })),
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
  /** The words the agent starts on; none for Talk's, which starts it blank, its first words said on the call. */
  readonly prompt: string | undefined;
  /** The pictures attached, in the order attached; none where nothing is. */
  readonly attachments: readonly AgentAttachment[] | undefined;
  readonly picked: ModelChoice | undefined;
  readonly runsOn: AgentRunsOnRequest;
}

/** What a start hands its agent: the words, or nothing for Talk's blank start. */
function briefOf(prompt: string | undefined) {
  return prompt === undefined ? { blank: true } : { prompt };
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
      ...briefOf(prompt),
      ...(attachments === undefined ? undefined : { attachments: [...attachments] }),
      ...(picked === undefined ? undefined : { model: picked.model, effort: picked.effort }),
      ...runsOnNamed(runsOn),
    }).catch(unanswered("The agent's start"));

    if ("failure" in answer) return { refused: startRefusalWords(answer) };

    return { agentId: answer.agent.id, taskId };
  };
}

/**
 * New agent's start as a fork, as the panel's forked draft sends it
 * (`forkStart`): from the source at its message, the words and pictures as
 * a note, the choice only where one was picked, since a fork otherwise runs
 * on its source's, and where it runs left to its source's; under one key
 * for the page, so a retry after no answer starts the agent once.
 */
export function useStartFork(
  taskId: string,
  fork: AgentFork,
): (ask: Omit<StartAsk, "runsOn">) => Promise<StartAnswer> {
  const acts = useHostActs();
  const [key] = useState(randomUUID);

  return async ({ prompt, attachments, picked }) => {
    const answer = await acts[ACT_KIND.AGENTS_START]({
      taskId,
      ...forkStart({
        draftId: key,
        fork,
        words: prompt ?? "",
        attachments: attachments ?? [],
        choice: picked,
      }),
    }).catch(unanswered("The fork's start"));

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
  // Note that the task's id is minted once, as the agent's key is, so a start sent again makes no second task.
  const [id] = useState(randomUUID);

  return async ({ prompt, attachments, picked, runsOn, ...place }) => {
    const answer = await acts[ACT_KIND.TASKS_START]({
      id,
      ...placeOf(workspaceId, place),
      planning: false,
      agent: {
        idempotencyKey: key,
        ...briefOf(prompt),
        ...(attachments === undefined ? undefined : { attachments: [...attachments] }),
        ...(picked === undefined ? undefined : { model: picked.model, effort: picked.effort }),
        ...runsOnNamed(runsOn),
      },
    }).catch(unanswered("The task's start"));

    if ("failure" in answer) return { refused: startFailureNote(answer.failure) };
    const started = answer.agentStart;

    if (started === undefined) return { taskId: answer.taskId };

    if ("failure" in started) {
      return { taskId: answer.taskId, note: startRefusalWords(started) };
    }

    return { agentId: started.agent.id, taskId: answer.taskId };
  };
}
