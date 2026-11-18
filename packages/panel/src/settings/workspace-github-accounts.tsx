import {
  GITHUB_ACCESS,
  GITHUB_REPOSITORY_SELECTION,
  type GitHubRepositoriesAnswer,
  type GitHubRepository,
} from "@repo/features/github-repositories-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { githubAccountPictureUrl } from "@repo/features/tasks-model";
import { countWords, readFailedWords, readingWords, TERM } from "@repo/features/words";
import type { WorkspaceGithubInstallation } from "@repo/features/workspace-wire";
import { ANNOUNCE, type RepositoryLineEntry, RepositoryLines, SettingsRowMark } from "@repo/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { MenuAction } from "../desktop/action-menu.js";
import { TILE_SIZE, WorkspaceTile } from "../desktop/workspace-tile.js";
import {
  repositoryListsQuery,
  repositoryListsRetryMutation,
  repositoryScope,
} from "../live-reads.js";
import { useRepositoryPictures } from "../repository-pictures.js";
import { useAnnounceShown } from "../use-announce-shown.js";
import { ReadFailed } from "./marks.js";
import { MenuRow } from "./menu-row.js";

/**
 * workspace-github-accounts.tsx -- every GitHub account on Settings › Workspace › GitHub, each with the repositories agents reach on it.
 *
 * Every account stands as the same row (`GitHubOwnerRow`) in the page's
 * Accounts and repositories. A row's ⋯, where it holds acts at all, is the
 * only way one row differs from another (`workspace-token-repositories.tsx`).
 *
 * The accounts here are those whose installation of our GitHub App is
 * connected and active; one suspended or removed on GitHub draws no row,
 * since agents reach none of it and the store never forgets a removed one.
 * Their repositories are the App's from the list the repository picker
 * reads for the workspace (`LIVE_READ.REPOSITORY_LISTS`), grouped by owner,
 * which GitHub spells as it pleases, so an account's are those whose owner
 * is its login in any case: the login the listing read from GitHub now
 * (`installations`), which the row is named by too, since the store keeps
 * an account's old one after a rename, else the stored one. Where the
 * listing says the installation was given every repository, the line says
 * All; a service older than it says nothing of it, and the line counts
 * alone. Members read the same as owners and admins.
 */

/** What an account's line says while its repositories are not yet known. */
const WORDS = {
  READING: readingWords(TERM.REPOSITORY.many),
  NOT_READ: readFailedWords(TERM.REPOSITORY.many),
} as const;

/** No repositories, for an account the list names none of. */
const NONE: readonly GitHubRepository[] = [];

/** No lines, for a row whose repositories are not yet known. */
const NO_LINES: readonly RepositoryLineEntry[] = [];

/** One connected GitHub account as the page lists it: its login, whether its installation is active, and its id where the service named it. */
export type ShownConnection = Pick<WorkspaceGithubInstallation, "login" | "active"> &
  Partial<Pick<WorkspaceGithubInstallation, "installationId">>;

/** A row's line: how many repositories it holds, all of them where its installation was given every one. */
export function repositoryCount(count: number, all = false): string {
  const counted = countWords(count, TERM.REPOSITORY);

  return all ? `All ${counted}` : counted;
}

/**
 * The App's repositories by owner, each owner keyed as no case spells it,
 * in the listing's order. Note that a service older than tokens lists the
 * App's alone and marks none.
 */
function repositoriesByOwner(
  repositories: readonly GitHubRepository[],
): ReadonlyMap<string, readonly GitHubRepository[]> {
  const byOwner = new Map<string, GitHubRepository[]>();

  for (const one of repositories) {
    if (one.access === GITHUB_ACCESS.TOKEN) continue;
    const key = one.owner.toLowerCase();
    const owned = byOwner.get(key);

    if (owned === undefined) byOwner.set(key, [one]);
    else owned.push(one);
  }

  return byOwner;
}

/** What the listing read of the connection's installation, where it names it: its login now and what it was given. */
function listedOf(answer: GitHubRepositoriesAnswer, connection: ShownConnection) {
  return answer.installations?.find((one) => one.installationId === connection.installationId);
}

/** One connected account as the listing reads it: its login GitHub holds now, its repositories, and whether it was given every one. */
export interface ListedAccount {
  readonly key: string | number;
  readonly login: string;
  readonly repositories: readonly GitHubRepository[];
  readonly all: boolean;
}

/**
 * Each active connection as the workspace's listing reads it, in order.
 * Note that the login GitHub answers now names it and finds its
 * repositories, because the store keeps an account's old one after a
 * rename on GitHub.
 */
export function listedAccounts(
  answer: GitHubRepositoriesAnswer,
  connections: readonly ShownConnection[],
): readonly ListedAccount[] {
  const byOwner = repositoriesByOwner(answer.repositories);

  return connections.map((connection) => {
    const listed = listedOf(answer, connection);
    const login = listed?.login ?? connection.login;

    return {
      key: connection.installationId ?? connection.login,
      login,
      repositories: byOwner.get(login.toLowerCase()) ?? NONE,
      all: listed?.repositorySelection === GITHUB_REPOSITORY_SELECTION.ALL,
    };
  });
}

/** The account's picture on GitHub, a workspace's tile keyed by its login, so its letter stands until the picture loads and wherever it fails to. */
function AccountMark({ login }: { login: string }): React.JSX.Element {
  return (
    <SettingsRowMark>
      <WorkspaceTile
        workspace={{
          id: `github:${login}`,
          name: login,
          pictureUrl: githubAccountPictureUrl(login),
        }}
        size={TILE_SIZE.NESTED}
      />
    </SettingsRowMark>
  );
}

/**
 * One GitHub account's row, every account's alike, its repositories folded
 * under its words as the setup's GitHub step lists them (`RepositoryLines`):
 * each one's owner's picture and whole name, a Token mark on one a member's
 * token reaches, in a list that scrolls past six.
 */
export function GitHubOwnerRow({
  login,
  line,
  repositories,
  actions = [],
}: {
  login: string;
  line: ReactNode;
  /** Its repositories; none where not yet known. */
  repositories: readonly RepositoryLineEntry[];
  actions?: readonly MenuAction[];
}): React.JSX.Element {
  const pictures = useRepositoryPictures();
  const label = `${login}'s repositories`;

  return (
    <MenuRow
      thing={login}
      actions={actions}
      row={{
        leading: <AccountMark login={login} />,
        label: login,
        description: line,
        ...(repositories.length !== 0 && {
          fold: {
            body: <RepositoryLines label={label} repositories={repositories} pictures={pictures} />,
            label,
            defaultOpen: false,
          },
        }),
      }}
    />
  );
}

/**
 * Every active account connected to the workspace, the first linked first,
 * the workspace's repositories held by the host while they stand
 * (`LIVE_READ.REPOSITORY_LISTS`): each account's line says Reading until
 * they land, then counts its own, and a read that failed says so once under
 * the accounts with Retry. Nothing is drawn, and nothing read, where no
 * account is connected.
 */
export function GitHubAccountRows({
  workspaceId,
  connections,
}: {
  workspaceId: string;
  /** The active connections alone. */
  connections: readonly ShownConnection[];
}): React.JSX.Element | null {
  if (connections.length === 0) return null;

  return <ListedAccountRows workspaceId={workspaceId} connections={connections} />;
}

/** The accounts once one is connected, which reads the workspace's repositories. */
function ListedAccountRows({
  workspaceId,
  connections,
}: {
  workspaceId: string;
  connections: readonly ShownConnection[];
}): React.JSX.Element {
  const list = useQuery(repositoryListsQuery(workspaceId));
  const retry = useMutation(repositoryListsRetryMutation());
  const answer = list.data;
  const failed = answer === undefined && list.isError;
  const reading = answer === undefined && !failed;
  useAnnounceShown(ANNOUNCE.POLITE, reading ? WORDS.READING : "");

  return (
    <>
      {answer === undefined
        ? connections.map((connection) => (
            <GitHubOwnerRow
              key={connection.installationId ?? connection.login}
              login={connection.login}
              line={reading ? WORDS.READING : undefined}
              repositories={NO_LINES}
            />
          ))
        : listedAccounts(answer, connections).map((account) => (
            <GitHubOwnerRow
              key={account.key}
              login={account.login}
              line={repositoryCount(account.repositories.length, account.all)}
              repositories={account.repositories.map(({ fullName }) => ({ repository: fullName }))}
            />
          ))}
      {failed ? (
        <ReadFailed
          line={WORDS.NOT_READ}
          surface={FAILURE_SURFACE.WORKSPACE_REPOSITORIES_READ}
          onRetry={() => retry.mutate(repositoryScope(workspaceId))}
        />
      ) : null}
    </>
  );
}
