import { signedInAccountId } from "@repo/credentials/snapshot";
import {
  GITHUB_ACCESS,
  type GitHubAccess,
  type GitHubRepository,
} from "@repo/features/github-repositories-wire";
import { INTEGRATION_PROVIDER } from "@repo/features/integration-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { countWords, TERM } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import {
  BUTTON_VARIANT,
  Button,
  CHOICE_LOOK,
  ChoiceList,
  type ChoiceOption,
  GAP,
  MARK_PROVIDER,
  PROVIDER_BUTTON_SIZE,
  ProviderButton,
  ProviderMark,
  RepositoryLines,
  SETTINGS_ROW_STATE,
  SettingsRow,
  SettingsRowMark,
  SettingsRowStateLine,
  Stack,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { actMutation } from "../act-mutations.js";
import { refusedShown } from "../failure-report.js";
import { githubTokenQuery, repositoryListsQuery } from "../live-reads.js";
import { useRepositoryPictures } from "../repository-pictures.js";
import { GitHubTokenPaste, useGitHubTokenSave } from "../settings/github-dialog.js";
import { replayMaskedError } from "../settings/marks.js";
import {
  TokenRepositoryPicker,
  useTokenRepositories,
} from "../settings/workspace-token-repositories.js";
import { appStateQuery, selectAccount } from "../use-app-state.js";

/**
 * setup-github.tsx -- setup's GitHub step: the App installed on the workspace's repositories, or the member's own token, chosen as two cards, then the repositories reached.
 *
 * The App is one trip to GitHub, which also links the member's GitHub
 * (the service keeps the install's user token). The token is made on
 * GitHub's own page and pasted here, in the steps an agent key's paste
 * takes (`GitHubTokenPaste`), then the repositories it may push to are
 * picked, several at once, in a menu that checks each one added. The token
 * stands on its own, needing no GitHub account linked first. The step is
 * done once the workspace reaches a repository, which is read again
 * whenever the window is focused, so a trip finished in the browser lands
 * on its own.
 *
 * Once one is reached the cards give way to GitHub's row as Settings draws
 * an integration's, connected and counting the repositories, with every one
 * of them under it as Settings › Workspace lists an account's
 * (`RepositoryLines`). The row's Add repositories adds through the route the
 * workspace is reached by: back to GitHub's install page, where the App's
 * installation is configured or another account given it, wherever the App
 * reaches one; and with the member's own token, where the token alone
 * reaches them, its checked picker, so a repository is taken back there too.
 */

/** What setup says over GitHub's cards, which setup lets be skipped: agents work in the account's repositories. */
export const GITHUB_PURPOSE = "Agents work in your repositories and open pull requests.";

/** The words of GitHub's row once a repository is reached. */
const WORDS = {
  ADD: "Add repositories",
  OPENING: "Opening GitHub",
  LIST: "Repositories agents reach",
} as const;

/** GitHub's own mark, which leads its row as it leads Settings › Workspace's. */
const GITHUB_MARK = (
  <SettingsRowMark>
    <ProviderMark provider={INTEGRATION_PROVIDER.GITHUB} />
  </SettingsRowMark>
);

/** A card's words under its choice, in the caption's muted ink. */
function CardWords({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
      {children}
    </Text>
  );
}

/**
 * The route the workspace's repositories are reached through: the App
 * wherever it reaches one, since the App wins, and a row with no access
 * named is the App's, from a service older than tokens.
 */
function reachedRoute(repositories: readonly GitHubRepository[]): GitHubAccess {
  const onApp = repositories.some(({ access }) => access !== GITHUB_ACCESS.TOKEN);
  return onApp ? GITHUB_ACCESS.APP : GITHUB_ACCESS.TOKEN;
}

/** The member's own GitHub token as the host holds it, or none where it is unread, refused, or not saved. */
function useHeldToken(): boolean {
  const accountId = signedInAccountId(useQuery({ ...appStateQuery, select: selectAccount }).data);
  const held = useQuery(githubTokenQuery(accountId));
  // Note that a token read that failed is taken for none, so the card offers a paste rather than waiting.
  return !held.isError && held.data?.token != null;
}

/** The App's card: one press sends the browser to GitHub's install page. */
function AppRoute({ workspaceId }: { workspaceId: string }): React.JSX.Element {
  const connectGitHub = useMutation(actMutation(ACT_KIND.WORKSPACE_GITHUB_CONNECT));
  const refusal = connectGitHub.error?.message;
  const install = () => connectGitHub.mutate({ workspaceId });
  return (
    <>
      <ProviderButton
        provider={MARK_PROVIDER.GITHUB}
        name="GitHub"
        words="Install on GitHub"
        size={PROVIDER_BUTTON_SIZE.GATE}
        primary
        busy={connectGitHub.isPending}
        busyLabel={WORDS.OPENING}
        onPress={install}
      />
      {refusal === undefined ? null : (
        <CardWords>
          <ReplayMask>{refusal}</ReplayMask>
        </CardWords>
      )}
    </>
  );
}

/** The token's card: a classic token made on GitHub and pasted here, then the repositories it may push to, picked several at once. */
function TokenRoute({ workspaceId }: { workspaceId: string }): React.JSX.Element {
  const save = useGitHubTokenSave();
  const repositories = useTokenRepositories(workspaceId);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const held = useHeldToken();
  if (!held) return <GitHubTokenPaste onSave={save} />;
  return (
    <>
      <span className="flex">
        <TokenRepositoryPicker
          workspaceId={workspaceId}
          repositories={repositories}
          onRefused={setRefusal}
        />
      </span>
      {refusal === undefined ? null : (
        <CardWords>
          <ReplayMask>{refusal}</ReplayMask>
        </CardWords>
      )}
    </>
  );
}

/** Add repositories through the App: GitHub's install page, where the App's installation is configured or another account given it. */
function AddOnGitHub({
  workspaceId,
  onRefused,
}: {
  workspaceId: string;
  onRefused: (refusal: string | undefined) => void;
}): React.JSX.Element {
  const connectGitHub = useMutation(actMutation(ACT_KIND.WORKSPACE_GITHUB_CONNECT));
  return (
    <Button
      variant={BUTTON_VARIANT.OUTLINE}
      busy={connectGitHub.isPending}
      busyLabel={WORDS.OPENING}
      onClick={() => {
        onRefused(undefined);
        connectGitHub.mutate({ workspaceId }, { onError: (refused) => onRefused(refused.message) });
      }}
    >
      {WORDS.ADD}
    </Button>
  );
}

/** Add repositories on the member's own token: its checked picker, which takes one back too. */
function AddOnToken({
  workspaceId,
  onRefused,
}: {
  workspaceId: string;
  onRefused: (refusal: string | undefined) => void;
}): React.JSX.Element {
  const repositories = useTokenRepositories(workspaceId);
  return (
    <TokenRepositoryPicker
      workspaceId={workspaceId}
      repositories={repositories}
      onRefused={onRefused}
    />
  );
}

/**
 * GitHub once the workspace reaches `repositories`: its row, connected and
 * counting them, Add repositories at its end, and every one of them under
 * it, a Token mark on each the token reaches. Note that a workspace reached
 * on a teammate's token alone adds through the App where the member holds no
 * token of their own.
 */
function ReachedGitHub({
  workspaceId,
  repositories,
}: {
  workspaceId: string;
  repositories: readonly GitHubRepository[];
}): React.JSX.Element {
  const pictures = useRepositoryPictures();
  const held = useHeldToken();
  const onToken = held && reachedRoute(repositories) === GITHUB_ACCESS.TOKEN;
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const lines = repositories.map(({ fullName, access }) => ({
    repository: fullName,
    token: access === GITHUB_ACCESS.TOKEN,
  }));
  return (
    <Stack gap={GAP.CONTROL}>
      <SettingsRow
        leading={GITHUB_MARK}
        label="GitHub"
        description={
          <SettingsRowStateLine state={SETTINGS_ROW_STATE.CONNECTED}>
            {countWords(repositories.length, TERM.REPOSITORY)}
          </SettingsRowStateLine>
        }
        error={replayMaskedError(refusedShown(refusal, FAILURE_SURFACE.WORKSPACE_GITHUB))}
      >
        {() =>
          onToken ? (
            <AddOnToken workspaceId={workspaceId} onRefused={setRefusal} />
          ) : (
            <AddOnGitHub workspaceId={workspaceId} onRefused={setRefusal} />
          )
        }
      </SettingsRow>
      <RepositoryLines label={WORDS.LIST} repositories={lines} pictures={pictures} />
    </Stack>
  );
}

/**
 * Setup's GitHub step for `workspaceId`; `onReached` hears whether the
 * workspace reaches a repository. Note that the host holds the workspace's
 * repositories while the step stands and asks again as the window comes
 * back from the install in the browser and as a token repository is added
 * (`LIVE_READ.REPOSITORY_LISTS`), so the step reads none of its own.
 */
export function GitHubSetup({
  workspaceId,
  onReached,
}: {
  workspaceId: string;
  onReached: (reached: boolean) => void;
}): React.JSX.Element {
  const [chosen, setChosen] = useState<GitHubAccess>(GITHUB_ACCESS.APP);
  const repositories = useQuery(repositoryListsQuery(workspaceId)).data?.repositories;
  const reached = repositories?.length ?? 0;
  useEffect(() => onReached(reached > 0), [reached, onReached]);
  const route = repositories !== undefined && reached > 0 ? reachedRoute(repositories) : chosen;
  // Note that the reached route becomes the card chosen, so taking the last token repository back draws the token's card rather than the App's.
  useEffect(() => {
    if (reached > 0) setChosen(route);
  }, [reached, route]);
  if (repositories !== undefined && reached > 0) {
    return <ReachedGitHub workspaceId={workspaceId} repositories={repositories} />;
  }
  const options: readonly ChoiceOption<GitHubAccess>[] = [
    {
      value: GITHUB_ACCESS.APP,
      label: "GitHub App",
      badge: "Recommended",
      below: chosen !== GITHUB_ACCESS.APP ? null : <AppRoute workspaceId={workspaceId} />,
    },
    {
      value: GITHUB_ACCESS.TOKEN,
      label: "Personal access token",
      below: chosen !== GITHUB_ACCESS.TOKEN ? null : <TokenRoute workspaceId={workspaceId} />,
    },
  ];
  return (
    <ChoiceList
      legend="How agents reach your repositories"
      look={CHOICE_LOOK.CARD}
      options={options}
      value={[chosen]}
      onChange={([picked]) => {
        if (picked !== undefined) setChosen(picked);
      }}
    />
  );
}
