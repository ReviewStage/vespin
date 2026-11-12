/**
 * pr-chapters.ts -- `vespin pr chapters`: a pull request's chapters as its Pull request tab reads them, and generated with `--generate` as its Generate makes them.
 *
 * The pull request is named by its page on GitHub or as `owner/name#number`
 * (`cli-pull-request-ref`), read through `pullRequestChapters.repositoryRead`
 * in the workspace the command acts in; anything else is an agent's id, its
 * own pull request read through `pullRequestChapters.read` at the number
 * `agentPullRequests.pullRequest` finds, as the tab finds it, or the one
 * `--number` names. `--generate` asks the matching Generate, which runs one
 * model call on the member's own API key and is answered once the
 * chapters land, under the service's chapters deadline; every limit on it,
 * the key, the claim a second press joins, and a diff too large to tell, is
 * the service's, as it is the tab's.
 */

import { HOSTED_API_ERROR } from "@repo/features";
import { CLI_EXIT } from "@repo/features/cli-exit";
import { cliPullRequestRefOf } from "@repo/features/cli-pull-request-ref";
import { HOSTED_DEADLINE } from "@repo/features/hosted-link";
import { PRODUCT_NAME } from "@repo/features/product-name";
import type { Chapter } from "@repo/features/pull-request-chapters";
import {
  PULL_REQUEST_CHAPTERS_FAILURE_KIND,
  PULL_REQUEST_CHAPTERS_STATE,
  type PullRequestChaptersAnswer,
} from "@repo/features/pull-request-chapters-wire";
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { answer, CommandFailed } from "../output.js";
import { askService, session } from "../session.js";
import { resolveWorkspace } from "../workspace.js";

/** The commit a line names, as short as git prints it. */
const SHORT_SHA_CHARS = 7;

/** What a refusal of a read or a Generate says, where the service's own words would not tell the person what to do. */
const CHAPTERS_REFUSAL_WORDS = {
  [HOSTED_API_ERROR.NOT_FOUND]: "No such pull request or agent, or it is none of yours.",
  [HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE]:
    "The workspace's GitHub installation no longer reaches that repository.",
} as const;

/** What a refusal of a Generate says beyond a read's: the key it runs on. */
const GENERATE_REFUSAL_WORDS = {
  ...CHAPTERS_REFUSAL_WORDS,
  [HOSTED_API_ERROR.UNAVAILABLE]: `Save an Anthropic or OpenAI API key in ${PRODUCT_NAME}'s settings to generate chapters.`,
} as const;

/** What each failure kind says, as the tab says it. */
const FAILURE_WORDS = {
  [PULL_REQUEST_CHAPTERS_FAILURE_KIND.TOO_LARGE]:
    "The pull request is too large to tell as chapters.",
  [PULL_REQUEST_CHAPTERS_FAILURE_KIND.TIMEOUT]: "Generating the chapters took too long.",
  [PULL_REQUEST_CHAPTERS_FAILURE_KIND.MODEL_REFUSED]: "The model refused to tell the chapters.",
  [PULL_REQUEST_CHAPTERS_FAILURE_KIND.INVALID_ANSWER]:
    "The model's answer could not be read as chapters.",
  [PULL_REQUEST_CHAPTERS_FAILURE_KIND.UNEXPECTED]: "The chapters could not be generated.",
} as const;

/** One chapter as a person reads it: its place and title, its risk, its summary, and its key changes. */
function chapterLines(chapter: Chapter, index: number): string[] {
  const risk = chapter.risk === null ? "" : `  [${chapter.risk} risk]`;

  return [
    `${index + 1}. ${chapter.title}${risk}`,
    ...chapter.summary.split("\n").map((line) => `   ${line}`),
    ...chapter.riskReasons.map((reason) => `   ! ${reason}`),
    ...chapter.keyChanges.map((change) => `   - ${change.content}`),
    "",
  ];
}

/** The answer as a person reads it: where the chapters stand, then each chapter where they are ready. */
function answerLines(found: PullRequestChaptersAnswer): string[] {
  const { pullRequest } = found;

  if (pullRequest === null) return ["The agent opened no pull request yet."];
  const { chapters, number } = pullRequest;

  const unkeyed = pullRequest.generatable
    ? []
    : [`Save an API key in ${PRODUCT_NAME}'s settings to generate chapters.`];

  switch (chapters.status) {
    case PULL_REQUEST_CHAPTERS_STATE.NONE:
      return [
        `#${number} has no chapters yet.`,
        ...(pullRequest.generatable ? ["Run this again with --generate to make them."] : unkeyed),
      ];
    case PULL_REQUEST_CHAPTERS_STATE.GENERATING:
      return [
        `#${number}'s chapters are being generated for ${chapters.headSha.slice(0, SHORT_SHA_CHARS)}.`,
      ];
    case PULL_REQUEST_CHAPTERS_STATE.FAILED:
      return [
        `#${number}'s chapters failed for ${chapters.headSha.slice(0, SHORT_SHA_CHARS)}: ${FAILURE_WORDS[chapters.failureKind]}`,
        ...unkeyed,
      ];
    case PULL_REQUEST_CHAPTERS_STATE.READY:
      return [
        `#${number}: ${chapters.chapters.length} chapters for ${chapters.headSha.slice(0, SHORT_SHA_CHARS)}, by ${chapters.model}`,
        "",
        ...chapters.chapters.flatMap(chapterLines),
      ];
  }
}

/** The chapters of the pull request the argument names, read or generated. */
function chaptersOf(argument: string, number: Option.Option<number>, generate: boolean) {
  return Effect.gen(function* () {
    const { hosted } = yield* session;
    const ref = cliPullRequestRefOf(argument);

    if (ref !== undefined) {
      if (Option.isSome(number)) {
        return yield* new CommandFailed({
          exit: CLI_EXIT.USAGE,
          message: "--number goes with an agent's id alone; a pull request's link names its own.",
        });
      }

      const { workspace } = yield* resolveWorkspace;

      const query = {
        workspaceId: workspace.id,
        repository: ref.repository,
        number: String(ref.number),
      };

      return generate
        ? yield* askService(
            hosted.pullRequestChapters.repositoryGenerate,
            { query },
            HOSTED_DEADLINE.CHAPTERS,
            GENERATE_REFUSAL_WORDS,
          )
        : yield* askService(
            hosted.pullRequestChapters.repositoryRead,
            query,
            HOSTED_DEADLINE.USUAL,
            CHAPTERS_REFUSAL_WORDS,
          );
    }

    const id = argument;

    if (generate) {
      const query = Option.isSome(number) ? { number: String(number.value) } : {};

      return yield* askService(
        hosted.pullRequestChapters.generate,
        { params: { id }, query },
        HOSTED_DEADLINE.CHAPTERS,
        GENERATE_REFUSAL_WORDS,
      );
    }

    // The tab reads its chapters at the number its own read of the pull request found.
    const found = Option.isSome(number)
      ? number.value
      : (yield* askService(
          hosted.agentPullRequests.pullRequest,
          { id },
          HOSTED_DEADLINE.USUAL,
          CHAPTERS_REFUSAL_WORDS,
        )).pullRequest?.number;

    if (found === undefined) return { pullRequest: null };

    return yield* askService(
      hosted.pullRequestChapters.read,
      { id, number: String(found) },
      HOSTED_DEADLINE.USUAL,
      CHAPTERS_REFUSAL_WORDS,
    );
  });
}

export const chaptersCommand = Command.make(
  "chapters",
  {
    pullRequest: Argument.String("pr|agent").pipe(
      Argument.withDescription(
        "The pull request, by its GitHub link or as owner/name#number, or an agent's id for its pull request",
      ),
    ),
    number: Flag.Int("number").pipe(
      Flag.optional,
      Flag.withDescription("With an agent's id, another pull request of its repository"),
    ),
    generate: Flag.Boolean("generate").pipe(
      Flag.withDefault(false),
      Flag.withDescription(
        "Generate the chapters for the head now, on your own API key; slower than reading",
      ),
    ),
  },
  ({ pullRequest, number, generate }) =>
    Effect.gen(function* () {
      const found = yield* chaptersOf(pullRequest, number, generate);
      yield* answer({ json: found, lines: answerLines(found) });
    }),
).pipe(
  Command.withDescription(
    "Read a pull request's chapters, the story of its diff in reading order; --generate makes them",
  ),
  Command.withExamples([
    { command: "vespin pr chapters acme/app#42", description: "Read the chapters" },
    {
      command: "vespin pr chapters https://github.com/acme/app/pull/42 --generate",
      description: "Generate them on your API key",
    },
    { command: "vespin pr chapters <agent-id>", description: "The agent's own pull request" },
  ]),
);
