/**
 * agent-pull-request.ts -- `vespin agent diff` and `vespin agent pr`: a coding agent's pull request read as a diff, and marked ready, turned back into a draft, merged, or set to merge on its own.
 *
 * `diff` prints what `agents.changes` answers, the files GitHub lists for
 * the pull request with each one's patch, as `gh pr diff` prints them; with
 * `--stat`, each file as one line. `pr` makes one change through
 * `agentPullRequests.action`, on GitHub as the member, as the Pull request
 * tab's merge box makes it (`packages/panel/src/tasks/merge-box.tsx`): a
 * merge and auto-merge name the head the overview reads now, or the one
 * `--head` pins, so GitHub refuses either against a head pushed since; the
 * method is the one named, else the first the repository allows, and a base
 * merged through a merge queue takes auto-merge with none, so GitHub queues
 * it by the queue's own. Both take `--number` for another pull request of
 * the agent's repository, as the tab does.
 */

import {
  type AgentChangedFile,
  CHANGED_FILE_STATUS,
  PATCH_OMITTED,
} from "@repo/features/agent-wire";
import { CLI_EXIT } from "@repo/features/cli-exit";
import { PRODUCT_NAME } from "@repo/features/product-name";
import {
  MERGE_METHOD,
  type MergeMethod,
  PULL_REQUEST_ACTION,
  PULL_REQUEST_WRITE_OUTCOME,
  type PullRequestWriteAnswer,
} from "@repo/features/pull-request-write-wire";
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { answer, CommandFailed, columns, note } from "../output.js";
import { askService, session } from "../session.js";

/** The changes `pr` makes, as typed after it. */
const PR_CHANGE = {
  READY: "ready",
  DRAFT: "draft",
  MERGE: "merge",
  AUTO_MERGE: "auto-merge",
} as const;

type PrChange = (typeof PR_CHANGE)[keyof typeof PR_CHANGE];

/** What each change says once GitHub made it. */
const DONE_WORDS = {
  [PR_CHANGE.READY]: "Marked ready for review.",
  [PR_CHANGE.DRAFT]: "Turned back into a draft.",
  [PR_CHANGE.MERGE]: "Merged.",
  [PR_CHANGE.AUTO_MERGE]: "Auto-merge is on.",
} as const satisfies Record<PrChange, string>;

/** The path a side of a file's diff names, or `/dev/null` where the file is not on that side. */
const NO_FILE = "/dev/null";

const agentArgument = Argument.String("agent").pipe(Argument.withDescription("The agent's id"));

const numberFlag = Flag.Int("number").pipe(
  Flag.optional,
  Flag.withDescription("Another pull request of the agent's repository, by its number"),
);

/** The number query a call names, or none for the agent's own pull request. */
function numberQuery(number: Option.Option<number>) {
  return Option.isSome(number) ? { number: String(number.value) } : {};
}

/** One file's diff, as git prints it: its header, then its patch or why GitHub carried none. */
export function fileDiffLines(file: AgentChangedFile): string[] {
  const before = file.previousPath ?? file.path;
  const from = file.status === CHANGED_FILE_STATUS.ADDED ? NO_FILE : `a/${before}`;
  const to = file.status === CHANGED_FILE_STATUS.DELETED ? NO_FILE : `b/${file.path}`;
  const header = [`diff --git a/${before} b/${file.path}`, `--- ${from}`, `+++ ${to}`];

  if (file.patch !== null) return [...header, file.patch];

  return [
    ...header,
    file.omitted === PATCH_OMITTED.BINARY ? "Binary file" : "Patch too large; GitHub carried none",
  ];
}

/** One file as a line of the stat: what became of it, the lines it adds and removes, and its path. */
export function fileStatRow(file: AgentChangedFile): string[] {
  const path = file.previousPath === null ? file.path : `${file.previousPath} -> ${file.path}`;

  return [file.status, `+${file.additions}`, `-${file.deletions}`, path];
}

export const diffCommand = Command.make(
  "diff",
  {
    agent: agentArgument,
    number: numberFlag,
    stat: Flag.Boolean("stat").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Each file as one line, with the lines it adds and removes"),
    ),
  },
  ({ agent: id, number, stat }) =>
    Effect.gen(function* () {
      const { hosted } = yield* session;

      const { pullRequest } = yield* askService(hosted.agents.changes, {
        id,
        ...numberQuery(number),
      });

      if (pullRequest === null) {
        yield* answer({ json: { pullRequest }, lines: ["The agent opened no pull request yet."] });

        return;
      }

      if (pullRequest.truncated) {
        yield* note(`GitHub listed only the first ${pullRequest.files.length} files.`);
      }

      yield* answer({
        json: { pullRequest },
        lines: stat
          ? columns(pullRequest.files.map(fileStatRow))
          : pullRequest.files.flatMap(fileDiffLines),
        ids: pullRequest.files.map((file) => file.path),
      });
    }),
).pipe(
  Command.withDescription(
    "Print the diff of an agent's pull request, as GitHub holds it; --stat lists its files",
  ),
  Command.withExamples([
    { command: "vespin agent diff <id>", description: "Every file's patch" },
    {
      command: "vespin agent diff <id> --stat",
      description: "The files, with lines added and removed",
    },
    { command: "vespin agent diff <id> -q", description: "The changed paths alone" },
  ]),
);

/** What `pr` was asked beside the agent and the pull request's number. */
interface PrChoice {
  readonly change: PrChange;
  readonly off: boolean;
  readonly method: Option.Option<MergeMethod>;
  readonly head: Option.Option<string>;
}

/**
 * The request a change sends. A merge and auto-merge read how the pull
 * request may be merged now, as the merge box does, for the head and the
 * method neither names; a refusal where GitHub did not say, or where the
 * repository allows no method.
 */
function changeRequest(id: string, query: { readonly number?: string }, choice: PrChoice) {
  return Effect.gen(function* () {
    if (choice.change === PR_CHANGE.READY) return { action: PULL_REQUEST_ACTION.READY_FOR_REVIEW };

    if (choice.change === PR_CHANGE.DRAFT) return { action: PULL_REQUEST_ACTION.CONVERT_TO_DRAFT };

    if (choice.off) return { action: PULL_REQUEST_ACTION.DISABLE_AUTO_MERGE };
    const { hosted } = yield* session;

    const { pullRequest } = yield* askService(hosted.agentPullRequests.overviewPullRequest, {
      id,
      ...query,
    });

    const merging = pullRequest?.merging;

    if (merging === undefined) {
      return yield* new CommandFailed({
        exit: CLI_EXIT.REFUSED,
        message:
          pullRequest === null
            ? "The agent opened no pull request yet."
            : "GitHub did not say how this pull request may be merged.",
      });
    }

    const headSha = Option.getOrElse(choice.head, () => merging.headSha);
    const method = Option.getOrUndefined(choice.method) ?? merging.methods[0];

    if (choice.change === PR_CHANGE.AUTO_MERGE) {
      // Note that a merge queue merges by its own method unless one is named.
      const named = merging.queue ? Option.getOrUndefined(choice.method) : method;

      return {
        action: PULL_REQUEST_ACTION.ENABLE_AUTO_MERGE,
        headSha,
        ...(named !== undefined && { method: named }),
      };
    }

    if (method === undefined) {
      return yield* new CommandFailed({
        exit: CLI_EXIT.REFUSED,
        message: "The repository allows no merge method.",
      });
    }

    return { action: PULL_REQUEST_ACTION.MERGE, method, headSha };
  });
}

/** The answer a change ends on: its words where GitHub made it, else a refusal saying why not. */
function changeAnswer(change: PrChange, off: boolean, written: PullRequestWriteAnswer) {
  if (written.outcome === PULL_REQUEST_WRITE_OUTCOME.SIGN_IN_REQUIRED) {
    return Effect.fail(
      new CommandFailed({
        exit: CLI_EXIT.REFUSED,
        message: `GitHub needs you to sign in again: sign in with GitHub in ${PRODUCT_NAME}, then run this again.`,
      }),
    );
  }

  if (written.outcome === PULL_REQUEST_WRITE_OUTCOME.REFUSED) {
    return Effect.fail(
      new CommandFailed({ exit: CLI_EXIT.REFUSED, message: `GitHub refused: ${written.words}` }),
    );
  }

  const words = off ? "Auto-merge is off." : DONE_WORDS[change];

  return answer({ json: written, lines: [words] });
}

export const prCommand = Command.make(
  "pr",
  {
    agent: agentArgument,
    change: Argument.Literals("change", Object.values(PR_CHANGE)).pipe(
      Argument.withDescription("ready, draft, merge, or auto-merge"),
    ),
    number: numberFlag,
    method: Flag.Literals("method", Object.values(MERGE_METHOD)).pipe(
      Flag.optional,
      Flag.withDescription(
        "How a merge or auto-merge merges (default: the first the repository allows)",
      ),
    ),
    head: Flag.String("head").pipe(
      Flag.optional,
      Flag.withDescription(
        "The head commit a merge or auto-merge is made against (default: the head now)",
      ),
    ),
    off: Flag.Boolean("off").pipe(
      Flag.withDefault(false),
      Flag.withDescription("With auto-merge, turn it off"),
    ),
  },
  ({ agent: id, change, number, method, head, off }) =>
    Effect.gen(function* () {
      if (off && change !== PR_CHANGE.AUTO_MERGE) {
        return yield* new CommandFailed({
          exit: CLI_EXIT.USAGE,
          message: "--off goes with auto-merge alone.",
        });
      }

      const { hosted } = yield* session;
      const query = numberQuery(number);
      const body = yield* changeRequest(id, query, { change, off, method, head });

      const written = yield* askService(hosted.agentPullRequests.action, {
        params: { id },
        query,
        body,
      });

      yield* changeAnswer(change, off, written);
    }),
).pipe(
  Command.withDescription(
    "Change an agent's pull request on GitHub as you: mark it ready, turn it back into a draft, merge it, or turn auto-merge on or off",
  ),
  Command.withExamples([
    { command: "vespin agent pr <id> ready", description: "Mark the draft ready for review" },
    { command: "vespin agent pr <id> merge --method squash", description: "Squash and merge now" },
    { command: "vespin agent pr <id> auto-merge", description: "Merge once its checks pass" },
    { command: "vespin agent pr <id> auto-merge --off", description: "Turn auto-merge off" },
  ]),
);
