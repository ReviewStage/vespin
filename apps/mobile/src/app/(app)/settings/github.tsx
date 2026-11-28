// github.tsx -- Settings › Workspace › GitHub, as iOS Settings opens an account from its row: GitHub's mark, name and where it stands, the repositories agents reach, and the install that adds more, out to GitHub's own page.

import { INTEGRATION_STATUS_WORDS } from "@repo/features/integration-status-words";
import { INTEGRATION_STATUS } from "@repo/features/integration-wire";
import { noneYetWords, TERM } from "@repo/features/words";
import { selectWorkspaces } from "@repo/host/app-state-reads";
import { GITHUB_PURPOSE } from "@repo/settings";
import {
  type ConnectionLine,
  ConnectionRow,
  EmptyState,
  GLYPH,
  ListSection,
  LoadingRow,
  MenuRow,
  PUSH_ROW_GOES,
  PushRow,
  SCREEN_GROUND,
  Screen,
  SettingsForm,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { useChosenWorkspace } from "../../../chosen-workspace.js";
import {
  GITHUB_MARK,
  GITHUB_WORDS,
  githubLines,
  useGitHubConnection,
} from "../../../github/github-connection.js";
import { appStateQuery } from "../../../host/app-state-query.js";

export { ScreenBoundary as ErrorBoundary } from "../../../screen-boundary.js";

/** What the page's repositories say, the panel's words for them. */
const REPOSITORIES = {
  TITLE: "Repositories",
  NONE: noneYetWords(TERM.REPOSITORY),
} as const;

/** No acts, for a repository's row, which only says. */
const NO_ACTS = [] as const;

/** The head's lines once GitHub reaches a repository: Connected, as a connection's page says, since the rows under it name what it reaches; then why the last install did not open. */
function connectedLines(refusal: string | undefined): readonly ConnectionLine[] {
  return [
    { text: INTEGRATION_STATUS_WORDS[INTEGRATION_STATUS.CONNECTED] },
    ...(refusal === undefined ? [] : [{ text: refusal, problem: true }]),
  ];
}

export default function GitHubScreen() {
  const { data: workspaces = [] } = useQuery({ ...appStateQuery, select: selectWorkspaces });
  const { chosen } = useChosenWorkspace(workspaces);

  if (chosen === undefined) return null;

  return <GitHubPage key={chosen.id} workspaceId={chosen.id} />;
}

/**
 * GitHub's page for `workspaceId`: its row, Connected with what it gives
 * agents under it once it reaches a repository, else what agents do there; then each repository it reaches by
 * its owner and name, and last the install, Add repositories… once it
 * reaches one, which leaves the app for GitHub's page as the section's
 * button did. There is no Disconnect, as the panel's page holds none: the
 * App is uninstalled on GitHub.
 */
function GitHubPage({ workspaceId }: { readonly workspaceId: string }) {
  const { repositories, install, opening, refusal } = useGitHubConnection(workspaceId);
  const { listed, read, failed, retry } = repositories;

  if (!read) {
    return (
      <Screen ground={SCREEN_GROUND.GROUPED}>
        <SettingsForm>
          <ListSection>
            {failed ? (
              <EmptyState title={GITHUB_WORDS.READ_FAILED} symbol={GLYPH.FAILED} retry={retry} />
            ) : (
              <LoadingRow words={GITHUB_WORDS.READING} />
            )}
          </ListSection>
        </SettingsForm>
      </Screen>
    );
  }

  const reached = listed.length > 0;

  return (
    <Screen ground={SCREEN_GROUND.GROUPED}>
      <SettingsForm>
        {/* Note that a GitHub reaching nothing says what it is for on its row, so the footer would say it twice. */}
        <ListSection footer={reached ? GITHUB_PURPOSE : undefined}>
          <ConnectionRow
            name={GITHUB_WORDS.NAME}
            mark={GITHUB_MARK}
            lines={reached ? connectedLines(refusal) : githubLines(listed, refusal)}
          />
        </ListSection>
        <ListSection
          title={REPOSITORIES.TITLE}
          count={listed.length}
          footer={reached ? undefined : REPOSITORIES.NONE}
        >
          {listed.map((repository) => (
            <MenuRow key={repository} label={repository} symbol={GLYPH.REPOSITORY} acts={NO_ACTS} />
          ))}
          <PushRow
            label={reached ? GITHUB_WORDS.ADD_OUT : GITHUB_WORDS.INSTALL}
            detail={opening ? GITHUB_WORDS.OPENING : undefined}
            goes={PUSH_ROW_GOES.OUT}
            onPress={install}
          />
        </ListSection>
      </SettingsForm>
    </Screen>
  );
}
