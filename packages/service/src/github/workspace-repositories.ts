/**
 * workspace-repositories.ts -- the repositories a member reaches in a workspace, through its GitHub installation or their own token, and one of them read with no plan naming it: the operations the hosted `github` procedures and the member MCP tools both run.
 *
 * The listing is read from GitHub on a token the App mints for it the
 * moment it is asked for and stored nowhere: every repository of the
 * installation connected to the workspace, most recently updated first, and
 * beside them the repositories members added to the workspace on their own
 * tokens that the member's own token may push to, each marked with which of
 * the two reaches it. A member who saved their own GitHub token is answered
 * apart, as addable, the repositories it may push to that neither lists.
 * The token's value is never read into any answer.
 *
 * One repository is read by the workspace and its full name: a window of a
 * file, a folder, the skills a developer may choose of it, and a pull
 * request's or an issue's title and state by its number, each to a member
 * of the workspace alone (`memberPlace`); a workspace the account is not in
 * is not found.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import {
  isWorkspaceMember,
  personalWorkspaceOf,
  workspaceOf,
} from "@repo/database/models/workspace-store";
import {
  addWorkspaceTokenRepository,
  listWorkspaceTokenRepositories,
  removeWorkspaceTokenRepository,
  type WorkspaceTokenRepositoryRow,
  workspaceTokenRepositoryAdder,
} from "@repo/database/models/workspace-token-repository-store";
import type { GitHubIssueSummary, GitHubPullRequestSummary } from "@repo/features";
import {
  GITHUB_ACCESS,
  type GitHubRepositoriesAnswer,
  type WorkspaceTokenRepositoriesAnswer,
} from "@repo/features/github-repositories-wire";
import type {
  TaskFileAnswer,
  TaskFileRequest,
  TaskSkillsAnswer,
  TaskTreeAnswer,
  TaskTreeRequest,
} from "@repo/features/task-wire";
import { managesWorkspace } from "@repo/features/workspace-role";
import { DateTime, Effect, Option, Result } from "effect";
import type { HttpClient } from "effect/http";
import { workspaceDrivePruned } from "../agents/workspace-drive.js";
import type { GitHubRepository } from "../core.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  repositoryNotReachable,
} from "../http/http-effect.js";
import { readRepositoryFileWindow } from "../tasks/task-file.js";
import { readWorkspaceSkills } from "../tasks/task-skills.js";
import { readRepositoryTree } from "../tasks/task-tree.js";
import {
  GitHubApp,
  type GitHubWorkspaceReadFailure,
  markRefusedToken,
  type WorkspaceListing,
} from "./github-app.js";
import {
  githubReachOrRefusal,
  githubReadOrRefusal,
  logWorkspaceReadFailure,
} from "./github-refusal.js";
import { issueByNumber } from "./issues.js";
import { PullRequestLinkKey, PullRequestLinks } from "./pull-request-links.js";

/** What the operations may require of whoever runs them. */
export type WorkspaceRepositoriesServices = DatabaseServices | GitHubApp | HttpClient.HttpClient;

/** A repository as a read with no plan names it: the workspace whose installation reaches it, the repository, and the member asking, whose own token reaches it where no installation does. */
export interface RepositoryPlace {
  readonly workspaceId: string;
  readonly repository: string;
  readonly member: string;
}

/** The place named, where the account is a member of its workspace; one not a member of is not found. */
export const memberPlace = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  place: Omit<RepositoryPlace, "member">,
): Effect.fn.Return<RepositoryPlace, HostedRefusal, DatabaseServices> {
  const member = yield* hostedStoreOrUnavailable(isWorkspaceMember(userId, place.workspaceId));

  if (!member) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);

  return { workspaceId: place.workspaceId, repository: place.repository, member: userId };
});

/** A repository's full name as two spellings of it compare: GitHub's names ignore case. */
function nameKey(fullName: string): string {
  return fullName.toLowerCase();
}

/** The picker's repositories, and those Add repository offers. */
interface PickedRepositories {
  readonly repositories: GitHubRepository[];
  readonly addable: GitHubRepository[];
}

/**
 * The picker's repositories: the installation's, each marked the App's,
 * and those members added to the workspace on their tokens that it does not
 * list and the member's own token may push to, marked the token's, so a
 * member with no token, or whose token cannot push to one, or whose token's
 * listing GitHub did not answer, is not offered it. One list, most recently
 * updated first. Beside it, the member's own token's that neither lists,
 * marked the token's, which Add repository offers and the picker does not,
 * since a token reaches a repository for a task only once it is added.
 */
function pickedRepositories(
  throughApp: readonly GitHubRepository[],
  onToken: readonly GitHubRepository[],
  added: readonly WorkspaceTokenRepositoryRow[],
): PickedRepositories {
  const listed = new Set(throughApp.map((one) => nameKey(one.fullName)));
  const ownByName = new Map(onToken.map((one) => [nameKey(one.fullName), one]));

  // Note that an added repository is drawn as the member's own token lists it, because its row keeps only its name.
  const addedOnly = added.flatMap((row) => {
    const key = nameKey(row.repository);
    const own = ownByName.get(key);

    return listed.has(key) || own === undefined ? [] : [own];
  });

  for (const one of addedOnly) listed.add(nameKey(one.fullName));

  const byRecent = (left: GitHubRepository, right: GitHubRepository) =>
    right.updatedAt - left.updatedAt;

  return {
    repositories: [
      ...throughApp.map((one) => ({ ...one, access: GITHUB_ACCESS.APP })),
      ...addedOnly.map((one) => ({ ...one, access: GITHUB_ACCESS.TOKEN })),
    ].sort(byRecent),
    addable: onToken
      .flatMap((one) =>
        listed.has(nameKey(one.fullName)) ? [] : [{ ...one, access: GITHUB_ACCESS.TOKEN }],
      )
      .sort(byRecent),
  };
}

/**
 * The workspace the listing is for: the one named, where the account is a
 * member of it, or the account's first one where none is named, which a
 * first read may arrive ahead of and so finds none, with nothing connected.
 */
const listedWorkspace = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  named: string | undefined,
): Effect.fn.Return<Option.Option<string>, HostedRefusal, DatabaseServices> {
  if (named === undefined) return yield* hostedStoreOrUnavailable(personalWorkspaceOf(userId));
  const member = yield* hostedStoreOrUnavailable(isWorkspaceMember(userId, named));

  if (!member) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);

  return Option.some(named);
});

/**
 * The repositories the member may pick in the workspace named, or their
 * first where none is named, whether an installation is connected to it,
 * its installations, the link to install the App, and those the member's
 * own token may add; a GitHub or a store the service could not reach is
 * unavailable.
 */
export const listWorkspaceRepositories = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  named: string | undefined,
): Effect.fn.Return<GitHubRepositoriesAnswer, HostedRefusal, WorkspaceRepositoriesServices> {
  const workspace = yield* listedWorkspace(userId, named);
  const app = yield* GitHubApp;

  const [listed, installationUrl, own] = yield* githubReadOrRefusal(
    Effect.all([
      Option.match(workspace, {
        onNone: () => Effect.succeed(Option.none<WorkspaceListing>()),
        onSome: app.workspaceListing,
      }),
      app.installUrl,
      app.memberRepositories(userId),
    ]),
  );

  const added = Option.isNone(workspace)
    ? []
    : yield* hostedStoreOrUnavailable(listWorkspaceTokenRepositories(userId, workspace.value));

  return {
    installed: Option.isSome(listed),
    ...pickedRepositories(
      Option.match(listed, { onNone: () => [], onSome: (listing) => listing.repositories }),
      Option.getOrElse(own, () => []),
      added,
    ),
    installations: Option.match(listed, {
      onNone: () => [],
      onSome: (listing) => listing.installations,
    }),
    installationUrl,
  };
});

/**
 * The repositories members added to the workspace on their tokens, as
 * Settings › Workspace lists them to a member of it, each removable by its
 * adder or a workspace's owner or admin; one the workspace's installation
 * reaches is left out, its row kept, since the App wins, and a GitHub that
 * does not answer leaves nothing out. A workspace the account is not in is
 * not found.
 */
export const workspaceTokenRepositories = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  workspaceId: string,
): Effect.fn.Return<
  WorkspaceTokenRepositoriesAnswer,
  HostedRefusal,
  WorkspaceRepositoriesServices
> {
  const workspace = yield* hostedStoreOrUnavailable(workspaceOf(userId, workspaceId));

  if (Option.isNone(workspace)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const rows = yield* hostedStoreOrUnavailable(listWorkspaceTokenRepositories(userId, workspaceId));

  if (rows.length === 0) return { repositories: [] };
  const app = yield* GitHubApp;

  // Note that a GitHub that does not answer hides nothing, because the list and its writes are the store's and must not wait on GitHub;
  // a store that cannot name the installations is the outage it is, so a row the App covers never shows on a guess.
  const throughApp = yield* app.workspaceRepositories(workspaceId).pipe(
    Effect.tapError(logWorkspaceReadFailure),
    Effect.catchTag(
      ["GitHubAppNotConfigured", "GitHubUnavailable"],
      () => Effect.succeed(Option.none<readonly GitHubRepository[]>()),
      () => Effect.fail(HOSTED_REFUSAL.UNAVAILABLE),
    ),
  );

  const reached = new Set(
    Option.getOrElse(throughApp, () => []).map((one) => nameKey(one.fullName)),
  );

  const manages = managesWorkspace(workspace.value);

  return {
    repositories: rows
      .filter((row) => !reached.has(nameKey(row.repository)))
      .map((row) => ({
        fullName: row.repository,
        addedBy: row.addedByUserId,
        addedAt: row.addedAt,
        removable: manages || row.addedByUserId === userId,
      })),
  };
});

/**
 * A repository added to the workspace on the member's own token, where the
 * reach finds their token may push to it (`github-app.ts`), and refused as
 * not reachable, with why, where it does not; one the workspace's
 * installation reaches is added nowhere, since the App wins.
 */
const addTokenRepository = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  workspaceId: string,
  repository: string,
): Effect.fn.Return<void, HostedRefusal, WorkspaceRepositoriesServices> {
  const app = yield* GitHubApp;
  const reach = yield* githubReachOrRefusal(app.repositoryReach(workspaceId, repository, userId));

  if (Result.isFailure(reach)) return yield* Effect.fail(repositoryNotReachable(reach.failure));

  if (reach.success.access !== GITHUB_ACCESS.TOKEN) return;
  const now = yield* DateTime.nowAsDate;
  yield* hostedStoreOrUnavailable(
    addWorkspaceTokenRepository(userId, workspaceId, reach.success.repository.fullName, now),
  );
});

/** A token repository removed from the workspace by its adder or a workspace's owner or admin; anyone else is not permitted. */
const removeTokenRepository = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  workspaceId: string,
  repository: string,
): Effect.fn.Return<void, HostedRefusal, DatabaseServices> {
  const workspace = yield* hostedStoreOrUnavailable(workspaceOf(userId, workspaceId));

  if (Option.isNone(workspace)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);

  const adder = yield* hostedStoreOrUnavailable(
    workspaceTokenRepositoryAdder(userId, workspaceId, repository),
  );

  if (Option.isNone(adder)) return;

  if (adder.value !== userId && !managesWorkspace(workspace.value)) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  }

  yield* hostedStoreOrUnavailable(
    removeWorkspaceTokenRepository(userId, workspaceId, repository, adder.value),
  );
});

/**
 * A repository added to the workspace on the member's own token, or removed
 * from it, answered with the token repositories as they then stand; a
 * workspace the account is not in is not found. A removal leaves the
 * workspace's tasks as they stand, and prunes the workspace's drive
 * past the answer (`workspace-drive.ts`).
 */
export const setWorkspaceTokenRepository = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  change: { readonly workspaceId: string; readonly repository: string; readonly added: boolean },
): Effect.fn.Return<
  WorkspaceTokenRepositoriesAnswer,
  HostedRefusal,
  WorkspaceRepositoriesServices
> {
  const member = yield* hostedStoreOrUnavailable(isWorkspaceMember(userId, change.workspaceId));

  if (!member) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  yield* change.added
    ? addTokenRepository(userId, change.workspaceId, change.repository)
    : removeTokenRepository(userId, change.workspaceId, change.repository);

  // Note that only a removal prunes the workspace's drive, so the repository leaves it; an addition fills nothing.
  if (!change.added) yield* workspaceDrivePruned(change.workspaceId);

  return yield* workspaceTokenRepositories(userId, change.workspaceId);
});

/** A window of one file of the repository, as a plan's File tab reads one (`tasks/task-file.ts`), a refusal inside the answer. */
export const readPlaceFile = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  named: Omit<RepositoryPlace, "member">,
  window: TaskFileRequest,
): Effect.fn.Return<TaskFileAnswer, HostedRefusal, WorkspaceRepositoriesServices> {
  const place = yield* memberPlace(userId, named);

  return yield* readRepositoryFileWindow(place.workspaceId, place.repository, place.member, window);
});

/** One folder of the repository, as a plan's tree lists one (`tasks/task-tree.ts`), a refusal inside the answer. */
export const readPlaceTree = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  named: Omit<RepositoryPlace, "member">,
  folder: TaskTreeRequest,
): Effect.fn.Return<TaskTreeAnswer, HostedRefusal, WorkspaceRepositoriesServices> {
  const place = yield* memberPlace(userId, named);

  return yield* readRepositoryTree(place.workspaceId, place.repository, place.member, folder);
});

/** The skills a developer may choose in the workspace, the repository's first where one is named (`tasks/task-skills.ts`), a refusal inside the answer. */
export const readPlaceSkills = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  workspaceId: string,
  repository: string | null,
  installed: boolean,
): Effect.fn.Return<TaskSkillsAnswer, HostedRefusal, WorkspaceRepositoriesServices> {
  const member = yield* hostedStoreOrUnavailable(isWorkspaceMember(userId, workspaceId));

  if (!member) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);

  return yield* hostedStoreOrUnavailable(
    readWorkspaceSkills(workspaceId, repository, userId, installed),
  );
});

/**
 * The pull request of the number given, as a link draws it, kept on the
 * instance a minute (`pull-request-links.ts`); none where the installation
 * does not reach the repository or it holds no pull request of that number.
 */
export const readPlacePullRequest = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  named: Omit<RepositoryPlace, "member">,
  number: number,
): Effect.fn.Return<
  GitHubPullRequestSummary | null,
  HostedRefusal,
  WorkspaceRepositoriesServices | PullRequestLinks
> {
  const place = yield* memberPlace(userId, named);
  const links = yield* PullRequestLinks;

  return yield* links
    .read(new PullRequestLinkKey({ ...place, number }))
    // Note that the failure is not logged here, because a refusal held from an earlier read was logged when it was read.
    .pipe(Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE));
});

/** The issue of the number given, as a link draws it; none where there is none to draw, as a pull request's link answers. */
const issueOfPlace = /* @__PURE__ */ Effect.fnUntraced(function* (
  place: RepositoryPlace,
  number: number,
): Effect.fn.Return<
  GitHubIssueSummary | null,
  GitHubWorkspaceReadFailure,
  WorkspaceRepositoriesServices
> {
  const app = yield* GitHubApp;

  const reached = yield* app.repositoryIssueToken(
    place.workspaceId,
    place.repository,
    place.member,
  );

  if (Option.isNone(reached)) return null;

  const found = yield* issueByNumber(reached.value.token, place.repository, number).pipe(
    markRefusedToken(reached.value.access),
  );

  return Option.getOrNull(found);
});

/** The issue of the number given, of a repository the installation reaches with issues read; none where the installation grants no issues or there is none. */
export const readPlaceIssue = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  named: Omit<RepositoryPlace, "member">,
  number: number,
): Effect.fn.Return<GitHubIssueSummary | null, HostedRefusal, WorkspaceRepositoriesServices> {
  const place = yield* memberPlace(userId, named);

  return yield* githubReadOrRefusal(issueOfPlace(place, number));
});
