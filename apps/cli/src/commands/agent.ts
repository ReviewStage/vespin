/**
 * agent.ts -- `vespin agent start`, `continue`, `list`, `view`, `logs`, `send`, `stop`, `wait`, `checkout`, `ports`, and `share`: coding agents started, continued, read, followed, messaged, stopped, waited on, their work brought into the working folder, and the ports their sandbox listens on shared by link; their shells are `agent-shell.ts`'s.
 *
 * A turn is followed on the held transcript read (`messages.agent`): asked
 * past the cursor the last answer handed back, the service holds it while
 * the agent works and nothing new was written, and answers with the new
 * messages and where the agent then stands. It is asked again on a
 * `Schedule` until the agent's status says the turn ended, which
 * `cliExitOfAgentStatus` reads into the exit code `wait` ends with. The live
 * events (`contract/live.ts`) carry no agent status, so the held read is the
 * one that answers both.
 *
 * An agent has two branches a person may mean: the one its sandbox stood on
 * as its last turn ended (`agents.read`), pushed or not, and the one it
 * pushed, as GitHub holds it (`agentPullRequests.pullRequest`). `view`
 * shows both; `checkout` takes the sandbox's, else the pushed one, and
 * refuses one GitHub does not hold yet rather than failing its fetch.
 */

import { isWireUuid } from "@repo/features";
import {
  AGENT_CURSOR_START,
  AGENT_MACHINE,
  AGENT_STATUS,
  type AgentRunsOnRequest,
  type AgentStartFrom,
  type AgentStatus,
  type AgentSummary,
  type AgentTranscriptMessage,
  agentStartRequestOnWire,
} from "@repo/features/agent-wire";
import { CLI_EXIT, cliExitOfAgentStatus } from "@repo/features/cli-exit";
import { transcriptPartLines, transcriptSpeaker } from "@repo/features/cli-transcript";
import { HOSTED_DEADLINE } from "@repo/features/hosted-link";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { FORWARD_PORT } from "@repo/features/sandbox-tunnel-wire";
import { Duration, Effect, Option, Ref, Result, Schedule } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { checkoutFromOrigin, originHasBranch, originRepository, treeIsClean } from "../git.js";
import { answer, CommandFailed, columns, note, readInput, streamLines } from "../output.js";
import { askService, session } from "../session.js";
import { resolveTaskId } from "../tasks.js";
import { resolveWorkspace } from "../workspace.js";
import { shellCommand, shellsCommand } from "./agent-shell.js";

/** How long after a held read answers the next is asked, so a read that answers at once never spins. */
const FOLLOW_SPACING = Duration.seconds(1);

/** What a start asks of its agent beside the task: its prompt, model and effort, where it runs, and the branch its checkout is cloned at. */
interface AgentStartChoice {
  readonly prompt?: string;
  readonly model?: string;
  readonly effort?: string;
  readonly runsOn?: AgentRunsOnRequest;
  readonly branch?: string;
}

/** What a continue asks of its agent beside the agent it starts from: the message a fork is cut at, a note after the replay, model and effort, and where it runs. */
interface AgentContinueChoice {
  readonly from: AgentStartFrom;
  readonly note?: string;
  readonly model?: string;
  readonly effort?: string;
  readonly runsOn?: AgentRunsOnRequest;
}

/** An agent as a line of a table: its id, where it stands, and its title or model. */
export function agentLines(agents: readonly AgentSummary[]): string[] {
  return columns(agents.map((agent) => [agent.id, agent.status, agent.title ?? agent.model]));
}

/** What a start says once its agent is started. */
export function startedLines(agent: AgentSummary): string[] {
  return [`Started agent ${agent.id} on ${agent.model} (${agent.effort}).`];
}

/** What a continue says once its agent is started: the agent it continued or forked, and the new one. */
function continuedLines(sourceId: string, forked: boolean, agent: AgentSummary): string[] {
  const how = forked ? "Forked" : "Continued";
  return [`${how} agent ${sourceId} as agent ${agent.id} on ${agent.model} (${agent.effort}).`];
}

/** A Start request under a key of its own, as it travels, or a usage refusal in `words` where it reads as none. */
function admittedStart(choice: AgentStartChoice | AgentContinueChoice, words: string) {
  const admitted = agentStartRequestOnWire({ idempotencyKey: crypto.randomUUID(), ...choice });
  return Result.isFailure(admitted)
    ? Effect.fail(new CommandFailed({ exit: CLI_EXIT.USAGE, message: words }))
    : Effect.succeed(admitted.success);
}

/** An agent started on a task, under a key of its own, or a refusal saying why it was not. */
export function startAgent(taskId: string, choice: AgentStartChoice) {
  return Effect.gen(function* () {
    const body = yield* admittedStart(
      choice,
      "The prompt is empty or too long, the model and effort do not read, or the branch is no name git takes.",
    );
    const { hosted } = yield* session;
    const started = yield* askService(
      hosted.agents.start,
      { params: { id: taskId }, body },
      HOSTED_DEADLINE.START,
    );
    return started.body.agent;
  });
}

/**
 * An agent started from another, in that agent's own place (its task, or its
 * workspace and repository where it has none), under a key of its own, or a
 * refusal saying why it was not. With no message named it continues the
 * agent, which the service hands over and stops; with one it forks the
 * agent's transcript at that message, and the agent goes on.
 */
function continueAgent(choice: AgentContinueChoice) {
  return Effect.gen(function* () {
    const body = yield* admittedStart(
      choice,
      "The agent or message id is no id, the note is empty or too long, or the model and effort do not read.",
    );
    const { hosted } = yield* session;
    const started = yield* askService(
      hosted.agents.startFrom,
      { params: { id: choice.from.agentId }, body },
      HOSTED_DEADLINE.START,
    );
    return started.body.agent;
  });
}

/** Where `--cloud` or `--on` says the agent runs, the device by its id or its name among the member's hosts; none for where a Start naming none runs. */
function runsOnOf(cloud: boolean, on: Option.Option<string>) {
  return Effect.gen(function* () {
    if (cloud && Option.isSome(on)) {
      return yield* new CommandFailed({
        exit: CLI_EXIT.USAGE,
        message: "Name one place to run: --cloud or --on <device>.",
      });
    }
    if (cloud) return { machine: AGENT_MACHINE.VERCEL } satisfies AgentRunsOnRequest;
    if (Option.isNone(on)) return undefined;
    const named = on.value;
    if (isWireUuid(named)) {
      return { machine: AGENT_MACHINE.DEVICE, deviceId: named } satisfies AgentRunsOnRequest;
    }
    const { hosted } = yield* session;
    const { hosts } = yield* askService(hosted.hosts.list, undefined);
    const host = hosts.find((each) => each.name.toLowerCase() === named.toLowerCase());
    if (host !== undefined) {
      return { machine: AGENT_MACHINE.DEVICE, deviceId: host.id } satisfies AgentRunsOnRequest;
    }
    return yield* new CommandFailed({
      exit: CLI_EXIT.USAGE,
      message: [
        `${named} is none of your devices. Name one by its name or its id:`,
        ...hosts.map((each) => `  ${each.id}  ${each.name}`),
      ].join("\n"),
    });
  });
}

/** The whole transcript, oldest first: the newest page, and every page below it. */
function wholeTranscript(agentId: string) {
  return Effect.gen(function* () {
    const { hosted } = yield* session;
    const newest = yield* askService(hosted.messages.agentNewest, { id: agentId });
    let messages = newest.messages;
    let before = newest.before;
    while (before !== undefined) {
      const older = yield* askService(hosted.messages.agentNewest, { id: agentId, before });
      messages = [...older.messages, ...messages];
      before = older.before;
    }
    const cursor = "cursor" in newest ? newest.cursor : AGENT_CURSOR_START;
    const status = "status" in newest ? newest.status : undefined;
    return { messages, cursor, status };
  });
}

/** What a reader following a turn holds: where it stands in the transcript, how many parts of each message it printed, and the messages as they now stand. */
interface Following {
  readonly cursor: string;
  readonly printed: ReadonlyMap<string, number>;
  readonly messages: ReadonlyMap<string, AgentTranscriptMessage>;
  readonly status: AgentStatus;
  readonly failureReason: string | undefined;
}

/** The lines a page of messages adds past what was printed of each, and how much of each is printed after them. */
function pageLines(
  page: readonly AgentTranscriptMessage[],
  printed: ReadonlyMap<string, number>,
  ended: boolean,
) {
  const next = new Map(printed);
  const lines: string[] = [];
  for (const message of page) {
    const before = next.get(message.id);
    const added = transcriptPartLines(message, before ?? 0, ended);
    if (added.lines.length > 0) {
      if (before === undefined || before === 0) lines.push("", `${transcriptSpeaker(message)}:`);
      lines.push(...added.lines);
    }
    next.set(message.id, added.printed);
  }
  return { lines, printed: next };
}

/**
 * A turn followed until it ends: each held read past the cursor, its new
 * parts streamed where `print` asks, asked again on the schedule while the
 * agent works. Answers how the turn ended and the transcript as it stood.
 */
function followTurn(agentId: string, print: boolean) {
  return Effect.gen(function* () {
    const { hosted } = yield* session;
    const start = yield* wholeTranscript(agentId);
    const first = pageLines(start.messages, new Map(), false);
    if (print) yield* streamLines(first.lines);
    const state = yield* Ref.make<Following>({
      cursor: start.cursor,
      printed: first.printed,
      messages: new Map(start.messages.map((message) => [message.id, message])),
      status: start.status ?? AGENT_STATUS.RUNNING,
      failureReason: undefined,
    });
    const step = Effect.gen(function* () {
      const held = yield* Ref.get(state);
      const read = yield* askService(
        hosted.messages.agent,
        { id: agentId, after: held.cursor },
        HOSTED_DEADLINE.HELD,
      );
      const ended = cliExitOfAgentStatus(read.status) !== undefined;
      const added = pageLines(read.messages, held.printed, ended);
      if (print) yield* streamLines(added.lines);
      const messages = new Map(held.messages);
      for (const message of read.messages) messages.set(message.id, message);
      const next: Following = {
        cursor: read.cursor,
        printed: added.printed,
        messages,
        status: read.status,
        failureReason: read.failureReason,
      };
      yield* Ref.set(state, next);
      return next;
    });
    const settled = yield* Effect.repeat(step, {
      schedule: Schedule.spaced(FOLLOW_SPACING),
      until: (following) => cliExitOfAgentStatus(following.status) !== undefined,
    });
    // Note that a turn that had ended before the first read leaves parts the first page held back as still written, which are printed whole now.
    if (print) {
      const rest = pageLines([...settled.messages.values()], settled.printed, true);
      yield* streamLines(rest.lines);
    }
    return settled;
  });
}

/** How a turn ended, in words for a person. */
function endedWords(following: Following): string {
  if (following.status === AGENT_STATUS.COMPLETED) return "The agent's turn completed.";
  if (following.status === AGENT_STATUS.CANCELED) return "The agent's turn was stopped.";
  const reason = following.failureReason === undefined ? "" : ` (${following.failureReason})`;
  return `The agent's turn failed${reason}.`;
}

/** A turn waited on, or followed, until it ends or the timeout passes; the answer says how it ended, and the exit code too. */
function waitOn(agentId: string, options: { readonly print: boolean; readonly timeout?: number }) {
  return Effect.gen(function* () {
    const followed = followTurn(agentId, options.print);
    const settled =
      options.timeout === undefined
        ? Option.some(yield* followed)
        : yield* Effect.timeoutOption(followed, Duration.seconds(options.timeout));
    if (Option.isNone(settled)) {
      yield* answer({
        json: { id: agentId, status: AGENT_STATUS.RUNNING, timedOut: true },
        lines: [`The agent is still working after ${options.timeout} seconds.`],
        ids: [agentId],
      });
      return yield* new CommandFailed({
        exit: CLI_EXIT.TIMED_OUT,
        message: "Timed out waiting on the agent's turn.",
      });
    }
    const following = settled.value;
    yield* answer({
      json: {
        id: agentId,
        status: following.status,
        failureReason: following.failureReason ?? null,
        timedOut: false,
      },
      lines: options.print ? ["", endedWords(following)] : [endedWords(following)],
      ids: [agentId],
    });
    return cliExitOfAgentStatus(following.status) ?? CLI_EXIT.OK;
  });
}

/** Ends the command with the turn's exit code where it is not fine, its words already printed. */
function endedWith(exit: number) {
  return exit === CLI_EXIT.OK
    ? Effect.void
    : Effect.fail(
        new CommandFailed({ exit: CLI_EXIT.TURN_FAILED, message: "The turn did not complete." }),
      );
}

const agentArgument = Argument.String("agent").pipe(Argument.withDescription("The agent's id"));

const taskArgument = Argument.String("task").pipe(
  Argument.withDescription("The task, by its id, its number, or its key such as ACME-42"),
);

const promptFlag = Flag.String("file").pipe(
  Flag.withAlias("F"),
  Flag.optional,
  Flag.withDescription("The prompt, from a file or - for stdin (default: the task's description)"),
);

const modelFlag = Flag.String("model").pipe(
  Flag.optional,
  Flag.withDescription("The model to run on, by its catalog id, with --effort"),
);

const effortFlag = Flag.String("effort").pipe(
  Flag.optional,
  Flag.withDescription("The reasoning effort, with --model"),
);

const cloudFlag = Flag.Boolean("cloud").pipe(
  Flag.withDefault(false),
  Flag.withDescription("Run in the cloud"),
);

const onFlag = Flag.String("on").pipe(
  Flag.optional,
  Flag.withDescription("Run on one of your devices, by its name or id"),
);

const followFlag = Flag.Boolean("follow").pipe(
  Flag.withDefault(false),
  Flag.withDescription("Stream the agent's turn until it ends"),
);

const waitFlag = Flag.Boolean("wait").pipe(
  Flag.withDefault(false),
  Flag.withDescription("Wait until the turn ends; the exit code says how"),
);

/** What a start's flags name beside its words: the model and effort, both or neither, where it runs, and how its turn is waited on, one way at most. */
function startFlagsOf(flags: {
  readonly model: Option.Option<string>;
  readonly effort: Option.Option<string>;
  readonly cloud: boolean;
  readonly on: Option.Option<string>;
  readonly follow: boolean;
  readonly wait: boolean;
}) {
  return Effect.gen(function* () {
    if (flags.follow && flags.wait) {
      return yield* new CommandFailed({
        exit: CLI_EXIT.USAGE,
        message: "Name one of --follow and --wait.",
      });
    }
    if (Option.isSome(flags.model) !== Option.isSome(flags.effort)) {
      return yield* new CommandFailed({
        exit: CLI_EXIT.USAGE,
        message: "Name --model and --effort together (vespin models lists them).",
      });
    }
    const runsOn = yield* runsOnOf(flags.cloud, flags.on);
    return {
      ...(Option.isSome(flags.model) ? { model: flags.model.value } : undefined),
      ...(Option.isSome(flags.effort) ? { effort: flags.effort.value } : undefined),
      ...(runsOn === undefined ? undefined : { runsOn }),
    };
  });
}

/** A started agent said in `lines`, then, with --follow or --wait, its turn followed or waited on until it ends. */
function afterStart(
  agent: AgentSummary,
  lines: string[],
  flags: { readonly follow: boolean; readonly wait: boolean },
) {
  return Effect.gen(function* () {
    if (!flags.follow && !flags.wait) {
      yield* answer({ json: agent, lines, ids: [agent.id] });
      return;
    }
    yield* note(lines.join("\n"));
    const exit = yield* waitOn(agent.id, { print: flags.follow });
    if (flags.wait) yield* endedWith(exit);
  });
}

const startCommand = Command.make(
  "start",
  {
    task: taskArgument,
    file: promptFlag,
    model: modelFlag,
    effort: effortFlag,
    cloud: cloudFlag,
    on: onFlag,
    branch: Flag.String("branch").pipe(
      Flag.optional,
      Flag.withDescription(
        "The branch to clone the agent's checkout at, already on GitHub (default: the repository's default branch)",
      ),
    ),
    follow: followFlag,
    wait: waitFlag,
  },
  ({ task, file, branch, ...flags }) =>
    Effect.gen(function* () {
      const chosen = yield* startFlagsOf(flags);
      const prompt = Option.isSome(file) ? yield* readInput(file.value) : undefined;
      const taskId = yield* resolveTaskId(task);
      const agent = yield* startAgent(taskId, {
        ...(prompt === undefined ? undefined : { prompt }),
        ...chosen,
        ...(Option.isSome(branch) ? { branch: branch.value } : undefined),
      });
      yield* afterStart(agent, startedLines(agent), flags);
    }),
).pipe(
  Command.withDescription("Start an agent on a task, handed its description or a prompt"),
  Command.withExamples([
    {
      command: "vespin agent start ACME-42",
      description: "An agent working the task's description",
    },
    {
      command: "vespin agent start ACME-42 --branch fix/login --cloud",
      description: "An agent in the cloud, on a branch already on GitHub",
    },
    {
      command: 'echo "Add a test for the redirect" | vespin agent start ACME-42 -F - --wait',
      description: "An agent on a prompt from stdin, waited on",
    },
    {
      command:
        "vespin agent start ACME-42 --model anthropic/claude-opus-5.5 --effort high --follow",
      description: "Choose the model, and stream the turn",
    },
  ]),
);

const continueCommand = Command.make(
  "continue",
  {
    agent: agentArgument,
    file: Flag.String("file").pipe(
      Flag.withAlias("F"),
      Flag.optional,
      Flag.withDescription(
        "A note handed to the new agent after the transcript, from a file or - for stdin",
      ),
    ),
    at: Flag.String("at").pipe(
      Flag.optional,
      Flag.withDescription(
        "Fork at this assistant message of the agent's transcript, by its id (agent logs --json), instead of continuing: the agent goes on",
      ),
    ),
    model: modelFlag.pipe(
      Flag.withDescription("The model to run on, with --effort (default: the agent's)"),
    ),
    effort: effortFlag,
    cloud: cloudFlag,
    on: onFlag.pipe(
      Flag.withDescription(
        "Run on one of your devices, by its name or id (default: where the agent runs)",
      ),
    ),
    follow: followFlag,
    wait: waitFlag,
  },
  ({ agent: sourceId, file, at, ...flags }) =>
    Effect.gen(function* () {
      const chosen = yield* startFlagsOf(flags);
      const note = Option.isSome(file) ? yield* readInput(file.value) : undefined;
      const agent = yield* continueAgent({
        from: {
          agentId: sourceId,
          ...(Option.isSome(at) ? { messageId: at.value } : undefined),
        },
        ...(note === undefined ? undefined : { note }),
        ...chosen,
      });
      yield* afterStart(agent, continuedLines(sourceId, Option.isSome(at), agent), flags);
    }),
).pipe(
  Command.withDescription(
    "Continue an agent as a new one on its task, handed its brief and transcript, as the app's Continue does; the agent is stopped, and the new one runs as you, on your own plan. --at forks it at a message instead, and it goes on",
  ),
  Command.withExamples([
    {
      command: "vespin agent continue <id>",
      description: "A new agent picks up where this one stopped, failed, or ran out of context",
    },
    {
      command: 'echo "Now add the tests" | vespin agent continue <id> -F - --cloud --wait',
      description: "Continue in the cloud with a note, and wait on it",
    },
    {
      command: "vespin agent continue <id> --at <message-id> --follow",
      description: "Fork at one of its messages, and stream the new agent's turn",
    },
  ]),
);

const listCommand = Command.make(
  "list",
  {
    task: taskArgument.pipe(Argument.optional),
    offset: Flag.Int("offset").pipe(
      Flag.filter(
        (offset) => offset >= 0,
        () => "--offset is a whole number from 0",
      ),
      Flag.optional,
      Flag.withDescription(
        "How many of the workspace's agents to pass over: the nextOffset an earlier list printed",
      ),
    ),
  },
  ({ task, offset }) =>
    Effect.gen(function* () {
      if (Option.isSome(task) && Option.isSome(offset)) {
        return yield* new CommandFailed({
          exit: CLI_EXIT.USAGE,
          message: "A task's agents come on one page; --offset pages the workspace's.",
        });
      }
      const { hosted } = yield* session;
      const workspace = Option.isSome(task) ? undefined : (yield* resolveWorkspace).workspace;
      const listed: { agents: readonly AgentSummary[]; nextOffset?: number } =
        workspace === undefined
          ? yield* askService(hosted.agents.listOfTask, {
              id: yield* resolveTaskId(Option.getOrThrow(task)),
            })
          : yield* askService(hosted.agents.listOfWorkspace, {
              workspaceId: workspace.id,
              ...(Option.isSome(offset) ? { offset: String(offset.value) } : undefined),
            });
      const { agents } = listed;
      // A task's list, and a service before paging, name no next page.
      const nextOffset = listed.nextOffset ?? null;
      yield* answer({
        json: { agents, nextOffset },
        lines: [
          ...(agents.length === 0 ? ["No agents."] : agentLines(agents)),
          ...(nextOffset === null
            ? []
            : [
                "",
                // The next page names its workspace, so it pages the same list whatever the default.
                `More agents stand: vespin agent list -w ${workspace?.slug ?? workspace?.id} --offset ${nextOffset}`,
              ]),
        ],
        ids: agents.map((agent) => agent.id),
      });
    }),
).pipe(
  Command.withDescription(
    "List a task's agents, or the workspace's a page at a time, newest first",
  ),
  Command.withExamples([
    { command: "vespin agent list ACME-42", description: "One task's agents" },
    { command: "vespin agent list -q", description: "The workspace's agents' ids" },
    {
      command: "vespin agent list --offset 50",
      description: "The workspace's next page, from the nextOffset a list printed",
    },
  ]),
);

const viewCommand = Command.make("view", { agent: agentArgument }, ({ agent: id }) =>
  Effect.gen(function* () {
    const { hosted } = yield* session;
    const [{ agent }, published] = yield* Effect.all(
      [
        askService(hosted.agents.read, { id }),
        askService(hosted.agentPullRequests.pullRequest, { id }),
      ],
      { concurrency: "unbounded" },
    );
    const { pullRequest, branch: pushedBranch } = published;
    const checks =
      pullRequest === null
        ? []
        : ((yield* askService(hosted.agentPullRequests.overviewChecks, { id })).pullRequest
            ?.checks ?? []);
    yield* answer({
      json: { ...agent, branch: agent.branch ?? null, pushedBranch, pullRequest, checks },
      lines: [
        `${agent.title ?? agent.model}`,
        ...columns([
          ["Status", agent.status],
          ["Model", `${agent.model} (${agent.effort})`],
          ["Repository", agent.repository ?? "none"],
          ["Sandbox branch", agent.branch ?? "none"],
          ["Pushed branch", pushedBranch ?? "none"],
          [
            "Pull request",
            pullRequest === null
              ? "none"
              : `#${pullRequest.number} ${pullRequest.state}  ${pullRequest.url}`,
          ],
          ["Checks", pullRequest === null ? "none" : pullRequest.checks],
          ["Task", agent.planId ?? "none"],
          ["Id", agent.id],
        ]),
        ...(checks.length === 0
          ? []
          : ["", ...columns(checks.map((check) => [`  ${check.state}`, check.name]))]),
      ],
      ids: [agent.id],
    });
  }),
).pipe(
  Command.withDescription("Show an agent: where it stands, its branch, pull request, and checks"),
  Command.withExamples([
    { command: "vespin agent view <id>", description: "One agent" },
    { command: "vespin agent view <id> --json", description: "The same, as JSON" },
  ]),
);

const logsCommand = Command.make(
  "logs",
  {
    agent: agentArgument,
    follow: Flag.Boolean("follow").pipe(
      Flag.withAlias("f"),
      Flag.withDefault(false),
      Flag.withDescription("Stream the turn under way until it ends"),
    ),
  },
  ({ agent: id, follow }) =>
    Effect.gen(function* () {
      if (follow) {
        const following = yield* followTurn(id, true);
        yield* answer({
          json: {
            id,
            status: following.status,
            failureReason: following.failureReason ?? null,
            messages: [...following.messages.values()],
          },
          lines: ["", endedWords(following)],
          ids: [id],
        });
        return;
      }
      const { messages, status } = yield* wholeTranscript(id);
      yield* answer({
        json: { id, status: status ?? null, messages },
        lines: pageLines(messages, new Map(), true).lines,
        ids: [id],
      });
    }),
).pipe(
  Command.withDescription(
    "Print an agent's transcript; --follow streams the turn under way (with --json, the whole transcript once it ends)",
  ),
  Command.withExamples([
    { command: "vespin agent logs <id>", description: "The transcript so far" },
    { command: "vespin agent logs <id> --follow", description: "Stream the turn live" },
  ]),
);

const sendCommand = Command.make(
  "send",
  {
    agent: agentArgument,
    file: Flag.String("file").pipe(
      Flag.withAlias("F"),
      Flag.withDescription("The message, from a file or - for stdin"),
    ),
  },
  ({ agent: id, file }) =>
    Effect.gen(function* () {
      const text = yield* readInput(file);
      const { hosted } = yield* session;
      const { agent } = yield* askService(
        hosted.messages.send,
        { params: { id }, body: { text, clientKey: crypto.randomUUID() } },
        HOSTED_DEADLINE.STEER,
      );
      yield* answer({ json: agent, lines: [`Sent to agent ${agent.id}.`], ids: [agent.id] });
    }),
).pipe(
  Command.withDescription("Message an agent; it reads it at its next step, or starts a turn on it"),
  Command.withExamples([
    {
      command: 'echo "Also update the README" | vespin agent send <id> -F -',
      description: "A follow-up from stdin",
    },
  ]),
);

const stopCommand = Command.make("stop", { agent: agentArgument }, ({ agent: id }) =>
  Effect.gen(function* () {
    const { hosted } = yield* session;
    const { agent } = yield* askService(hosted.agents.stop, { id });
    yield* answer({ json: agent, lines: [`Stopped agent ${agent.id}.`], ids: [agent.id] });
  }),
).pipe(
  Command.withDescription("Stop an agent's turn; what it pushed stays"),
  Command.withExamples([{ command: "vespin agent stop <id>", description: "Stop the turn" }]),
);

const waitCommand = Command.make(
  "wait",
  {
    agent: agentArgument,
    timeout: Flag.Int("timeout").pipe(
      Flag.optional,
      Flag.withDescription("Give up after this many seconds, exiting 6"),
    ),
  },
  ({ agent: id, timeout }) =>
    Effect.gen(function* () {
      const exit = yield* waitOn(id, {
        print: false,
        ...(Option.isSome(timeout) ? { timeout: timeout.value } : undefined),
      });
      yield* endedWith(exit);
    }),
).pipe(
  Command.withDescription(
    "Wait until an agent's turn ends: exit 0 when it completed, 5 when it failed or was stopped, 6 on --timeout",
  ),
  Command.withExamples([
    { command: "vespin agent wait <id>", description: "Block until the turn ends" },
    {
      command: "vespin agent wait <id> --timeout 600 && vespin agent checkout <id>",
      description: "Bring the work here once it completed",
    },
  ]),
);

const checkoutCommand = Command.make("checkout", { agent: agentArgument }, ({ agent: id }) =>
  Effect.gen(function* () {
    const { hosted } = yield* session;
    const [{ agent }, published] = yield* Effect.all(
      [
        askService(hosted.agents.read, { id }),
        askService(hosted.agentPullRequests.pullRequest, { id }),
      ],
      { concurrency: "unbounded" },
    );
    const repository = agent.repository ?? published.repository;
    const branch = agent.branch ?? published.branch;
    if (repository === null || branch === null) {
      return yield* new CommandFailed({
        exit: CLI_EXIT.REFUSED,
        message: "The agent has no branch yet.",
      });
    }
    const here = yield* originRepository;
    if (here.toLowerCase() !== repository.toLowerCase()) {
      return yield* new CommandFailed({
        exit: CLI_EXIT.REFUSED,
        message: `This folder is ${here}, and the agent works in ${repository}. Run this in a checkout of ${repository}.`,
      });
    }
    if (!(yield* originHasBranch(branch))) {
      return yield* new CommandFailed({
        exit: CLI_EXIT.REFUSED,
        message: `The agent hasn't pushed ${branch} yet.`,
      });
    }
    if (!(yield* treeIsClean)) {
      return yield* new CommandFailed({
        exit: CLI_EXIT.REFUSED,
        message: "This checkout has changes. Commit or stash them, then run this again.",
      });
    }
    yield* checkoutFromOrigin(branch);
    yield* answer({
      json: { id, repository, branch },
      lines: [`Checked out ${branch}.`],
      ids: [branch],
    });
  }),
).pipe(
  Command.withDescription(
    `Fetch an agent's branch from GitHub and check it out in this folder, as gh pr checkout does`,
  ),
  Command.withExamples([
    { command: "vespin agent checkout <id>", description: "Bring the agent's work here" },
  ]),
);

const portsCommand = Command.make("ports", { agent: agentArgument }, ({ agent: id }) =>
  Effect.gen(function* () {
    const { hosted } = yield* session;
    const listed = yield* askService(hosted.agentPorts.list, { id });
    // Note that a sandbox not running shares nothing, so its share is not read.
    const { shared } = listed.running
      ? yield* askService(hosted.agentPorts.shared, { id })
      : { shared: null };
    const portLines = columns(
      listed.ports.map((port) => [String(port), port === shared?.port ? shared.url : ""]),
    );
    yield* answer({
      json: { ...listed, shared },
      lines: !listed.running
        ? ["The agent's sandbox is not running."]
        : listed.ports.length === 0
          ? ["Nothing listens in the agent's sandbox."]
          : portLines,
      ids: listed.ports.map(String),
    });
  }),
).pipe(
  Command.withDescription(
    "List the ports a server listens on in an agent's cloud sandbox, and the one shared by link",
  ),
  Command.withExamples([
    { command: "vespin agent ports <id>", description: "The ports, the shared one with its link" },
    { command: "vespin agent ports <id> -q", description: "The port numbers alone" },
  ]),
);

/** What a share says of the port shared now: the port and its link, or that none is. */
function sharedLines(shared: { readonly port: number; readonly url: string } | null): string[] {
  return shared === null
    ? ["No port is shared."]
    : [`Port ${shared.port} is shared at ${shared.url}`];
}

const shareCommand = Command.make(
  "share",
  {
    agent: agentArgument,
    port: Argument.Int("port").pipe(
      Argument.filter(
        (port) => port >= FORWARD_PORT.MIN && port <= FORWARD_PORT.MAX,
        () => `The port is a number from ${FORWARD_PORT.MIN} to ${FORWARD_PORT.MAX}`,
      ),
      Argument.withDescription("The port to share, replacing any shared before"),
      Argument.optional,
    ),
    stop: Flag.Boolean("stop").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Stop sharing; the link closes"),
    ),
  },
  ({ agent: id, port, stop }) =>
    Effect.gen(function* () {
      if (stop && Option.isSome(port)) {
        return yield* new CommandFailed({
          exit: CLI_EXIT.USAGE,
          message: "Name a port to share, or --stop, not both.",
        });
      }
      const { hosted } = yield* session;
      if (stop) {
        const stopped = yield* askService(hosted.agentPorts.unshare, { id });
        yield* answer({ json: stopped, lines: ["Stopped sharing."], ids: [] });
        return;
      }
      if (Option.isSome(port)) {
        const { url } = yield* askService(hosted.agentPorts.share, {
          params: { id },
          body: { port: port.value },
        });
        const shared = { port: port.value, url };
        yield* answer({ json: { shared }, lines: sharedLines(shared), ids: [url] });
        return;
      }
      const { shared } = yield* askService(hosted.agentPorts.shared, { id });
      yield* answer({
        json: { shared },
        lines: sharedLines(shared),
        ids: shared === null ? [] : [shared.url],
      });
    }),
).pipe(
  Command.withDescription(
    "Share a port of an agent's running cloud sandbox by public link, show the link, or stop sharing",
  ),
  Command.withExamples([
    { command: "vespin agent share <id> 3000", description: "Share port 3000, printing its link" },
    { command: "vespin agent share <id> -q", description: "The link shared now, alone" },
    { command: "vespin agent share <id> --stop", description: "Close the link" },
  ]),
);

/** The agent group: start, continue, and the rest through share, and its shells. */
export const agentCommand = Command.make("agent").pipe(
  Command.withDescription(
    `Start, continue, follow, message, and stop ${PRODUCT_NAME}'s coding agents`,
  ),
  Command.withSubcommands([
    startCommand,
    continueCommand,
    listCommand,
    viewCommand,
    logsCommand,
    sendCommand,
    stopCommand,
    waitCommand,
    checkoutCommand,
    portsCommand,
    shareCommand,
    shellCommand,
    shellsCommand,
  ]),
  Command.withExamples([
    { command: "vespin agent start ACME-42 --wait", description: "Start an agent, and wait on it" },
    { command: "vespin agent logs <id> --follow", description: "Stream its turn" },
  ]),
);
