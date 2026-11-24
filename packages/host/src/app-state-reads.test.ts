import { INBOX_SCOPE_KIND } from "@repo/features/agent-view";
import { AGENT_KIND } from "@repo/features/agent-wire";
import { holderName } from "@repo/features/inbox-list-model";
import { INBOX_STATUS, INBOX_WIRE_VERSION, type InboxItem } from "@repo/features/inbox-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import { MANAGER_FACE_CHARACTER, MANAGER_FACE_COLOR } from "@repo/features/manager-face";
import { listedAgentOf, taskSummaryOf } from "@repo/features/task-list-live";
import { TASKS_READ } from "@repo/features/tasks-view";
import { Context } from "effect";
import { describe, expect, it } from "vitest";
import type { AppStateSnapshot } from "./app-state.js";
import {
  answerKeeper,
  INBOX_FEED,
  inboxGroupsIn,
  selectInboxFeed,
  selectInboxHoldings,
  shareAppState,
} from "./app-state-reads.js";
import { AppStateStore, initialAppState } from "./client/app-state-store.js";
import { runModeFor } from "./run-mode.js";
import { agentListRow, planListRow } from "./testing/task-list-rows.js";

describe("shareAppState", () => {
  it("answers a reader's changed slice with the document's own nodes, not copies of them", () => {
    const kept = { id: "kept", title: "Kept" };
    const moved = { id: "moved", title: "Before" };
    const held = { tasks: [kept, moved] };
    const document = { tasks: [kept, { id: "moved", title: "After" }] };

    const shared = shareAppState(held, document);

    expect(shared).toBe(document);
    expect(shared.tasks).toBe(document.tasks);
  });

  it("keeps the held parts a fresh write left equal, and takes the parts it changed", () => {
    const kept = { id: "kept", title: "Kept" };
    const held = { tasks: [kept, { id: "moved", title: "Before" }] };
    const changed = { id: "moved", title: "After" };
    const write = { tasks: [{ id: "kept", title: "Kept" }, changed] };

    const shared = shareAppState(held, write);

    expect(shared).toEqual(write);
    expect(shared.tasks[0]).toBe(kept);
    expect(shared.tasks[1]).toBe(changed);
  });

  it("answers a list a row joined at its head with the document's own rows, not each row laid over its neighbor", () => {
    const by = { userId: "user-ada", name: "Ada" };
    const first = { id: "first", title: "First", sentBy: { ...by }, files: [] };
    const second = { id: "second", title: "Second", sentBy: { ...by }, files: [] };
    const joined = { id: "joined", title: "Joined", sentBy: { ...by }, files: [] };
    const document = { threads: [joined, first, second] };

    const shared = shareAppState({ threads: [first, second] }, document);

    expect(shared).toBe(document);
  });

  it("keeps a held row whose id repeats an earlier row's while another row changes", () => {
    const repeated = { id: "a", value: 2 };
    const held = [{ id: "a", value: 1 }, repeated, { id: "b" }];

    const shared = shareAppState(held, [{ id: "a", value: 1 }, { id: "a", value: 2 }, { id: "c" }]);

    expect(shared[1]).toBe(repeated);
  });
});

describe("answerKeeper", () => {
  it("answers the last answer again while a new one equals it, and the new one once it moves", () => {
    const keep = answerKeeper<{ readonly rows: readonly { readonly id: string }[] }>();
    const first = keep({ rows: [{ id: "a" }, { id: "b" }] });
    const same = keep({ rows: [{ id: "a" }, { id: "b" }] });
    const moved = keep({ rows: [{ id: "a" }, { id: "c" }] });

    expect(same).toBe(first);
    expect(moved.rows.map(({ id }) => id)).toEqual(["a", "c"]);
    expect(moved.rows[0]).toBe(first.rows[0]);
  });
});

describe("selectInboxHoldings", () => {
  const RUN = {
    launch: { captureOutput: undefined, profile: "idle", captureMode: false, fixtureMode: false },
    runMode: runModeFor({ capture: false, fixture: false }),
    appVersion: "1.2.3",
    packaged: true,
    platform: "ios",
  } as const;

  /** An open thread posted once and last changed at `updatedAt`. */
  const thread = (id: string, updatedAt: number): InboxItem => ({
    id,
    agentId: "agent-1",
    key: id,
    revision: 1,
    version: INBOX_WIRE_VERSION,
    title: id,
    needsReply: false,
    status: INBOX_STATUS.OPEN,
    postedAt: 1,
    updatedAt,
  });

  /** A launch's document with the feed's rows by task, whether they're the phone's kept ones, the tasks the account's read named, and the tasks kept beside the rows. */
  const documentWith = (
    byTask: Readonly<Record<string, readonly InboxItem[]>>,
    kept: boolean,
    named: readonly { readonly taskId: string }[],
    keptHolders: readonly string[] = [],
  ): AppStateSnapshot => {
    const launched = new AppStateStore(initialAppState(RUN, true, []), Context.empty()).snapshot();

    return {
      ...launched,
      window: { fullScreen: false },
      [LIVE_READ.INBOX_ITEMS]: {
        rows: { [INBOX_SCOPE_KIND.TASK]: byTask },
        ...(kept ? { kept: true } : undefined),
        ...(keptHolders.length === 0
          ? undefined
          : {
              keptHolders: keptHolders.map((id) => taskSummaryOf(planListRow(id, id), undefined)),
            }),
      },
      inbox: {
        ...launched.inbox,
        tasks: named.map(({ taskId }) => ({ taskId, items: 1, updatedAt: 1 })),
      },
    };
  };

  const byTask = {
    older: [thread("a", 100)],
    newer: [thread("b", 50), thread("c", 300)],
  };

  const taskIdsOf = (document: AppStateSnapshot) =>
    selectInboxHoldings(document).tasks.map(({ taskId }) => taskId);

  it("holds the kept rows' own tasks, the latest changed first, until the account's read names its tasks", () => {
    expect(taskIdsOf(documentWith(byTask, true, []))).toEqual(["newer", "older"]);
    expect(taskIdsOf(documentWith(byTask, true, [{ taskId: "older" }]))).toEqual(["older"]);
    expect(taskIdsOf(documentWith(byTask, false, []))).toEqual([]);
  });

  it("reads the feed's rows as still on their first read while the task list they're grouped under is read or drawn", () => {
    const listing = (listStatus: AppStateSnapshot["tasks"]["listStatus"]) => {
      const document = documentWith(byTask, true, []);

      return selectInboxFeed({ ...document, tasks: { ...document.tasks, listStatus } });
    };

    expect(listing(TASKS_READ.READING)).toBe(INBOX_FEED.READING);
    expect(listing(TASKS_READ.READY)).toBe(INBOX_FEED.ANSWERED);
  });

  /** `document` with its task list standing as `listStatus` says. */
  const withList = (
    document: AppStateSnapshot,
    listStatus: AppStateSnapshot["tasks"]["listStatus"],
  ): AppStateSnapshot => ({ ...document, tasks: { ...document.tasks, listStatus } });

  /** The tasks the Inbox groups `document`'s rows under, with none of the task list's own drawn. */
  const groupedUnder = (document: AppStateSnapshot) =>
    inboxGroupsIn(selectInboxHoldings(document), [], undefined, []).map(({ holder }) =>
      "task" in holder ? holder.task.id : holder.agent.id,
    );

  it("groups the kept rows under the tasks kept beside them while the task list is read, and under the list's own once it is drawn", () => {
    const kept = documentWith(byTask, true, [], ["older", "newer"]);

    expect(groupedUnder(withList(kept, TASKS_READ.READING))).toEqual(["newer", "older"]);
    expect(groupedUnder(withList(kept, TASKS_READ.READY))).toEqual([]);
  });

  it("reads the kept rows as answered while the task list is read only where the tasks kept beside them hold every one they stand on", () => {
    const feedOf = (keptHolders: readonly string[]) =>
      selectInboxFeed(withList(documentWith(byTask, true, [], keptHolders), TASKS_READ.READING));

    expect(feedOf(["older", "newer"])).toBe(INBOX_FEED.ANSWERED);
    expect(feedOf(["older"])).toBe(INBOX_FEED.READING);
  });

  it("groups a Manager's threads, which stand on no task, under the Manager as the list names it, in its workspace alone", () => {
    const manager = listedAgentOf(
      {
        ...agentListRow("", 1),
        taskId: null,
        kind: AGENT_KIND.MANAGER,
        title: "Release manager",
        face: { character: MANAGER_FACE_CHARACTER.PLANET, color: MANAGER_FACE_COLOR.BLUE },
      },
      true,
      undefined,
    );

    const launched = documentWith(byTask, false, [{ taskId: "older" }]);

    const document: AppStateSnapshot = {
      ...launched,
      [LIVE_READ.INBOX_ITEMS]: {
        rows: {
          [INBOX_SCOPE_KIND.TASK]: byTask,
          agents: { [manager.id]: [thread("cut-the-release", 400)] },
        },
      },
    };

    const older = taskSummaryOf(planListRow("older", "Older"), undefined);

    const grouped = (workspaceId: string | undefined) =>
      inboxGroupsIn(selectInboxHoldings(document), [older], workspaceId, [manager]).map(
        ({ holder, items }) => [holderName(holder), items.map(({ id }) => id)],
      );

    expect(grouped(undefined)).toEqual([
      ["Older", ["a"]],
      ["Release manager", ["cut-the-release"]],
    ]);
    expect(grouped(manager.workspaceId)).toContainEqual(["Release manager", ["cut-the-release"]]);
    expect(grouped("another-workspace")).toEqual([]);
  });
});
