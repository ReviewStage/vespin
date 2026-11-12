import {
  ACTION_RESULT_STATUS,
  type AgentMessageMetadata,
  type CarryOnLineMetadata,
  type CommentLineMetadata,
  GITHUB_CHECK_CONCLUSION,
  GITHUB_LINE_EVENT,
  type GitHubCheckConclusion,
  type GitHubLineMetadata,
  isFailingConclusion,
  isRecord,
  isWireNumber,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  type SlackLineMetadata,
  THREAD_LINE_EVENT,
  type ThreadLineMetadata,
  USER_MESSAGE_METADATA,
  type UserMessageMetadata,
} from "@repo/wire";
import { Option, Schema } from "effect";
import { AGENT_PART, type AgentPart, agentParts, messageWords } from "./agent-parts.js";
import { AGENT_TOOL, CLAUDE_CODE_TOOL } from "./agent-tools.js";
import type { AgentTranscriptMessage } from "./agent-wire.js";
import { MESSAGE_BLOCK, messageText } from "./reply-quote.js";

/**
 * transcript-lines.ts -- the lines a coding agent's transcript carries beside its own turns, read out of what the service stored: an agent's, a thread's, a comment's, GitHub's and Slack's, a wakeup and a carry-on, and a worker's task.
 *
 * Pure reads over the wire's shapes, shared by the panel's transcript and
 * the copies its menu makes (`transcript-copy.ts`), and by any client that
 * draws or copies a transcript.
 */

/** A user row's metadata as the service stored it, or nothing where it holds none this build reads. */
const readUserMetadata = Schema.decodeUnknownOption(USER_MESSAGE_METADATA);

/**
 * What another coding agent's message, sent with `message_agent`, says of
 * its sender, where one wrote the line rather than the developer; nothing
 * for the developer's own words, typed or spoken, or a row this build
 * cannot read.
 */
export function agentMessageOf(message: AgentTranscriptMessage): AgentMessageMetadata | undefined {
  const read = userMetadataOf(message);

  return read?.channel === MESSAGE_CHANNEL.AGENT_MESSAGE ? read : undefined;
}

/**
 * Whether a line is one of the agent's own wakeups: the prompt a wakeup set,
 * which the service sends back to the agent as a line of the agent's own on
 * the app's channel when it comes due (`schedule_wakeup`, delivered by the
 * scheduled sweep), so its head says the agent woke up.
 */
export function isWakeupLine(message: AgentTranscriptMessage): boolean {
  return userMetadataOf(message)?.channel === MESSAGE_CHANNEL.APP;
}

/** What the carry-on line the service sent after a cut-off turn says of why, where a line is one; nothing for any other line, or a row this build cannot read. */
export function carryOnLineOf(message: AgentTranscriptMessage): CarryOnLineMetadata | undefined {
  const read = userMetadataOf(message);

  return read?.channel === MESSAGE_CHANNEL.CARRY_ON ? read : undefined;
}

/** A second, in the milliseconds a wakeup's wait is told in. */
const SECOND_MS = 1_000;

/** The calls that book a wakeup, each with its delay under `delaySeconds`: Claude Code's own, and ours, which a Codex agent books with. */
const WAKEUP_TOOLS: ReadonlySet<string> = new Set([
  CLAUDE_CODE_TOOL.SCHEDULE_WAKEUP,
  AGENT_TOOL.SCHEDULE_WAKEUP,
]);

/** Whether a wakeup call booked one: not a cancel, and not a call of ours the service refused, which left the booking before it standing. */
function booksWakeup(part: AgentPart): boolean {
  if (part.kind !== AGENT_PART.TOOL || !WAKEUP_TOOLS.has(part.tool)) return false;

  if (isRecord(part.input) && part.input.stop === true) return false;

  return !(isRecord(part.output) && part.output.status === ACTION_RESULT_STATUS.REJECTED);
}

/**
 * How long the last wakeup a turn booked waited, in milliseconds: the delay
 * the service held it to, as its answer names it, or else the delay the
 * call asked for; none where the turn booked none.
 */
export function wakeupDelayOf(turn: AgentTranscriptMessage | undefined): number | undefined {
  if (turn === undefined) return undefined;
  const call = agentParts(turn).findLast(booksWakeup);

  if (call?.kind !== AGENT_PART.TOOL) return undefined;
  const booked = isRecord(call.output) ? call.output.wakeup : undefined;

  const held =
    isRecord(booked) && isWireNumber(booked.delaySeconds) ? booked.delaySeconds : undefined;

  const asked =
    isRecord(call.input) && isWireNumber(call.input.delaySeconds)
      ? call.input.delaySeconds
      : undefined;

  const seconds = held ?? asked;

  return seconds === undefined ? undefined : seconds * SECOND_MS;
}

/** What a member did on a thread that a line steered into the agent carries, and the item it is on; nothing for any other line. */
export function threadLineOf(message: AgentTranscriptMessage): ThreadLineMetadata | undefined {
  const read = userMetadataOf(message);

  return read?.channel === MESSAGE_CHANNEL.THREAD ? read : undefined;
}

/**
 * What a comment thread that reached the agent carries for a window to draw
 * it by, its member's words among them; nothing for any other line, or for
 * a comment line kept before it carried them, which draws as the words the
 * agent read.
 */
export function commentLineOf(message: AgentTranscriptMessage): CommentLineMetadata | undefined {
  const read = userMetadataOf(message);

  return read?.channel === MESSAGE_CHANNEL.COMMENT && read.words !== undefined ? read : undefined;
}

/** A comment line's words as a transcript draws them: what its thread is on, quoted, over the member's own words. */
export function commentLineWords(line: CommentLineMetadata): string {
  const words = line.words ?? "";

  if (line.quote === undefined || line.quote === "") return words;

  return messageText([
    { kind: MESSAGE_BLOCK.QUOTE, words: line.quote },
    { kind: MESSAGE_BLOCK.WORDS, lines: words.split("\n") },
  ]);
}

/** What a member's message to the Slack bot carries for a window to draw it by, their own words and the message's link; nothing for any other line. */
export function slackLineOf(message: AgentTranscriptMessage): SlackLineMetadata | undefined {
  const read = userMetadataOf(message);

  return read?.channel === MESSAGE_CHANNEL.SLACK ? read : undefined;
}

/** What GitHub said on the agent's pull request that a line steered into the agent carries; nothing for any other line. */
export function githubLineOf(message: AgentTranscriptMessage): GitHubLineMetadata | undefined {
  const read = userMetadataOf(message);

  return read?.channel === MESSAGE_CHANNEL.GITHUB ? read : undefined;
}

/** What a review's verdict reads as before its pull request, by GitHub's own state; any other reads as reviewed. */
const VERDICT_WORDS: ReadonlyMap<string, string> = new Map([
  ["approved", "approved"],
  ["changes_requested", "requested changes on"],
]);

/** What a review that is neither an approval nor a change request reads as. */
const REVIEWED = "reviewed";

/** What a comment on the pull request, not a review, reads as. */
const COMMENTED = "commented on";

/** What the merge queue taking the pull request out without merging it reads as, in GitHub's own word. */
const DEQUEUED = "dequeued";

/** How a check a GitHub line names ended, in words, as its row on the line's card says it. */
export const CONCLUSION_WORDS = {
  [GITHUB_CHECK_CONCLUSION.SUCCESS]: "Passed",
  [GITHUB_CHECK_CONCLUSION.FAILURE]: "Failed",
  [GITHUB_CHECK_CONCLUSION.NEUTRAL]: "Neutral",
  [GITHUB_CHECK_CONCLUSION.CANCELED]: "Canceled",
  [GITHUB_CHECK_CONCLUSION.SKIPPED]: "Skipped",
  [GITHUB_CHECK_CONCLUSION.TIMED_OUT]: "Timed out",
  [GITHUB_CHECK_CONCLUSION.ACTION_REQUIRED]: "Needs action",
  [GITHUB_CHECK_CONCLUSION.STALE]: "Stale",
  [GITHUB_CHECK_CONCLUSION.STARTUP_FAILURE]: "Failed to start",
} as const satisfies Record<GitHubCheckConclusion, string>;

/** What the service tells an agent when every check finished and one failed, which is how a line kept before it said `failing` says so. */
const SOME_FAILED_WORDS = /\bAt least one failed\b/u;

/** One check a GitHub line names. */
type GitHubLineCheck = NonNullable<GitHubLineMetadata["checks"]>[number];

/** A GitHub line's head: what GitHub did, then what it did it to, which links the line's page. */
export interface GitHubLineHead {
  /** What happened, whole, as a copy reads it: "@octocat approved", "2 of 3 checks failed on". */
  readonly event: string;
  /** What its sender did, as the card says it after their chip: "approved", "2 of 3 checks failed on". */
  readonly does: string;
  readonly target: string;
}

/** Whether a check line says a check failed: a failed check always does, every check finished by its `failing`, or, on a line kept before it said so, by the words that told the agent. */
export function githubChecksFailed(line: GitHubLineMetadata, words: string): boolean {
  if (line.event === GITHUB_LINE_EVENT.CHECK_FAILED) return true;

  return line.failing ?? SOME_FAILED_WORDS.test(words);
}

/** The checks a check line names, those that failed first, each kind in the order the line lists them; none on a line that names none. */
export function githubLineChecks(line: GitHubLineMetadata): readonly GitHubLineCheck[] {
  const checks = line.checks ?? [];

  return [
    ...checks.filter((check) => isFailingConclusion(check.conclusion)),
    ...checks.filter((check) => !isFailingConclusion(check.conclusion)),
  ];
}

/** Whether every check a check line names passed: none failed, and each it names succeeded rather than was skipped, neutral, or stale. */
export function githubChecksPassed(line: GitHubLineMetadata, words: string): boolean {
  if (githubChecksFailed(line, words)) return false;

  return (line.checks ?? []).every((check) => check.conclusion === GITHUB_CHECK_CONCLUSION.SUCCESS);
}

/** How many checks, as a head counts them: one, or all of them. */
function allChecks(count: number): string {
  return count === 1 ? "1 check" : `all ${count} checks`;
}

/**
 * What a check line's sender did, by how many of its checks failed where it
 * names them, else by whether any did; with none failed, by how many passed
 * and how many were skipped, neutral and stale among them, as the Pull
 * request tab counts them, since a check skipped did not pass.
 */
function checksDid(line: GitHubLineMetadata, words: string): string {
  const checks = line.checks ?? [];
  const failed = checks.filter((check) => isFailingConclusion(check.conclusion)).length;
  const noun = checks.length === 1 ? "check" : "checks";

  if (failed > 0) return `${failed} of ${checks.length} ${noun} failed on`;

  if (line.event === GITHUB_LINE_EVENT.CHECK_FAILED) return "a check failed on";

  if (githubChecksFailed(line, words)) return "some checks failed on";

  if (checks.length === 0) return "every check passed on";

  const passed = checks.filter(
    (check) => check.conclusion === GITHUB_CHECK_CONCLUSION.SUCCESS,
  ).length;

  const skipped = checks.length - passed;

  if (skipped === 0) return `${allChecks(passed)} passed on`;

  return passed === 0
    ? `${allChecks(skipped)} skipped on`
    : `${passed} passed, ${skipped} skipped on`;
}

/**
 * A GitHub line's head, as its card draws it and a copy or a find reads
 * it: who reviewed by their verdict, commented, or took the pull request
 * out of the merge queue; or, for a check event, how many of the checks it
 * names failed, or whether any did; then the
 * pull request by its number, else its checks. The card names a reviewer
 * by their chip, so it reads what they did alone (`does`); a copy reads
 * them by their login (`event`), and a check event as its words alone.
 */
export function githubLineHead(line: GitHubLineMetadata, words: string): GitHubLineHead {
  const target = line.number === undefined ? "its checks" : `#${line.number}`;

  switch (line.event) {
    case GITHUB_LINE_EVENT.REVIEW: {
      const does = VERDICT_WORDS.get(line.verdict ?? "") ?? REVIEWED;

      return { event: `@${line.by} ${does}`, does, target };
    }

    case GITHUB_LINE_EVENT.COMMENT:
      return { event: `@${line.by} ${COMMENTED}`, does: COMMENTED, target };
    case GITHUB_LINE_EVENT.CHECK_FAILED:
    case GITHUB_LINE_EVENT.CHECKS_COMPLETED: {
      const does = checksDid(line, words);

      return { event: `${does.charAt(0).toUpperCase()}${does.slice(1)}`, does, target };
    }

    case GITHUB_LINE_EVENT.DEQUEUED:
      return { event: `@${line.by} ${DEQUEUED}`, does: DEQUEUED, target };
  }
}

/**
 * A GitHub line as words, as its card draws them, which a copy reads and a
 * find counts: its head, the words, each inline comment by its file and
 * line over what it says, then each check it names by how it ended, where
 * the card holds them, every check passing being its head alone.
 */
export function githubLineWords(line: GitHubLineMetadata, words: string): string {
  const head = githubLineHead(line, words);

  const comments = (line.comments ?? []).map((comment) => {
    const where = comment.line === undefined ? comment.path : `${comment.path} L${comment.line}`;

    return comment.body === "" ? where : `${where}\n\n${comment.body}`;
  });

  const checks = githubChecksPassed(line, words)
    ? ""
    : githubLineChecks(line)
        .map((check) => `${check.name}: ${CONCLUSION_WORDS[check.conclusion]}`)
        .join("\n");

  return [`${head.event} ${head.target}`, line.words ?? "", ...comments, checks]
    .filter((part) => part !== "")
    .join("\n\n");
}

/** A user row's metadata where it names the channel that carried it; nothing for an assistant's row, an observation, or a row this build cannot read. */
function userMetadataOf(
  message: AgentTranscriptMessage,
): Extract<UserMessageMetadata, { readonly channel: unknown }> | undefined {
  if (message.role !== MESSAGE_ROLE.USER || message.metadata === undefined) return undefined;
  const read = Option.getOrUndefined(readUserMetadata(message.metadata));

  return read === undefined || !("channel" in read) ? undefined : read;
}

/** The id of the row a worker's tab draws its task on, which no row of the service's spells. */
const TASK_ROW_ID = "task";

/**
 * A worker's transcript as its tab draws it: the task it was handed as the
 * first row, from the words the agent's call carried, and the worker's own
 * turns after it. The service's first row is the same task, so the
 * developer's rows are left out rather than drawn twice; nothing else of
 * the developer's reaches a worker. A worker opened by a link, which
 * carries no words, takes its task from the service's first row, and is
 * drawn as any other.
 */
export function workerLines(
  task: string,
  messages: readonly AgentTranscriptMessage[],
): readonly AgentTranscriptMessage[] {
  // A worker opened by its link carries no task's words, so the service's own first row's are the task.
  const first = messages.find((message) => message.role === MESSAGE_ROLE.USER);
  const words = task === "" && first !== undefined ? messageWords(first) : task;

  return [
    { id: TASK_ROW_ID, role: MESSAGE_ROLE.USER, parts: [{ type: AGENT_PART.TEXT, text: words }] },
    ...messages.filter((message) => message.role !== MESSAGE_ROLE.USER),
  ];
}

/** What a line's head says was done: in lowercase after its sender's name, or opening the line where it is the reader's own. */
export interface LineLead {
  readonly AFTER_NAME: string;
  readonly OWN: string;
}

/** What a thread's line says the member did on it, by the event its metadata names, so the head reads as a sentence from their name. */
export const THREAD_LINE_DID = {
  [THREAD_LINE_EVENT.MESSAGE]: { AFTER_NAME: "wrote in", OWN: "Wrote in" },
  [THREAD_LINE_EVENT.ANSWER]: { AFTER_NAME: "answered", OWN: "Answered" },
  [THREAD_LINE_EVENT.CLOSE]: { AFTER_NAME: "resolved", OWN: "Resolved" },
} as const satisfies Record<ThreadLineMetadata["event"], LineLead>;

/** What a comment line leads with, as a thread's leads with what its member did. */
export const COMMENT_LINE_LEAD = {
  AFTER_NAME: "commented on",
  OWN: "Commented on",
} as const satisfies LineLead;

/** What a comment line's chip names where no page does: the description of the task it is on. */
const DESCRIPTION_WORDS = "the description";

/** What a comment line's head names: the page by its title, or the description. */
export function commentLineSubject(line: CommentLineMetadata): string {
  return line.page_title ?? DESCRIPTION_WORDS;
}

/** What a Slack line leads with: after its sender's name, as GitHub's card says what its author did, or opening the line where it is the reader's own. */
export const SLACK_LINE_LEAD = {
  AFTER_NAME: "wrote in",
  OWN: "Wrote in",
} as const satisfies LineLead;

/** What a Slack line's chip names: Slack, whose mark the chip wears for a link to it. */
export const SLACK_LINE_SUBJECT = "Slack";
