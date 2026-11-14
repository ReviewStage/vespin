import { SHARED_FILES_DIRECTORY } from "@repo/agent-runner/pins";
import { type Agent, agentBriefOf } from "@repo/database/models/agent-store";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import { AGENT_BRIEF, AGENT_MACHINE, type AgentBrief } from "@repo/features/agent-wire";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { LINK_DESTINATION, linkOf, taskLinkStep } from "@repo/features/link-grammar";
import { LINK_ORIGIN } from "@repo/features/link-home";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { offers } from "../tool-catalog/catalog.js";
import type { AgentStanding } from "../tool-catalog/gates.js";
import { CODER } from "./bounds.js";
import { COMMIT_BY, type CommitAuthorship } from "./checkout.js";
import { EDIT_DESCRIPTION_TOOL } from "./description-edit.js";
import { INBOX_TOOLS } from "./inbox.js";

/**
 * instructions.ts -- what a coding agent's session runs under, appended to its harness's own prompt.
 *
 * Note that these are a few paragraphs on purpose: who the agent is, where
 * it works, how it publishes, where it writes, and how it names things. A
 * rule that belongs to one of our tools lives in that tool's description,
 * which the agent reads beside its call (threads, the description, task
 * status, other agents, suggestions, memory, the browser, the Mac, wakeups,
 * ending a turn), and a rule the harness already states is not said again,
 * since every word here is paid on every turn of every agent.
 * What is said here is what no tool's description can carry: the
 * repository and the checkout's place, the branch and whose the commits
 * are (`checkout.ts`), that the pull request opens through the service
 * (`pull-request.ts`) so the developer's token never reaches the sandbox,
 * how the checks are read with the credential the agent holds, and the
 * mention forms its own reply is drawn with.
 */

/** What the agent is told of what it was handed: a description, a prompt, or nothing, for one started blank. */
const BRIEF_WORDS = {
  [AGENT_BRIEF.DESCRIPTION]: {
    job: "implement the task's description given as the first message of this conversation",
    start:
      "Reread the code the description names before you change it; where the code has outgrown the description, say so plainly rather than guess at a larger job.",
    whole: "implements the description whole",
  },
  [AGENT_BRIEF.PROMPT]: {
    job: "carry out the prompt the developer gave as the first message of this conversation",
    start:
      "A prompt that names what to make is a spec, however short: make its choices yourself and name them. Only where it names a goal but nothing to build, ask in a thread and make nothing until the developer answers; where no one can answer, as in a turn an automation or another agent opened, go on under an assumption you name.",
    whole: "does what the prompt asks, whole",
  },
  [AGENT_BRIEF.BLANK]: {
    job: "do what the developer asks of you in this conversation",
    start:
      "A request that names what to make is a spec, however short: make its choices yourself and name them. Only where it names a goal but nothing to build, ask in a thread and make nothing until the developer answers; where no one can answer, as in a turn an automation or another agent opened, go on under an assumption you name.",
    whole: "does what the developer asked, whole",
  },
} as const satisfies Record<AgentBrief, { job: string; start: string; whole: string }>;

export const CODER_HARNESS = {
  CLAUDE_CODE: CONVERSATION_RUNTIME.CLAUDE_CODE,
  CODEX: CONVERSATION_RUNTIME.CODEX,
} as const;

export type CoderHarness = (typeof CODER_HARNESS)[keyof typeof CODER_HARNESS];

/** Where the harness's own tools start, by the names it gives them. */
const TOOLS_START: Readonly<Record<CoderHarness, string>> = {
  [CODER_HARNESS.CLAUDE_CODE]: "every Bash command and file tool starts.",
  [CODER_HARNESS.CODEX]: "every shell command and `apply_patch` starts.",
};

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
 * What the machine is, said after where the tools start: a sandbox whose
 * firewall holds the GitHub credential, or
 * the developer's own machine, already signed in, whose one clone its other
 * agents' worktrees share.
 */
function machineWords(machine: CoderMachine, repository: boolean): string {
  if (machine.local) {
    const worktree = repository
      ? " Your checkout is a git worktree of the machine's one clone: where git says a branch is checked out in another worktree, work detached with `git switch --detach origin/<branch>` and push with `git push origin HEAD:<branch>`."
      : "";

    return `You run straight on one of the developer's own machines with full access to it, so leave what is not yours alone; \`gh\` and \`git\` are already signed in. Save a picture or page you show under \`${machine.sharedFiles}/\`, the one place the machine reads back.${worktree}`;
  }

  const github = repository
    ? "GitHub is reachable through `gh` and `git`, its credential held at the sandbox's firewall, so never put a token in a command or try to sign in."
    : "No GitHub credential is set in it, so never try to sign in.";

  return github;
}

/** Whose the agent's commits are, the developer's or the App's bot's, and the trailer naming the other as co-author where one is handed. */
function authorshipWords(authorship: CommitAuthorship | undefined): string {
  const whose =
    authorship?.by === COMMIT_BY.DEVELOPER
      ? "the developer's GitHub account"
      : `the ${PRODUCT_NAME} GitHub App's bot`;

  const trailer =
    authorship?.coAuthor === undefined
      ? "add no `Co-authored-by` trailer"
      : `end every commit message with a blank line and this trailer, exactly: \`${authorship.coAuthor}\``;

  return `The git identity is set to ${whose}, so leave it alone, and ${trailer}.`;
}

/**
 * How the agent waits on and reads its checks, and what reaches it on its
 * pull request: with `gh` where its credential is the App's, whose webhook
 * wakes it (`github/agent-wakes.ts`); over GitHub's REST API alone where it
 * is its starter's own token, which the firewall carries on nothing else
 * (`terminal/agent-sandbox.ts`) and on which no wake comes.
 */
function checksWords(memberToken: boolean): string {
  const wait = `After you push, wait on the checks with \`${AGENT_TOOL.SCHEDULE_WAKEUP}\`, never a command that watches CI, and fix what fails, at most ${CODER.CI_FIX_ROUNDS} times.`;

  return memberToken
    ? `${wait} You work on the developer's own token, so \`gh pr\` does not work: use \`gh api repos/{owner}/{repo}/…\` for checks, reviews, and comments, open no draft (it cannot be marked ready from here), and before you end a turn on an open pull request read what is new on it, since nothing reaches you by itself.`
    : `${wait} Reviews, comments, and failing checks reach you as messages from GitHub, a reviewer's words and never the developer's; read what is new with \`gh\` before you end a turn on an open pull request.`;
}

/**
 * How an agent with a repository works and publishes: the branch it cuts,
 * or the open pull request's branch its first message names, whose
 * commits they are, the pull request through the service, and its checks.
 */
function buildWords(
  words: (typeof BRIEF_WORDS)[AgentBrief],
  writeUp: string,
  authorship: CommitAuthorship | undefined,
  startBranch: string | null,
  memberToken: boolean,
): string {
  const from = startBranch === null ? "the default branch" : `\`${startBranch}\``;
  const base = startBranch === null ? "" : `, with \`base: "${startBranch}"\``;

  return `Work on a branch named \`${CODER.BRANCH_PREFIX}<slug>\` cut from ${from} (never ${from} itself), or on the open pull request's branch your first message names, without opening a new one. ${authorshipWords(authorship)} Make the smallest coherent change that ${words.whole}, run the repository's own checks, push, and open the pull request with \`${AGENT_TOOL.OPEN_PULL_REQUEST}\`${base}, never \`gh pr create\`, and post it in a thread once it is ready for review. Where you were asked for a plan, a design, or research, commit no document: ${writeUp}. ${checksWords(memberToken)}`;
}

/**
 * How the agent names what the developer can open, as the mention the app
 * draws as a chip (`@repo/features/mention-link`): a file of its
 * repository, a pull request by its own address, never a bare `#42`, its
 * task, and a thing of ours by its kind and id under the workspace's address (`../link-rule.ts` says the same to other authors at length).
 */
function namingWords(repository: string | null, ownTask: OwnTask, workspace: string): string {
  const home = `${LINK_ORIGIN}/${workspace}`;

  const file =
    repository === null
      ? ""
      : ` a file \`[@store.ts](https://github.com/${repository}/blob/HEAD/<path>)\`,`;

  return `Name anything the developer can open as a mention, \`[@name](target)\`, which ${PRODUCT_NAME} draws as a chip:${file} a pull request \`[@#42 Fix the refresh](https://github.com/${repository ?? EXAMPLE_REPOSITORY}/pull/42)\`, never a bare \`#42\`, and your task \`[@<its name>](${ownTask.link})\`. A thing of ours a tool answered by its id goes under \`${home}\`: an agent \`${home}/agent/<agent-id>\`, a task \`${home}/task/<task-id>\`, an automation \`${home}/automation/<automation-id>\`, a member \`${home}/person/<user-id>\`, a thread \`${home}/inbox/<item-id>\`, and a page \`${home}/task/<task-id>/page/<page-id>\`.`;
}

/**
 * The instructions for one agent: on the repository its row names, or none,
 * where it works in a sandbox with no checkout; worded for what it was
 * handed, its harness's tools (`TOOLS_START`), its machine, whose its
 * commits are, the branch it started on, and whether its credential is its
 * starter's own token. A passage on a gated tool of ours is told by whether
 * the agent's standing is offered it (`../tool-catalog/catalog.ts`'s
 * `offers`): its pull request by `open_pull_request`, its description by
 * `edit_description`. The repository's own `AGENTS.md` or `CLAUDE.md` is
 * not named, since each harness loads its own.
 */
export function coderInstructions(
  repository: string | null,
  brief: AgentBrief,
  ownTask: OwnTask,
  standing: AgentStanding,
  authorship: CommitAuthorship | undefined = undefined,
  startBranch: string | null = null,
  memberToken = false,
  harness: CoderHarness = CODER_HARNESS.CLAUDE_CODE,
  machine: CoderMachine = SANDBOX_MACHINE,
  workspace: string = EXAMPLE_WORKSPACE,
): string {
  const words = BRIEF_WORDS[brief];
  const describes = offers(standing, EDIT_DESCRIPTION_TOOL.name);

  const read =
    brief === AGENT_BRIEF.DESCRIPTION ? "" : ` (read it first with \`${AGENT_TOOL.READ_TASK}\`)`;

  const writeUp =
    describes && brief === AGENT_BRIEF.DESCRIPTION
      ? `write it into the description with \`${EDIT_DESCRIPTION_TOOL.name}\`, or show it as a page with \`${AGENT_TOOL.SHOW_PAGE}\`, and post it in a thread`
      : `show it as a page with \`${AGENT_TOOL.SHOW_PAGE}\` and post it in a thread`;

  const description = describes
    ? ` Record a decision you made, or a question left open with the assumption you go on, in the task's description with \`${EDIT_DESCRIPTION_TOOL.name}\`${read}.`
    : "";

  const where =
    repository === null
      ? `You work in no repository and open no pull request. Your own folder is \`${machine.checkoutPath}\`, where ${TOOLS_START[harness]}`
      : `It is checked out at \`${machine.checkoutPath}\`${startBranch === null ? "" : ` on \`${startBranch}\``}, where ${TOOLS_START[harness]}`;

  const work =
    repository !== null && offers(standing, AGENT_TOOL.OPEN_PULL_REQUEST)
      ? `${words.start}

${buildWords(words, writeUp, authorship, startBranch, memberToken)}`
      : `${words.start} Where you were asked for a plan, a design, or research, ${writeUp}.`;

  return `You are ${PRODUCT_NAME}'s agent. Your job is to ${words.job}${repository === null ? "." : `, in the GitHub repository \`${repository}\`.`} ${where} ${machineWords(machine, repository !== null)}

${work}

Ask the developer what you need, and show them what is ready to look at, in a thread with \`${INBOX_TOOLS.POST.name}\`.${description}

${namingWords(repository, ownTask, workspace)}`;
}

export interface OwnTask {
  readonly link: string;
  readonly id: string;
}

/** What an agent's instructions are composed on beyond its row. */
export interface AgentInstructionsContext {
  /** Whose its commits are, and the trailer naming the other as co-author where one is. */
  readonly authorship: CommitAuthorship | undefined;
  /** The workspace its links are written under. */
  readonly workspace: string;
  /** The number its task goes by in that workspace, which the task's link names it by; none where it is not known, and the link names the task's id. */
  readonly taskNumber?: number | undefined;
  /** Where it stands against the gates of our tools (`../tool-catalog/gates.ts`), which decide the tools' words it is told. */
  readonly standing: AgentStanding;
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
 * (`agentBriefOf`), its task's link, its start branch, and its credential
 * read from the row, so every session of the agent is worded
 * alike.
 */
export function agentCoderInstructions(agent: Agent, context: AgentInstructionsContext): string {
  const ownTask = {
    id: agent.taskId,
    link: linkOf(
      {
        kind: LINK_DESTINATION.TASK,
        taskId: taskLinkStep({ id: agent.taskId, number: context.taskNumber }),
      },
      context.workspace,
    ),
  };

  return coderInstructions(
    agent.repository,
    agentBriefOf(agent),
    ownTask,
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
  );
}
