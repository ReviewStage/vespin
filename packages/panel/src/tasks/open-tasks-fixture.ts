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
 *
 * An address naming `scale=large` beside the profile (`?fixture=tasks-open&scale=large`)
 * lists as many tasks and agents again as a real account's at its largest
 * (`LARGE`): 3,200 light tasks, 5,400 agents, and a Manager that started some
 * of them, the first few of the tasks sub-tasks of the task open. One row
 * moves on a timer as an agent at work moves it, so what a step costs the
 * window can be timed (`tools/bench/README.md`): `move` names the row, a
 * background agent's (`agent`, the default), the open task's agent its tab
 * shows (`shown-agent`) or another of its agents (`task-agent`), a
 * background task's own as its agents' turns start and end (`task`), the
 * open task's first sub-task's the same way (`sub-task`), a turn ending on
 * each background task in turn, so each step moves another to the head of
 * the activity order (`tasks`), or none
 * (`none`), and `every` how many milliseconds apart, 0 for no timer. A bench
 * steps it itself through `vespinFixtureStep()` on the page, so each step is
 * timed alone.
 */

import {
  AGENT_KIND,
  AGENT_RUNTIME,
  AGENT_STATUS,
  type AgentTranscriptMessage,
  type ListedAgent,
} from "@repo/features/agent-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import { TASK_PRIORITY, TASK_STATUS, type Task, type TaskSummary } from "@repo/features/task-wire";
import type { ListedTasksView, TasksView } from "@repo/features/tasks-view";
import type { Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import {
  type AppStateSnapshot,
  type AppTranscript,
  OWN_TRANSCRIPT,
  RUN_PROFILE,
} from "@repo/host/app-state";
import type { PortActKind, PortActPayload, PortActResult } from "@repo/host/contract";
import { FIXTURE_IDS } from "@repo/host/fixture-stage";
import { EXPERIMENT } from "@repo/settings";
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

/** How big the large stage is, and how it moves (`LARGE_PARAMETER`). */
const LARGE = {
  /** The light tasks listed beside the profile's own. */
  TASKS: 3200,
  /** Of every 16 light tasks, how many hold two agents rather than one, so the 3,200 hold 5,400. */
  TWO_AGENTS_OF_16: 11,
  /** The light tasks at the head of the list that are sub-tasks of the task open. */
  SUB_TASKS: 6,
  /** Of every so many light tasks, the one whose first agent the Manager started. */
  MANAGED_EVERY: 20,
  /** Of every so many light tasks, the one whose first agent is at work. */
  WORKING_EVERY: 8,
  /** How many milliseconds apart the row named moves, where the address names none; 0 for no timer. */
  EVERY: 400,
} as const;

/** The address's words for the large stage. */
const LARGE_PARAMETER = {
  SCALE: "scale",
  MOVE: "move",
  EVERY: "every",
} as const;

/** The scale that asks for the large stage. */
const SCALE_LARGE = "large";

/** The row the large stage moves on each step. */
const LARGE_MOVE = {
  /** A background task's first agent: its row moves, as each step of its turn moves it. */
  AGENT: "agent",
  /** The open task's first agent, at work, whose tab the task opens on. */
  SHOWN_AGENT: "shown-agent",
  /** The open task's second agent, whose tab stands beside the shown one. */
  TASK_AGENT: "task-agent",
  /** A background task's own row: its agents' turn starts, then ends, by turns. */
  TASK: "task",
  /** The open task's first sub-task's own row, moved as a background task's is, in view on its Overview. */
  SUB_TASK: "sub-task",
  /** Background tasks in turn, oldest first: each step ends a turn of the next one's agents, so each puts another task at the head of the activity order. */
  TASKS: "tasks",
  /** Nothing moves. */
  NONE: "none",
} as const;

type LargeMove = (typeof LARGE_MOVE)[keyof typeof LARGE_MOVE];

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

/** What the address asks of the large stage: none where it names no `scale=large`, as in a desktop run. */
function largeAsked(): { readonly move: LargeMove; readonly every: number } | undefined {
  const search = typeof location === "undefined" ? "" : location.search;
  const asked = new URLSearchParams(search);

  if (asked.get(LARGE_PARAMETER.SCALE) !== SCALE_LARGE) return undefined;
  const named = asked.get(LARGE_PARAMETER.MOVE);
  const move = Object.values(LARGE_MOVE).find((each) => each === named) ?? LARGE_MOVE.AGENT;
  const every = Number(asked.get(LARGE_PARAMETER.EVERY) ?? LARGE.EVERY);

  return { move, every: Number.isFinite(every) && every >= 0 ? every : LARGE.EVERY };
}

/** The Manager of the large stage, which started some of its agents and works on no task. */
const LARGE_MANAGER: ListedAgent = {
  id: fixtureUuid(5, 0),
  taskId: null,
  model: MODEL,
  effort: "high",
  title: "Bench manager",
  kind: AGENT_KIND.MANAGER,
  createdAt: LANDED - 30 * 24 * HOUR,
  status: AGENT_STATUS.COMPLETED,
  turnId: null,
  startedBy: ADA,
  runtime: AGENT_RUNTIME.CLAUDE_CODE,
  workspaceId: FIXTURE_IDS.WORKSPACE,
  repository: REPOSITORY,
  settledAt: LANDED - HOUR,
};

/** The light task at `index` of the large stage: a row the list carries, never opened. */
function largeTaskAt(index: number): TaskSummary {
  const agents = index % 16 < LARGE.TWO_AGENTS_OF_16 ? 2 : 1;
  const at = LANDED - (OPEN_TASKS.TASKS + index + 2) * 6 * MINUTE;

  return {
    id: fixtureUuid(3, index),
    workspaceId: FIXTURE_IDS.WORKSPACE,
    name: `${subjectAt(index)}: step ${index + 1}`,
    createdAt: at,
    updatedAt: at + MINUTE,
    repository: REPOSITORY,
    priority: TASK_PRIORITY.MEDIUM,
    status: index % 3 === 0 ? TASK_STATUS.DONE : TASK_STATUS.IN_PROGRESS,
    number: 1000 + index,
    ownerId: ADA.userId,
    createdBy: ADA,
    assignee: ADA,
    blockedBy: [],
    blocks: [],
    ...(index < LARGE.SUB_TASKS ? { parentTaskId: taskIdAt(0) } : undefined),
    agents: {
      total: agents,
      working: index % LARGE.WORKING_EVERY === 0 ? 1 : 0,
      activityAt: at + MINUTE,
      pullRequestTotal: 0,
    },
  };
}

/** The agent at `at` of the large stage's light task `task`. */
function largeAgentOf(task: TaskSummary, index: number, at: number): ListedAgent {
  const running = at === 0 && index % LARGE.WORKING_EVERY === 0;
  const startedAt = task.createdAt + at * MINUTE;

  return {
    id: fixtureUuid(4, index * 2 + at),
    taskId: task.id,
    model: MODEL,
    effort: "high",
    title: `${task.name} (${at + 1})`,
    createdAt: startedAt,
    status: running ? AGENT_STATUS.RUNNING : AGENT_STATUS.COMPLETED,
    turnId: null,
    runStartedAt: startedAt,
    startedBy: ADA,
    ...(at === 0 && index % LARGE.MANAGED_EVERY === 0
      ? { startedByAgentId: LARGE_MANAGER.id }
      : undefined),
    runtime: AGENT_RUNTIME.CLAUDE_CODE,
    workspaceId: FIXTURE_IDS.WORKSPACE,
    repository: REPOSITORY,
    ...(running ? undefined : { settledAt: startedAt + HOUR }),
  };
}

/** The workspaces staged with the large stage, Managers on in the fixture's own so its Manager's page draws its overview, one array for each list's. */
const MANAGED_WORKSPACES = new WeakMap<readonly Workspace[], readonly Workspace[]>();

/** `workspaces` with Managers turned on in the fixture's own, as its owner would turn it on. */
function managedWorkspaces(workspaces: readonly Workspace[]): readonly Workspace[] {
  const kept = MANAGED_WORKSPACES.get(workspaces);

  if (kept !== undefined) return kept;

  const managers = {
    experiment: EXPERIMENT.MANAGERS,
    on: true,
    changedBy: { id: ADA.userId, name: ADA.name },
    changedAt: LANDED - 30 * 24 * HOUR,
  };

  const laid = workspaces.map((workspace) =>
    workspace.id === FIXTURE_IDS.WORKSPACE
      ? {
          ...workspace,
          experiments: [
            ...(workspace.experiments ?? []).filter(
              (each) => each.experiment !== EXPERIMENT.MANAGERS,
            ),
            managers,
          ],
        }
      : workspace,
  );

  MANAGED_WORKSPACES.set(workspaces, laid);

  return laid;
}

/** The large stage as it stands: its rows and the profile's own agents, moved in place by each step, and how many steps it took. */
interface LargeStage {
  readonly tasks: TaskSummary[];
  readonly agents: ListedAgent[];
  readonly own: ListedAgent[];
  steps: number;
}

/** The large stage, made the first time a list is staged under an address asking for it. */
let large: LargeStage | undefined;

/** The large stage's rows, made once, and the timer moving the row the address names. */
function largeStage(): LargeStage | undefined {
  if (large !== undefined) return large;
  const asked = largeAsked();

  if (asked === undefined) return undefined;
  const tasks = Array.from({ length: LARGE.TASKS }, (_, index) => largeTaskAt(index));

  const agents = [
    LARGE_MANAGER,
    ...tasks.flatMap((task, index) =>
      Array.from({ length: task.agents?.total ?? 0 }, (_, at) => largeAgentOf(task, index, at)),
    ),
  ];

  const stage: LargeStage = { tasks, agents, own: [...AGENTS], steps: 0 };
  large = stage;

  const step = () => largeStep(stage, asked.move);
  // Note that a bench takes each step itself, so it times one at a time (`tools/bench`).
  Object.assign(globalThis, { vespinFixtureStep: step });

  if (asked.move !== LARGE_MOVE.NONE && asked.every > 0) setInterval(step, asked.every);

  return stage;
}

/**
 * Moves the row `move` names one step, as the service's delivery moves it:
 * an agent's start of its run by a millisecond, as each step of a turn
 * moves its row and nothing a list draws of it, or a background task's
 * agents' turn starting, then ending, by turns, its activity moved as it
 * ends; then stages the window's document again.
 */
function largeStep(stage: LargeStage, move: LargeMove): void {
  if (move === LARGE_MOVE.NONE) return;
  stage.steps += 1;

  if (move === LARGE_MOVE.TASKS) {
    const at = (stage.tasks.length - (stage.steps % stage.tasks.length)) % stage.tasks.length;
    const task = stage.tasks[at];

    if (task?.agents === undefined) return;
    stage.tasks[at] = { ...task, agents: { ...task.agents, activityAt: LANDED + stage.steps } };
  } else if (move === LARGE_MOVE.TASK || move === LARGE_MOVE.SUB_TASK) {
    const at = move === LARGE_MOVE.TASK ? stage.tasks.length - 1 : 0;
    const task = stage.tasks[at];

    if (task?.agents === undefined) return;
    const starts = stage.steps % 2 === 1;

    stage.tasks[at] = {
      ...task,
      agents: {
        ...task.agents,
        working: starts ? 1 : 0,
        ...(starts ? undefined : { activityAt: LANDED + stage.steps }),
      },
    };
  } else {
    // Note that the open task's agents are the profile's own, staged from a copy the stage keeps.
    const own = move === LARGE_MOVE.SHOWN_AGENT || move === LARGE_MOVE.TASK_AGENT;
    const rows = own ? stage.own : stage.agents;
    const id = own ? agentIdAt(0, move === LARGE_MOVE.SHOWN_AGENT ? 0 : 1) : rows.at(-1)?.id;
    const at = rows.findIndex((agent) => agent.id === id);
    const agent = rows[at];

    if (agent === undefined) return;
    rows[at] = { ...agent, runStartedAt: (agent.runStartedAt ?? 0) + 1 };
  }

  fixtureMoved();
}

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
const STAGED_LISTS = new WeakMap<
  ListedTasksView,
  Map<string | undefined, { readonly steps: number; readonly view: ListedTasksView }>
>();

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

  const stage = largeStage();
  const steps = stage?.steps ?? 0;
  const kept = byOpen.get(opened);

  if (kept !== undefined && kept.steps === steps) return kept.view;
  const { activeTaskId: _open, ...rest } = list;

  const laid: ListedTasksView = {
    ...rest,
    ...(stage === undefined ? undefined : { workspaces: managedWorkspaces(list.workspaces) }),
    tasks: [...TASK_ROWS, ...(stage?.tasks ?? []), ...list.tasks],
    taskAgents: [...(stage?.own ?? AGENTS), ...(stage?.agents ?? []), ...(list.taskAgents ?? [])],
    ...(opened === undefined ? undefined : { activeTaskId: opened }),
  };

  byOpen.set(opened, { steps, view: laid });

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
