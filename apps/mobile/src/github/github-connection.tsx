// github-connection.tsx -- the workspace's GitHub as the phone draws it, Settings › Workspace's and setup's Connect GitHub alike: one row, saying the accounts and repositories agents reach or what GitHub is for, which opens GitHub's own page in Settings, or in setup ends in the install, which opens GitHub's page in the app's authentication sheet.

import { githubHoldsWords, repositoryOwners } from "@repo/features/github-holds-words";
import { INTEGRATION_PROVIDER } from "@repo/features/integration-wire";
import { readFailedWords, readingWords } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import { GITHUB_PURPOSE } from "@repo/settings";
import {
  type ConnectionLine,
  ConnectionRow,
  EmptyState,
  GLYPH,
  INTEGRATION_MARK_ASSET,
  ListSection,
  LoadingRow,
} from "@repo/ui-native";
import { useRouter } from "expo-router";
import { useState } from "react";
import { useHostActs } from "../host/host-provider.js";
import { SETTINGS_ROUTE } from "../settings-button.js";
import { useWorkspaceRepositories, type WorkspaceRepositories } from "../tasks/use-start.js";
import { useWrite } from "../use-write.js";

/** What the row and GitHub's page say, as the panel's setup and Settings › Workspace say it. */
export const GITHUB_WORDS = {
  NAME: "GitHub",
  INSTALL: "Install on GitHub",
  ADD: "Add repositories",
  /** The page's row that adds repositories on GitHub's own page, which opens out of Settings. */
  ADD_OUT: "Add repositories…",
  OPENING: "Opening GitHub",
  READING: readingWords("the repositories"),
  READ_FAILED: readFailedWords("the repositories"),
} as const;

/** GitHub's mark, which leads its row here and on its page. */
export const GITHUB_MARK = INTEGRATION_MARK_ASSET[INTEGRATION_PROVIDER.GITHUB];

/** The workspace's GitHub as a screen reads it: its repositories, and the install that adds more. */
export interface GitHubConnection {
  readonly repositories: WorkspaceRepositories;
  /** Opens GitHub's install page for the workspace in the authentication sheet, where the App is installed or given more repositories. */
  readonly install: () => void;
  /** Whether the install is on its way to the sheet. */
  readonly opening: boolean;
  /** Why the last install did not open, until the next is pressed. */
  readonly refusal: string | undefined;
}

/**
 * The workspace's repositories, followed while the screen stands, and its
 * install. Note that the install answers once its sheet closes, and the
 * repositories are read again then, because repositories given to an
 * installation that already stood move nothing else the host reads.
 */
export function useGitHubConnection(workspaceId: string): GitHubConnection {
  const acts = useHostActs();
  const write = useWrite();
  const repositories = useWorkspaceRepositories(workspaceId);
  const [opening, setOpening] = useState(false);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);

  const install = () => {
    if (opening) return;
    setOpening(true);
    setRefusal(undefined);
    void write(() => acts[ACT_KIND.WORKSPACE_GITHUB_CONNECT]({ workspaceId }), {
      inPlace: setRefusal,
    })
      .then((went) => {
        if (went) repositories.retry();
      })
      .finally(() => setOpening(false));
  };

  return { repositories, install, opening, refusal };
}

/**
 * The lines under GitHub's row: the accounts it reaches and how many
 * repositories, as the panel's row says them, or reaching none, what
 * agents do there; then why the last install did not open.
 */
export function githubLines(
  listed: readonly string[],
  refusal: string | undefined,
): readonly ConnectionLine[] {
  return [
    { text: githubHoldsWords(repositoryOwners(listed), listed.length) ?? GITHUB_PURPOSE },
    ...(refusal === undefined ? [] : [{ text: refusal, problem: true }]),
  ];
}

/**
 * GitHub's group of Settings › Workspace for `workspaceId`: GitHub's row
 * alone, as iOS Settings stands an account, saying while its repositories
 * are read, or that the read failed, then the accounts and repositories it
 * reaches or what agents do there; one press ending in the chevron that
 * opens GitHub's own page, where Try again and the install stand.
 */
function GitHubPageRow({ workspaceId }: { readonly workspaceId: string }) {
  const router = useRouter();
  const { listed, read, failed } = useWorkspaceRepositories(workspaceId);

  // Note that the row opens no install of its own, so it has no refusal to say: the page's install says its own; and that it says nothing while its repositories are read, its name alone standing, since a read under way shows no words.
  const lines: readonly ConnectionLine[] = read
    ? githubLines(listed, undefined)
    : failed
      ? [{ text: GITHUB_WORDS.READ_FAILED, problem: true }]
      : [];

  return (
    <ListSection>
      <ConnectionRow
        name={GITHUB_WORDS.NAME}
        mark={GITHUB_MARK}
        lines={lines}
        onOpen={() => router.push(SETTINGS_ROUTE.GITHUB)}
      />
    </ListSection>
  );
}

/**
 * GitHub's section for `workspaceId`. In Settings › Workspace
 * (`opensPage`), GitHub's row alone, which opens its page
 * (`GitHubPageRow`). In setup, while its repositories are read, a line
 * saying so, and Try again where the read failed; then GitHub's row,
 * saying the accounts and repositories it reaches with Add repositories at
 * its end, or, reaching none, what agents do there with Install on GitHub.
 * The member's own token stays the desktop's, as the panel's second route.
 */
export function GitHubSection({
  workspaceId,
  opensPage = false,
}: {
  readonly workspaceId: string;
  /** Whether the row opens GitHub's page of Settings rather than ending in the install, as Settings › Workspace's does. */
  readonly opensPage?: boolean | undefined;
}) {
  if (opensPage) return <GitHubPageRow workspaceId={workspaceId} />;

  return <GitHubSetupSection workspaceId={workspaceId} />;
}

/** Setup's GitHub: its read, then its row ending in the install. */
function GitHubSetupSection({ workspaceId }: { readonly workspaceId: string }) {
  const { repositories, install, opening, refusal } = useGitHubConnection(workspaceId);
  const { listed, read, failed, retry } = repositories;

  if (!read) {
    return (
      <ListSection title={GITHUB_WORDS.NAME}>
        {failed ? (
          <EmptyState title={GITHUB_WORDS.READ_FAILED} symbol={GLYPH.FAILED} retry={retry} />
        ) : (
          <LoadingRow words={GITHUB_WORDS.READING} />
        )}
      </ListSection>
    );
  }

  const reached = listed.length > 0;

  return (
    <ListSection title={GITHUB_WORDS.NAME}>
      <ConnectionRow
        name={GITHUB_WORDS.NAME}
        mark={GITHUB_MARK}
        lines={githubLines(listed, refusal)}
        act={{
          label: opening ? GITHUB_WORDS.OPENING : reached ? GITHUB_WORDS.ADD : GITHUB_WORDS.INSTALL,
          disabled: opening,
          onPress: install,
        }}
      />
    </ListSection>
  );
}
