/**
 * pr-view.ts -- `vespin pr view`: any pull request of a repository the workspace reaches on GitHub, named by its page or as `owner/name#number`, read as its Pull request tab reads it.
 *
 * With no part named it prints the pull request as GitHub holds it now
 * (`pullRequests.pullRequest`) and its overview, its description among it
 * (`pullRequests.overviewPullRequest`). `--checks` prints its head's checks
 * and deployments (`overviewChecks`), `--conversation` its comments and
 * reviews, oldest first, with their review threads (`overviewConversation`),
 * `--diff` every changed file's patch as `agent diff` prints them
 * (`changes`), and `--stat` each file as one line with whether you marked
 * it viewed (`viewed`). Several parts print one after another; `--json`
 * prints each read whole under its part's name.
 */

import type {
  AgentOverviewChecks,
  AgentOverviewConversation,
  AgentOverviewPullRequest,
  ConversationEntry,
} from "@repo/features/agent-wire";
import { CLI_EXIT } from "@repo/features/cli-exit";
import { cliPullRequestRefOf } from "@repo/features/cli-pull-request-ref";
import {
  PULL_REQUEST_WRITE_OUTCOME,
  type PullRequestViewedAnswer,
} from "@repo/features/pull-request-write-wire";
import { Effect } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { answer, CommandFailed, columns, note } from "../output.js";
import { askService, session } from "../session.js";
import { resolveWorkspace } from "../workspace.js";
import { fileDiffLines, fileStatRow } from "./agent-pull-request.js";

/** How a pull request's argument is spelled, as a refusal names it. */
const PULL_REQUEST_WORDS = "owner/name#number, or the pull request's page on GitHub";

export const pullRequestArgument = Argument.String("pr").pipe(
  Argument.withDescription(`The pull request, as ${PULL_REQUEST_WORDS}`),
);

/** The query a pull request's argument names in the workspace this command acts in, or a usage failure where it names none. */
export const pullRequestQuery = Effect.fnUntraced(function* (argument: string) {
  const named = cliPullRequestRefOf(argument);
  if (named === undefined) {
    return yield* new CommandFailed({
      exit: CLI_EXIT.USAGE,
      message: `Name the pull request as ${PULL_REQUEST_WORDS}.`,
    });
  }
  const { workspace } = yield* resolveWorkspace;
  return { workspaceId: workspace.id, repository: named.repository, number: String(named.number) };
});

/** Words as lines indented under what they belong to, a blank line where there are none. */
function indented(text: string, indent = "    "): string[] {
  return text === "" ? [] : text.split("\n").map((line) => `${indent}${line}`);
}

/** The overview's lines: its title and number, where it stands, its branches and author, and its description. */
function overviewLines(
  pullRequest: { readonly checks: string; readonly additions: number; readonly deletions: number },
  overview: AgentOverviewPullRequest | null,
): string[] {
  const counts = `checks ${pullRequest.checks}  +${pullRequest.additions} -${pullRequest.deletions}`;
  if (overview === null) return [counts];
  const labels = overview.labels?.map((label) => label.name).join(", ") ?? "";
  return [
    `${overview.title} #${overview.number}`,
    `${overview.state}  merge ${overview.merge}  ${counts}`,
    `${overview.base} <- ${overview.head}${overview.author === undefined ? "" : `  by ${overview.author.login}`}`,
    ...(labels === "" ? [] : [`labels: ${labels}`]),
    overview.url,
    "",
    ...(overview.body ?? "").split("\n"),
  ];
}

function checksLines(checks: AgentOverviewChecks | null): string[] {
  if (checks === null) return ["No checks."];
  return [
    ...columns(checks.checks.map((check) => [check.state, check.name, check.url ?? ""])),
    ...columns(
      (checks.deployments ?? []).map((deployment) => [
        deployment.state,
        deployment.environment,
        deployment.url ?? "",
      ]),
    ),
  ];
}

/** One entry of the conversation: who, what it left them as, its words, and its review threads. */
function entryLines(entry: ConversationEntry): string[] {
  const state = entry.state === undefined ? entry.kind : `${entry.kind} ${entry.state}`;
  const at = new Date(entry.at).toISOString();
  return [
    `${entry.by.login} (${state}) ${at}`,
    ...indented(entry.body),
    ...(entry.threads ?? []).flatMap((thread) => [
      `    ${thread.path}${thread.line === null ? "" : `:${thread.line}`}${thread.resolved ? " (resolved)" : ""}`,
      ...thread.comments.flatMap((comment) => [
        `      ${comment.by.login}:`,
        ...indented(comment.body, "        "),
      ]),
    ]),
    "",
  ];
}

function conversationLines(conversation: AgentOverviewConversation | null): string[] {
  if (conversation === null) return ["No conversation."];
  return [
    ...(conversation.earlier > 0
      ? [`${conversation.earlier} earlier entries are on GitHub alone.`, ""]
      : []),
    ...conversation.conversation.flatMap(entryLines),
    ...columns(conversation.reviewers.map((reviewer) => [reviewer.state, reviewer.by.login])),
  ];
}

/** Where each file's viewed mark stands, by its path; none where it could not be read. */
function viewedMarks(viewed: PullRequestViewedAnswer) {
  return viewed.outcome === PULL_REQUEST_WRITE_OUTCOME.DONE
    ? new Map(viewed.files.map((file) => [file.path, file.state]))
    : undefined;
}

export const viewCommand = Command.make(
  "view",
  {
    pr: pullRequestArgument,
    checks: Flag.Boolean("checks").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Its head's checks and deployments"),
    ),
    conversation: Flag.Boolean("conversation").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Its comments and reviews, with their review threads"),
    ),
    diff: Flag.Boolean("diff").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Every changed file's patch"),
    ),
    stat: Flag.Boolean("stat").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Each changed file as one line, with whether you marked it viewed"),
    ),
  },
  ({ pr, checks, conversation, diff, stat }) =>
    Effect.gen(function* () {
      const { hosted } = yield* session;
      const query = yield* pullRequestQuery(pr);
      const overview = !(checks || conversation || diff || stat);
      const json: Record<string, unknown> = {};
      const lines: string[] = [];
      let ids: readonly string[] | undefined;
      if (overview) {
        const published = yield* askService(hosted.pullRequests.pullRequest, query);
        const read = yield* askService(hosted.pullRequests.overviewPullRequest, query);
        json.pullRequest = published.pullRequest;
        json.branch = published.branch;
        json.overview = read.pullRequest;
        if (published.pullRequest !== null) {
          lines.push(...overviewLines(published.pullRequest, read.pullRequest));
          ids = [published.pullRequest.url];
        }
      }
      if (checks) {
        const read = yield* askService(hosted.pullRequests.overviewChecks, query);
        json.checks = read.pullRequest;
        lines.push(...checksLines(read.pullRequest));
      }
      if (conversation) {
        const read = yield* askService(hosted.pullRequests.overviewConversation, query);
        json.conversation = read.pullRequest;
        lines.push(...conversationLines(read.pullRequest));
      }
      if (diff || stat) {
        const { pullRequest: changes } = yield* askService(hosted.pullRequests.changes, query);
        json.changes = changes;
        if (changes?.truncated === true) {
          yield* note(`GitHub listed only the first ${changes.files.length} files.`);
        }
        const files = changes?.files ?? [];
        ids = files.map((file) => file.path);
        if (stat) {
          const viewed = yield* askService(hosted.pullRequests.viewed, query);
          json.viewed = viewed;
          const marks = viewedMarks(viewed);
          if (marks === undefined) yield* note("Could not read which files you marked viewed.");
          lines.push(
            ...columns(files.map((file) => [...fileStatRow(file), marks?.get(file.path) ?? ""])),
          );
        }
        if (diff) lines.push(...files.flatMap(fileDiffLines));
      }
      yield* answer({ json, lines, ...(ids === undefined ? {} : { ids }) });
    }),
).pipe(
  Command.withDescription(
    "Read any pull request of a repository the workspace reaches: its overview, checks, conversation, or diff",
  ),
  Command.withExamples([
    { command: "vespin pr view acme/relay#42", description: "Its overview and description" },
    {
      command: "vespin pr view https://github.com/acme/relay/pull/42 --checks --conversation",
      description: "Its checks, then its comments and reviews",
    },
    {
      command: "vespin pr view acme/relay#42 --stat",
      description: "Its files, and which you viewed",
    },
    { command: "vespin pr view acme/relay#42 --diff", description: "Every file's patch" },
  ]),
);
