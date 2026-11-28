import { githubHoldsWords } from "@repo/features/github-holds-words";
import { INTEGRATION_NAME, INTEGRATION_PROVIDER } from "@repo/features/integration-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import type {
  WorkspaceSentry,
  WorkspaceSentryInstallation,
} from "@repo/features/sentry-install-wire";
import { FAILURE_SURFACE, type FailureSurface } from "@repo/features/shown-failure";
import type { SlackListedChannel } from "@repo/features/slack-bot-wire";
import { andList, countWords, noneYetWords, TERM } from "@repo/features/words";
import type { WorkspaceSlack } from "@repo/features/workspace-integrations-live";
import { managesWorkspace } from "@repo/features/workspace-role";
import { WORKSPACE_READ_FAILED } from "@repo/features/workspace-settings-words";
import type { Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { SettingsSubPage } from "@repo/settings/settings-views";
import {
  BUTTON_VARIANT,
  Button,
  CONFIRM_LOSS,
  ConfirmDialog,
  ProviderMark,
  SettingsLinkRow,
  SettingsRow,
  SettingsRowMark,
  SettingsSection,
  useConfirmDialog,
} from "@repo/ui";
import { ExternalLinkIcon } from "@repo/ui/icons";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { rejectionWords, useAsyncAction } from "@repo/ui/use-async-action";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { actMutation } from "../act-mutations.js";
import { ANSWER_ACCEPTED, refusedWith, useConfirmAct } from "../confirm-act.js";
import { confirmFailure, refusedShown } from "../failure-report.js";
import {
  repositoryListsQuery,
  slackChannelsQuery,
  workspaceIntegrationsQuery,
  workspaceIntegrationsRetryMutation,
} from "../live-reads.js";
import { ReadFailed, replayMaskedError } from "./marks.js";
import { SECTION as SECTION_HEAD, settingsSectionHead } from "./settings-sections.js";
import { AddSlackChannel, SlackBotChannelRows } from "./slack-bot-channels.js";
import {
  GitHubAccountRows,
  listedAccounts,
  type ShownConnection,
} from "./workspace-github-accounts.js";
import {
  AddTokenRepository,
  TOKEN_REPOSITORIES_READ,
  TokenOwnerRows,
  type TokenRepositories,
  useTokenRepositories,
} from "./workspace-token-repositories.js";

/**
 * workspace-integrations.tsx -- Settings › Workspace's Workspace connections, a row each for GitHub, Slack, and Sentry, and the page each connected one opens.
 *
 * A connected service's row opens its own page, pressed anywhere
 * (`SettingsLinkRow`), and says what it holds in words: its accounts and
 * how many repositories, its Slack workspace and how many channels, whose
 * alerts start automations. GitHub's row opens its page whatever stands,
 * because the repositories a member adds on their own token stand there
 * with or without the App. A service not connected says what it does and
 * ends in Connect, for an owner or an admin, and asks a member to have one
 * connect it; Slack's and Sentry's then open nothing.
 *
 * Each page holds what the service's row once folded open, and a member
 * reads the same page with nothing on it to press:
 *
 * - GitHub: its row with Manage on GitHub, which opens GitHub's own page,
 *   where accounts are added and the App uninstalled, so the page holds no
 *   Disconnect; then Accounts and repositories, whose head holds Add
 *   repository, every account connected (`workspace-github-accounts.tsx`)
 *   and every owner of a repository added on a token
 *   (`workspace-token-repositories.tsx`).
 * - Slack: its row, then Channels, whose head holds Add channel, the
 *   default repository, and each channel's (`slack-bot-channels.tsx`), and
 *   last Disconnect, which asks first.
 * - Sentry: its installations, and last a Disconnect for each, which asks
 *   first.
 *
 * Slack's and Sentry's rows stand only where the deployment holds the
 * service, as the host holds the workspace's integrations followed live on
 * the service, so an install finished in the browser draws as it lands; a
 * read that did not land says so in the row's place, with Retry.
 */

/** The services Workspace connections lists, in order, each a page of Settings › Workspace's own. */
const WORKSPACE_SERVICES = [
  INTEGRATION_PROVIDER.GITHUB,
  INTEGRATION_PROVIDER.SLACK,
  INTEGRATION_PROVIDER.SENTRY,
] as const satisfies readonly SettingsSubPage[];

type WorkspaceService = (typeof WORKSPACE_SERVICES)[number];

/** How many rows Workspace connections stands while it is read, one per service. */
export const WORKSPACE_SERVICE_COUNT = WORKSPACE_SERVICES.length;

/** What a service not connected says it does, under its name. */
const DOES = {
  [INTEGRATION_PROVIDER.GITHUB]: "The repositories agents work in",
  [INTEGRATION_PROVIDER.SLACK]: "Start agents from Slack and hear back there",
  [INTEGRATION_PROVIDER.SENTRY]: "Alerts and new issues start automations",
} as const satisfies Record<WorkspaceService, string>;

/** What a member, who may connect nothing, is told after what a service does. */
const ASK_TO_CONNECT = "Ask an owner or admin to connect it.";

/** What every service's row presses to connect it, the same word on every row. */
const CONNECT = "Connect";

/** Each service's own mark, which leads its row as a provider's leads Settings › Integrations'. */
const MARK = {
  [INTEGRATION_PROVIDER.GITHUB]: (
    <SettingsRowMark>
      <ProviderMark provider={INTEGRATION_PROVIDER.GITHUB} />
    </SettingsRowMark>
  ),
  [INTEGRATION_PROVIDER.SLACK]: (
    <SettingsRowMark>
      <ProviderMark provider={INTEGRATION_PROVIDER.SLACK} />
    </SettingsRowMark>
  ),
  [INTEGRATION_PROVIDER.SENTRY]: (
    <SettingsRowMark>
      <ProviderMark provider={INTEGRATION_PROVIDER.SENTRY} />
    </SettingsRowMark>
  ),
} as const satisfies Record<WorkspaceService, ReactNode>;

/** What a page's Disconnect says and asks, Slack's and Sentry's. */
const DISCONNECT = {
  PRESS: "Disconnect",
  RUNNING: "Disconnecting",
} as const;

/** A service's line while it is not connected: what it does, and to a member, whom to ask. */
function unconnectedLine(service: WorkspaceService, manages: boolean): string {
  return manages ? DOES[service] : `${DOES[service]}. ${ASK_TO_CONNECT}`;
}

/** The outline press that connects a service, busy while the browser is being sent. */
function ConnectButton({
  running,
  busyLabel,
  onConnect,
}: {
  running: boolean;
  busyLabel: string;
  onConnect: () => void;
}): React.JSX.Element {
  return (
    <Button
      variant={BUTTON_VARIANT.OUTLINE}
      busy={running}
      busyLabel={busyLabel}
      onClick={onConnect}
    >
      {CONNECT}
    </Button>
  );
}

/** A connect as a row presses it: whether the browser is still being sent, what refused it, and the press. */
interface Connect {
  readonly running: boolean;
  readonly refusal: string | undefined;
  readonly connect: () => void;
}

/** A connect that opens the service's install in the browser, its refusal kept to say under the row. Note that a second press while one is out is taken as none, because an install begun again replaces the first one's intent. */
function useConnect(send: () => Promise<void>): Connect {
  const opening = useAsyncAction(rejectionWords);

  return {
    running: opening.running,
    refusal: opening.refusal,
    connect: () => void opening.run(send),
  };
}

/**
 * The GitHub accounts connected to the workspace and active, the first
 * linked first: every one a service with several lists, else the one a
 * service from before them names. Note that one suspended or removed on
 * GitHub counts as none, because the store never forgets a removed one and
 * agents reach nothing through it.
 */
function connectionsOf(workspace: Workspace): readonly ShownConnection[] {
  const listed =
    workspace.githubInstallations ?? (workspace.github === null ? [] : [workspace.github]);

  return listed.filter((connection) => connection.active);
}

/** GitHub's connect, which opens the App's install, or for one installed its page on GitHub, where accounts are added and repositories chosen. */
function useGitHubConnect(workspaceId: string) {
  const { mutateAsync } = useMutation(actMutation(ACT_KIND.WORKSPACE_GITHUB_CONNECT));

  return useConnect(() => mutateAsync({ workspaceId }).then(() => undefined));
}

/**
 * What GitHub's row says it holds: every account it reaches, the App's
 * and the token repositories' owners, and once the workspace's
 * repositories are read, how many there are; what GitHub does while it
 * holds none.
 */
function useGitHubLine(
  workspace: Workspace,
  connections: readonly ShownConnection[],
  repositories: TokenRepositories,
): string {
  // Note that the App's repositories are read only where an account is connected, as its rows read them.
  const listing = useQuery(
    repositoryListsQuery(connections.length > 0 ? workspace.id : undefined),
  ).data;

  const accounts = listing === undefined ? undefined : listedAccounts(listing, connections);
  const tokenListed = repositories.read === TOKEN_REPOSITORIES_READ.READY;
  const logins = new Map<string, string>();

  for (const login of accounts?.map((each) => each.login) ?? connections.map((each) => each.login))
    logins.set(login.toLowerCase(), login);

  // Note that the token repositories' owners follow the App's accounts in order of their logins, as their rows stand.
  const owners = (tokenListed ? repositories.listed : [])
    .map((repository) => repository.fullName.slice(0, repository.fullName.indexOf("/")))
    .sort((one, other) => one.localeCompare(other, undefined, { sensitivity: "base" }));

  for (const login of owners) {
    if (!logins.has(login.toLowerCase())) logins.set(login.toLowerCase(), login);
  }

  // Note that the count waits on every list it adds up, so it never counts a part as the whole.
  const counted = !((connections.length > 0 && accounts === undefined) || !tokenListed);

  const count =
    (accounts ?? []).reduce((sum, each) => sum + each.repositories.length, 0) +
    repositories.listed.length;

  return (
    githubHoldsWords([...logins.values()], counted ? count : undefined) ??
    unconnectedLine(INTEGRATION_PROVIDER.GITHUB, managesWorkspace(workspace))
  );
}

/**
 * GitHub's row in Workspace connections, which opens its page whatever
 * stands, and ends in Connect for an owner or an admin while no account is
 * connected.
 */
function GitHubLinkRow({
  workspace,
  onOpen,
}: {
  workspace: Workspace;
  onOpen: () => void;
}): React.JSX.Element {
  const connections = connectionsOf(workspace);
  const repositories = useTokenRepositories(workspace.id);
  const line = useGitHubLine(workspace, connections, repositories);
  const opening = useGitHubConnect(workspace.id);
  const offered = managesWorkspace(workspace) && connections.length === 0;

  return (
    <SettingsLinkRow
      leading={MARK[INTEGRATION_PROVIDER.GITHUB]}
      label={INTEGRATION_NAME[INTEGRATION_PROVIDER.GITHUB]}
      description={<ReplayMask>{line}</ReplayMask>}
      error={replayMaskedError(refusedShown(opening.refusal, FAILURE_SURFACE.WORKSPACE_GITHUB))}
      onOpen={onOpen}
      control={
        offered
          ? () => (
              <ConnectButton
                running={opening.running}
                busyLabel="Connecting"
                onConnect={opening.connect}
              />
            )
          : undefined
      }
    />
  );
}

/**
 * Settings › Workspace › GitHub: GitHub's row, Connect or Manage on GitHub
 * at its end for an owner or an admin, then every account it reaches and
 * the repositories each holds, Add repository at their head for a reader
 * whose own token is saved.
 */
function GitHubPage({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const connections = connectionsOf(workspace);
  const repositories = useTokenRepositories(workspace.id);
  const line = useGitHubLine(workspace, connections, repositories);
  const opening = useGitHubConnect(workspace.id);
  const [addRefusal, setAddRefusal] = useState<string>();
  const connected = connections.length > 0;

  // Note that the token rows say their read while it is out or failed, so the section stands for those lines too.
  const owns =
    connected ||
    repositories.read !== TOKEN_REPOSITORIES_READ.READY ||
    repositories.listed.length > 0;

  return (
    <>
      <SettingsSection>
        <SettingsRow
          leading={MARK[INTEGRATION_PROVIDER.GITHUB]}
          label={INTEGRATION_NAME[INTEGRATION_PROVIDER.GITHUB]}
          description={<ReplayMask>{line}</ReplayMask>}
          error={replayMaskedError(
            refusedShown(opening.refusal ?? addRefusal, FAILURE_SURFACE.WORKSPACE_GITHUB),
          )}
        >
          {() =>
            !managesWorkspace(workspace) ? null : connected ? (
              <Button
                variant={BUTTON_VARIANT.OUTLINE}
                icon={<ExternalLinkIcon />}
                busy={opening.running}
                busyLabel="Opening GitHub"
                onClick={opening.connect}
              >
                Manage on GitHub
              </Button>
            ) : (
              <ConnectButton
                running={opening.running}
                busyLabel="Connecting"
                onConnect={opening.connect}
              />
            )
          }
        </SettingsRow>
      </SettingsSection>
      <SettingsSection
        {...settingsSectionHead(SECTION_HEAD.GITHUB_ACCOUNTS)}
        action={
          <AddTokenRepository
            workspaceId={workspace.id}
            repositories={repositories}
            onRefused={setAddRefusal}
          />
        }
      >
        {owns ? (
          <>
            <GitHubAccountRows workspaceId={workspace.id} connections={connections} />
            <TokenOwnerRows repositories={repositories} />
          </>
        ) : (
          <SettingsRow label={noneYetWords(TERM.REPOSITORY)} />
        )}
      </SettingsSection>
    </>
  );
}

/** The workspace's integrations as the host holds them, Slack's and Sentry's; a read that did not land draws its failure with Retry, said in `failed`'s words. */
function useIntegrationsRead(workspace: Workspace) {
  const read = useQuery(workspaceIntegrationsQuery(workspace.id));
  const retry = useMutation(workspaceIntegrationsRetryMutation());

  return {
    data: read.data,
    failed: read.isError,
    retry: () => retry.mutate({ workspaceId: workspace.id }),
  };
}

/** Slack's connect, which opens Slack's Add to Slack in the browser. */
function useSlackConnect(workspaceId: string) {
  const { mutateAsync } = useMutation(actMutation(ACT_KIND.WORKSPACE_SLACK_BOT_INSTALL));

  return useConnect(() => mutateAsync({ workspaceId }).then(() => undefined));
}

/** The team's channels the bot may be in, which Slack lists to an owner or an admin of a connected bot alone. */
function useSlackChannels(
  workspace: Workspace,
  slack: WorkspaceSlack,
): readonly SlackListedChannel[] | undefined {
  const listed = managesWorkspace(workspace) && slack.team !== undefined;

  return useQuery(slackChannelsQuery(listed ? workspace.id : undefined)).data;
}

/** What a connected bot's row says: its Slack workspace, and to one Slack lists them to, how many channels the bot is in. */
function slackLine(
  team: NonNullable<WorkspaceSlack["team"]>,
  channels: readonly SlackListedChannel[] | undefined,
): ReactNode {
  const joined = channels?.filter((channel) => channel.member).length;

  return (
    <>
      The <ReplayMask>{team.name}</ReplayMask> workspace
      {joined === undefined ? null : `, ${countWords(joined, TERM.CHANNEL)}`}
    </>
  );
}

/** Slack's row while the bot is not connected: what it does, and Connect for an owner or an admin. */
function SlackConnectRow({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const installing = useSlackConnect(workspace.id);
  const manages = managesWorkspace(workspace);

  return (
    <SettingsRow
      leading={MARK[INTEGRATION_PROVIDER.SLACK]}
      label={INTEGRATION_NAME[INTEGRATION_PROVIDER.SLACK]}
      description={unconnectedLine(INTEGRATION_PROVIDER.SLACK, manages)}
      error={replayMaskedError(
        refusedShown(installing.refusal, FAILURE_SURFACE.WORKSPACE_SLACK_BOT),
      )}
    >
      {() =>
        manages ? (
          <ConnectButton
            running={installing.running}
            busyLabel="Opening Slack"
            onConnect={installing.connect}
          />
        ) : null
      }
    </SettingsRow>
  );
}

/** Slack's row in Workspace connections: the connected bot's, which opens its page, else its Connect. */
function SlackLinkRow({
  workspace,
  slack,
  onOpen,
}: {
  workspace: Workspace;
  slack: WorkspaceSlack;
  onOpen: () => void;
}): React.JSX.Element {
  const channels = useSlackChannels(workspace, slack);

  if (slack.team === undefined) return <SlackConnectRow workspace={workspace} />;

  return (
    <SettingsLinkRow
      leading={MARK[INTEGRATION_PROVIDER.SLACK]}
      label={INTEGRATION_NAME[INTEGRATION_PROVIDER.SLACK]}
      description={slackLine(slack.team, channels)}
      onOpen={onOpen}
    />
  );
}

/**
 * Slack's Disconnect, an owner's or an admin's, which asks first: the bot
 * stops writing to the workspace's members, and stays installed in Slack,
 * which the question says.
 */
function SlackDisconnect({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const { mutateAsync: sendWorkspaceSlackBotDisconnect, ...slackLeaving } = useMutation(
    actMutation(ACT_KIND.WORKSPACE_SLACK_BOT_DISCONNECT),
  );

  const workspaceId = workspace.id;

  const disconnectAct = useConfirmAct(slackLeaving, {
    send: () => sendWorkspaceSlackBotDisconnect({ workspaceId }),
    answered: () => ANSWER_ACCEPTED,
    failed: refusedWith,
  });

  const disconnect = useConfirmDialog(
    { subject: true, surfaceOpen: true },
    disconnectAct,
    confirmFailure(FAILURE_SURFACE.WORKSPACE_SLACK_BOT_DISCONNECT),
  );

  return (
    <SettingsSection>
      <SettingsRow
        label="Disconnect Slack"
        description={`${PRODUCT_NAME} stops messaging this workspace's members in Slack. The bot stays installed until a Slack admin removes it.`}
      >
        {() => (
          <Button
            variant={BUTTON_VARIANT.DANGER_OUTLINE}
            busy={disconnect.busy}
            busyLabel={DISCONNECT.RUNNING}
            onClick={disconnect.ask}
          >
            {DISCONNECT.PRESS}
          </Button>
        )}
      </SettingsRow>
      <ConfirmDialog
        open
        confirm={disconnect}
        question={{
          title: `Disconnect the Slack bot from ${workspace.name}?`,
          replayUnmasked: true,
          titleReplayMasked: true,
          body: `${PRODUCT_NAME} stops messaging this workspace's members in Slack. The bot stays installed in Slack until a Slack admin removes it.`,
          verb: "Disconnect Slack bot",
          running: DISCONNECT.RUNNING,
          loss: CONFIRM_LOSS.AFFECTS_OTHERS,
        }}
      />
    </SettingsSection>
  );
}

/**
 * Settings › Workspace › Slack: the bot's row, then to an owner or an
 * admin its channels, Add channel at their head once Slack has listed the
 * team's channels, and last Disconnect. A bot not connected stands as its
 * row with Connect, as a link landing here before the install does.
 */
function SlackPage({
  workspace,
  slack,
}: {
  workspace: Workspace;
  slack: WorkspaceSlack;
}): React.JSX.Element {
  const channels = useSlackChannels(workspace, slack);
  const [addRefusal, setAddRefusal] = useState<string>();
  const { team } = slack;

  if (team === undefined) {
    return (
      <SettingsSection>
        <SlackConnectRow workspace={workspace} />
      </SettingsSection>
    );
  }

  const manages = managesWorkspace(workspace);

  return (
    <>
      <SettingsSection>
        <SettingsRow
          leading={MARK[INTEGRATION_PROVIDER.SLACK]}
          label={INTEGRATION_NAME[INTEGRATION_PROVIDER.SLACK]}
          description={slackLine(team, channels)}
          error={replayMaskedError(
            refusedShown(addRefusal, FAILURE_SURFACE.WORKSPACE_SLACK_BOT_CHANNEL),
          )}
        />
      </SettingsSection>
      {manages ? (
        <>
          <SettingsSection
            {...settingsSectionHead(SECTION_HEAD.SLACK_CHANNELS)}
            action={
              channels === undefined ? undefined : (
                <AddSlackChannel
                  workspaceId={workspace.id}
                  channels={channels}
                  onRefused={setAddRefusal}
                />
              )
            }
          >
            <SlackBotChannelRows workspace={workspace} slack={slack} channels={channels} />
          </SettingsSection>
          <SlackDisconnect workspace={workspace} />
        </>
      ) : null}
    </>
  );
}

/** Sentry's connect, which opens Sentry's install page in the browser. */
function useSentryConnect(workspaceId: string) {
  const { mutateAsync } = useMutation(actMutation(ACT_KIND.WORKSPACE_SENTRY_INSTALL));

  return useConnect(() => mutateAsync({ workspaceId }).then(() => undefined));
}

/** What a connected Sentry's row says: whose alerts start automations, by the organizations Sentry names. */
function sentryLine(sentry: WorkspaceSentry): ReactNode {
  const accounts = sentry.installations.flatMap((one) =>
    one.account === undefined ? [] : [one.account],
  );

  if (accounts.length === 0) return "Its alerts and new issues start automations";

  return (
    <>
      <ReplayMask>{andList(accounts)}</ReplayMask>'s alerts and new issues start automations
    </>
  );
}

/** Sentry's row while none is installed: what it does, and Connect for an owner or an admin. */
function SentryConnectRow({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const installing = useSentryConnect(workspace.id);
  const manages = managesWorkspace(workspace);

  return (
    <SettingsRow
      leading={MARK[INTEGRATION_PROVIDER.SENTRY]}
      label={INTEGRATION_NAME[INTEGRATION_PROVIDER.SENTRY]}
      description={unconnectedLine(INTEGRATION_PROVIDER.SENTRY, manages)}
      error={replayMaskedError(refusedShown(installing.refusal, FAILURE_SURFACE.WORKSPACE_SENTRY))}
    >
      {() =>
        manages ? (
          <ConnectButton
            running={installing.running}
            busyLabel="Opening Sentry"
            onConnect={installing.connect}
          />
        ) : null
      }
    </SettingsRow>
  );
}

/** Sentry's row in Workspace connections: an installed one's, which opens its page, else its Connect. */
function SentryLinkRow({
  workspace,
  sentry,
  onOpen,
}: {
  workspace: Workspace;
  sentry: WorkspaceSentry;
  onOpen: () => void;
}): React.JSX.Element {
  if (sentry.installations.length === 0) return <SentryConnectRow workspace={workspace} />;

  return (
    <SettingsLinkRow
      leading={MARK[INTEGRATION_PROVIDER.SENTRY]}
      label={INTEGRATION_NAME[INTEGRATION_PROVIDER.SENTRY]}
      description={sentryLine(sentry)}
      onOpen={onOpen}
    />
  );
}

/**
 * Sentry's Disconnects, an owner's or an admin's, one for each
 * installation, each asking first: its alerts stop firing this workspace's
 * automations, and the integration stays installed on Sentry until the
 * organization removes it there, which the question says. A lone
 * installation's says only Disconnect Sentry, since none other stands to
 * tell it from.
 */
function SentryDisconnects({
  workspace,
  sentry,
}: {
  workspace: Workspace;
  sentry: WorkspaceSentry;
}): React.JSX.Element {
  const { mutateAsync: sendWorkspaceSentryDisconnect, ...sentryLeaving } = useMutation(
    actMutation(ACT_KIND.WORKSPACE_SENTRY_DISCONNECT),
  );

  const workspaceId = workspace.id;
  const [leaving, setLeaving] = useState<WorkspaceSentryInstallation>();

  // Note that the question stands only while its installation is still listed, so a read that drops it dismisses it.
  const stillListed =
    leaving !== undefined &&
    sentry.installations.some((one) => one.installationId === leaving.installationId);

  const disconnectAct = useConfirmAct(sentryLeaving, {
    send: () =>
      leaving === undefined
        ? Promise.resolve()
        : sendWorkspaceSentryDisconnect({ workspaceId, installationId: leaving.installationId }),
    answered: () => ANSWER_ACCEPTED,
    failed: refusedWith,
  });

  const disconnect = useConfirmDialog(
    { subject: stillListed, surfaceOpen: true },
    disconnectAct,
    confirmFailure(FAILURE_SURFACE.WORKSPACE_SENTRY_DISCONNECT),
  );

  const lone = sentry.installations.length === 1;

  return (
    <SettingsSection>
      {sentry.installations.map((installation) => (
        <SettingsRow
          key={installation.installationId}
          label={
            lone || installation.account === undefined ? (
              "Disconnect Sentry"
            ) : (
              <>
                Disconnect <ReplayMask>{installation.account}</ReplayMask>
              </>
            )
          }
          description="Its alerts and new issues stop triggering this workspace's automations."
        >
          {() => (
            <Button
              variant={BUTTON_VARIANT.DANGER_OUTLINE}
              busy={disconnect.busy && leaving?.installationId === installation.installationId}
              busyLabel={DISCONNECT.RUNNING}
              onClick={() => {
                setLeaving(installation);
                disconnect.ask();
              }}
            >
              {DISCONNECT.PRESS}
            </Button>
          )}
        </SettingsRow>
      ))}
      <ConfirmDialog
        open
        confirm={disconnect}
        question={{
          title: `Disconnect Sentry from ${workspace.name}?`,
          replayUnmasked: true,
          titleReplayMasked: true,
          body: `Its alerts and new issues stop triggering this workspace's automations. Uninstall ${PRODUCT_NAME} in Sentry's settings to remove it there too.`,
          verb: "Disconnect Sentry",
          running: DISCONNECT.RUNNING,
          loss: CONFIRM_LOSS.AFFECTS_OTHERS,
        }}
      />
    </SettingsSection>
  );
}

/** Settings › Workspace › Sentry: each installation, then to an owner or an admin a Disconnect for each; Connect while none stands. */
function SentryPage({
  workspace,
  sentry,
}: {
  workspace: Workspace;
  sentry: WorkspaceSentry;
}): React.JSX.Element {
  if (sentry.installations.length === 0) {
    return (
      <SettingsSection>
        <SentryConnectRow workspace={workspace} />
      </SettingsSection>
    );
  }

  return (
    <>
      <SettingsSection>
        {sentry.installations.map((installation) => (
          <SettingsRow
            key={installation.installationId}
            leading={MARK[INTEGRATION_PROVIDER.SENTRY]}
            label={
              installation.account === undefined ? (
                INTEGRATION_NAME[INTEGRATION_PROVIDER.SENTRY]
              ) : (
                <ReplayMask>{installation.account}</ReplayMask>
              )
            }
            description="Its alerts and new issues start this workspace's automations"
          />
        ))}
      </SettingsSection>
      {managesWorkspace(workspace) ? (
        <SentryDisconnects workspace={workspace} sentry={sentry} />
      ) : null}
    </>
  );
}

/** What a page says of a service this deployment does not hold, as a link written for another deployment lands on it. */
function UnavailableRow({ service }: { service: WorkspaceService }): React.JSX.Element {
  return (
    <SettingsSection>
      <SettingsRow
        leading={MARK[service]}
        label={INTEGRATION_NAME[service]}
        description={`${INTEGRATION_NAME[service]} isn't available here.`}
      />
    </SettingsSection>
  );
}

/** What Slack's or Sentry's row or page draws once the workspace's integrations are read, or the read's failure in its place, or nothing while it is out. */
function IntegrationsRead({
  workspace,
  failedLine,
  failedSurface,
  children,
}: {
  workspace: Workspace;
  failedLine: string;
  failedSurface: FailureSurface;
  children: (integrations: {
    slack: WorkspaceSlack;
    sentry: WorkspaceSentry;
  }) => React.JSX.Element | null;
}): React.JSX.Element | null {
  const read = useIntegrationsRead(workspace);

  if (read.data === undefined) {
    return read.failed ? (
      <ReadFailed line={failedLine} surface={failedSurface} onRetry={read.retry} />
    ) : null;
  }

  return children(read.data);
}

/** Workspace connections' rows, GitHub's, Slack's, and Sentry's, each opening its page through `onOpen`. */
export function WorkspaceConnectionRows({
  workspace,
  onOpen,
}: {
  workspace: Workspace;
  onOpen: (service: SettingsSubPage) => void;
}): React.JSX.Element {
  return (
    <>
      <GitHubLinkRow workspace={workspace} onOpen={() => onOpen(INTEGRATION_PROVIDER.GITHUB)} />
      <IntegrationsRead
        workspace={workspace}
        failedLine={WORKSPACE_READ_FAILED.SLACK_BOT}
        failedSurface={FAILURE_SURFACE.WORKSPACE_SLACK_BOT_READ}
      >
        {({ slack }) =>
          slack.configured ? (
            <SlackLinkRow
              workspace={workspace}
              slack={slack}
              onOpen={() => onOpen(INTEGRATION_PROVIDER.SLACK)}
            />
          ) : null
        }
      </IntegrationsRead>
      <IntegrationsRead
        workspace={workspace}
        failedLine={WORKSPACE_READ_FAILED.SENTRY}
        failedSurface={FAILURE_SURFACE.WORKSPACE_SENTRY_READ}
      >
        {({ sentry }) =>
          sentry.configured ? (
            <SentryLinkRow
              workspace={workspace}
              sentry={sentry}
              onOpen={() => onOpen(INTEGRATION_PROVIDER.SENTRY)}
            />
          ) : null
        }
      </IntegrationsRead>
    </>
  );
}

/** Settings › Workspace's page for `service`, GitHub's, Slack's, or Sentry's, as above. */
export function WorkspaceIntegrationPage({
  workspace,
  service,
}: {
  workspace: Workspace;
  service: SettingsSubPage;
}): React.JSX.Element | null {
  switch (service) {
    case INTEGRATION_PROVIDER.GITHUB:
      return <GitHubPage workspace={workspace} />;
    case INTEGRATION_PROVIDER.SLACK:
      return (
        <IntegrationsRead
          workspace={workspace}
          failedLine={WORKSPACE_READ_FAILED.SLACK_BOT}
          failedSurface={FAILURE_SURFACE.WORKSPACE_SLACK_BOT_READ}
        >
          {({ slack }) =>
            !slack.configured ? (
              <UnavailableRow service={INTEGRATION_PROVIDER.SLACK} />
            ) : (
              // Keyed to the team, so what one team's Add channel was refused with never stands under another's.
              <SlackPage key={slack.team?.id} workspace={workspace} slack={slack} />
            )
          }
        </IntegrationsRead>
      );
    case INTEGRATION_PROVIDER.SENTRY:
      return (
        <IntegrationsRead
          workspace={workspace}
          failedLine={WORKSPACE_READ_FAILED.SENTRY}
          failedSurface={FAILURE_SURFACE.WORKSPACE_SENTRY_READ}
        >
          {({ sentry }) =>
            sentry.configured ? (
              <SentryPage workspace={workspace} sentry={sentry} />
            ) : (
              <UnavailableRow service={INTEGRATION_PROVIDER.SENTRY} />
            )
          }
        </IntegrationsRead>
      );
    default:
      return null;
  }
}
