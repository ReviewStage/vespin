// github-connection.tsx -- the workspace's GitHub as the phone draws it, Settings › Workspace's and setup's Connect GitHub alike: one row, connected and counting the repositories agents reach, or offering the install, which opens GitHub's page in the app's authentication sheet.

import { INTEGRATION_STATUS_WORDS } from "@repo/features/integration-status-words";
import { INTEGRATION_PROVIDER, INTEGRATION_STATUS } from "@repo/features/integration-wire";
import { countWords, readFailedWords, readingWords, TERM } from "@repo/features/words";
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
import { useState } from "react";
import { useHostActs } from "../host/host-provider.js";
import { useWorkspaceRepositories, type WorkspaceRepositories } from "../tasks/use-start.js";
import { useWrite } from "../use-write.js";

/** What the row says, as the panel's setup and Settings › Workspace say it. */
const WORDS = {
  NAME: "GitHub",
  INSTALL: "Install on GitHub",
  ADD: "Add repositories",
  OPENING: "Opening GitHub",
  CONNECTED: INTEGRATION_STATUS_WORDS[INTEGRATION_STATUS.CONNECTED],
  READING: readingWords("the repositories"),
  READ_FAILED: readFailedWords("the repositories"),
} as const;

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
 * GitHub's section for `workspaceId`: while its repositories are read, a
 * line saying so, and Try again where the read failed; then GitHub's row,
 * connected and counting the repositories with Add repositories at its end,
 * or, reaching none, what agents do there with Install on GitHub. The
 * member's own token stays the desktop's, as the panel's second route.
 */
export function GitHubSection({ workspaceId }: { readonly workspaceId: string }) {
  const { repositories, install, opening, refusal } = useGitHubConnection(workspaceId);
  const { listed, read, failed, retry } = repositories;

  if (!read) {
    return (
      <ListSection title={WORDS.NAME}>
        {failed ? (
          <EmptyState title={WORDS.READ_FAILED} symbol={GLYPH.FAILED} retry={retry} />
        ) : (
          <LoadingRow words={WORDS.READING} />
        )}
      </ListSection>
    );
  }

  const reached = listed.length > 0;

  const lines: readonly ConnectionLine[] = [
    reached
      ? { text: `${WORDS.CONNECTED} · ${countWords(listed.length, TERM.REPOSITORY)}` }
      : { text: GITHUB_PURPOSE },
    ...(refusal === undefined ? [] : [{ text: refusal, problem: true }]),
  ];

  return (
    <ListSection title={WORDS.NAME}>
      <ConnectionRow
        name={WORDS.NAME}
        mark={INTEGRATION_MARK_ASSET[INTEGRATION_PROVIDER.GITHUB]}
        lines={lines}
        act={{
          label: opening ? WORDS.OPENING : reached ? WORDS.ADD : WORDS.INSTALL,
          disabled: opening,
          onPress: install,
        }}
      />
    </ListSection>
  );
}
