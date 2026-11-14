import type { AgentStatus } from "@repo/features/agent-wire";
import type { Entity, KnownNames } from "@repo/features/entity-kind";
import type { LinkDestination } from "@repo/features/link-grammar";
import { LIVE_READ } from "@repo/features/live-wire";
import { encodeMention, MENTION_KIND } from "@repo/features/mention-link";
import { agentName, modelLabel } from "@repo/features/model-label";
import type { CatalogModel } from "@repo/features/models-wire";
import { PAGE_OWNER, type PageLine } from "@repo/features/page-wire";
import type { TaskStatus } from "@repo/features/task-wire";
import { taskKey } from "@repo/features/workspace-key";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { and, eq, isUndefined, not, useLiveQuery } from "@tanstack/react-db";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useAutomation } from "../automation-directory.js";
import { useMemberDirectory } from "../member-directory.js";
import { useTaskListCollections, useTaskListRow } from "../task-list-collections.js";
import { appStateQuery, memoizedSelect } from "../use-app-state.js";
import { useMentionedPlace } from "./mentioned-place.js";

/**
 * use-known-names.ts -- the names the window already holds for places in the app, by id, for a chip to call an app link by.
 *
 * Read from main's document, which every window holds: every task's title,
 * the agents each task's row names, as their tabs name them
 * (`agentName`, so an untitled agent goes by its model), the models they
 * run on, and the automations that started them, the active task's
 * pages as the window holds them (`LIVE_READ.PAGES`), each task's key, the
 * Inbox items waiting, and the agents an automation started with no task;
 * from the directories standing around
 * the caller, the members and the automation asked for, and the catalog an
 * untitled agent's model is named by, as its tab and row name it
 * (`mentioned-place.ts`). Nothing is fetched,
 * so a name the window does not hold is not here; the task list is followed
 * from the account signing in (`compose-tasks.ts`), which brings each task's
 * name as the service gives it.
 *
 * The document's names are built once per delivery in a memoized select
 * every chip shares (`memoizedSelect`), rather than once per chip, so a
 * transcript of a hundred chips builds them once; and not at all for a
 * delivery that moved neither the tasks, the Inbox, nor the active task's
 * pages.
 *
 * A chip names one subject, so it reads the names of that subject alone
 * (`useNamesOf`): its task and its agent by id from the task list's
 * collections (`useTaskListRow`), so it is drawn again only when they move,
 * never for a delivery that moved some other row of the list.
 */

/** No people: what a caller outside a member directory names. */
const NO_PEOPLE: ReadonlyMap<string, string> = new Map();

/** The agents each held set of names last named by a catalog, and that catalog, so every chip of one delivery shares one map. */
const cataloguedAgents = new WeakMap<
  ReadonlyMap<string, string>,
  { readonly models: readonly CatalogModel[]; readonly agents: ReadonlyMap<string, string> }
>();

/**
 * The agents' names with each untitled agent's, the one its model's id
 * spells, named by the catalog instead, as its tab and its row in a list
 * name it; the names as held where no catalog is read.
 */
function agentsNamedBy(
  agents: ReadonlyMap<string, string>,
  agentModels: ReadonlyMap<string, string>,
  models: readonly CatalogModel[] | undefined,
): ReadonlyMap<string, string> {
  if (models === undefined) return agents;
  const held = cataloguedAgents.get(agents);

  if (held?.models === models) return held.agents;
  const named = new Map(agents);

  for (const [agentId, name] of agents) {
    const model = agentModels.get(agentId);

    if (model !== undefined && name === modelLabel(model))
      named.set(agentId, modelLabel(model, models));
  }

  cataloguedAgents.set(agents, { models, agents: named });

  return named;
}

/** The active task's pages as the window holds them; none with no task open, or before they are read. */
function activePagesOf(state: AppStateSnapshot | undefined): readonly PageLine[] | undefined {
  const taskId = state?.tasks.activeTaskId;

  return taskId === undefined ? undefined : state?.[LIVE_READ.PAGES][PAGE_OWNER.TASK][taskId]?.rows;
}

/** The names the document holds, no people among them, from the tasks, the Inbox, and the active task's pages. */
function heldNamesOf(
  planning: AppStateSnapshot["tasks"] | undefined,
  inbox: AppStateSnapshot["inbox"] | undefined,
  activePages: readonly PageLine[] | undefined,
): KnownNames {
  const tasks = new Map(planning?.tasks.map((task) => [task.id, task.name]));
  const agents = new Map<string, string>();
  const agentModels = new Map<string, string>();
  const automations = new Map<string, string>();

  for (const agent of planning?.taskAgents ?? []) {
    agents.set(agent.id, agentName(agent));
    agentModels.set(agent.id, agent.model);

    if (agent.automationId !== undefined && agent.automationName !== undefined) {
      automations.set(agent.automationId, agent.automationName);
    }
  }

  const pages = new Map(activePages?.map((page) => [page.id, page.title]));

  const inboxItems = new Map(
    (inbox?.waiting ?? []).flatMap((task) => task.items).map((item) => [item.id, item.title]),
  );

  return {
    tasks,
    agents,
    agentModels,
    pages,
    pagesTaskId: planning?.activeTaskId,
    inboxItems,
    people: NO_PEOPLE,
    automations,
  };
}

/** The names of a window before the first document arrives. */
const NO_HELD_NAMES = heldNamesOf(undefined, undefined, undefined);

/** The names the document holds, the one value every reader of this window shares, made again only for a delivery that moved the tasks, the Inbox, or the active task's pages. */
const selectHeldNames = memoizedSelect(
  (state) => [state.tasks, state.inbox, activePagesOf(state)],
  heldNamesOf,
);

/** Each listed task's status, by its id, built once per delivery that moved the slices the names are read from, as the names are. */
const selectHeldStatuses = memoizedSelect(
  (state) => [state.tasks],
  (planning): ReadonlyMap<string, TaskStatus> =>
    new Map(
      planning.tasks.flatMap((task) =>
        task.status === undefined ? [] : [[task.id, task.status] as const],
      ),
    ),
);

/** Each listed agent's status by its id, built as the task statuses are. */
const selectHeldAgentStatuses = memoizedSelect(
  (state) => [state.tasks],
  (planning): ReadonlyMap<string, AgentStatus> =>
    new Map((planning.taskAgents ?? []).map((agent) => [agent.id, agent.status] as const)),
);

/** No keys: what a window listing no numbered task holds, one object for every reader. */
const NO_KEY_TARGETS: ReadonlyMap<string, string> = new Map();

/** Whether two sets of keys name the same tasks by the same links, which a delivery that moved no task's key keeps. */
function sameTargets(
  held: ReadonlyMap<string, string>,
  next: ReadonlyMap<string, string>,
): boolean {
  if (held.size !== next.size) return false;

  for (const [key, target] of held) if (next.get(key) !== target) return false;

  return true;
}

/**
 * Each listed task's key (`ACME-42`), the link its mention is written with.
 * A key two tasks share, as two workspaces whose names begin alike give
 * theirs, names neither, so words never chip the wrong task.
 */
function keyTargetsOf(planning: AppStateSnapshot["tasks"]): ReadonlyMap<string, string> {
  const workspaces = new Map(planning.workspaces.map((workspace) => [workspace.id, workspace]));
  const targets = new Map<string, string>();
  const shared = new Set<string>();

  for (const task of planning.tasks) {
    const workspace = workspaces.get(task.workspaceId);

    if (workspace === undefined || task.number === undefined) continue;
    const key = taskKey(workspace.name, task.number);

    if (targets.has(key)) shared.add(key);
    const place = { workspace: workspace.slug ?? "", repository: null };
    targets.set(key, encodeMention({ kind: MENTION_KIND.TASK, taskId: task.id }, place));
  }

  for (const key of shared) targets.delete(key);

  return targets.size === 0 ? NO_KEY_TARGETS : targets;
}

/** The keys last handed to the readers, kept while a delivery names the same keys by the same links. */
let heldKeyTargets: ReadonlyMap<string, string> = NO_KEY_TARGETS;

/**
 * The keys, built once per delivery that moved the task list, as the names
 * are. It tells its readers only when a key or its link changed, which a
 * task's other moves never do, so the words drawn with it are read again
 * only then. Note that the last answer is kept here by hand, because a
 * `structuralSharing` function on one reader's `useQuery` becomes the
 * shared app-state query's own (`QueryObserver.setOptions`), which would
 * then compare whole documents with it.
 */
const selectKeyTargets = memoizedSelect(
  (state) => [state.tasks],
  (planning) => {
    const next = keyTargetsOf(planning);

    if (!sameTargets(heldKeyTargets, next)) heldKeyTargets = next;

    return heldKeyTargets;
  },
);

/** The members and former members of the directory around the caller, by user id; none outside one. */
function usePeople(): ReadonlyMap<string, string> {
  const { members, former } = useMemberDirectory();

  return useMemo(
    () =>
      members === undefined && former === undefined
        ? NO_PEOPLE
        : new Map([...(former ?? []), ...(members ?? [])].map((each) => [each.userId, each.name])),
    [members, former],
  );
}

/** `held`, with the automation `automationId` names as the directory around the caller lists it, where it does. */
function useAutomationsNamed(
  held: ReadonlyMap<string, string>,
  automationId: string | undefined,
): ReadonlyMap<string, string> {
  const automation = useAutomation(automationId)?.automation;

  // Note that the directory's automation is its name now, so it stands over the name the run that started an agent kept.
  return useMemo(
    () => (automation === undefined ? held : new Map([...held, [automation.id, automation.name]])),
    [held, automation],
  );
}

/**
 * The names words written with any among them are drawn with as a chip:
 * each listed task's key, by the link it names its task with
 * (`keyTargetsOf`). The same object until a key or a link changes.
 */
export function useWordTargets(): ReadonlyMap<string, string> {
  return useQuery({ ...appStateQuery, select: selectKeyTargets }).data ?? NO_KEY_TARGETS;
}

/**
 * The status of the task `taskId` names, as the window's task list holds it,
 * which a chip or a row naming the task wears as its mark (`PlanGlyph`);
 * none for a task the window does not list, or none asked for.
 */
export function useTaskStatus(taskId: string | undefined): TaskStatus | undefined {
  const select = useCallback(
    (state: AppStateSnapshot) =>
      taskId === undefined ? undefined : selectHeldStatuses(state).get(taskId),
    [taskId],
  );

  return useQuery({ ...appStateQuery, select }).data;
}

/** The status of the agent the window lists by `agentId`; none where it lists no such agent. */
export function useAgentStatus(agentId: string): AgentStatus | undefined {
  const select = useCallback(
    (state: AppStateSnapshot) => selectHeldAgentStatuses(state).get(agentId),
    [agentId],
  );

  return useQuery({ ...appStateQuery, select }).data;
}

/**
 * The names the window holds, the automation `automationId` names among them
 * where the directory around the caller lists it. Outside a member directory
 * and with no automation asked for, every caller is handed the one shared
 * value, which stays the same object until the tasks or the Inbox move; with
 * the catalog read, every caller shares the one map of agents' names it named.
 */
export function useKnownNames(automationId?: string): KnownNames {
  const held = useQuery({ ...appStateQuery, select: selectHeldNames }).data ?? NO_HELD_NAMES;
  const agents = agentsNamedBy(held.agents, held.agentModels, useMentionedPlace().models);
  const people = usePeople();
  const automations = useAutomationsNamed(held.automations, automationId);

  return useMemo(
    () =>
      people === held.people && automations === held.automations && agents === held.agents
        ? held
        : { ...held, agents, people, automations },
    [held, agents, people, automations],
  );
}

/** The ids a subject names the window's rows by: its task (`taskId`, or a link's `taskId`), its agent, and its automation. */
interface NamedIds {
  readonly taskId: string | undefined;
  readonly agentId: string | undefined;
  readonly automationId: string | undefined;
}

/** The ids a mention, an entity, or a link's place names rows of the task list by. */
function namedIdsOf(named: Entity | LinkDestination): NamedIds {
  return {
    taskId: "taskId" in named ? named.taskId : "taskId" in named ? named.taskId : undefined,
    agentId: "agentId" in named ? named.agentId : undefined,
    automationId: "automationId" in named ? named.automationId : undefined,
  };
}

/** The names of the open task's pages and of the Inbox items waiting, none of the task list's rows among them. */
interface PlaceNames {
  readonly pages: ReadonlyMap<string, string>;
  readonly pagesTaskId: string | undefined;
  readonly inboxItems: ReadonlyMap<string, string>;
}

/** No names: what a subject the window holds none of is named from. */
const NO_NAMES: ReadonlyMap<string, string> = new Map();

/** The pages and Inbox items' names, built once per delivery that moved the open task, its pages, or the Inbox, and never for one that moved only the task list's rows. */
const selectPlaceNames = memoizedSelect(
  (state) => [state.tasks.activeTaskId, state.inbox, activePagesOf(state)],
  (pagesTaskId, inbox, activePages): PlaceNames => ({
    pages: new Map(activePages?.map((page) => [page.id, page.title])),
    pagesTaskId,
    inboxItems: new Map(
      inbox.waiting.flatMap((task) => task.items).map((item) => [item.id, item.title]),
    ),
  }),
);

/** The names of a window before the first document arrives. */
const NO_PLACE_NAMES: PlaceNames = {
  pages: NO_NAMES,
  pagesTaskId: undefined,
  inboxItems: NO_NAMES,
};

/**
 * The name the agents of the task list keep for the automation `automationId`
 * names, the one the run that started any of them kept; none where no
 * listed agent was started by it, or none is asked for. One query stands
 * only for a chip naming an automation, which few words do.
 */
function useStartedByName(automationId: string | undefined): string | undefined {
  const { agents } = useTaskListCollections();

  // Note that the query's identity is the values it captures, as TanStack DB 1.0 derives it, so it is made again only for another automation.
  const { data } = useLiveQuery({
    query: (q) =>
      automationId === undefined
        ? undefined
        : q
            .from({ agent: agents })
            .where(({ agent }) =>
              and(eq(agent.automationId, automationId), not(isUndefined(agent.automationName))),
            )
            .findOne(),
  });

  return data?.automationName;
}

/**
 * The names the window holds for the one subject `named` names, a
 * mention's or a link's place, as `useKnownNames` holds them: its task's
 * name, its agent's as its tab names it, the model it runs on, and the
 * automation that started it, read by id from the task list's collections;
 * the open task's pages, the Inbox items waiting, and the people around the
 * caller beside them. It is drawn again when that task or agent moves, and
 * never for any other row of the list.
 */
export function useNamesOf(named: Entity | LinkDestination): KnownNames {
  const ids = namedIdsOf(named);
  const { tasks, agents } = useTaskListCollections();
  const task = useTaskListRow(tasks, ids.taskId);
  const agent = useTaskListRow(agents, ids.agentId);
  const startedBy = useStartedByName(ids.automationId);
  const models = useMentionedPlace().models;
  const place = useQuery({ ...appStateQuery, select: selectPlaceNames }).data ?? NO_PLACE_NAMES;
  const people = usePeople();

  const held = useMemo(
    () =>
      ids.automationId === undefined || startedBy === undefined
        ? NO_NAMES
        : new Map([[ids.automationId, startedBy]]),
    [ids.automationId, startedBy],
  );

  const automations = useAutomationsNamed(held, ids.automationId);

  return useMemo(
    () => ({
      ...place,
      tasks: task === undefined ? NO_NAMES : new Map([[task.id, task.name]]),
      agents: agent === undefined ? NO_NAMES : new Map([[agent.id, agentName(agent, models)]]),
      agentModels: agent === undefined ? NO_NAMES : new Map([[agent.id, agent.model]]),
      people,
      automations,
    }),
    [place, task, agent, models, people, automations],
  );
}
