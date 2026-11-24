/**
 * task-list-following.ts -- a client's task list, its tasks, agents, and pull requests, as TanStack DB collections, fed by the host's deliveries to the client's follow of its document.
 *
 * A screen that reads the task list off the document derives again from
 * every row whenever any row moves. These collections hold the same rows
 * keyed by id, so a live query or a lookup (`.get(key)`) is told only the
 * rows that moved. Each delivery of the document carries the rows a drawing
 * moved beside the document rather than in it (`AppStateDelivery`'s
 * `taskList`), and a client hands each to `deliver` as it is heard; its whole
 * read of the document, and a fixture run's synthetic list, are laid
 * through `write`. Both clients stand on it: the panel (`@repo/panel`'s
 * `use-app-state.ts`) and the iOS app (`apps/mobile`'s `app-state-query.ts`),
 * each with its own React hooks over these collections, since the two draw
 * on different Reacts.
 *
 * A delivery names the task list's rows that moved by part, so it is laid in as
 * those rows alone, never by walking a list: each row it carries is written
 * where it says something new, and a row its ids leave out is deleted. A
 * whole read, a fixture run's list, and a delivery carrying the lists whole are
 * laid as the whole list they are, writing each row that is not the one
 * held.
 *
 * Moved rows were worked out from the document the bridge last sent, which
 * a client may never have held whole: the desktop's stream sends its first
 * whole, but a page running the host in process hears from the moment it
 * subscribes. So one heard before any whole list is laid
 * waits for one, and is laid over it then; laying moved rows over a list as
 * new as the document they were worked out from or newer still lands on
 * the document they moved to, and one older than the list held is passed
 * over.
 *
 * Each collection's sync is a custom one, as TanStack DB's Collection Options
 * Creator guide writes it: it listens before it reads, takes the rows its
 * part holds as its snapshot and marks itself ready once the first list is
 * laid, then writes each later change in one `begin()`/`write()`/`commit()`.
 */

import type { ListedAgent } from "@repo/features/agent-wire";
import type { ListedPullRequest, TaskPullRequests, TaskSummary } from "@repo/features/task-wire";
import type { TaskListParts } from "@repo/features/tasks-view";
import { keepIdentity } from "@repo/wire";
import { type Collection, type CollectionConfig, createCollection } from "@tanstack/db";
import type { TaskListDelivery, TaskListPartMoved } from "./app-state.js";

/** One row a change writes, and whether the part held it before. */
interface RowWritten<Row> {
  readonly row: Row;
  readonly held: boolean;
}

/** What one list or delivery moved in a part: the rows written and the rows gone. */
interface PartChange<Row> {
  readonly written: readonly RowWritten<Row>[];
  readonly gone: readonly Row[];
}

/** What a part's feed tells a collection's sync. */
const FEED_TOLD = {
  CHANGE: "change",
  TROUBLE: "trouble",
  HEALTHY: "healthy",
} as const;

type FeedTold<Row> =
  | { readonly kind: typeof FEED_TOLD.CHANGE; readonly change: PartChange<Row> }
  | { readonly kind: typeof FEED_TOLD.TROUBLE; readonly cause: unknown }
  | { readonly kind: typeof FEED_TOLD.HEALTHY };

/** One part of the task list: the collection's id, the field of the view its rows stand under, and the field its rows are keyed by. */
interface TaskListPart<Row extends object> {
  readonly id: string;
  readonly field: "tasks" | "taskAgents" | "taskPullRequests" | "agentPullRequests";
  readonly keyOf: (row: Row) => string;
}

/** A part's rows as the feed holds them, and every collection listening for what moves in them. */
interface PartFeed<Row extends object> {
  /** The rows held, by key; none before a first list is laid. */
  readonly held: () => ReadonlyMap<string, Row> | undefined;
  readonly listen: (hear: (told: FeedTold<Row>) => void) => () => void;
  /** Lays `rows` as the part's whole list. */
  readonly lay: (rows: readonly Row[]) => void;
  /** Lays the rows that moved, and where `ids` is named, lets go every row it leaves out. */
  readonly move: (rows: readonly Row[], ids: readonly string[] | undefined) => void;
  readonly trouble: (cause: unknown) => void;
  /** Says a later list or delivery was taken, clearing any trouble said before it. */
  readonly heal: () => void;
}

const TASKS_PART: TaskListPart<TaskSummary> = {
  id: "task-list-tasks",
  field: "tasks",
  keyOf: (task) => task.id,
};

const AGENTS_PART: TaskListPart<ListedAgent> = {
  id: "task-list-agents",
  field: "taskAgents",
  keyOf: (agent) => agent.id,
};

const TASK_PULL_REQUESTS_PART: TaskListPart<TaskPullRequests> = {
  id: "task-list-task-pull-requests",
  field: "taskPullRequests",
  keyOf: (listed) => listed.taskId,
};

const AGENT_PULL_REQUESTS_PART: TaskListPart<ListedPullRequest> = {
  id: "task-list-agent-pull-requests",
  field: "agentPullRequests",
  keyOf: (listed) => listed.agentId,
};

/** A part's feed, holding its rows as each list and delivery leaves them. */
function partFeed<Row extends object>(part: TaskListPart<Row>): PartFeed<Row> {
  let held: Map<string, Row> | undefined;
  let troubled = false;
  const listeners = new Set<(told: FeedTold<Row>) => void>();

  const tell = (told: FeedTold<Row>): void => {
    for (const hear of listeners) hear(told);
  };

  // Note that a row is kept against the one held, because a delivery crossed as text, so one that says nothing new is the very row held and written nowhere.
  const written = (rows: Map<string, Row>, laid: readonly Row[]): RowWritten<Row>[] =>
    laid.flatMap((row) => {
      const was = rows.get(part.keyOf(row));
      const kept = was === undefined ? row : keepIdentity(was, row);

      if (kept === was) return [];
      rows.set(part.keyOf(row), kept);

      return [{ row: kept, held: was !== undefined }];
    });

  const changed = (change: PartChange<Row>, first: boolean): void => {
    if (!first && change.written.length === 0 && change.gone.length === 0) return;
    tell({ kind: FEED_TOLD.CHANGE, change });
  };

  return {
    held: () => held,
    listen: (hear) => {
      listeners.add(hear);

      return () => {
        listeners.delete(hear);
      };
    },
    lay: (laid) => {
      const first = held === undefined;
      const rows = held ?? new Map<string, Row>();
      const next = new Set(laid.map(part.keyOf));
      const gone = [...rows].filter(([key]) => !next.has(key));

      for (const [key] of gone) rows.delete(key);
      held = rows;
      changed({ written: written(rows, laid), gone: gone.map(([, row]) => row) }, first);
    },
    move: (moved, ids) => {
      const first = held === undefined;
      const rows = held ?? new Map<string, Row>();
      const kept = ids === undefined ? undefined : new Set(ids);
      const gone = kept === undefined ? [] : [...rows].filter(([key]) => !kept.has(key));

      for (const [key] of gone) rows.delete(key);
      held = rows;
      changed({ written: written(rows, moved), gone: gone.map(([, row]) => row) }, first);
    },
    trouble: (cause) => {
      troubled = true;
      tell({ kind: FEED_TOLD.TROUBLE, cause });
    },
    heal: () => {
      if (!troubled) return;
      troubled = false;
      tell({ kind: FEED_TOLD.HEALTHY });
    },
  };
}

/**
 * A collection holding one part of the task list, synced from `feed`. It is
 * never collected while the client stands (`gcTime: Infinity`), since the
 * follow feeds it for the client's life and a resync would write every row
 * again.
 */
function partCollectionOptions<Row extends object>(
  part: TaskListPart<Row>,
  feed: PartFeed<Row>,
): CollectionConfig<Row, string> {
  return {
    id: part.id,
    getKey: part.keyOf,
    startSync: true,
    gcTime: Infinity,
    sync: {
      rowUpdateMode: "full",
      sync: ({ begin, write, commit, markReady, reportError, reportHealthy }) => {
        let ready = false;
        let troubled = false;

        const seed = (rows: ReadonlyMap<string, Row>): void => {
          ready = true;
          begin();

          for (const row of rows.values()) write({ type: "insert", value: row });
          commit();
          markReady();
        };

        const take = (change: PartChange<Row>): void => {
          begin();

          for (const { row, held } of change.written) {
            write({ type: held ? "update" : "insert", value: row });
          }

          for (const row of change.gone) write({ type: "delete", value: row });
          commit();
        };

        // Note that the feed is listened to before its rows are read, as the guide orders it, so nothing laid between is missed.
        const stop = feed.listen((told) => {
          if (told.kind === FEED_TOLD.CHANGE) {
            const held = feed.held();

            if (ready) take(told.change);
            else if (held !== undefined) seed(held);

            return;
          }

          if (told.kind === FEED_TOLD.HEALTHY) {
            if (troubled) reportHealthy();
            troubled = false;

            return;
          }

          // Note that trouble before the first snapshot is not reported, since the follow asks again on the next delivery, and reporting throws before `markReady`.
          if (!ready) return;
          troubled = true;
          reportError(told.cause);
        });

        const held = feed.held();

        if (held !== undefined) seed(held);

        return stop;
      },
    },
  };
}

/** The archived agents a follow keeps back from the agents' collection while a client draws its first screens, and the doors that write them. */
interface AgentsDeferral {
  /** Lays `rows` as the agents' whole list, keeping back the archived ones still deferred. */
  readonly lay: (rows: readonly ListedAgent[]) => void;
  /** Lays the agents that moved, keeping back the archived ones still deferred, and lets go every agent `ids` leaves out. */
  readonly move: (rows: readonly ListedAgent[], ids: readonly string[] | undefined) => void;
  readonly keep: (ids: Iterable<string>) => void;
  readonly write: (count: number) => number;
  readonly flush: () => void;
}

/**
 * The archived agents on a task kept back from `feed` until the client
 * writes them (`write`, a few at a time, or `flush`, the rest at once), and
 * the agents `keep` names written at once. An agent on no task, a Manager,
 * is never kept back, and once the backlog is written, every agent passes
 * straight through. Note that an agent kept back is kept as it last moved:
 * archived after the list was laid, it leaves the collection for the
 * backlog; brought back, it leaves the backlog for the collection; gone, it
 * leaves both.
 */
function agentsDeferral(feed: PartFeed<ListedAgent>): AgentsDeferral {
  let deferring = true;
  const deferred = new Map<string, ListedAgent>();
  const kept = new Set<string>();

  const passes = (agent: ListedAgent): boolean =>
    !deferring || agent.archivedAt === undefined || agent.taskId === null || kept.has(agent.id);

  // Writes `rows` into the collection as moved rows, ending the deferral once the backlog is empty.
  const writeOut = (rows: readonly ListedAgent[]): void => {
    for (const agent of rows) deferred.delete(agent.id);

    if (deferred.size === 0) deferring = false;

    if (rows.length > 0) feed.move(rows, undefined);
  };

  return {
    lay: (rows) => {
      if (!deferring) {
        feed.lay(rows);

        return;
      }

      deferred.clear();
      const passed = rows.filter((agent) => passes(agent) || !deferred.set(agent.id, agent));
      feed.lay(passed);
    },
    move: (rows, ids) => {
      if (!deferring) {
        feed.move(rows, ids);

        return;
      }

      const newlyDeferred = new Set<string>();
      const passed: ListedAgent[] = [];

      for (const agent of rows) {
        if (passes(agent)) {
          deferred.delete(agent.id);
          passed.push(agent);
        } else {
          deferred.set(agent.id, agent);
          newlyDeferred.add(agent.id);
        }
      }

      const named = ids === undefined ? undefined : new Set(ids);

      if (named !== undefined)
        for (const key of deferred.keys()) if (!named.has(key)) deferred.delete(key);

      // Note that an agent the move archived leaves the collection as it joins the backlog, so the ids the feed is told leave it out.
      const held = feed.held();

      const told =
        ids !== undefined
          ? ids.filter((id) => !deferred.has(id))
          : newlyDeferred.size > 0 && held !== undefined
            ? [...held.keys(), ...passed.map((agent) => agent.id)].filter(
                (id) => !newlyDeferred.has(id),
              )
            : undefined;

      feed.move(passed, told);
    },
    keep: (ids) => {
      const named: ListedAgent[] = [];

      for (const id of ids) {
        kept.add(id);
        const agent = deferred.get(id);

        if (agent !== undefined) named.push(agent);
      }

      if (named.length > 0) writeOut(named);
    },
    write: (count) => {
      if (deferring) writeOut([...deferred.values()].slice(0, count));

      return deferred.size;
    },
    flush: () => {
      if (deferring) writeOut([...deferred.values()]);
    },
  };
}

/** The task list's collections, one per part, each keyed by its rows' id. */
export interface TaskListCollections {
  /** The account's tasks, by task id. */
  readonly tasks: Collection<TaskSummary, string>;
  /** Every agent on a task, the archived among them, by agent id. */
  readonly agents: Collection<ListedAgent, string>;
  /** The pull requests of every task that has one, by task id. */
  readonly taskPullRequests: Collection<TaskPullRequests, string>;
  /** The pull request of every agent that opened one, by agent id. */
  readonly agentPullRequests: Collection<ListedPullRequest, string>;
}

/** A client's collections and the feed its follow writes them through. */
export interface TaskListFollowing {
  readonly collections: TaskListCollections;
  /** Lays a whole task list, a whole read's or a fixture run's, under its version. */
  readonly write: (version: number, lists: TaskListParts) => void;
  /** Lays the task list's rows one delivery carries (`AppStateDelivery`'s `taskList`): its lists whole, or the rows it moved, under its version. */
  readonly deliver: (delivery: TaskListDelivery) => void;
  /** Says a document could not be written; the rows held stay, and the next write clears it. */
  readonly trouble: (cause: unknown) => void;
  /**
   * Writes up to `count` of the archived agents kept back
   * (`deferArchivedAgents`) into the agents' collection in one commit, and
   * answers how many still wait; none where nothing is kept back.
   */
  readonly writeDeferredAgents: (count: number) => number;
  /** Writes every archived agent still kept back at once, and keeps none back from then on. */
  readonly flushDeferredAgents: () => void;
  /** Writes at once the kept-back agents `ids` names, and keeps none of them back from then on, as the Inbox names those its threads stand on. */
  readonly keepAgents: (ids: Iterable<string>) => void;
  /** Stops every collection's sync. */
  readonly stop: () => void;
}

/** How a client follows its task list. */
export interface TaskListFollowingOptions {
  /**
   * Whether the archived agents on a task are kept back from the agents'
   * collection until the client writes them (`writeDeferredAgents`,
   * `flushDeferredAgents`), so a launch's first screens, none of which list
   * an archived agent, are drawn without writing an account's thousands of
   * them. Off where none is given.
   */
  readonly deferArchivedAgents?: boolean;
}

/** The collections of one client's task list, syncing from the moment they are made, and the feed its follow writes them through. */
export function taskListFollowing(options: TaskListFollowingOptions = {}): TaskListFollowing {
  let version = -1;
  let laid = false;
  /** The moved rows heard before any whole list was laid, in order. */
  let early: TaskListDelivery[] = [];

  const feeds = {
    tasks: partFeed(TASKS_PART),
    taskAgents: partFeed(AGENTS_PART),
    taskPullRequests: partFeed(TASK_PULL_REQUESTS_PART),
    agentPullRequests: partFeed(AGENT_PULL_REQUESTS_PART),
  };

  const deferral =
    options.deferArchivedAgents === true ? agentsDeferral(feeds.taskAgents) : undefined;

  const agentsFeed = deferral ?? feeds.taskAgents;

  const collections: TaskListCollections = {
    tasks: createCollection(partCollectionOptions(TASKS_PART, feeds.tasks)),
    agents: createCollection(partCollectionOptions(AGENTS_PART, feeds.taskAgents)),
    taskPullRequests: createCollection(
      partCollectionOptions(TASK_PULL_REQUESTS_PART, feeds.taskPullRequests),
    ),
    agentPullRequests: createCollection(
      partCollectionOptions(AGENT_PULL_REQUESTS_PART, feeds.agentPullRequests),
    ),
  };

  // Note that a list or delivery taken clears any trouble said before it, whatever part it moved.
  const current = (at: number): boolean => {
    if (at < version) return false;
    version = at;

    for (const feed of Object.values(feeds)) feed.heal();

    return true;
  };

  const lay = (view: TaskListParts): void => {
    laid = true;
    feeds.tasks.lay(view.tasks);
    agentsFeed.lay(view.taskAgents ?? []);
    feeds.taskPullRequests.lay(view.taskPullRequests ?? []);
    feeds.agentPullRequests.lay(view.agentPullRequests ?? []);
  };

  // Lays one moved part of the task list into the feed of the part it names.
  const moveIn = (move: TaskListPartMoved): void => {
    const field = move.key[0];

    if (field === undefined || !Object.hasOwn(feeds, field)) return;

    // SAFETY: `field` is an own key of `feeds`, checked above, and a part's rows cross as the rows of its own field (`HOST_READ_SLICE`'s `tasks`), so the feed takes them as its own.
    const feed = (
      field === AGENTS_PART.field ? agentsFeed : feeds[field as keyof typeof feeds]
    ) as Pick<PartFeed<object>, "lay" | "move">;

    if ("value" in move) {
      // SAFETY: a part's key crossing whole carries its list of rows, or null where the part is gone (`HOST_READ_SLICE`'s `tasks`).
      feed.lay((move.value ?? []) as readonly object[]);
    } else feed.move(move.rows, move.ids);
  };

  const take = (delivery: TaskListDelivery): void => {
    if (!current(delivery.version)) return;

    if (delivery.whole !== undefined) lay(delivery.whole);
    else for (const move of delivery.moved ?? []) moveIn(move);
  };

  // Lays the moved rows heard before the first whole list, now one is laid.
  const takeEarly = (): void => {
    const waiting = early;
    early = [];

    for (const delivery of waiting) take(delivery);
  };

  return {
    collections,
    write: (at, lists) => {
      if (!current(at)) return;
      lay(lists);
      takeEarly();
    },
    deliver: (delivery) => {
      if (!laid && delivery.whole === undefined) {
        early.push(delivery);

        return;
      }

      take(delivery);
      takeEarly();
    },
    trouble: (cause) => {
      for (const feed of Object.values(feeds)) feed.trouble(cause);
    },
    writeDeferredAgents: (count) => deferral?.write(count) ?? 0,
    flushDeferredAgents: () => deferral?.flush(),
    keepAgents: (ids) => deferral?.keep(ids),
    stop: () => {
      // Note that the live queries reading the collections are cleaned up with them, since the follow stops only as the window, the app, or its account goes, and `cleanup()` alone rejects while one reads a collection (`@tanstack/db` 1.0's `Collection.cleanup` documents `dependents` for this).
      for (const collection of Object.values(collections))
        void collection.cleanup({ dependents: true });
    },
  };
}
