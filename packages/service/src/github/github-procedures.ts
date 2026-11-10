/**
 * github-procedures.ts -- the account's GitHub and the repositories of a workspace's installation, as one hosted resource.
 *
 * Connecting the account's GitHub: the Mac holds an OAuth access token,
 * not the browser session Better Auth's `linkSocial` needs, so it asks
 * `POST /api/github/connect` on its bearer for an intent and opens the web
 * page the answer names, on the host it asked through, where the browser's
 * session cookie lives. The page claims the intent at
 * `POST /api/github/connect/claim` on that session rather than a bearer:
 * the claim answers claimed only for the account it was made for, and only
 * then does the page ask Better Auth to link GitHub.
 * `GET /api/github/connection` answers whether the account has a GitHub
 * account row with a usable token, and never a token.
 * `POST /api/github/disconnect` removes the account's GitHub link through
 * Better Auth's own `unlinkAccount` (`github-unlink.ts`), under the Mac's
 * Better Auth session, which the bearer plugin reads off the
 * `Authorization` header: an OAuth token alone is no session, so it is
 * refused as unauthenticated, and only the session's own link can go,
 * whichever account a browser happens to be signed in to.
 *
 * The repositories: `GET /api/github/repositories`, which the desktop's
 * repository chip lists from, is read from GitHub on a token the App mints
 * for the listing the moment it is asked for and stored nowhere: every
 * repository of the installation connected to the workspace named in the
 * `workspaceId` query, or to the account's first workspace where none is
 * named, most recently updated first, to a member of it, and whether one is
 * connected at all; a workspace the account is not in is not found. A
 * workspace with nothing connected has no repositories. Beside them are
 * listed the repositories members added to the workspace on their own
 * tokens that the member's own token may push to, each entry marked with
 * which of the two reaches it; a member whose own token cannot push to one,
 * or who saved none, is not offered it. A member who saved their
 * own GitHub token is answered apart, as addable, the repositories it may
 * push to that neither lists, which only Add repository offers. A GitHub or
 * a store the service could not reach is unavailable.
 *
 * Those added repositories are their own resource,
 * `/api/github/token-repositories`: a member of the workspace reads them
 * (GET), less any the workspace's installation reaches, since the App
 * wins; adds one (PUT) where their own token may push to it, as the reach
 * reads it; and removes one, which its adder or a workspace's owner or
 * admin may. A removal leaves the workspace's tasks as they stand.
 *
 * Beside it, one repository of the workspace's installation is read by the
 * workspace and its name, for a place no plan names, such as an agent an
 * automation started: `GET /api/github/repositories/file`, a window of one
 * file of it, `GET /api/github/repositories/tree`, one folder of it, and
 * `GET /api/github/repositories/skills`, the skills a developer may choose
 * of it, each answered exactly as a plan's own read answers
 * (`tasks/task-file.ts`, `tasks/task-tree.ts`, `tasks/task-skills.ts`) to a member of the
 * workspace, through the same reach of its installation; a workspace the
 * account is not in is not found, and a repository the installation does
 * not reach is refused as a plan's is, inside the answer.
 *
 * And one pull request of such a repository is read by its number, for a
 * link to it to draw its title and where it stands:
 * `GET /api/github/repositories/pull-request`, on a token the installation
 * mints for that one repository with pull requests read
 * (`pull-requests.ts`), to a member of the workspace, answering its number,
 * title, page, and state and nothing more of it. A repository the
 * installation does not reach and a number the repository holds no pull
 * request under both answer none, since a link to either draws the same.
 * The answer is kept on the instance a minute, and GitHub's refusal of it
 * as long as GitHub asked (`pull-request-links.ts`), since a screen of
 * links asks for the same pull request in bursts.
 * One issue is read the same way, `GET /api/github/repositories/issue`, on
 * a token minted for the one repository with issues read alone
 * (`issues.ts`); an installation that does not grant the App issues
 * answers none, as an unreached repository does, so a link to an issue
 * there draws its address.
 *
 * The listing, the token repositories, and the reads of one repository
 * are operations of their own (`workspace-repositories.ts`), which the
 * member MCP server's tools run too; each procedure here is their door.
 *
 * Every caller is resolved on the resource's implementer rather than the
 * procedure's, so it runs before oRPC decodes the input against its schema.
 */

import {
  claimGitHubConnectIntent,
  githubConnection,
  openGitHubConnectIntent,
} from "@repo/database/models/github-connection-store";
import { GITHUB_CONNECT_PAGE } from "@repo/features/github-connection-wire";
import { Effect } from "effect";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  type SessionUserIdResolver,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, hosted, sessionMiddleware } from "../orpc/base.js";
import { fileWindowOf } from "../tasks/task-files-procedures.js";
import type { GitHubUnlink } from "./github-unlink.js";
import {
  listWorkspaceRepositories,
  readPlaceFile,
  readPlaceIssue,
  readPlacePullRequest,
  readPlaceSkills,
  readPlaceTree,
  setWorkspaceTokenRepository,
  workspaceTokenRepositories,
} from "./workspace-repositories.js";

/**
 * Better Auth's codes for an unlink it refused that we read: a session
 * older than its freshness bound, which `unlinkAccount` asks of a session,
 * and GitHub as the account's last way to sign in.
 */
const UNLINK_REFUSAL = {
  SESSION_NOT_FRESH: "SESSION_NOT_FRESH",
  LAST_ACCOUNT: "FAILED_TO_UNLINK_LAST_ACCOUNT",
} as const;

export interface GitHubProcedureSeams {
  resolveUserId: UserIdResolver;
  resolveSessionUserId: SessionUserIdResolver;
  unlinkGitHub: GitHubUnlink;
}

/**
 * The session's own GitHub link removed: a session Better Auth refuses, or
 * holds too old to unlink with, is unauthenticated, which the Mac answers
 * with a fresh session from the hand-off; GitHub as the account's last way
 * to sign in is not permitted; anything else is the outage the Mac may retry.
 */
function unlinkOrRefusal(unlink: ReturnType<GitHubUnlink>): Effect.Effect<void, HostedRefusal> {
  return unlink.pipe(
    Effect.catch((failure): Effect.Effect<never, HostedRefusal> => {
      // A failure that is not a refusal is logged by its kind alone, since what it threw may quote a request.
      if (failure._tag === "UnknownError") {
        return Effect.andThen(
          Effect.logWarning("GitHub unlink failed: UnknownError"),
          Effect.fail(HOSTED_REFUSAL.UNAVAILABLE),
        );
      }
      if (
        failure.status === HOSTED_HTTP_STATUS.UNAUTHORIZED ||
        failure.code === UNLINK_REFUSAL.SESSION_NOT_FRESH
      ) {
        return Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
      }
      return Effect.fail(
        failure.code === UNLINK_REFUSAL.LAST_ACCOUNT
          ? HOSTED_REFUSAL.NOT_PERMITTED
          : HOSTED_REFUSAL.UNAVAILABLE,
      );
    }),
  );
}

/**
 * The GitHub resource: the connect intent, the connection, and the
 * repositories to the account's bearer (or the browser's cookie), the claim
 * to the browser's session, and the disconnect to the Mac's.
 */
export function githubProcedures(seams: GitHubProcedureSeams) {
  const signedIn = hosted.github.use(accountMiddleware(seams.resolveUserId));
  const inSession = hosted.github.use(sessionMiddleware(seams.resolveSessionUserId));
  return {
    connect: signedIn.connect.effect(function* ({ context }) {
      const intent = yield* hostedStoreOrUnavailable(openGitHubConnectIntent(context.userId));
      // Note that the page is on the host the Mac asked through, because the session cookie is that host's.
      const url = new URL(GITHUB_CONNECT_PAGE.PATH, context.request.url);
      url.searchParams.set(GITHUB_CONNECT_PAGE.INTENT_PARAM, intent);
      return { url: url.toString() };
    }),
    claim: inSession.claim.effect(function* ({ context, input }) {
      const claim = yield* hostedStoreOrUnavailable(
        claimGitHubConnectIntent(input.intent, context.userId),
      );
      return { claim };
    }),
    connection: signedIn.connection.effect(function* ({ context }) {
      return yield* hostedStoreOrUnavailable(githubConnection(context.userId));
    }),
    disconnect: inSession.disconnect.effect(function* ({ context }) {
      yield* unlinkOrRefusal(seams.unlinkGitHub(context.sessionHeaders));
      return yield* hostedStoreOrUnavailable(githubConnection(context.userId));
    }),
    repositories: signedIn.repositories.effect(function* ({ context, input }) {
      return yield* listWorkspaceRepositories(context.userId, input.workspaceId);
    }),
    tokenRepositories: signedIn.tokenRepositories.effect(function* ({ context, input }) {
      return yield* workspaceTokenRepositories(context.userId, input.workspaceId);
    }),
    setTokenRepository: signedIn.setTokenRepository.effect(function* ({ context, input }) {
      return yield* setWorkspaceTokenRepository(context.userId, input);
    }),
    repositoryFile: signedIn.repositoryFile.effect(function* ({ context, input }) {
      const window = yield* fileWindowOf(input);
      return yield* readPlaceFile(context.userId, input, window);
    }),
    repositoryTree: signedIn.repositoryTree.effect(function* ({ context, input }) {
      return yield* readPlaceTree(context.userId, input, {
        path: input.path ?? "",
        ...(input.recursive === undefined ? undefined : { recursive: true }),
      });
    }),
    repositorySkills: signedIn.repositorySkills.effect(function* ({ context, input }) {
      return yield* readPlaceSkills(
        context.userId,
        input.workspaceId,
        input.repository ?? null,
        input.installed !== undefined,
      );
    }),
    repositoryPullRequest: signedIn.repositoryPullRequest.effect(function* ({ context, input }) {
      return { pullRequest: yield* readPlacePullRequest(context.userId, input, input.number) };
    }),
    repositoryIssue: signedIn.repositoryIssue.effect(function* ({ context, input }) {
      return { issue: yield* readPlaceIssue(context.userId, input, input.number) };
    }),
  };
}
