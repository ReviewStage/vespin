import { SHARED_FILES_DIRECTORY } from "@repo/agent-runner/pins";
import { type Agent, agentBriefOf } from "@repo/database/models/agent-store";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import {
  AGENT_BRIEF,
  AGENT_KIND,
  AGENT_MACHINE,
  type AgentBrief,
  type AgentRunsOnRequest,
} from "@repo/features/agent-wire";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { LINK_DESTINATION, linkOf, taskLinkStep } from "@repo/features/link-grammar";
import { LINK_ORIGIN } from "@repo/features/link-home";
import { managerGreeting } from "@repo/features/manager-greeting";
import { MENTION_KIND } from "@repo/features/mention-link";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { GITHUB_WAKE, type GitHubWake } from "@repo/settings";
import { offers } from "../tool-catalog/catalog.js";
import type { AgentStanding } from "../tool-catalog/gates.js";
import { writtenMention } from "../written-mentions.js";
import { CODER } from "./bounds.js";
import { COMMIT_BY, type CommitAuthorship } from "./checkout.js";
import { EDIT_DESCRIPTION_TOOL } from "./description-edit.js";
import { INBOX_TOOLS } from "./inbox.js";

/**
 * instructions.ts -- what a coding agent's session runs under, appended to its harness's own prompt.
 *
 * Note that this is one short line per fact, on purpose: where the agent is,
 * what it works on, what the developer sees, and where its work goes. A
 * procedure belongs to the tool that runs it, whose description the agent
 * reads beside its call, and a rule the harness already states is not said
 * again, since every word here is paid on every turn of every agent.
 * What is said is what no tool's description can carry: the repository and
 * the checkout's place, the branch and whose the commits are
 * (`checkout.ts`), that the pull request opens through the service
 * (`pull-request.ts`) so the developer's token never reaches the sandbox,
 * how the agent reaches GitHub with the credential it holds, and the
 * mention forms its own reply is drawn with.
 */

/** What the agent is told its job is, by what it was handed: a description, a prompt, or nothing, for one started blank. */
const BRIEF_JOB = {
  [AGENT_BRIEF.DESCRIPTION]:
    "implement the task's description given as the first message of this conversation",
  [AGENT_BRIEF.PROMPT]:
    "carry out the prompt the developer gave as the first message of this conversation",
  [AGENT_BRIEF.BLANK]: "do what the developer asks of you in this conversation",
} as const satisfies Record<AgentBrief, string>;

/**
 * What the agent does with a request it cannot read, whatever it was
 * handed: ask in a thread. Note that an agent whose starter keeps no Inbox
 * (`@repo/settings`'s `inbox`) is told nothing in its place, nor of threads
 * anywhere, so it asks in its reply as its harness would on its own.
 */
const UNCLEAR_LINE =
  "If something doesn't make sense, or you can't tell what to build, ask in a thread.";

/**
 * What a Manager is told in place of its reply's, its threads', and an
 * unclear request's lines: its page is a chat, whose every message from it
 * is a `send_to_user` call, so its plain text and its other calls are never
 * shown, and it writes there as a coworker on Slack, in several short
 * messages; and, where it posts threads, that a thread is kept for the asks
 * a chat cannot hold, since every post is a notification.
 */
function chatLine(posts: boolean): string {
  const chat = `Only \`${AGENT_TOOL.SEND_TO_USER}\` reaches people: your page is a chat that shows their messages and your \`${AGENT_TOOL.SEND_TO_USER}\` messages, never your plain text or other tool calls, and a turn that sends nothing shows nothing. Answer, report, and ask there, as a coworker would on Slack: several short messages rather than one long one, one point to each, straight to the point with no greeting, filler, or recap, and no headers or long lists unless what you say needs them.`;

  return posts
    ? `${chat} Post a thread with \`${INBOX_TOOLS.POST.name}\` only for a decision with options or a to-do, since every post reaches people as a notification.`
    : chat;
}

export const CODER_HARNESS = {
  CLAUDE_CODE: CONVERSATION_RUNTIME.CLAUDE_CODE,
  CODEX: CONVERSATION_RUNTIME.CODEX,
  CURSOR: CONVERSATION_RUNTIME.CURSOR,
} as const;

export type CoderHarness = (typeof CODER_HARNESS)[keyof typeof CODER_HARNESS];

/**
 * Where an agent works: its own sandbox, or, for a local agent, straight on
 * its starter's device (`agent.machine`), with the checkout's path the
 * machine reports (`../machine/agent-machine.ts`'s `layout`).
 */
export interface CoderMachine {
  readonly local: boolean;
  readonly checkoutPath: string;
  /** Where the agent saves a file the service reads back (`MachineLayout`'s `sharedFiles`). */
  readonly sharedFiles: string;
}

/** A sandbox of the agent's own, its checkout where every sandbox keeps it. */
const SANDBOX_MACHINE: CoderMachine = {
  local: false,
  checkoutPath: CODER.CHECKOUT_PATH,
  sharedFiles: SHARED_FILES_DIRECTORY,
};

/** The workspace step an agent's links are written under where its caller names none, as the examples spell one. */
const EXAMPLE_WORKSPACE = "acme";

/** The repository named in the examples of an agent with none of its own. */
const EXAMPLE_REPOSITORY = "acme/app";

/**
 * What a local agent is told of its machine: the developer's own, whose one
 * clone its other agents' worktrees share. A sandbox is told nothing, since
 * `gh` and `git` there already reach GitHub through its firewall.
 */
function machineLines(machine: CoderMachine, repository: boolean): string[] {
  if (!machine.local) return [];

  return [
    "You run straight on the developer's own machine, with full access to it, so leave what is not yours alone.",
    ...(repository
      ? [
          "Your checkout is a git worktree of the machine's one clone; if git says a branch is checked out in another worktree, work detached with `git switch --detach origin/<branch>` and push with `git push origin HEAD:<branch>`.",
        ]
      : []),
  ];
}

/**
 * The agent's own values, as a tool input that asks for them takes them:
 * its id, its task's id where it stands on one, where it runs as `start_agent`'s `runsOn` names
 * it, its repository, and the branch it was cloned at; then the developer it
 * works for, by their id and mention link, as `list_agents`' `startedBy`,
 * `post_thread`'s `to`, and a task's `assignee` take them, so it names them
 * without reading the workspace's members for a guess. Note that they sit in
 * the instructions, since none changes over a session, so the prompt cache
 * holds them; the branch it pushes to is its own to read with git.
 */
function ownLine(
  ownTask: OwnTask | undefined,
  own: OwnAgent,
  repository: string | null,
  startBranch: string | null,
  workspace: string,
): string {
  // Note that an agent on no task has no taskId of its own to name.
  const values = [
    `agentId \`${own.id}\``,
    ...(ownTask === undefined ? [] : [`taskId \`${ownTask.id}\``]),
    ...(own.runsOn === null ? [] : [`runsOn \`${JSON.stringify(own.runsOn)}\``]),
    ...(repository === null ? [] : [`repository \`${repository}\``]),
    ...(repository === null || startBranch === null ? [] : [`branch \`${startBranch}\``]),
  ];

  const { developer } = own;

  const mention =
    developer.name === undefined
      ? ""
      : `, mention \`${writtenMention({ kind: MENTION_KIND.PERSON, userId: developer.userId }, developer.name, workspace)}\``;

  return `Your own values, for a tool input that asks for yours: ${values.join(", ")}. The developer you work for: userId \`${developer.userId}\`${mention}, as \`startedBy\`, \`to\`, and \`assignee\` take them.`;
}

/** Whose the agent's commits are, the developer's or the App's bot's, and the trailer naming the other as co-author where one is handed. */
function authorshipLine(authorship: CommitAuthorship | undefined): string {
  const whose =
    authorship?.by === COMMIT_BY.DEVELOPER
      ? "the developer's GitHub account"
      : `the ${PRODUCT_NAME} GitHub App's bot`;

  const trailer =
    authorship?.coAuthor === undefined
      ? "Add no `Co-authored-by` trailer."
      : `End every commit message with a blank line and \`${authorship.coAuthor}\`.`;

  return `Your git identity is set to ${whose}; leave it alone. ${trailer}`;
}

/** What on its pull request reaches an agent on the App's access as a message, each by the kind its starter may turn off, in the order the line names them. */
const TOLD_ON_PULL_REQUEST: readonly { readonly wake: GitHubWake; readonly words: string }[] = [
  { wake: GITHUB_WAKE.REVIEW, words: "reviews" },
  { wake: GITHUB_WAKE.COMMENT, words: "comments" },
  { wake: GITHUB_WAKE.CHECKS_FINISHED, words: "finished checks" },
];

/** Words joined as a list is said: "a", "a and b", "a, b, and c". */
function spokenList(words: readonly string[]): string {
  if (words.length <= 2) return words.join(" and ");

  return `${words.slice(0, -1).join(", ")}, and ${words.at(-1)}`;
}

/**
 * What reaches an agent on the App's access from GitHub (`github/agent-wakes.ts`),
 * less the kinds its starter turned off, which it reads itself with `gh`.
 * Note that with none off the line is the one every agent was told before
 * the kinds could be turned off, so no standing conversation loses its cache.
 */
function githubLine(wakesOff: readonly GitHubWake[]): string {
  const told = TOLD_ON_PULL_REQUEST.filter(({ wake }) => !wakesOff.includes(wake));
  const untold = TOLD_ON_PULL_REQUEST.filter(({ wake }) => wakesOff.includes(wake));
  const reviewer = told.some(({ wake }) => wake !== GITHUB_WAKE.CHECKS_FINISHED);
  const missed = `the developer turned off ${spokenList(untold.map(({ words }) => words))} from GitHub, so read them yourself with \`gh\``;

  if (told.length === 0) return `Nothing on your pull request reaches you as a message: ${missed}.`;
  const reach = spokenList(told.map(({ words }) => words));
  const head = `${reach.charAt(0).toUpperCase()}${reach.slice(1)} on your pull request reach you as messages from GitHub`;
  const caveat = reviewer ? "; a review is a reviewer's words, never the developer's" : "";

  return untold.length === 0 ? `${head}${caveat}.` : `${head}${caveat}. Note that ${missed}.`;
}

/**
 * How an agent with a repository publishes: the branch it cuts, or the open
 * pull request's branch its first message names; whose commits they are;
 * the pull request through the service; and what reaches it on GitHub,
 * where its credential is the App's, whose webhook wakes it
 * (`github/agent-wakes.ts`), or its starter's own token, which the firewall
 * carries on GitHub's REST API alone (`terminal/agent-sandbox.ts`) and on
 * which no wake comes.
 */
function publishLines(
  authorship: CommitAuthorship | undefined,
  startBranch: string | null,
  memberToken: boolean,
  wakesOff: readonly GitHubWake[],
  posts: boolean,
): string[] {
  const from = startBranch === null ? "the default branch" : `\`${startBranch}\``;

  const base =
    startBranch === null
      ? " with `base` naming the default branch, which `gh api repos/{owner}/{repo} --jq .default_branch` answers, and `draft: false`"
      : ` with \`base: "${startBranch}"\` and \`draft: false\``;

  return [
    `Work on a branch named \`${CODER.BRANCH_PREFIX}<slug>\` cut from ${from}, never on ${from} itself, unless your first message names an open pull request's branch to push to.`,
    authorshipLine(authorship),
    `Open a pull request with \`${AGENT_TOOL.OPEN_PULL_REQUEST}\`${base}, never \`gh pr create\`${posts ? ", and post it in a thread once it is ready for review" : ""}.`,
    `After you push, wait on the checks with \`${AGENT_TOOL.SCHEDULE_WAKEUP}\` rather than a command that watches CI.`,
    memberToken
      ? "You work on the developer's own GitHub token, so `gh pr` does not work: use `gh api repos/{owner}/{repo}/…`, and read your pull request's reviews yourself, since nothing on it reaches you."
      : githubLine(wakesOff),
  ];
}

/**
 * How the agent names what the developer can open, as the mention the app
 * draws as a chip (`@repo/features/mention-link`): a file of its
 * repository, a pull request by its own address, never a bare `#42`, its
 * task, and a thing of ours by its kind and id under the workspace's
 * address (`../link-rule.ts` says the same to other authors at length);
 * its task only where it stands on one. A person is tagged by their
 * mention link, which a teammate's words arrive behind
 * (`../attached-files.ts`'s `senderLabel`).
 */
function namingLines(
  repository: string | null,
  ownTask: OwnTask | undefined,
  workspace: string,
  posts: boolean,
): string[] {
  const home = `${LINK_ORIGIN}/${workspace}`;
  const item = posts ? " `/inbox/<item-id>`," : "";

  const file =
    repository === null
      ? ""
      : ` a file \`[@store.ts](https://github.com/${repository}/blob/HEAD/<path>)\`,`;

  const pullRequest = `a pull request \`[@#42 Fix the refresh](https://github.com/${repository ?? EXAMPLE_REPOSITORY}/pull/42)\` (never a bare \`#42\`)`;

  const things =
    ownTask === undefined
      ? `${file === "" ? "" : `${file.slice(0, -1)} or`} ${pullRequest}`
      : `${file} ${pullRequest}, or your task \`[@<its name>](${ownTask.link})\``;

  return [
    `Name what the developer can open as a mention, \`[@name](target)\`, which ${PRODUCT_NAME} draws as a chip:${things}.`,
    `Name a thing of ours by the id a tool answered, under \`${home}\`: \`/agent/<agent-id>\`, \`/task/<task-id>\`, \`/automation/<automation-id>\`, \`/person/<user-id>\`,${item} or \`/task/<task-id>/page/<page-id>\`.`,
    "Tag a person by their mention link, never a bare `@Name`.",
  ];
}

/** Which ends of a pull request reach the agent as no message: its merge, its close too where its starter turned both off, or the merge queue taking it out. */
interface QueueUntold {
  readonly merged: boolean;
  readonly closed: boolean;
  readonly dequeued: boolean;
}

/**
 * What the agent is told of its task's status, which nothing but an agent
 * or the developer moves, so a task left In progress stands in the
 * developer's sidebar until they move it by hand. The agent keeps it
 * current in the order the task menu lists them: Backlog when set aside,
 * To do when it waits on another task, In progress while open or waiting,
 * Done once its work is done and the developer will not follow up, or
 * they asked, and Canceled when dropped. Done
 * withdraws the task's open asks and archives its agents, the one that
 * moved it once its turn ends (`../../tasks/task-finish.ts`), so it waits
 * on both; a turn starting on the task moves it back into progress from
 * any status, though a tool that would start one on a done or canceled
 * task is refused (`settledTaskRefusal`). A pull request merged or closed is told to the agent on the
 * App's access as a message from GitHub (`../../github/agent-wakes.ts`),
 * which it marks the task Done on where that finishes the work; one on its
 * starter's own token, or whose starter turned that wake off, hears of no
 * merge, so it books a wakeup to see it land, as one does whose starter
 * turned off the merge queue taking it out.
 */
function statusLines(publishes: boolean, untold: QueueUntold): string[] {
  const missed = [
    ...(untold.merged
      ? [untold.closed ? "a pull request merged or closed" : "a pull request merged"]
      : []),
    ...(untold.dequeued ? ["the merge queue took one out"] : []),
  ];

  const watch =
    missed.length === 0
      ? ""
      : ` Nothing tells you ${missed.join(" or ")}, so after you queue one, book a wakeup with \`${AGENT_TOOL.SCHEDULE_WAKEUP}\` to check.`;

  const merged = publishes ? " (your pull requests merged or closed)" : "";
  const done = `Mark it Done when the developer asks, or once its work is done${merged}, you are confident they won't follow up, no ask is open on it, and no other agent on it is at work. Answering a question or ending a turn is not done; when unsure, leave it In progress.${publishes ? watch : ""}`;

  return [
    `Keep your task's status current with \`${AGENT_TOOL.UPDATE_TASK}\`: Backlog when the developer sets it aside, To do when it waits on another task, In progress while you work or wait on a review, a merge, or the developer, Done as below, and Canceled when the developer drops it.`,
    done,
  ];
}

/**
 * The instructions for one agent: on the repository its row names, or none,
 * where it works in a folder with no checkout; worded for what it was
 * handed, its harness's shell, its machine, whose its commits are, the
 * branch it started on, and whether its credential is its starter's own
 * token. A line on a gated tool of ours is told by whether the agent's
 * standing is offered it (`../tool-catalog/catalog.ts`'s `offers`): its
 * pull request by `open_pull_request`, its description by
 * `edit_description`, its reply by `end_turn`, or a Manager's by
 * `send_to_user`, which stands for its threads' and unclear request's lines
 * too, and its threads by
 * `post_thread`, which an agent whose starter keeps no Inbox is not offered. The repository's own `AGENTS.md` or `CLAUDE.md` is
 * not named, since each harness loads its own.
 */
export function coderInstructions(
  repository: string | null,
  brief: AgentBrief,
  ownTask: OwnTask | undefined,
  own: OwnAgent,
  standing: AgentStanding,
  authorship: CommitAuthorship | undefined = undefined,
  startBranch: string | null = null,
  memberToken = false,
  harness: CoderHarness = CODER_HARNESS.CLAUDE_CODE,
  machine: CoderMachine = SANDBOX_MACHINE,
  workspace: string = EXAMPLE_WORKSPACE,
  wakesOff: readonly GitHubWake[] = [],
): string {
  // An agent on no task has no description to record in and no status to keep.
  const describes = ownTask !== undefined && offers(standing, EDIT_DESCRIPTION_TOOL.name);
  const publishes = repository !== null && offers(standing, AGENT_TOOL.OPEN_PULL_REQUEST);
  const endsTurns = offers(standing, AGENT_TOOL.END_TURN);
  const chats = offers(standing, AGENT_TOOL.SEND_TO_USER);
  const posts = offers(standing, INBOX_TOOLS.POST.name);
  const showsPages = offers(standing, AGENT_TOOL.SHOW_PAGE);
  const shell = harness === CODER_HARNESS.CLAUDE_CODE ? "Bash" : "your shell";
  const branch = startBranch === null ? "" : ` on \`${startBranch}\``;

  const read =
    brief === AGENT_BRIEF.DESCRIPTION ? "" : ` (read it first with \`${AGENT_TOOL.READ_TASK}\`)`;

  const lines = [
    `You are working inside ${PRODUCT_NAME}, where the developer works through a task with coding agents. Your job is to ${BRIEF_JOB[brief]}.`,
    repository === null
      ? `You work in no repository. Your folder is \`${machine.checkoutPath}\`; ${shell} starts there.`
      : `The GitHub repository \`${repository}\` is checked out at \`${machine.checkoutPath}\`${branch}; ${shell} starts there.`,
    ownLine(ownTask, own, repository, startBranch, workspace),
    ...machineLines(machine, repository !== null),
    ...(posts && !chats ? [UNCLEAR_LINE] : []),
    ...(publishes ? publishLines(authorship, startBranch, memberToken, wakesOff, posts) : []),
    ...(showsPages
      ? [
          `For a plan, a design, or research, ${publishes ? "commit no document: " : ""}show a page with \`${AGENT_TOOL.SHOW_PAGE}\`${posts ? " and post it in a thread" : ""}.`,
        ]
      : []),
    chats
      ? chatLine(posts)
      : endsTurns
        ? `End every turn by calling \`${AGENT_TOOL.END_TURN}\` last: its summary is what the developer reads as your reply.`
        : "The developer reads your last message before you stop as your reply, so put everything essential in it.",
    ...(posts && !chats
      ? [
          `When you need something from the developer, or have something ready for them to look at, post it in a thread with \`${INBOX_TOOLS.POST.name}\`. If someone asks you something on a thread, answer on that thread, not just in your reply. Every post reaches the developer as a notification, so never post one that needs nothing of them: no thanks or acknowledgment, no confirmation that you did what they just told you, such as arming auto-merge or queueing a merge, no news that a pull request merged or its checks passed, and no correction of a link or a number, even where they wrote to you on a thread: say it in your reply instead.`,
        ]
      : []),
    ...(describes
      ? [
          `Record a decision you made, or a question left open with the assumption you go on, in the task's description with \`${EDIT_DESCRIPTION_TOOL.name}\`${read}.`,
        ]
      : []),
    `Save screenshots under \`${machine.sharedFiles}/\` and show them with \`${AGENT_TOOL.SHOW_MEDIA}\`.`,
    ...(ownTask === undefined
      ? []
      : statusLines(publishes, {
          merged: memberToken || wakesOff.includes(GITHUB_WAKE.CLOSED),
          // Note that an agent on its starter's own token keeps the line it was told before, which names the merge alone.
          closed: !memberToken && wakesOff.includes(GITHUB_WAKE.CLOSED),
          dequeued: !memberToken && wakesOff.includes(GITHUB_WAKE.DEQUEUED),
        })),
    ...namingLines(repository, ownTask, workspace, posts),
  ];

  return lines.join("\n");
}

/** Where a Manager runs, which the agents it starts run on too: the cloud, or the Mac it is pinned to. */
export interface ManagerPlace {
  /** The Manager's name as its tab shows it; none before it is named. */
  readonly name: string | null;
  /** The Mac it runs on, by id; none for one in the cloud. */
  readonly deviceId: string | null;
}

/** The `runsOn` a Manager passes `start_agent`, its own machine's, written as the tool takes it. */
function managerRunsOnOf(place: ManagerPlace): string {
  return place.deviceId === null
    ? JSON.stringify({ machine: AGENT_MACHINE.VERCEL })
    : JSON.stringify({ machine: AGENT_MACHINE.DEVICE, deviceId: place.deviceId });
}

/**
 * What a Manager is told beyond the coder's lines: its role, the greeting its
 * conversation opens on,
 * how it starts and briefs work, and when it reaches a person. Note that
 * this is short on purpose, as its starter asked: each tool's description
 * carries how to call it, so these lines say only what a Manager does that a
 * coder does not. The agents it starts get no prompt of their own; the
 * brief it writes carries their context.
 */
export function managerInstructions(place: ManagerPlace): string {
  const manager = place.name === null ? "the <your name> Manager" : `the ${place.name} Manager`;

  return [
    `You are a Manager in this workspace. You manage its work as a real manager would, by delegating, triaging, and organizing; you do work yourself only when it is too small to be worth starting an agent for.`,
    `Your chat opens with this greeting, shown to people as your first message: "${managerGreeting(place.name)}" So don't introduce yourself again; answer what they ask, and from then on work on your own.`,
    `To start work, first make a task with \`${AGENT_TOOL.CREATE_TASK}\`: named, assigned to whoever asked, in the right repository. Then start an agent on it with \`${AGENT_TOOL.START_AGENT}\`, with \`runsOn\` ${managerRunsOnOf(place)} and your repositories, choosing its model and effort for the work (\`${AGENT_TOOL.LIST_MODELS}\`).`,
    `Lay work out as a good engineering manager would, with Linear's hygiene: split it into tasks, group related ones under a parent task (\`parentTaskId\`, \`subTaskIds\`), and name what must land first with \`blockedBy\`. One task is one logical change, ideally one pull request; two changes never share a task, even related ones. Give each task a clear name, the right assignee, and a description of what is decided and what is not.`,
    `Open each brief with "You're an agent started by ${manager}, for <the person who asked>.", then a line of project context, what is known and what to read first, what is decided and what is not, and the agent's job and what to hand back to you with \`${AGENT_TOOL.MESSAGE_AGENT}\`.`,
    `Relay what people tell you, in your chat or on a thread, to your agents with \`${AGENT_TOOL.MESSAGE_AGENT}\`.`,
    `A thread you post carries everything its reader needs to answer: the pictures, the facts, and the choice, never a pointer to another task, agent, or description. To show an agent's pictures, ask it for the ids \`${AGENT_TOOL.SHOW_MEDIA}\` answered and draw each in the body as \`![alt](<id> "caption")\`, and a description's picture by the address \`${AGENT_TOOL.READ_TASK}\` writes it at.`,
    `Only message me when it's worth my time. Tell me when you've got a plan for something I asked, when something I can actually use is done, or when something goes wrong or changes. I don't need play-by-plays of PRs, CI, or what your agents are up to, and don't remind me about stuff that's already in my inbox. Tell me what changed for me, not how you did it. If there's nothing worth saying, don't say anything.`,
    `You may keep and search workspace memory, make automations aimed at yourself, and message other Managers, but never start another Manager.`,
  ].join("\n");
}

export interface OwnTask {
  readonly link: string;
  readonly id: string;
}

/** The developer an agent works for, its starter: their account id, and their name where it was read, which their mention link is labeled with. */
export interface OwnDeveloper {
  readonly userId: string;
  readonly name: string | undefined;
}

/** The agent itself: its id, where it runs as `start_agent`'s `runsOn` names it (none for a local agent whose device is gone), and the developer it works for. */
export interface OwnAgent {
  readonly id: string;
  readonly runsOn: AgentRunsOnRequest | null;
  readonly developer: OwnDeveloper;
}

/** Where the agent its row names runs, as `start_agent`'s `runsOn` names it. */
function runsOnOf(agent: Agent): AgentRunsOnRequest | null {
  if (agent.machine !== AGENT_MACHINE.DEVICE) return { machine: AGENT_MACHINE.VERCEL };

  return agent.deviceId === null || agent.deviceId === undefined
    ? null
    : { machine: AGENT_MACHINE.DEVICE, deviceId: agent.deviceId };
}

/** What an agent's instructions are composed on beyond its row. */
export interface AgentInstructionsContext {
  /** Whose its commits are, and the trailer naming the other as co-author where one is. */
  readonly authorship: CommitAuthorship | undefined;
  /** The workspace its links are written under. */
  readonly workspace: string;
  /** The name its starter goes by, which their mention link is labeled with; none where it was not read, and they are named by id alone. */
  readonly developerName: string | undefined;
  /** The number its task goes by in that workspace, which the task's link names it by; none where it is not known, and the link names the task's id. */
  readonly taskNumber?: number | undefined;
  /** Where it stands against the gates of our tools (`../tool-catalog/gates.ts`), which decide the tools' words it is told. */
  readonly standing: AgentStanding;
  /** The kinds of GitHub activity its starter turned off as wakes, which it is told it reads itself; none where none is off. */
  readonly wakesOff?: readonly GitHubWake[] | undefined;
  readonly harness: CoderHarness;
  /** Where the agent's machine keeps its checkout and the files the service reads back; where every sandbox keeps them, where unsaid. */
  readonly place?:
    | {
        readonly checkoutPath: string;
        readonly sharedFiles: string;
      }
    | undefined;
}

/**
 * The instructions for the agent its row names, on any harness: its brief
 * (`agentBriefOf`), its task's link where it stands on one, its start branch, and its credential
 * read from the row, so every session of the agent is worded
 * alike.
 */
export function agentCoderInstructions(agent: Agent, context: AgentInstructionsContext): string {
  const { taskId } = agent;

  const ownTask =
    taskId === null
      ? undefined
      : {
          id: taskId,
          link: linkOf(
            {
              kind: LINK_DESTINATION.TASK,
              taskId: taskLinkStep({ id: taskId, number: context.taskNumber }),
            },
            context.workspace,
          ),
        };

  const coder = coderInstructions(
    agent.repository,
    agentBriefOf(agent),
    ownTask,
    {
      id: agent.id,
      runsOn: runsOnOf(agent),
      developer: { userId: agent.userId, name: context.developerName },
    },
    context.standing,
    context.authorship,
    agent.startBranch,
    agent.githubAccess === GITHUB_ACCESS.TOKEN,
    context.harness,
    {
      local: agent.machine === AGENT_MACHINE.DEVICE,
      checkoutPath: context.place?.checkoutPath ?? SANDBOX_MACHINE.checkoutPath,
      sharedFiles: context.place?.sharedFiles ?? SANDBOX_MACHINE.sharedFiles,
    },
    context.workspace,
    context.wakesOff,
  );

  // A Manager's lines follow the coder's, so a coder's instructions stay as they were.
  if (agent.kind !== AGENT_KIND.MANAGER) return coder;

  return `${coder}\n${managerInstructions({ name: agent.title, deviceId: agent.machine === AGENT_MACHINE.DEVICE ? (agent.deviceId ?? null) : null })}`;
}
