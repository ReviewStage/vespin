import { ACCOUNT_STATUS, signedInAccountId } from "@repo/credentials/snapshot";
import { CLI_COMMAND, CLI_LINK_FOLDER } from "@repo/features/cli-release";
import { MCP_ACCESS_TOKEN_MINUTES, type McpClient } from "@repo/features/mcp-client-wire";
import { FIRST_PARTY_OAUTH_CLIENT_ID } from "@repo/features/oauth-client-ids";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { readingWords } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import { CLI_INSTALL_OUTCOME, type CliInstallAnswer } from "@repo/host/contract";
import { HOST_CAPABILITY } from "@repo/settings";
import { SETTINGS_SEARCH_ROW, searchAnchorProps } from "@repo/settings/settings-anchors";
import {
  ANNOUNCE,
  BUTTON_VARIANT,
  Button,
  CONFIRM_LOSS,
  COPY_FIELD_PROMPT,
  COPY_FIELD_WIDTH,
  ConfirmDialog,
  CopyField,
  ErrorLine,
  Inline,
  OutsideSteps,
  SETTINGS_ROW_STATE,
  SETTINGS_SKELETON_CONTROL,
  SettingsBlock,
  SettingsLine,
  SettingsRow,
  SettingsRowStateLine,
  SettingsSection,
  type SettingsSectionSkeletonShape,
  SettingsSectionsSkeleton,
  STEP_STATE,
  Step,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TIME_LOOK,
  Time,
  useConfirmDialog,
} from "@repo/ui";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { actMutation } from "../act-mutations.js";
import { useConfirmAct } from "../confirm-act.js";
import { copyThroughShell } from "../copy-feedback.js";
import { confirmFailure, refusedShown } from "../failure-report.js";
import { mcpClientsQuery, mcpClientsRetryMutation } from "../live-reads.js";
import { appStateQuery, selectAccount, selectCapability } from "../use-app-state.js";
import { ReadFailed } from "./marks.js";
import { SECTION as SECTION_HEAD, settingsSectionHead } from "./settings-sections.js";

/**
 * cli-section.tsx -- Settings › our MCP & CLI's CLI section: the `vespin` command's sign-in, with Sign out everywhere once it holds one, and its install, to copy and, in the desktop app, run here as VS Code installs `code`.
 *
 * The section stands as the MCP section over it does: what is connected
 * first, then how to connect. Until the command signs in, a line says so
 * over one setup told as steps (`OutsideSteps`): install it, then sign in
 * from a terminal, with the wait for its sign-in under them, as Connect an
 * app is told. Once it has, its sign-in's row stands first and the install's
 * row under it. The install holds `npm i -g vespin` in `@repo/ui`'s
 * `CopyField`; a browser tab shows that alone.
 * Where the client runs the install itself (`HOST_CAPABILITY.CLI_INSTALL`,
 * the desktop app once its build names a release), the row ends in Install,
 * which runs the service's install script in this Mac's account. Once it
 * lands, the row's line says the version installed, or that `~/.local/bin`
 * needs adding to the PATH, and the button becomes Reinstall; an install
 * that did not land says why in the row's failure line, in the script's own
 * words.
 *
 * The sign-in reads the command's grant from the clients the account allowed
 * (`LIVE_READ.MCP_CLIENTS`, the MCP section's read, which this section
 * narrows to `vespin-cli` and that one leaves out of its list). With none, it shows
 * `vespin login` to copy. With one, its row names the account and when the
 * command was last active, and Sign out everywhere revokes the grant, asking
 * first in the confirm dialog as an agent's Disconnect does: every token the
 * command holds for the account goes, so every computer it is signed in on
 * is signed out, though an access token it already holds keeps working until
 * it expires. A grant revoked while the page shows stays signed out here
 * until the read no longer lists it, unless the command signs in again.
 */

const SECTION = {
  CAPTION: `Use ${PRODUCT_NAME} from your terminal.`,
} as const;

const PAGE_LINE = {
  INSTALL_LABEL: `Install the ${PRODUCT_NAME.toLowerCase()} command`,
  INSTALL_HERE: "On this Mac, or with npm anywhere.",
  INSTALL_NPM: "With npm, on Node 20 or later.",
  INSTALL: "Install",
  REINSTALL: "Reinstall",
  INSTALLING: "Installing the command-line tool",
  NPM_COMMAND: "npm command",
  SIGN_IN_LABEL: "Sign in from your terminal",
  SIGN_IN_WORDS: "It opens your browser to sign in.",
  WAITING: `Waiting for the ${PRODUCT_NAME.toLowerCase()} command to sign in`,
  LOGIN_COMMAND: "Sign-in command",
  SIGNED_IN: "Signed in",
  SIGN_OUT: "Sign out everywhere",
  SIGNING_OUT: "Signing out",
  SIGN_OUT_REFUSED: "Signing out didn't finish. Try again.",
  READ_FAILED: "The command's sign-in could not be read.",
  NOT_SIGNED_IN: "Not signed in yet.",
} as const;

/** The section as it stands while the sign-in is read: the sign-in's row, then the install's, ending in Install where the client runs it. */
function sectionSkeleton(installs: boolean): readonly SettingsSectionSkeletonShape[] {
  return [
    {
      headed: true,
      rows: [
        { described: true, controls: [] },
        { described: true, controls: installs ? [SETTINGS_SKELETON_CONTROL.BUTTON] : [] },
      ],
    },
  ];
}

/** The install row's line once the command is installed: its version, and where the shell will not find it, that its folder needs adding. */
function InstalledLine({ version, onPath }: { version: string; onPath: boolean }) {
  return onPath ? (
    <SettingsRowStateLine state={SETTINGS_ROW_STATE.CONNECTED}>
      Installed · v{version}
    </SettingsRowStateLine>
  ) : (
    <SettingsRowStateLine state={SETTINGS_ROW_STATE.ATTENTION}>
      Installed · v{version} · Add {CLI_LINK_FOLDER} to your PATH
    </SettingsRowStateLine>
  );
}

/** The command's install where the client runs it: pressed, out, and how it last went. */
interface CliInstall {
  readonly busy: boolean;
  readonly onPress: () => void;
  readonly installed:
    | Extract<CliInstallAnswer, { outcome: typeof CLI_INSTALL_OUTCOME.INSTALLED }>
    | undefined;
  readonly failed: string | undefined;
}

/** The install the client runs, its last answer held while a new one is out. */
function useCliInstall(): CliInstall {
  const cliInstall = useMutation(actMutation(ACT_KIND.CLI_INSTALL));
  // Note that the last answer stays drawn while a new install is out, so it is held here rather than read off the mutation, which forgets it as one starts.
  const [answer, setAnswer] = useState<CliInstallAnswer | undefined>(undefined);
  const install = {
    busy: cliInstall.isPending,
    onPress: () =>
      cliInstall.mutate(undefined, {
        onSuccess: setAnswer,
        onError: (refused) =>
          setAnswer({ outcome: CLI_INSTALL_OUTCOME.FAILED, reason: refused.message }),
      }),
  };
  return {
    ...install,
    installed: answer?.outcome === CLI_INSTALL_OUTCOME.INSTALLED ? answer : undefined,
    failed: answer?.outcome === CLI_INSTALL_OUTCOME.FAILED ? answer.reason : undefined,
  };
}

/** Install's own press, where the client runs it: Install, or Reinstall once it has. */
function InstallPress({ install }: { install: CliInstall }): React.JSX.Element {
  return (
    <Button
      variant={BUTTON_VARIANT.OUTLINE}
      onClick={install.onPress}
      busy={install.busy}
      busyLabel={PAGE_LINE.INSTALLING}
    >
      {install.installed === undefined ? PAGE_LINE.INSTALL : PAGE_LINE.REINSTALL}
    </Button>
  );
}

/** The npm install, to copy. */
function NpmInstallCommand(): React.JSX.Element {
  return (
    <CopyField
      label={PAGE_LINE.NPM_COMMAND}
      value={CLI_COMMAND.NPM_INSTALL}
      what="command"
      copy={copyThroughShell}
      width={COPY_FIELD_WIDTH.FULL}
      prompt={COPY_FIELD_PROMPT.SHELL}
    />
  );
}

/** `vespin login`, to copy. */
function LoginCommand(): React.JSX.Element {
  return (
    <CopyField
      label={PAGE_LINE.LOGIN_COMMAND}
      value={CLI_COMMAND.LOGIN}
      what="command"
      copy={copyThroughShell}
      width={COPY_FIELD_WIDTH.FULL}
      prompt={COPY_FIELD_PROMPT.SHELL}
    />
  );
}

/** The install's row, once the command is signed in or its sign-in could not be read: the npm install to copy, and, where the client runs it, Install and how it went. */
function InstallRow({ installs }: { installs: boolean }): React.JSX.Element {
  const install = useCliInstall();
  const { installed, failed } = install;
  return (
    <div {...searchAnchorProps(SETTINGS_SEARCH_ROW.CLI_INSTALL)}>
      <SettingsRow
        label={PAGE_LINE.INSTALL_LABEL}
        description={
          installed === undefined ? (
            installs ? (
              PAGE_LINE.INSTALL_HERE
            ) : (
              PAGE_LINE.INSTALL_NPM
            )
          ) : (
            <InstalledLine version={installed.version} onPath={installed.onPath} />
          )
        }
        error={refusedShown(failed, FAILURE_SURFACE.CLI_INSTALL)}
        {...(installs ? { children: () => <InstallPress install={install} /> } : undefined)}
        below={() => <NpmInstallCommand />}
      />
    </div>
  );
}

/**
 * The command not signed in: install it, then sign in from a terminal, as
 * steps, and the wait for its sign-in under them. Install's step says how
 * the client's own install went, and checks off once it lands.
 */
function SetUpSteps({ installs }: { installs: boolean }): React.JSX.Element {
  const install = useCliInstall();
  const { installed, failed } = install;
  return (
    <div {...searchAnchorProps(SETTINGS_SEARCH_ROW.CLI_INSTALL)}>
      <SettingsBlock>
        <OutsideSteps waiting={PAGE_LINE.WAITING}>
          <Step
            number={1}
            title={PAGE_LINE.INSTALL_LABEL}
            state={installed === undefined ? STEP_STATE.CURRENT : STEP_STATE.DONE}
          >
            <NpmInstallCommand />
            {installed === undefined ? (
              <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                {installs ? PAGE_LINE.INSTALL_HERE : PAGE_LINE.INSTALL_NPM}
              </Text>
            ) : (
              <InstalledLine version={installed.version} onPath={installed.onPath} />
            )}
            {installs ? (
              <Inline>
                <InstallPress install={install} />
              </Inline>
            ) : null}
            <ErrorLine
              level={ANNOUNCE.ALERT}
              error={refusedShown(failed, FAILURE_SURFACE.CLI_INSTALL)}
            />
          </Step>
          <Step number={2} title={PAGE_LINE.SIGN_IN_LABEL} state={STEP_STATE.CURRENT}>
            <LoginCommand />
            <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              {PAGE_LINE.SIGN_IN_WORDS}
            </Text>
          </Step>
        </OutsideSteps>
      </SettingsBlock>
    </div>
  );
}

/** When the command signed in, and when it was last active, where it has been. */
function GrantLine({ grant }: { grant: McpClient }): React.JSX.Element {
  return (
    <>
      {PAGE_LINE.SIGNED_IN}
      {grant.lastRefreshedAt !== null ? (
        <>
          {" · Active "}
          <Time at={grant.lastRefreshedAt} look={TIME_LOOK.AGO} />
        </>
      ) : grant.allowedAt !== null ? (
        <>
          {" "}
          <Time at={grant.allowedAt} look={TIME_LOOK.PROVENANCE} />
        </>
      ) : null}
    </>
  );
}

/** The command signed in: the account it is signed in as, when it was last active, and Sign out everywhere. */
function SignedInRow({
  email,
  grant,
  onSignedOut,
}: {
  email: string;
  grant: McpClient;
  onSignedOut: () => void;
}): React.JSX.Element {
  const { mutateAsync: sendMcpClientsRevoke, ...revoking } = useMutation(
    actMutation(ACT_KIND.MCP_CLIENTS_REVOKE),
  );
  const [rejection, setRejection] = useState<string | undefined>(undefined);
  const refused: ActionResult = {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: PAGE_LINE.SIGN_OUT_REFUSED,
  };
  const signOut = (): Promise<ActionResult> => {
    setRejection(undefined);
    return sendMcpClientsRevoke({ clientId: grant.clientId }).then(
      (answer): ActionResult => {
        if ("failure" in answer) {
          setRejection(refused.reason);
          return refused;
        }
        onSignedOut();
        return { status: ACTION_RESULT_STATUS.ACCEPTED };
      },
      () => {
        setRejection(refused.reason);
        return refused;
      },
    );
  };
  const confirmAct = useConfirmAct(revoking, {
    send: signOut,
    answered: (answer): ActionResult =>
      "failure" in answer ? refused : { status: ACTION_RESULT_STATUS.ACCEPTED },
    failed: () => refused,
  });
  const confirm = useConfirmDialog(
    { subject: true, surfaceOpen: true },
    confirmAct,
    confirmFailure(FAILURE_SURFACE.MCP_CLIENT_REVOKE),
  );
  return (
    <>
      <SettingsRow
        label={<ReplayMask>{email}</ReplayMask>}
        description={<GrantLine grant={grant} />}
        error={refusedShown(rejection, FAILURE_SURFACE.MCP_CLIENT_REVOKE)}
      >
        {() => (
          <Button variant={BUTTON_VARIANT.OUTLINE} onClick={confirm.ask}>
            {PAGE_LINE.SIGN_OUT}
          </Button>
        )}
      </SettingsRow>
      <ConfirmDialog
        open
        confirm={confirm}
        question={{
          title: `Sign out of the ${PRODUCT_NAME.toLowerCase()} command everywhere?`,
          body: `It signs out on every computer it's signed in on. Access it already holds stops working within ${MCP_ACCESS_TOKEN_MINUTES} minutes.`,
          verb: PAGE_LINE.SIGN_OUT,
          running: PAGE_LINE.SIGNING_OUT,
          loss: CONFIRM_LOSS.AFFECTS_OTHERS,
          replayUnmasked: true,
        }}
      />
    </>
  );
}

/** The command's grant among the clients the account allowed, where it holds one. */
function cliGrant(clients: readonly McpClient[]): McpClient | undefined {
  return clients.find((client) => client.clientId === FIRST_PARTY_OAUTH_CLIENT_ID.CLI);
}

/**
 * The CLI section for the account signed in: the command's sign-in, or that
 * it has none yet, then how to install it, as the MCP section over it stands
 * its agents over Connect an app.
 */
export function CliSection(): React.JSX.Element {
  const installs =
    useQuery({ ...appStateQuery, select: selectCapability(HOST_CAPABILITY.CLI_INSTALL) }).data ===
    true;
  const account = useQuery({ ...appStateQuery, select: selectAccount }).data;
  const accountId = signedInAccountId(account);
  const read = useQuery(mcpClientsQuery(accountId));
  const retry = useMutation(mcpClientsRetryMutation());
  const rows = read.data;
  // The grant signed out while the page shows, by when it was allowed, which stands signed out until the read drops it or a new sign-in replaces it.
  const [signedOutAt, setSignedOutAt] = useState<number | null | undefined>(undefined);
  if (rows === undefined && !read.isError) {
    return (
      <SettingsSectionsSkeleton
        label={readingWords("the command's sign-in")}
        sections={sectionSkeleton(installs)}
      />
    );
  }
  const listed = rows === undefined ? undefined : cliGrant(rows.clients);
  const grant =
    listed === undefined || (signedOutAt !== undefined && listed.allowedAt === signedOutAt)
      ? undefined
      : listed;
  const email = account?.status === ACCOUNT_STATUS.SIGNED_IN ? account.email : undefined;
  return (
    <SettingsSection {...settingsSectionHead(SECTION_HEAD.CLI_SIGN_IN)} caption={SECTION.CAPTION}>
      {rows === undefined ? (
        <>
          <ReadFailed
            line={PAGE_LINE.READ_FAILED}
            surface={FAILURE_SURFACE.MCP_CLIENTS_READ}
            onRetry={() => retry.mutate()}
          />
          <InstallRow installs={installs} />
        </>
      ) : grant === undefined || email === undefined ? (
        <>
          <SettingsLine>{PAGE_LINE.NOT_SIGNED_IN}</SettingsLine>
          <SetUpSteps installs={installs} />
        </>
      ) : (
        <>
          <SignedInRow
            email={email}
            grant={grant}
            onSignedOut={() => setSignedOutAt(grant.allowedAt)}
          />
          <InstallRow installs={installs} />
        </>
      )}
    </SettingsSection>
  );
}
