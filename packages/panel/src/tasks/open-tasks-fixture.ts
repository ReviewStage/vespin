/**
 * open-tasks-fixture.ts -- the tasks the tasks-open profile lists, each opened from the sidebar as a signed-in account's task opens: a long description, several agents, and a long transcript each.
 *
 * Every other fixture profile binds its own task for good, so a press on a
 * sidebar row opens nothing, and nothing times what opening a real task
 * costs the window. This profile signs in the Inbox fixture's account
 * (`@repo/host/fixture-inbox`) and lists beside its tasks a run of tasks
 * as big as a busy account's: each a description of some twenty sections
 * with lists, code, and tables, three agents, and each agent's transcript
 * forty turns of calls and words. The first task stands open at the start. A select opens the task it names, as main
 * binds one, by moving the task the list holds open and staging the
 * window's document again (`fixture-moves.ts`), and a close leaves it.
 * Every name, path, and line here is invented.
 */

import {
  AGENT_RUNTIME,
  AGENT_STATUS,
  type AgentTranscriptMessage,
  type ListedAgent,
} from "@repo/features/agent-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import { TASK_PRIORITY, TASK_STATUS, type Task, type TaskSummary } from "@repo/features/task-wire";
import type { ListedTasksView, TasksView } from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import {
  type AppStateSnapshot,
  type AppTranscript,
  OWN_TRANSCRIPT,
  RUN_PROFILE,
} from "@repo/host/app-state";
import type { PortActKind, PortActPayload, PortActResult } from "@repo/host/contract";
import { FIXTURE_IDS } from "@repo/host/fixture-stage";
import { MESSAGE_ROLE, type WireRecord } from "@repo/wire";
import { fixtureMoved } from "./fixture-moves.js";

/** How big each task is. */
const OPEN_TASKS = {
  /** The tasks listed beside the Inbox fixture's. */
  TASKS: 24,
  /** The sections of each description, each a heading and its words. */
  SECTIONS: 20,
  /** The agents on each task. */
  AGENTS: 3,
  /** The turns of each agent's transcript, each a line in and a journal out. */
  TURNS: 40,
  /** The calls each journal makes before its words. */
  CALLS_PER_TURN: 6,
} as const;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** When the tasks were last moved, counted back from the moment the chunk landed, as the Inbox fixture counts. */
const LANDED = Date.now();

/** The account signed in, as the Inbox fixture signs it in. */
const ADA = { userId: "user-ada", name: "Ada Lovelace" } as const;

const MODEL = "anthropic/claude-opus-5.5";

const REPOSITORY = "ada/relay";

/** What each task is about, the first words of its name. */
const SUBJECTS = [
  "Invite links",
  "Billing export",
  "Search ranking",
  "Audit log",
  "Webhook retries",
  "Usage dashboard",
  "Session expiry",
  "Rate limits",
  "Email digest",
  "Import from CSV",
  "Role permissions",
  "Theme tokens",
] as const;

/** The subject at `index`, wrapping round the list. */
function subjectAt(index: number): string {
  return SUBJECTS[index % SUBJECTS.length] ?? SUBJECTS[0];
}

/** What a task asks of its subject, the rest of its name. */
const ASKS = ["redesign", "speed up", "harden"] as const;

/** A stable id from a kind's number and an index, as the fixture's ids are spelled. */
function fixtureUuid(kind: number, index: number): string {
  const tail = (kind * 10_000 + index).toString(16).padStart(12, "0");

  return `0a0b0c0d-1e2f-4a3b-8c4d-${tail}`;
}

/** The task at `index`'s id. */
function taskIdAt(index: number): string {
  return fixtureUuid(1, index);
}

/** The agent at `at` of the task at `index`'s id. */
function agentIdAt(index: number, at: number): string {
  return fixtureUuid(2, index * OPEN_TASKS.AGENTS + at);
}

/** The task at `index`'s name. */
function taskNameAt(index: number): string {
  return `${subjectAt(index)}: ${ASKS[Math.floor(index / SUBJECTS.length) % ASKS.length]}`;
}

/** One section of a description: a heading, words, a list, and now and then code or a table. */
function descriptionSection(index: number, section: number): string {
  const subject = subjectAt(index + section);

  const words = [
    `## ${section + 1}. ${subject} ${section % 2 === 0 ? "decisions" : "open questions"}`,
    "",
    `The ${subject.toLowerCase()} work stands on what the last review settled: the reads stay on the service, the window draws what it holds, and nothing waits on a second round trip. [@invite.ts](https://github.com/${REPOSITORY}/blob/HEAD/src/members/invite.ts) holds the first half of it, and the rest follows the same shape so a reader meets one pattern twice rather than two patterns once.`,
    "",
    `- Keep the ${subject.toLowerCase()} rows in one table, keyed by workspace, so a delete takes them with it.`,
    "- Read the newest page first and the rest on scroll, never the whole history at once.",
    `- Say in the row what moved last, with **who** and *when*, as the sidebar does.`,
    "- Leave the old column in place until every client reads the new one.",
  ];

  if (section % 3 === 0) {
    words.push(
      "",
      "```ts",
      `export function ${subject.replace(/[^A-Za-z]/g, "").toLowerCase()}Rows(workspaceId: string, page: number): Promise<readonly Row[]> {`,
      "  return db.select().from(rows).where(eq(rows.workspaceId, workspaceId)).limit(50).offset(page * 50);",
      "}",
      "```",
    );
  }

  if (section % 4 === 1) {
    words.push(
      "",
      "| Step | Owner | State |",
      "| --- | --- | --- |",
      "| Schema | Ada | Done |",
      "| Reads | Grace | In review |",
      "| Window | Alan | To do |",
    );
  }

  return words.join("\n");
}

/** The task at `index`'s description. */
function descriptionAt(index: number): string {
  const sections = Array.from({ length: OPEN_TASKS.SECTIONS }, (_, section) =>
    descriptionSection(index, section),
  );

  return `${sections.join("\n\n")}\n`;
}

/** The task at `index` as the list carries its row. */
function taskRowAt(index: number): TaskSummary {
  return {
    id: taskIdAt(index),
    workspaceId: FIXTURE_IDS.WORKSPACE,
    name: taskNameAt(index),
    createdAt: LANDED - (index + 2) * 6 * HOUR,
    updatedAt: LANDED - (index + 1) * 20 * MINUTE,
    repository: REPOSITORY,
    priority: TASK_PRIORITY.MEDIUM,
    status: index % 5 === 0 ? TASK_STATUS.TODO : TASK_STATUS.IN_PROGRESS,
    number: 200 + index,
    ownerId: ADA.userId,
    createdBy: ADA,
    assignee: ADA,
    blockedBy: [],
    blocks: [],
    agents: {
      total: OPEN_TASKS.AGENTS,
      working: 1,
      activityAt: LANDED - (index + 1) * 20 * MINUTE,
      pullRequestTotal: 0,
    },
  };
}

/** The agent at `at` of the task at `index`, as the list follows it: the first still at work, the rest done. */
function agentAt(index: number, at: number): ListedAgent {
  const startedAt = LANDED - (index + 1) * HOUR - at * 10 * MINUTE;
  const running = at === 0;

  return {
    id: agentIdAt(index, at),
    taskId: taskIdAt(index),
    model: MODEL,
    effort: "high",
    title: `${taskNameAt(index)} (${at + 1})`,
    createdAt: startedAt,
    status: running ? AGENT_STATUS.RUNNING : AGENT_STATUS.COMPLETED,
    turnId: null,
    runStartedAt: startedAt,
    startedBy: ADA,
    runtime: AGENT_RUNTIME.CLAUDE_CODE,
    workspaceId: FIXTURE_IDS.WORKSPACE,
    repository: REPOSITORY,
    ...(running ? undefined : { settledAt: startedAt + 2 * HOUR }),
  };
}

/** A tool's call as the transcript stores it, answered. */
function toolPart(tool: string, callId: string, input: WireRecord, output: WireRecord): WireRecord {
  return { type: `tool-${tool}`, toolCallId: callId, state: "output-available", input, output };
}

/** One of a journal's calls: a read, a command, or an edit. */
function call(agentId: string, turn: number, at: number): WireRecord {
  const id = `${agentId}-${turn}-${at}`;

  const path = `src/${subjectAt(turn + at)
    .replace(/[^A-Za-z]/g, "")
    .toLowerCase()}/rows.ts`;

  switch (at % 3) {
    case 0:
      return toolPart(
        "read_file",
        id,
        { filePath: path },
        { content: `export const ROWS_PER_PAGE = ${turn};\n`.repeat(30) },
      );
    case 1:
      return toolPart(
        "bash",
        id,
        { command: `pnpm test ${path}`, description: "Run the rows tests" },
        {
          stdout: Array.from({ length: 12 }, (_, line) => `✓ rows ${line} (${line + 3}ms)`).join(
            "\n",
          ),
          stderr: "",
          exitCode: 0,
        },
      );
    default:
      return toolPart(
        "edit_file",
        id,
        { filePath: path, oldString: "limit(50)", newString: "limit(ROWS_PER_PAGE)" },
        { status: "accepted" },
      );
  }
}

/** The words a journal ends on: what changed and what is next, in Markdown. */
function journalWords(turn: number): string {
  return [
    `Turn ${turn + 1} is done. The rows read **one page** at a time now, and the tests pass.`,
    "",
    "| File | Change |",
    "| --- | --- |",
    "| `src/rows.ts` | Pages by `ROWS_PER_PAGE` |",
    "| `src/rows.test.ts` | Covers the last page |",
    "",
    "Next I will move the window's read onto the same page size, so the two agree.",
  ].join("\n");
}

/** The agent `agentId`'s transcript: every turn finished but the newest, which is still under way where it runs. */
function transcriptOf(agentId: string, startedAt: number, running: boolean): AppTranscript {
  const messages = Array.from({ length: OPEN_TASKS.TURNS }, (_, turn): AgentTranscriptMessage[] => {
    const at = startedAt + turn * 3 * MINUTE;
    const newest = turn === OPEN_TASKS.TURNS - 1;

    const calls = Array.from({ length: OPEN_TASKS.CALLS_PER_TURN }, (_, each) => [
      { type: "step-start" },
      call(agentId, turn, each),
    ]).flat();

    return [
      {
        id: `${agentId}-line-${turn}`,
        role: MESSAGE_ROLE.USER,
        parts: [{ type: "text", text: `Take the next step on the rows, turn ${turn + 1}.` }],
        sentAt: at,
      },
      {
        id: `${agentId}-journal-${turn}`,
        role: MESSAGE_ROLE.ASSISTANT,
        parts: [
          { type: "step-start" },
          { type: "reasoning", text: "Read the rows first, then run the tests." },
          ...calls,
          { type: "text", text: journalWords(turn) },
        ],
        startedAt: at,
        ...(running && newest ? undefined : { finishedAt: at + 2 * MINUTE }),
      },
    ];
  }).flat();

  return {
    messages,
    cursor: `${messages.length}:0`,
    word: {
      status: running ? AGENT_STATUS.RUNNING : AGENT_STATUS.COMPLETED,
      runStartedAt: startedAt,
      title: agentId,
      caughtUp: true,
    },
    pages: 1,
  };
}

const INDEXES = Array.from({ length: OPEN_TASKS.TASKS }, (_, index) => index);

const TASK_ROWS: readonly TaskSummary[] = INDEXES.map(taskRowAt);

const AGENTS: readonly ListedAgent[] = INDEXES.flatMap((index) =>
  Array.from({ length: OPEN_TASKS.AGENTS }, (_, at) => agentAt(index, at)),
);

/** Each task's description as main holds it once read, by task. */
const DOCUMENTS: AppStateSnapshot[typeof LIVE_READ.HELD_TASK] = Object.fromEntries(
  TASK_ROWS.map((row, index): [string, { readonly rows: { readonly task: Task } }] => {
    const { agents: _agents, ...task } = row;

    return [
      row.id,
      { rows: { task: { ...task, description: { body: descriptionAt(index), assumptions: [] } } } },
    ];
  }),
);

/** Each agent's transcript as main holds it once read, by agent. */
const TRANSCRIPTS: AppStateSnapshot[typeof LIVE_READ.TRANSCRIPT] = Object.fromEntries(
  AGENTS.map((agent) => [
    agent.id,
    {
      [OWN_TRANSCRIPT]: {
        rows: transcriptOf(agent.id, agent.createdAt, agent.status === AGENT_STATUS.RUNNING),
      },
    },
  ]),
);

/** The task the list holds open, as main binds the one a select names; the first task's until another is opened. */
let opened: string | undefined = taskIdAt(0);

/** The lists staged, one object for each list handed in and task open, as a staged list must be. */
const STAGED_LISTS = new WeakMap<ListedTasksView, Map<string | undefined, ListedTasksView>>();

/** Whether the profile opens the task a select names, as a signed-in account's window does; every other profile binds its own. */
export function opensTasks(profile: string): boolean {
  return profile === RUN_PROFILE.TASKS_OPEN;
}

/** The list with the profile's tasks and agents laid beside its own and the task opened last open; the list handed in under any other profile. */
export function openTasksView(profile: string, list: ListedTasksView): ListedTasksView {
  if (!opensTasks(profile)) return list;
  let byOpen = STAGED_LISTS.get(list);

  if (byOpen === undefined) {
    byOpen = new Map();
    STAGED_LISTS.set(list, byOpen);
  }

  const kept = byOpen.get(opened);

  if (kept !== undefined) return kept;
  const { activeTaskId: _open, ...rest } = list;

  const laid: ListedTasksView = {
    ...rest,
    tasks: [...TASK_ROWS, ...list.tasks],
    taskAgents: [...AGENTS, ...(list.taskAgents ?? [])],
    ...(opened === undefined ? undefined : { activeTaskId: opened }),
  };

  byOpen.set(opened, laid);

  return laid;
}

/** Main's held descriptions and transcripts with the profile's laid over them, one object for each of main's. */
const STAGED_DOCUMENTS = new WeakMap<object, AppStateSnapshot[typeof LIVE_READ.HELD_TASK]>();
const STAGED_TRANSCRIPTS = new WeakMap<object, AppStateSnapshot[typeof LIVE_READ.TRANSCRIPT]>();

/** Main's tasks naming the task opened last open, one object for each of main's and each task opened. */
const STAGED_OPEN = new WeakMap<TasksView, Map<string | undefined, TasksView>>();

/**
 * Main's tasks naming the task opened last as the open one, as main's
 * document names the task it binds. Note that the document must name it,
 * because a select is answered with no delivery here, and a document staged
 * again the same as the last draws no window, so the window would read the
 * task opened only on its next draw, and step from the one before it.
 */
function openedTasks(tasks: TasksView): TasksView {
  let byOpen = STAGED_OPEN.get(tasks);

  if (byOpen === undefined) {
    byOpen = new Map();
    STAGED_OPEN.set(tasks, byOpen);
  }

  const kept = byOpen.get(opened);

  if (kept !== undefined) return kept;
  const { activeTaskId: _open, ...rest } = tasks;
  const laid: TasksView = opened === undefined ? rest : { ...rest, activeTaskId: opened };
  byOpen.set(opened, laid);

  return laid;
}

/** Main's document with every task's description and every agent's transcript held, under the profile; the very document under any other. */
export function openTasksAppState(state: AppStateSnapshot): AppStateSnapshot {
  if (!opensTasks(state.run.profile)) return state;
  const heldTasks = state[LIVE_READ.HELD_TASK];
  const heldTranscripts = state[LIVE_READ.TRANSCRIPT];
  const documents = STAGED_DOCUMENTS.get(heldTasks) ?? { ...heldTasks, ...DOCUMENTS };

  const transcripts = STAGED_TRANSCRIPTS.get(heldTranscripts) ?? {
    ...heldTranscripts,
    ...TRANSCRIPTS,
  };

  STAGED_DOCUMENTS.set(heldTasks, documents);
  STAGED_TRANSCRIPTS.set(heldTranscripts, transcripts);

  return {
    ...state,
    tasks: openedTasks(state.tasks),
    [LIVE_READ.HELD_TASK]: documents,
    [LIVE_READ.TRANSCRIPT]: transcripts,
  };
}

/**
 * What the profile answers a select and a close with, in place of main: the
 * task named opened, or none, and the document staged again, as main binds
 * one; none for any other kind, and under any other profile.
 */
export function openTasksActAnswer(
  profile: string,
  kind: PortActKind,
  payload: PortActPayload<PortActKind>,
): { readonly answer: PortActResult<PortActKind> } | undefined {
  if (!opensTasks(profile)) return undefined;

  if (kind === ACT_KIND.TASKS_SELECT) {
    // SAFETY: a select carries the task it names (`TASKS_SELECT`'s input).
    opened = (payload as PortActPayload<typeof ACT_KIND.TASKS_SELECT>).taskId;
    fixtureMoved();

    return { answer: true };
  }

  if (kind === ACT_KIND.TASKS_CLOSE) {
    opened = undefined;
    fixtureMoved();

    return { answer: undefined };
  }

  return undefined;
}
