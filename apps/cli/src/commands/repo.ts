/**
 * repo.ts -- `vespin repo list`, `add`, `remove`, `cat`, `ls`, `skills`, and `issue`: the GitHub repositories the workspace reaches, those added on a member's own token, and one of them read with no task naming it.
 *
 * Each acts in the workspace the command resolves (`../workspace.js`) and
 * calls one `github` procedure, which checks the member's standing and the
 * reach of the workspace's installation or the member's own token: `list`
 * reads `github.repositories` and `github.tokenRepositories`, `add` and
 * `remove` are `github.setTokenRepository`, and `cat`, `ls`, `skills`, and
 * `issue` read a repository by its full name (`owner/name`) as GitHub holds
 * it. The member's GitHub token is never printed.
 */

import { HOSTED_API_ERROR } from "@repo/features";
import { CLI_EXIT } from "@repo/features/cli-exit";
import { GITHUB_REPOSITORY_TREE_RECURSIVE, TASK_FILE_QUERY_FLAG } from "@repo/features/contract";
import { PRODUCT_NAME } from "@repo/features/product-name";
import {
  TASK_FILE_REFUSAL,
  TASK_SKILLS_INSTALLED,
  TASK_TREE_ENTRY,
  type TaskFileRefusal,
} from "@repo/features/task-wire";
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { answer, CommandFailed, columns, note } from "../output.js";
import { askService, session } from "../session.js";
import { resolveWorkspace } from "../workspace.js";

/** Why the service read no file, listed no folder, or read no skills, as a person reads it. */
const FILE_REFUSAL_WORDS = {
  [TASK_FILE_REFUSAL.SECRET]: "The file may hold a secret, so its contents are never read.",
  [TASK_FILE_REFUSAL.MISSING]: "Nothing of that kind stands at that path.",
  [TASK_FILE_REFUSAL.NOT_TEXT]: "The file is too large, or not text.",
  [TASK_FILE_REFUSAL.NO_REPOSITORY]: "No repository was named.",
  [TASK_FILE_REFUSAL.NOT_REACHABLE]:
    "Neither the workspace's GitHub installation nor a repository added on your token reaches that repository; vespin repo list lists those that do.",
  [TASK_FILE_REFUSAL.UNAVAILABLE]: "GitHub did not answer just now; try again shortly.",
} as const satisfies Record<TaskFileRefusal, string>;

/** A refused read as the command's failure, naming the branch GitHub found nothing on. */
function fileRefused(refused: { readonly refusal: TaskFileRefusal; readonly branch?: string }) {
  const words = FILE_REFUSAL_WORDS[refused.refusal];
  return new CommandFailed({
    exit:
      refused.refusal === TASK_FILE_REFUSAL.UNAVAILABLE ? CLI_EXIT.UNAVAILABLE : CLI_EXIT.REFUSED,
    message: refused.branch === undefined ? words : `${words} (read on ${refused.branch})`,
  });
}

/** What an add or a removal is refused for, in words that say what to do. */
const TOKEN_REPOSITORY_REFUSAL_WORDS = {
  [HOSTED_API_ERROR.NOT_PERMITTED]:
    "Only the member who added the repository, or a workspace owner or admin, may remove it.",
  [HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE]:
    "Your GitHub token may not push to that repository, or you saved none (vespin github token set).",
  [HOSTED_API_ERROR.GITHUB_UNANSWERED]: "GitHub could not be reached just now; try again shortly.",
};

const repositoryArgument = Argument.String("repository").pipe(
  Argument.withDescription("The GitHub repository, owner/name"),
);

const listCommand = Command.make("list", {}, () =>
  Effect.gen(function* () {
    const { workspace } = yield* resolveWorkspace;
    const { hosted } = yield* session;
    const listed = yield* askService(hosted.github.repositories, { workspaceId: workspace.id });
    const added = yield* askService(hosted.github.tokenRepositories, {
      workspaceId: workspace.id,
    });
    if (!listed.installed) {
      yield* note(
        `No GitHub installation is connected to this workspace; install ${PRODUCT_NAME}'s GitHub App at ${listed.installationUrl}`,
      );
    }
    const rows = listed.repositories.map((one) => [
      one.fullName,
      one.access ?? "",
      one.private ? "private" : "public",
      one.defaultBranch,
    ]);
    yield* answer({
      json: { ...listed, tokenRepositories: added.repositories },
      lines: [
        ...(rows.length === 0 ? ["No repositories."] : columns(rows)),
        ...((listed.addable ?? []).length === 0
          ? []
          : [
              "",
              "Your token may add (vespin repo add):",
              ...(listed.addable ?? []).map((one) => `  ${one.fullName}`),
            ]),
      ],
      ids: listed.repositories.map(({ fullName }) => fullName),
    });
  }),
).pipe(
  Command.withDescription(
    "List the GitHub repositories you can choose for a task in the workspace, and how each is reached",
  ),
  Command.withExamples([
    { command: "vespin repo list", description: "The workspace's repositories" },
  ]),
);

/** An add or a removal of a repository on the member's own token, answered with the token repositories as they then stand. */
function setTokenRepository(repository: string, added: boolean) {
  return Effect.gen(function* () {
    const { workspace } = yield* resolveWorkspace;
    const { hosted } = yield* session;
    const answered = yield* askService(
      hosted.github.setTokenRepository,
      { workspaceId: workspace.id, repository, added },
      undefined,
      TOKEN_REPOSITORY_REFUSAL_WORDS,
    );
    yield* answer({
      json: answered,
      lines: [
        added
          ? `Added ${repository} on your GitHub token, unless the workspace's installation already reaches it.`
          : `Removed ${repository}; the workspace's tasks stand as they were.`,
      ],
      ids: answered.repositories.map(({ fullName }) => fullName),
    });
  });
}

const addCommand = Command.make("add", { repository: repositoryArgument }, ({ repository }) =>
  setTokenRepository(repository, true),
).pipe(
  Command.withDescription(
    "Add a repository to the workspace on your own GitHub token, where the installation does not reach it",
  ),
  Command.withExamples([
    { command: "vespin repo add acme/app", description: "Add a repository your token may push to" },
  ]),
);

const removeCommand = Command.make("remove", { repository: repositoryArgument }, ({ repository }) =>
  setTokenRepository(repository, false),
).pipe(
  Command.withDescription("Remove a repository added on a member's token from the workspace"),
  Command.withExamples([
    { command: "vespin repo remove acme/app", description: "Remove a token repository" },
  ]),
);

const catCommand = Command.make(
  "cat",
  {
    repository: repositoryArgument,
    path: Argument.String("path").pipe(
      Argument.withDescription("The file's path from the repository's root"),
    ),
    commit: Flag.String("commit").pipe(
      Flag.withDescription(
        "Read at this commit, by its full SHA, rather than the default branch's head",
      ),
      Flag.optional,
    ),
  },
  ({ repository, path, commit }) =>
    Effect.gen(function* () {
      const { workspace } = yield* resolveWorkspace;
      const { hosted } = yield* session;
      // Note that a raw read carries the whole text, so its window stands for nothing.
      const read = yield* askService(hosted.github.repositoryFile, {
        workspaceId: workspace.id,
        repository,
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
    "Print a file of a repository as GitHub holds it, at the default branch's head or a commit",
  ),
  Command.withExamples([
    {
      command: "vespin repo cat acme/app README.md",
      description: "The file on the default branch",
    },
    {
      command: "vespin repo cat acme/app src/index.ts --commit <sha>",
      description: "The file at a commit",
    },
  ]),
);

const lsCommand = Command.make(
  "ls",
  {
    repository: repositoryArgument,
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
  ({ repository, path, recursive }) =>
    Effect.gen(function* () {
      const { workspace } = yield* resolveWorkspace;
      const { hosted } = yield* session;
      const listed = yield* askService(hosted.github.repositoryTree, {
        workspaceId: workspace.id,
        repository,
        ...(Option.isSome(path) && path.value !== "" ? { path: path.value } : undefined),
        ...(recursive ? { recursive: GITHUB_REPOSITORY_TREE_RECURSIVE } : undefined),
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
    "List a folder of a repository as GitHub holds it at the default branch's head",
  ),
  Command.withExamples([
    { command: "vespin repo ls acme/app", description: "The repository's root" },
    { command: "vespin repo ls acme/app src -r", description: "Everything under src" },
  ]),
);

const skillsCommand = Command.make("skills", { repository: repositoryArgument }, ({ repository }) =>
  Effect.gen(function* () {
    const { workspace } = yield* resolveWorkspace;
    const { hosted } = yield* session;
    const read = yield* askService(hosted.github.repositorySkills, {
      workspaceId: workspace.id,
      repository,
      installed: TASK_SKILLS_INSTALLED,
    });
    if ("refusal" in read) return yield* fileRefused(read);
    const { skills } = read;
    yield* answer({
      json: skills,
      lines:
        skills.skills.length === 0
          ? ["No skills."]
          : columns(skills.skills.map((skill) => [skill.name, skill.source, skill.description])),
      ids: skills.skills.map(({ name }) => name),
    });
  }),
).pipe(
  Command.withDescription(
    "List the skills an agent may load by name: the repository's, then your installed ones",
  ),
  Command.withExamples([
    {
      command: "vespin repo skills acme/app",
      description: "The skills offered for that repository",
    },
  ]),
);

const issueCommand = Command.make(
  "issue",
  {
    repository: repositoryArgument,
    number: Argument.Int("number").pipe(
      Argument.withDescription("The issue's or pull request's number"),
    ),
  },
  ({ repository, number }) =>
    Effect.gen(function* () {
      const { workspace } = yield* resolveWorkspace;
      const { hosted } = yield* session;
      const place = { workspaceId: workspace.id, repository, number: String(number) };
      // Note that GitHub numbers issues and pull requests in one series, so the issue is asked only where no pull request answered.
      const { pullRequest } = yield* askService(hosted.github.repositoryPullRequest, place);
      const { issue } =
        pullRequest === null
          ? yield* askService(hosted.github.repositoryIssue, place)
          : { issue: null };
      const found = pullRequest ?? issue;
      if (found === null) {
        return yield* new CommandFailed({
          exit: CLI_EXIT.REFUSED,
          message: `No issue or pull request #${number} of ${repository} is reached.`,
        });
      }
      yield* answer({
        json: { pullRequest, issue },
        lines: [`#${found.number}  ${found.state}  ${found.title}`, found.url],
        ids: [found.url],
      });
    }),
).pipe(
  Command.withDescription(
    "Print the title, state, and link of an issue or pull request of a repository",
  ),
  Command.withExamples([
    { command: "vespin repo issue acme/app 42", description: "Issue or pull request #42" },
  ]),
);

/** The repo group: list, add, remove, cat, ls, skills, and issue. */
export const repoCommand = Command.make("repo").pipe(
  Command.withDescription("List the workspace's GitHub repositories and read their files"),
  Command.withSubcommands([
    listCommand,
    addCommand,
    removeCommand,
    catCommand,
    lsCommand,
    skillsCommand,
    issueCommand,
  ]),
  Command.withExamples([
    { command: "vespin repo list", description: "The workspace's repositories" },
    { command: "vespin repo cat acme/app README.md", description: "Read a file" },
  ]),
);
