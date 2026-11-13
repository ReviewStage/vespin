/**
 * task.ts -- `vespin task list`, `view`, `create`, `update`, `relate`, `delete`, `follow`, `unfollow`, `cat`, and `ls`: the workspace's tasks, one task with its agents, pull requests, and open asks, a new task, a task changed, a relation between two tasks moved, a task deleted, its followers added and removed, and its repository's files read.
 *
 * Each reads the workspace a command acts in (`../workspace.js`) and names a
 * task by its id, its number, or its key (`../tasks.js`). `create` takes its
 * repository from the working folder's `origin` unless `-R` names one, and
 * with `--start` or `--prompt` starts an agent on the new task, the one-shot
 * every peer leads with: in the create's own request where there is no plan
 * to write first, else created, then planned through `plans.editDescription`, then
 * started, so the agent reads the plan it was given. `cat` and `ls` read the
 * task's repository as its File tab does, on GitHub at the default branch's
 * head or a commit, never from an agent's sandbox.
 */

import { CLI_EXIT } from "@repo/features/cli-exit";
import { TASK_FILE_QUERY_FLAG } from "@repo/features/contract";
import { HOSTED_DEADLINE } from "@repo/features/hosted-link";
import { INBOX_STATUS, type InboxItem, openAskOf } from "@repo/features/inbox-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { TASK_SECTION_WRITE } from "@repo/features/task-section-wire";
import {
  TASK_BLOCK_CHANGE,
  TASK_BLOCK_RELATION,
  TASK_FILE_REFUSAL,
  TASK_PRIORITY_ORDER,
  TASK_RELATION_KIND,
  TASK_STATUS_ORDER,
  TASK_TREE_ENTRY,
  type Task,
  type TaskFollowersAnswer,
  type TaskPullRequestLine,
  type TaskRelationKind,
  type TaskSummary,
} from "@repo/features/task-wire";
import { taskKey } from "@repo/features/workspace-key";
import type { Workspace, WorkspaceMember } from "@repo/features/workspace-wire";
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { fileRefused } from "../file-refusal.js";
import { originRepository } from "../git.js";
import { answer, CommandFailed, columns, confirmOrYes, note, readInput } from "../output.js";
import { askService, session } from "../session.js";
import { resolveTaskId, signedInMemberId } from "../tasks.js";
import { resolveWorkspace } from "../workspace.js";
import { agentLines, startAgent, startedLines } from "./agent.js";
import { writeDescription } from "./description.js";
import { resolveSection } from "./section.js";

/** What `--assignee` takes to assign the task to nobody, and to the signed-in member. */
const ASSIGNEE_WORD = { NONE: "none", ME: "me" } as const;

/** What `--parent` and `--section` take to take the task out from under its parent, or out of its section. */
const NONE_WORD = "none";

/** The fields of a task every answer prints, its key beside them where it has a number. */
function taskJson(task: Omit<TaskSummary, "agents">, workspaceName: string | undefined) {
  const { id, number, name, status, priority, repository, assignee, workspaceId } = task;

  return {
    id,
    key:
      number === undefined || workspaceName === undefined ? null : taskKey(workspaceName, number),
    number: number ?? null,
    name,
    status: status ?? null,
    priority: priority ?? null,
    repository,
    assignee: assignee ?? null,
    workspaceId,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

/** How a task is named to a person: its key where it has one, else its id. */
function taskLabel(task: ReturnType<typeof taskJson>): string {
  return task.key ?? task.id;
}

/** A pull request's line: its number, where it stands, its checks, and its title and address. */
function pullRequestLine(pullRequest: TaskPullRequestLine): string[] {
  return [
    `#${pullRequest.number}`,
    pullRequest.state,
    `checks ${pullRequest.checks}`,
    `${pullRequest.title}${pullRequest.url === undefined ? "" : `  ${pullRequest.url}`}`,
  ];
}

/** An open ask's line: the thread's title and the words that ask, on their first line. */
function askLine(item: InboxItem): string | undefined {
  const asking = openAskOf(item.thread ?? []);

  if (item.status !== INBOX_STATUS.OPEN || asking === undefined) return undefined;
  const words = asking.message.text.trim().split("\n")[0] ?? "";

  return `  ${item.title}${words.length === 0 ? "" : `: ${words}`}  (${item.id})`;
}

/** The workspace of the member's a task belongs to, by its id, for its key. */
function workspaceNamed(workspaces: readonly Workspace[], id: string): string | undefined {
  return workspaces.find((workspace) => workspace.id === id)?.name;
}

const listCommand = Command.make(
  "list",
  {
    mine: Flag.Boolean("mine").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Only the tasks assigned to you"),
    ),
    status: Flag.Literals("status", TASK_STATUS_ORDER).pipe(
      Flag.optional,
      Flag.withDescription("Only the tasks that stand here"),
    ),
  },
  ({ mine, status }) =>
    Effect.gen(function* () {
      const { workspace } = yield* resolveWorkspace;
      const { hosted } = yield* session;
      const me = mine ? yield* signedInMemberId : undefined;
      const { plans } = yield* askService(hosted.plans.list, {});

      const listed = plans.filter(
        (task) =>
          task.workspaceId === workspace.id &&
          (Option.isNone(status) || task.status === status.value) &&
          (me === undefined || task.assignee?.userId === me),
      );

      const found = listed.map((task) => ({
        ...taskJson(task, workspace.name),
        agents: task.agents?.total ?? 0,
        working: task.agents?.working ?? 0,
        pullRequests: task.agents?.pullRequests ?? [],
      }));

      yield* answer({
        json: found,
        lines:
          found.length === 0
            ? ["No tasks."]
            : columns(
                found.map((task) => [
                  taskLabel(task),
                  task.status ?? "",
                  task.priority ?? "",
                  task.working > 0 ? `${task.working} working` : "",
                  task.name,
                ]),
              ),
        ids: found.map((task) => task.id),
      });
    }),
).pipe(
  Command.withDescription("List the workspace's tasks, newest first"),
  Command.withExamples([
    { command: "vespin task list", description: "Every task of the workspace" },
    {
      command: "vespin task list --mine --status in-progress",
      description: "Your tasks under way",
    },
  ]),
);

const viewCommand = Command.make(
  "view",
  {
    task: Argument.String("task").pipe(
      Argument.withDescription("The task, by its id, its number, or its key such as ACME-42"),
    ),
  },
  ({ task }) =>
    Effect.gen(function* () {
      const id = yield* resolveTaskId(task);
      const { hosted } = yield* session;

      const [{ plan }, { agents }, { plans }, { items }, { workspaces }] = yield* Effect.all(
        [
          askService(hosted.plans.open, { id }),
          askService(hosted.agents.listOfTask, { id }),
          askService(hosted.plans.list, {}),
          askService(hosted.inbox.task, { id }),
          askService(hosted.workspaces.list, undefined),
        ],
        { concurrency: "unbounded" },
      );

      const row = plans.find((listed) => listed.id === id);
      const found = taskJson(plan, workspaceNamed(workspaces, plan.workspaceId));
      const pullRequests = row?.agents?.pullRequests ?? [];

      const asks = items.flatMap((item) => {
        const line = askLine(item);

        return line === undefined ? [] : [{ item, line }];
      });

      yield* answer({
        json: {
          ...found,
          agents,
          pullRequests,
          pullRequestTotal: row?.agents?.pullRequestTotal ?? pullRequests.length,
          openAsks: asks.map(({ item }) => item),
        },
        lines: [
          `${taskLabel(found)}  ${found.name}`,
          ...columns([
            ["Status", found.status ?? "none"],
            ["Priority", found.priority ?? "none"],
            ["Repository", found.repository ?? "none"],
            ["Assignee", found.assignee?.name ?? "nobody"],
            ["Id", found.id],
          ]),
          "",
          `Agents (${agents.length})`,
          ...(agents.length === 0 ? ["  none"] : agentLines(agents).map((line) => `  ${line}`)),
          "",
          `Pull requests (${row?.agents?.pullRequestTotal ?? pullRequests.length})`,
          ...(pullRequests.length === 0
            ? ["  none"]
            : columns(pullRequests.map(pullRequestLine)).map((line) => `  ${line}`)),
          "",
          `Open asks (${asks.length})`,
          ...(asks.length === 0 ? ["  none"] : asks.map(({ line }) => line)),
        ],
        ids: [found.id],
      });
    }),
).pipe(
  Command.withDescription("Show a task: where it stands, its agents, pull requests, and open asks"),
  Command.withExamples([
    { command: "vespin task view ACME-42", description: "One task, by its key" },
    { command: "vespin task view 42 --json", description: "The same, by its number, as JSON" },
  ]),
);

const createCommand = Command.make(
  "create",
  {
    title: Argument.String("title").pipe(Argument.withDescription("The task's name")),
    repo: Flag.String("repo").pipe(
      Flag.withAlias("R"),
      Flag.optional,
      Flag.withDescription("The GitHub repository, owner/name (default: this folder's origin)"),
    ),
    file: Flag.String("file").pipe(
      Flag.withAlias("F"),
      Flag.optional,
      Flag.withDescription("The description, as Markdown, from a file or - for stdin"),
    ),
    start: Flag.Boolean("start").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Start an agent on the new task, handed its description"),
    ),
    prompt: Flag.String("prompt").pipe(
      Flag.optional,
      Flag.withDescription(
        "Start an agent with this prompt in the description's place, from a file or - for stdin",
      ),
    ),
  },
  ({ title, repo, file, start, prompt }) =>
    Effect.gen(function* () {
      const fileSource = Option.getOrUndefined(file);
      const promptSource = Option.getOrUndefined(prompt);

      if (fileSource === "-" && promptSource === "-") {
        return yield* new CommandFailed({
          exit: CLI_EXIT.USAGE,
          message: "Only one of -F and --prompt may read stdin.",
        });
      }

      const descriptionText = fileSource === undefined ? undefined : yield* readInput(fileSource);
      const promptText = promptSource === undefined ? undefined : yield* readInput(promptSource);
      const starting = start || promptText !== undefined;

      if (starting && descriptionText === undefined && promptText === undefined) {
        return yield* new CommandFailed({
          exit: CLI_EXIT.USAGE,
          message:
            "An agent needs something to work from: give the task a description with -F, or the agent a prompt with --prompt.",
        });
      }

      const repository = Option.isSome(repo) ? repo.value : yield* originRepository;
      const { workspace } = yield* resolveWorkspace;
      const { hosted } = yield* session;
      // Note that an agent goes in the create's own request only where no plan is written first, since it would read the plan empty.
      const together = starting && descriptionText === undefined;

      const created = yield* askService(
        hosted.plans.create,
        {
          name: title,
          workspaceId: workspace.id,
          repository,
          ...(together
            ? {
                agent: {
                  idempotencyKey: crypto.randomUUID(),
                  ...(promptText === undefined ? undefined : { prompt: promptText }),
                },
              }
            : { planning: false }),
        },
        together ? HOSTED_DEADLINE.START : HOSTED_DEADLINE.USUAL,
      );

      const task = taskJson(created.body.plan, workspace.name);

      if (descriptionText !== undefined) {
        yield* writeDescription(task.id, created.body.plan.document.body, descriptionText);
      }

      const agent =
        starting && !together
          ? yield* startAgent(task.id, {
              ...(promptText === undefined ? undefined : { prompt: promptText }),
            })
          : created.body.agent;

      const refusal = created.body.agentRefusal;
      yield* answer({
        json: { task, agent: agent ?? null, agentRefusal: refusal ?? null },
        lines: [
          `Created ${taskLabel(task)} ${task.name} in ${repository}.`,
          ...(agent === undefined ? [] : startedLines(agent)),
        ],
        ids: [task.id, ...(agent === undefined ? [] : [agent.id])],
      });

      if (refusal !== undefined) {
        return yield* new CommandFailed({
          exit: CLI_EXIT.REFUSED,
          message: `The task was created, but ${PRODUCT_NAME} refused its agent: ${refusal.error}.`,
        });
      }
    }),
).pipe(
  Command.withDescription(
    "Create a task in this folder's repository, and with --start or --prompt start an agent on it",
  ),
  Command.withExamples([
    { command: 'vespin task create "Fix the login redirect"', description: "A new task, no agent" },
    {
      command: 'vespin task create "Fix the login redirect" -F description.md --start',
      description: "A task with a description, and an agent working it",
    },
    {
      command:
        'echo "Fix the flaky test in auth.test.ts" | vespin task create "Flaky test" --prompt -',
      description: "A task and an agent on a prompt from stdin",
    },
  ]),
);

/** A task flag that may be given again, once for each task it names. */
function taskFlags(name: string, description: string) {
  return Flag.String(name).pipe(Flag.atLeast(0), Flag.withDescription(description));
}

/** The blocks `--blocked-by`, `--blocks`, and their `--remove-` forms name, each as `plans.block` takes it, the tasks resolved to ids. */
function blockChangesOf(named: {
  readonly blockedBy: readonly string[];
  readonly blocks: readonly string[];
  readonly removeBlockedBy: readonly string[];
  readonly removeBlocks: readonly string[];
}) {
  const asked = [
    ...named.blockedBy.map(
      (task) => [TASK_BLOCK_CHANGE.ADD, TASK_BLOCK_RELATION.BLOCKED_BY, task] as const,
    ),
    ...named.blocks.map(
      (task) => [TASK_BLOCK_CHANGE.ADD, TASK_BLOCK_RELATION.BLOCKS, task] as const,
    ),
    ...named.removeBlockedBy.map(
      (task) => [TASK_BLOCK_CHANGE.REMOVE, TASK_BLOCK_RELATION.BLOCKED_BY, task] as const,
    ),
    ...named.removeBlocks.map(
      (task) => [TASK_BLOCK_CHANGE.REMOVE, TASK_BLOCK_RELATION.BLOCKS, task] as const,
    ),
  ];

  return Effect.forEach(asked, ([change, relation, task]) =>
    Effect.map(resolveTaskId(task), (taskId) => ({ change, relation, taskId })),
  );
}

const updateCommand = Command.make(
  "update",
  {
    task: Argument.String("task").pipe(
      Argument.withDescription("The task, by its id, its number, or its key such as ACME-42"),
    ),
    status: Flag.Literals("status", TASK_STATUS_ORDER).pipe(
      Flag.optional,
      Flag.withDescription("Where it stands; done marks it done"),
    ),
    priority: Flag.Literals("priority", TASK_PRIORITY_ORDER).pipe(
      Flag.optional,
      Flag.withDescription("How much it matters"),
    ),
    assignee: Flag.String("assignee").pipe(
      Flag.optional,
      Flag.withDescription("A member by email, name, or id; me for you, none for nobody"),
    ),
    name: Flag.String("name").pipe(Flag.optional, Flag.withDescription("Its new name")),
    parent: Flag.String("parent").pipe(
      Flag.optional,
      Flag.withDescription("The task to put it under, by id, number, or key; none for the top"),
    ),
    blockedBy: taskFlags("blocked-by", "A task it waits on, added; again for each"),
    blocks: taskFlags("blocks", "A task that waits on it, added; again for each"),
    removeBlockedBy: taskFlags("remove-blocked-by", "A task it waits on, taken away"),
    removeBlocks: taskFlags("remove-blocks", "A task that waits on it, taken away"),
    section: Flag.String("section").pipe(
      Flag.optional,
      Flag.withDescription("Your sidebar section to keep it in, by id or title; none for none"),
    ),
  },
  ({ task, status, priority, assignee, name, parent, section, ...blockFlags }) =>
    Effect.gen(function* () {
      const blocksAsked = Object.values(blockFlags).some((named) => named.length > 0);

      if (
        [status, priority, assignee, name, parent, section].every(Option.isNone) &&
        !blocksAsked
      ) {
        return yield* new CommandFailed({
          exit: CLI_EXIT.USAGE,
          message:
            "Name a change: --status, --priority, --assignee, --name, --parent, --blocked-by, --blocks, their --remove- forms, or --section.",
        });
      }

      const id = yield* resolveTaskId(task);
      const { hosted } = yield* session;

      const assigneeId = Option.isSome(assignee)
        ? yield* memberIdOf(id, assignee.value)
        : undefined;

      const parentTaskId = Option.isNone(parent)
        ? undefined
        : parent.value === NONE_WORD
          ? null
          : yield* resolveTaskId(parent.value);

      const blockChanges = yield* blockChangesOf(blockFlags);

      const fields = {
        ...(Option.isSome(status) ? { status: status.value } : undefined),
        ...(Option.isSome(priority) ? { priority: priority.value } : undefined),
        ...(assigneeId === undefined ? undefined : { assigneeId }),
        ...(Option.isSome(name) ? { name: name.value } : undefined),
      };

      // Note that each change is its own request, as the task menu's are, and the task as the last one answers is the one printed.
      let plan: Task | undefined;

      if (Object.keys(fields).length > 0) {
        plan = (yield* askService(hosted.plans.update, { params: { id }, body: fields })).plan;
      }

      if (parentTaskId !== undefined) {
        plan = (yield* askService(hosted.plans.parent, { params: { id }, body: { parentTaskId } }))
          .plan;
      }

      for (const block of blockChanges) {
        plan = (yield* askService(hosted.plans.block, { params: { id }, body: block })).plan;
      }

      plan ??= (yield* askService(hosted.plans.open, { id })).plan;

      const sectionId = Option.isNone(section)
        ? undefined
        : section.value === NONE_WORD
          ? null
          : (yield* resolveSection(plan.workspaceId, section.value)).section.id;

      if (sectionId !== undefined) {
        yield* askService(hosted.taskSections.write, {
          kind: TASK_SECTION_WRITE.PLACE,
          taskId: id,
          sectionId,
        });
      }

      const { workspaces } = yield* askService(hosted.workspaces.list, undefined);

      const found = {
        ...taskJson(plan, workspaceNamed(workspaces, plan.workspaceId)),
        parentTaskId: plan.parentTaskId ?? null,
        blockedBy: plan.blockedBy ?? [],
        blocks: plan.blocks ?? [],
        ...(sectionId === undefined ? undefined : { sectionId }),
      };

      yield* answer({
        json: found,
        lines: [
          `Updated ${taskLabel(found)} ${found.name}: ${found.status ?? "none"}, ${found.priority ?? "none"}, ${found.assignee?.name ?? "nobody"}.`,
          ...(parentTaskId === undefined ? [] : [`  Parent: ${found.parentTaskId ?? "none"}`]),
          ...(blockChanges.length === 0
            ? []
            : [
                `  Blocked by: ${found.blockedBy.join(", ") || "none"}`,
                `  Blocks: ${found.blocks.join(", ") || "none"}`,
              ]),
          ...(sectionId === undefined ? [] : [`  Section: ${sectionId ?? "none"}`]),
        ],
        ids: [found.id],
      });
    }),
).pipe(
  Command.withDescription(
    "Change a task's status, priority, assignee, name, parent, blocks, or sidebar section",
  ),
  Command.withExamples([
    { command: "vespin task update ACME-42 --status done", description: "Mark a task done" },
    {
      command: "vespin task update ACME-42 --assignee me --priority high",
      description: "Take a task, and raise it",
    },
    {
      command: "vespin task update ACME-42 --blocked-by ACME-41 --parent ACME-40",
      description: "Make it wait on another, under a parent",
    },
    {
      command: 'vespin task update ACME-42 --section "This week"',
      description: "Keep it in one of your sidebar sections",
    },
  ]),
);

const deleteCommand = Command.make(
  "delete",
  {
    task: Argument.String("task").pipe(
      Argument.withDescription("The task, by its id, its number, or its key such as ACME-42"),
    ),
    yes: Flag.Boolean("yes").pipe(
      Flag.withAlias("y"),
      Flag.withDefault(false),
      Flag.withDescription("Delete without asking; required where stdin is no terminal"),
    ),
  },
  ({ task, yes }) =>
    Effect.gen(function* () {
      const id = yield* resolveTaskId(task);
      const { hosted } = yield* session;

      const [{ plan }, { workspaces }] = yield* Effect.all(
        [askService(hosted.plans.open, { id }), askService(hosted.workspaces.list, undefined)],
        { concurrency: "unbounded" },
      );

      const found = taskJson(plan, workspaceNamed(workspaces, plan.workspaceId));
      yield* confirmOrYes(
        `Delete ${taskLabel(found)} ${found.name} for good, with its agents and their transcripts?`,
        yes,
      );
      yield* askService(hosted.plans.delete, { id });
      yield* answer({
        json: { id: found.id, key: found.key, name: found.name, deleted: true },
        lines: [`Deleted ${taskLabel(found)} ${found.name}.`],
        ids: [found.id],
      });
    }),
).pipe(
  Command.withDescription(
    "Delete a task for good: its agents are stopped first, then it goes with its description and transcripts",
  ),
  Command.withExamples([
    { command: "vespin task delete ACME-42", description: "Delete a task, after you confirm" },
    { command: "vespin task delete ACME-42 --yes", description: "The same, from a script" },
  ]),
);

/** The kind each kind is the other side of, which a relation can never stand in beside it, so a move from it turns the relation around. */
const INVERSE_RELATION_KIND = {
  [TASK_RELATION_KIND.BLOCKED_BY]: TASK_RELATION_KIND.BLOCKS,
  [TASK_RELATION_KIND.BLOCKS]: TASK_RELATION_KIND.BLOCKED_BY,
  [TASK_RELATION_KIND.SUB_TASK]: TASK_RELATION_KIND.PARENT,
  [TASK_RELATION_KIND.PARENT]: TASK_RELATION_KIND.SUB_TASK,
} as const satisfies Record<TaskRelationKind, TaskRelationKind>;

/** How a relation reads with the task first and the other task after it. */
const RELATION_WORDS = {
  [TASK_RELATION_KIND.BLOCKED_BY]: "blocked by",
  [TASK_RELATION_KIND.BLOCKS]: "blocks",
  [TASK_RELATION_KIND.SUB_TASK]: "parent of",
  [TASK_RELATION_KIND.PARENT]: "sub-task of",
} as const satisfies Record<TaskRelationKind, string>;

/** A flag naming the other task in one kind of relation. */
const relatedFlag = (kind: TaskRelationKind, words: string) =>
  Flag.String(kind).pipe(Flag.optional, Flag.withDescription(words));

const relateCommand = Command.make(
  "relate",
  {
    task: Argument.String("task").pipe(
      Argument.withDescription("The task, by its id, its number, or its key such as ACME-42"),
    ),
    blockedBy: relatedFlag(TASK_RELATION_KIND.BLOCKED_BY, "The other task, made to block it"),
    blocks: relatedFlag(TASK_RELATION_KIND.BLOCKS, "The other task, made to wait on it"),
    subTask: relatedFlag(TASK_RELATION_KIND.SUB_TASK, "The other task, made its sub-task"),
    parent: relatedFlag(TASK_RELATION_KIND.PARENT, "The other task, made its parent"),
    from: Flag.Literals("from", Object.values(TASK_RELATION_KIND)).pipe(
      Flag.optional,
      Flag.withDescription(
        "How the other task stands to it now; the other side of the new kind where left out",
      ),
    ),
  },
  ({ task, blockedBy, blocks, subTask, parent, from }) =>
    Effect.gen(function* () {
      const named = [
        { to: TASK_RELATION_KIND.BLOCKED_BY, other: blockedBy },
        { to: TASK_RELATION_KIND.BLOCKS, other: blocks },
        { to: TASK_RELATION_KIND.SUB_TASK, other: subTask },
        { to: TASK_RELATION_KIND.PARENT, other: parent },
      ].flatMap(({ to, other }) => (Option.isSome(other) ? [{ to, other: other.value }] : []));

      const [asked, ...others] = named;

      if (asked === undefined || others.length > 0) {
        return yield* new CommandFailed({
          exit: CLI_EXIT.USAGE,
          message: "Name one relation: --blocked-by, --blocks, --sub-task, or --parent.",
        });
      }

      const fromKind = Option.getOrElse(from, () => INVERSE_RELATION_KIND[asked.to]);

      if (fromKind === asked.to) {
        return yield* new CommandFailed({
          exit: CLI_EXIT.USAGE,
          message: `--from names the kind it stands in now, so it is another than ${asked.to}.`,
        });
      }

      const id = yield* resolveTaskId(task);
      const otherId = yield* resolveTaskId(asked.other);
      const { hosted } = yield* session;

      const { plan } = yield* askService(hosted.plans.relation, {
        params: { id },
        body: { taskId: otherId, from: fromKind, to: asked.to },
      });

      const { workspaces } = yield* askService(hosted.workspaces.list, undefined);
      const found = taskJson(plan, workspaceNamed(workspaces, plan.workspaceId));
      yield* answer({
        json: found,
        lines: [
          `Related ${taskLabel(found)} ${found.name}: ${RELATION_WORDS[asked.to]} ${asked.other}.`,
        ],
        ids: [found.id],
      });
    }),
).pipe(
  Command.withDescription(
    "Move a relation between two tasks to another kind in one step, or add it where none stood",
  ),
  Command.withExamples([
    {
      command: "vespin task relate ACME-42 --sub-task ACME-43 --from blocked-by",
      description: "Make the task blocking ACME-42 its sub-task instead",
    },
    {
      command: "vespin task relate ACME-42 --blocked-by ACME-43",
      description: "Turn a block around: ACME-43 blocks ACME-42, where ACME-42 blocked it",
    },
  ]),
);

/** The task's workspace's members, as `--assignee` and `--member` name them among. */
function taskMembersOf(taskId: string) {
  return Effect.gen(function* () {
    const { hosted } = yield* session;
    const { plan } = yield* askService(hosted.plans.open, { id: taskId });

    const { members } = yield* askService(hosted.workspaces.members, {
      workspaceId: plan.workspaceId,
    });

    return { plan, members };
  });
}

/** The account id `--assignee` names among the task's workspace's members: none for nobody, or a usage failure where it names no one, or several. */
function memberIdOf(taskId: string, named: string) {
  return Effect.gen(function* () {
    if (named === ASSIGNEE_WORD.NONE) return null;

    if (named === ASSIGNEE_WORD.ME) return yield* signedInMemberId;
    const { members } = yield* taskMembersOf(taskId);

    return yield* memberNamed(members, named);
  });
}

/** The account id one member is named by among `members`, by id, email, or name: a usage failure where it names no one, or several. */
function memberNamed(members: readonly WorkspaceMember[], named: string) {
  return Effect.gen(function* () {
    const lowered = named.toLowerCase();

    const matches = members.filter(
      (member) =>
        member.userId === named ||
        member.email.toLowerCase() === lowered ||
        member.name.toLowerCase() === lowered,
    );

    const [only, ...others] = matches;

    if (only !== undefined && others.length === 0) return only.userId;
    const listed = members.map((member) => `  ${member.email}  ${member.name}`);

    return yield* new CommandFailed({
      exit: CLI_EXIT.USAGE,
      message: [
        only === undefined
          ? `${named} is no member of the task's workspace.`
          : `${named} names several members; name one by email.`,
        "Its members:",
        ...listed,
      ].join("\n"),
    });
  });
}

/** What a follower write answers: the task's followers as they then stand. */
type FollowersAnswer = Pick<TaskFollowersAnswer, "followers">;

/** The members `--member` names, each by account id, the signed-in member for `me`; none where it names no one. */
function membersNamed(taskId: string, named: readonly string[]) {
  return Effect.gen(function* () {
    const { plan, members } = yield* taskMembersOf(taskId);
    const readerId = yield* signedInMemberId;

    const ids = yield* Effect.forEach(named, (each) =>
      each === ASSIGNEE_WORD.ME ? Effect.succeed(readerId) : memberNamed(members, each),
    );

    return { plan, members, readerId, ids };
  });
}

/** Prints the task's followers as the last write left them, each by name, the assignee and whose machines its agents may use marked. */
function followersAnswer(
  taskId: string,
  written: FollowersAnswer,
  members: readonly WorkspaceMember[],
  verb: string,
) {
  const followers = written.followers.map((follower) => ({
    ...follower,
    name: members.find((member) => member.userId === follower.userId)?.name ?? follower.userId,
  }));

  return answer({
    json: { taskId, followers },
    lines: [
      `${verb}. Followers (${followers.length}):`,
      ...(followers.length === 0
        ? ["  none"]
        : columns(
            followers.map((follower) => [
              follower.name,
              [follower.assignee ? "assignee" : "", follower.machines ? "machines on" : ""]
                .filter((word) => word !== "")
                .join(", "),
            ]),
          ).map((line) => `  ${line}`)),
    ],
    ids: [taskId],
  });
}

/** A member a follower command names, again for each; none names the signed-in member. */
const memberFlags = (description: string) =>
  Flag.String("member").pipe(Flag.atLeast(0), Flag.withDescription(description));

const followCommand = Command.make(
  "follow",
  {
    task: Argument.String("task").pipe(
      Argument.withDescription("The task, by its id, its number, or its key such as ACME-42"),
    ),
    member: memberFlags("A member to add as a follower, by email, name, or id; again for each"),
  },
  ({ task, member }) =>
    Effect.gen(function* () {
      const id = yield* resolveTaskId(task);
      const { hosted } = yield* session;
      const { members, readerId, ids } = yield* membersNamed(id, member);
      // Note that each follower is its own request, as the popover's are, and the followers the last one answers are the ones printed.
      let written: FollowersAnswer = { followers: [] };

      for (const userId of ids.length === 0 ? [readerId] : ids) {
        written =
          userId === readerId
            ? yield* askService(hosted.taskFollowers.follow, { id })
            : yield* askService(hosted.taskFollowers.add, { params: { id }, body: { userId } });
      }

      yield* followersAnswer(id, written, members, ids.length === 0 ? "Following" : "Added");
    }),
).pipe(
  Command.withDescription(
    "Follow a task, or add members as its followers, with their machines off until they switch them on",
  ),
  Command.withExamples([
    { command: "vespin task follow ACME-42", description: "Follow a task yourself" },
    {
      command: "vespin task follow ACME-42 --member ana@acme.dev --member Raj",
      description: "Add two teammates as followers",
    },
  ]),
);

const unfollowCommand = Command.make(
  "unfollow",
  {
    task: Argument.String("task").pipe(
      Argument.withDescription("The task, by its id, its number, or its key such as ACME-42"),
    ),
    member: memberFlags("A follower to remove, by email, name, or id; again for each"),
  },
  ({ task, member }) =>
    Effect.gen(function* () {
      const id = yield* resolveTaskId(task);
      const { hosted } = yield* session;
      const { members, readerId, ids } = yield* membersNamed(id, member);
      let written: FollowersAnswer = { followers: [] };

      for (const userId of ids.length === 0 ? [readerId] : ids) {
        written =
          userId === readerId
            ? yield* askService(hosted.taskFollowers.unfollow, { id })
            : yield* askService(hosted.taskFollowers.remove, { id, userId });
      }

      yield* followersAnswer(id, written, members, ids.length === 0 ? "Unfollowed" : "Removed");
    }),
).pipe(
  Command.withDescription(
    "Stop following a task, or remove other followers; its assignee keeps following while assigned",
  ),
  Command.withExamples([
    { command: "vespin task unfollow ACME-42", description: "Stop following a task" },
    {
      command: "vespin task unfollow ACME-42 --member ana@acme.dev",
      description: "Remove a teammate as a follower",
    },
  ]),
);

/** A file or folder named by its task, as `cat` and `ls` take it. */
const taskArgument = Argument.String("task").pipe(
  Argument.withDescription("The task, by its id, its number, or its key such as ACME-42"),
);

const commitFlag = Flag.String("commit").pipe(
  Flag.withDescription(
    "Read at this commit, by its full SHA, rather than the default branch's head",
  ),
  Flag.optional,
);

const catCommand = Command.make(
  "cat",
  {
    task: taskArgument,
    path: Argument.String("path").pipe(
      Argument.withDescription("The file's path from the repository's root"),
    ),
    commit: commitFlag,
  },
  ({ task, path, commit }) =>
    Effect.gen(function* () {
      const id = yield* resolveTaskId(task);
      const { hosted } = yield* session;

      // Note that a raw read carries the whole text, so its window stands for nothing.
      const read = yield* askService(hosted.taskFiles.file, {
        id,
        path,
        first: "1",
        last: "1",
        raw: TASK_FILE_QUERY_FLAG,
        ...(Option.isSome(commit) ? { ref: commit.value } : undefined),
      });

      if ("refusal" in read) return yield* fileRefused(read);

      if (!("text" in read)) return yield* fileRefused({ refusal: TASK_FILE_REFUSAL.NOT_TEXT });
      yield* answer({ json: read.text, lines: [read.text.text], ids: [read.text.path] });
    }),
).pipe(
  Command.withDescription(
    "Print a file of a task's repository as GitHub holds it, at the default branch's head or a commit",
  ),
  Command.withExamples([
    {
      command: "vespin task cat ACME-42 README.md",
      description: "The file as the default branch holds it",
    },
    {
      command: "vespin task cat ACME-42 src/index.ts --commit <sha>",
      description: "The file at a commit",
    },
  ]),
);

const lsCommand = Command.make(
  "ls",
  {
    task: taskArgument,
    path: Argument.String("path").pipe(
      Argument.withDescription(
        "The folder's path from the repository's root; the root where left out",
      ),
      Argument.optional,
    ),
    recursive: Flag.Boolean("recursive").pipe(
      Flag.withAlias("r"),
      Flag.withDefault(false),
      Flag.withDescription("List everything under the folder, each by its path from it"),
    ),
  },
  ({ task, path, recursive }) =>
    Effect.gen(function* () {
      const id = yield* resolveTaskId(task);
      const { hosted } = yield* session;

      const listed = yield* askService(hosted.taskFiles.tree, {
        id,
        ...(Option.isSome(path) && path.value !== "" ? { path: path.value } : undefined),
        ...(recursive ? { recursive: TASK_FILE_QUERY_FLAG } : undefined),
      });

      if ("refusal" in listed) return yield* fileRefused(listed);
      const { folder } = listed;

      const names = folder.entries.map((entry) =>
        entry.kind === TASK_TREE_ENTRY.FOLDER ? `${entry.name}/` : entry.name,
      );

      if (folder.truncated) yield* note("The folder holds more entries than one listing carries.");
      yield* answer({ json: folder, lines: names, ids: names });
    }),
).pipe(
  Command.withDescription(
    "List a folder of a task's repository as GitHub holds it at the default branch's head",
  ),
  Command.withExamples([
    { command: "vespin task ls ACME-42", description: "The repository's root" },
    { command: "vespin task ls ACME-42 src -r", description: "Everything under src" },
  ]),
);

/** The task group: list, view, create, update, relate, delete, follow, unfollow, cat, and ls. */
export const taskCommand = Command.make("task").pipe(
  Command.withDescription(
    "List, view, create, change, follow, and delete tasks, and read their repository's files",
  ),
  Command.withSubcommands([
    listCommand,
    viewCommand,
    createCommand,
    updateCommand,
    relateCommand,
    deleteCommand,
    followCommand,
    unfollowCommand,
    catCommand,
    lsCommand,
  ]),
  Command.withExamples([
    { command: "vespin task list --mine", description: "Your tasks" },
    { command: 'vespin task create "Fix X" --prompt -', description: "A task, and an agent on it" },
  ]),
);
