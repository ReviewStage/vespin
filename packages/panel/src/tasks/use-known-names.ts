import type { AgentStatus, ListedAgent } from "@repo/features/agent-wire";
import type { Entity, KnownNames } from "@repo/features/entity-kind";
import type { LinkDestination } from "@repo/features/link-grammar";
import { LIVE_READ } from "@repo/features/live-wire";
import type { ManagerFace } from "@repo/features/manager-face";
import { encodeMention, MENTION_KIND } from "@repo/features/mention-link";
import { agentName, modelLabel } from "@repo/features/model-label";
import type { CatalogModel } from "@repo/features/models-wire";
import { PAGE_OWNER, type PageLine } from "@repo/features/page-wire";
import type { TaskStatus, TaskSummary } from "@repo/features/task-wire";
import type { TasksView } from "@repo/features/tasks-view";
import { taskKey } from "@repo/features/workspace-key";
import type { AppStateSnapshot } from "@repo/host/app-state";
import {
  and,
  type ChangeMessage,
  type Collection,
  eq,
  isUndefined,
  not,
  useLiveQuery,
} from "@tanstack/react-db";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useSyncExternalStore } from "react";
import { useAutomation } from "../automation-directory.js";
import { useMemberDirectory } from "../member-directory.js";
import { useTaskListCollections, useTaskListRow } from "../task-list-collections.js";
import {
  appStateQuery,
  memoizedSelect,
  selectWorkspaces,
  useAppStateSlice,
} from "../use-app-state.js";
import { useMentionedPlace } from "./mentioned-place.js";

/**
 * use-known-names.ts -- the names the window already holds for places in the app, by id, for a chip to call an app link by.
 *
 * Read from the task list's collections (`task-list-collections.tsx`): every
 * task's title, every listed agent, as its tab names it (`agentName`, so an
 * untitled agent goes by its model), the model it runs on, and the
 * automation that started it, and each task's key; from main's document,
 * which every window holds, the active task's pages as the window holds
 * them (`LIVE_READ.PAGES`), the Inbox items waiting, and the workspaces a
 * key is spelled with; from the directories standing around
 * the caller, the members and the automation asked for, and the catalog an
 * untitled agent's model is named by, as its tab and row name it
 * (`mentioned-place.ts`). Nothing is fetched,
 * so a name the window does not hold is not here; the task list is followed
 * from the account signing in (`compose-tasks.ts`), which brings each task's
 * name as the service gives it.
 *
 * The account-wide names and keys are each one derivation of a collection
 * every reader shares (`derivationOf`), rather than one per message, so a
 * transcript of a hundred messages builds them once; and a delivery is
 * looked at only for the rows it moved, so one that moves no name or key,
 * as an agent's status or a task's time does, leaves them the same object
 * and draws none of their readers again.
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

/** One value derived from every row of a collection, which its readers listen to and read. */
interface Derivation<Value> {
  readonly listen: (heard: () => void) => () => void;
  readonly read: () => Value;
}

/**
 * The one `derive` of `collection`'s rows that every reader shares. It
 * listens from its first read, so the readers drawn in one frame derive it
 * once, until its last listener goes; a change it hears is looked at for
 * the rows it moved alone (`moves`), and only one that moves the value
 * derives it again, so it stays the same object across a delivery that
 * moves nothing it holds.
 */
function derivationOf<Row extends object, Value extends object>(
  collection: Collection<Row, string>,
  derive: (rows: Iterable<Row>) => Value,
  moves: (held: Value, change: ChangeMessage<Row, string>) => boolean,
): Derivation<Value> {
  let held: Value | undefined;
  let stop: (() => void) | undefined;
  const listeners = new Set<() => void>();

  const follow = (): void => {
    if (stop !== undefined) return;

    const subscription = collection.subscribeChanges((changes) => {
      const was = held;

      // Note that no reader holds a value not yet derived again, so a change heard before the next read tells no one.
      if (was === undefined || !changes.some((change) => moves(was, change))) return;
      held = undefined;

      for (const hear of listeners) hear();
    });

    stop = () => subscription.unsubscribe();
  };

  return {
    listen: (heard) => {
      follow();
      listeners.add(heard);

      return () => {
        listeners.delete(heard);

        if (listeners.size > 0) return;
        stop?.();
        stop = undefined;
        held = undefined;
      };
    },
    read: () => {
      follow();
      held ??= derive(collection.values());

      return held;
    },
  };
}

/** The derivation `make` builds of `collection`, made once for it and kept while it stands. */
function sharedOf<Key extends object, Value>(
  made: WeakMap<Key, Value>,
  key: Key,
  make: (key: Key) => Value,
): Value {
  const held = made.get(key) ?? make(key);
  made.set(key, held);

  return held;
}

/** The value `derivation` holds, drawn again only when a change moves it. */
function useDerived<Value>(derivation: Derivation<Value>): Value {
  // Note that a render to markup reads the value as it stands, as a window's first frame does.
  return useSyncExternalStore(derivation.listen, derivation.read, derivation.read);
}

/** The names of the listed agents, the models they run on, and the automations that started them. */
interface AgentNames {
  readonly agents: ReadonlyMap<string, string>;
  readonly agentModels: ReadonlyMap<string, string>;
  readonly automations: ReadonlyMap<string, string>;
}

/** Where a numbered task's key is spelled from: its workspace and its number. */
interface TaskNumber {
  readonly workspaceId: string;
  readonly number: number;
}

/** Every task's name, by task id. */
const taskNames = new WeakMap<
  Collection<TaskSummary, string>,
  Derivation<ReadonlyMap<string, string>>
>();

/** Every listed agent's names, by agent id. */
const agentNames = new WeakMap<Collection<ListedAgent, string>, Derivation<AgentNames>>();

/** Every numbered task's workspace and number, by task id. */
const taskNumbers = new WeakMap<
  Collection<TaskSummary, string>,
  Derivation<ReadonlyMap<string, TaskNumber>>
>();

/** Every task's name, moved only by a task added, gone, or renamed. */
function taskNamesOf(tasks: Collection<TaskSummary, string>) {
  return sharedOf(taskNames, tasks, (collection) =>
    derivationOf(
      collection,
      (rows) => new Map(Array.from(rows, (task) => [task.id, task.name])),
      (held, change) => change.type !== "update" || held.get(change.key) !== change.value.name,
    ),
  );
}

/** Every listed agent's names, moved only by an agent added, gone, or named anew, or one an automation not yet named started. */
function agentNamesOf(agents: Collection<ListedAgent, string>) {
  return sharedOf(agentNames, agents, (collection) =>
    derivationOf(
      collection,
      (rows): AgentNames => {
        const named = new Map<string, string>();
        const agentModels = new Map<string, string>();
        const automations = new Map<string, string>();

        for (const agent of rows) {
          named.set(agent.id, agentName(agent));
          agentModels.set(agent.id, agent.model);

          if (agent.automationId !== undefined && agent.automationName !== undefined) {
            automations.set(agent.automationId, agent.automationName);
          }
        }

        return { agents: named, agentModels, automations };
      },
      (held, change) => {
        const agent = change.value;

        return (
          change.type !== "update" ||
          held.agents.get(change.key) !== agentName(agent) ||
          held.agentModels.get(change.key) !== agent.model ||
          (agent.automationId !== undefined &&
            agent.automationName !== undefined &&
            !held.automations.has(agent.automationId))
        );
      },
    ),
  );
}

/** Every numbered task's workspace and number, moved only by a numbered task added or gone, or a task numbered or moved anew. */
function taskNumbersOf(tasks: Collection<TaskSummary, string>) {
  return sharedOf(taskNumbers, tasks, (collection) =>
    derivationOf(
      collection,
      (rows) => {
        const numbers = new Map<string, TaskNumber>();

        for (const task of rows) {
          if (task.number !== undefined) {
            numbers.set(task.id, { workspaceId: task.workspaceId, number: task.number });
          }
        }

        return numbers;
      },
      (held, change) => {
        const was = held.get(change.key);

        if (change.type === "delete") return was !== undefined;

        return (
          was?.number !== change.value.number ||
          (was !== undefined && was.workspaceId !== change.value.workspaceId)
        );
      },
    ),
  );
}

/** Names handed to the readers, and the parts they were made of. */
interface HeldNames {
  readonly tasks: ReadonlyMap<string, string>;
  readonly agents: AgentNames;
  readonly place: PlaceNames;
  readonly names: KnownNames;
}

/** The names last handed to the readers, so every reader of one delivery shares one value. */
let heldNames: HeldNames | undefined;

/** The names the window holds, no people among them, the same object while none of its parts moves. */
function heldNamesOf(
  tasks: ReadonlyMap<string, string>,
  agents: AgentNames,
  place: PlaceNames,
): KnownNames {
  if (heldNames?.tasks === tasks && heldNames.agents === agents && heldNames.place === place) {
    return heldNames.names;
  }

  const names = { ...place, ...agents, tasks, people: NO_PEOPLE };
  heldNames = { tasks, agents, place, names };

  return names;
}

/** No keys: what a window listing no numbered task holds, one object for every reader. */
const NO_KEY_TARGETS: ReadonlyMap<string, string> = new Map();

/** No workspaces: what a window holds before the first document arrives. */
const NO_WORKSPACES: TasksView["workspaces"] = [];

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
 * Each numbered task's key (`ACME-42`), the link its mention is written with.
 * A key two tasks share, as two workspaces whose names begin alike give
 * theirs, names neither, so words never chip the wrong task.
 */
function keyTargetsOf(
  numbers: ReadonlyMap<string, TaskNumber>,
  listed: TasksView["workspaces"],
): ReadonlyMap<string, string> {
  const workspaces = new Map(listed.map((workspace) => [workspace.id, workspace]));
  const targets = new Map<string, string>();
  const shared = new Set<string>();

  for (const [taskId, { workspaceId, number }] of numbers) {
    const workspace = workspaces.get(workspaceId);

    if (workspace === undefined) continue;
    const key = taskKey(workspace.name, number);

    if (targets.has(key)) shared.add(key);
    const place = { workspace: workspace.slug ?? "", repository: null };
    targets.set(key, encodeMention({ kind: MENTION_KIND.TASK, taskId }, place));
  }

  for (const key of shared) targets.delete(key);

  return targets.size === 0 ? NO_KEY_TARGETS : targets;
}

/** Keys handed to the readers, and the numbers and workspaces they were spelled from. */
interface HeldKeyTargets {
  readonly numbers: ReadonlyMap<string, TaskNumber> | undefined;
  readonly workspaces: TasksView["workspaces"] | undefined;
  readonly targets: ReadonlyMap<string, string>;
}

/** The keys last handed to the readers. */
let heldKeyTargets: HeldKeyTargets = {
  numbers: undefined,
  workspaces: undefined,
  targets: NO_KEY_TARGETS,
};

/**
 * The keys, spelled again only when the tasks' numbers or the workspaces
 * moved, and handed on as the same object while they name the same tasks
 * by the same links, so the words drawn with them are read again only when
 * a key or its link changed.
 */
function keyTargetsFor(
  numbers: ReadonlyMap<string, TaskNumber>,
  workspaces: TasksView["workspaces"],
): ReadonlyMap<string, string> {
  if (heldKeyTargets.numbers === numbers && heldKeyTargets.workspaces === workspaces) {
    return heldKeyTargets.targets;
  }

  const next = keyTargetsOf(numbers, workspaces);
  const targets = sameTargets(heldKeyTargets.targets, next) ? heldKeyTargets.targets : next;
  heldKeyTargets = { numbers, workspaces, targets };

  return targets;
}

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
  const numbers = useDerived(taskNumbersOf(useTaskListCollections().tasks));
  const workspaces = useAppStateSlice(selectWorkspaces) ?? NO_WORKSPACES;

  return keyTargetsFor(numbers, workspaces);
}

/**
 * The status of the task `taskId` names, as the window's task list holds it,
 * which a chip or a row naming the task wears as its mark (`PlanGlyph`);
 * none for a task the window does not list, or none asked for.
 */
export function useTaskStatus(taskId: string | undefined): TaskStatus | undefined {
  return useTaskListRow(useTaskListCollections().tasks, taskId)?.status;
}

/** The face of the Manager the window lists by `agentId`, which a chip naming it wears (`@repo/features/manager-face`); none for a coder, and where it lists no such agent. */
export function useAgentFace(agentId: string): ManagerFace | undefined {
  return useTaskListRow(useTaskListCollections().agents, agentId)?.face;
}

/** The status of the agent the window lists by `agentId`; none where it lists no such agent. */
export function useAgentStatus(agentId: string): AgentStatus | undefined {
  return useTaskListRow(useTaskListCollections().agents, agentId)?.status;
}

/**
 * The names the window holds, the automation `automationId` names among them
 * where the directory around the caller lists it. Outside a member directory
 * and with no automation asked for, every caller is handed the one shared
 * value, which stays the same object until a name, the Inbox, or the pages move; with
 * the catalog read, every caller shares the one map of agents' names it named.
 */
export function useKnownNames(automationId?: string): KnownNames {
  const collections = useTaskListCollections();
  const tasks = useDerived(taskNamesOf(collections.tasks));
  const listed = useDerived(agentNamesOf(collections.agents));
  const place = useQuery({ ...appStateQuery, select: selectPlaceNames }).data ?? NO_PLACE_NAMES;
  const held = heldNamesOf(tasks, listed, place);
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
