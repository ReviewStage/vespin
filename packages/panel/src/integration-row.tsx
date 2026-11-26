import type { ServerRow } from "@repo/features/agent-servers-model";
import { CONNECTION_HEALTH, type ConnectionHealth } from "@repo/features/integration-health";
import {
  disconnectQuestion,
  grantLabel,
  INTEGRATION_REFUSED,
  INTEGRATION_ROW_WORDS,
} from "@repo/features/integration-settings-words";
import {
  SIGN_IN,
  SIGN_IN_ACTION,
  type SignIn,
  signInLine,
} from "@repo/features/integration-sign-in";
import { INTEGRATION_STATUS_WORDS } from "@repo/features/integration-status-words";
import type { IntegrationStatusView } from "@repo/features/integration-view";
import {
  INTEGRATION_ACCOUNTS_MAX,
  INTEGRATION_LABEL_MAX,
  INTEGRATION_NAME,
  INTEGRATION_PURPOSE,
  INTEGRATION_STATUS,
  type IntegrationProvider,
  type IntegrationStatus,
  integrationAccountLabel,
} from "@repo/features/integration-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { andList, readFailedWords } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import {
  AccountWords,
  BUTTON_VARIANT,
  Button,
  CONFIRM_LOSS,
  ConfirmDialog,
  GAP,
  type InlineEditEnd,
  ProviderMark,
  RenamableName,
  RetryButton,
  SETTINGS_ROW_CONTROLS,
  SETTINGS_ROW_STATE,
  SettingsLinkRow,
  SettingsRow,
  SettingsRowMark,
  type SettingsRowState,
  SettingsRowStateLine,
  SPINNER_SIZE,
  SpinnerRing,
  Stack,
  useConfirmDialog,
} from "@repo/ui";
import { GLYPH, PlusIcon, RefreshCwIcon } from "@repo/ui/icons";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { useInlineRename } from "@repo/ui/use-inline-rename";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useMutation } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import type { ActResult, ActVariables } from "./act.js";
import { sendAct } from "./act.js";
import { actMutation } from "./act-mutations.js";
import { sameAnswer, useConfirmAct } from "./confirm-act.js";
import { confirmFailure, refusedShown } from "./failure-report.js";
import { type GitHubConnectControl, useGitHubConnection } from "./github-connect.js";
import { GRANT_OUTCOME, grantedBySignIn, useIntegrationGrant } from "./integration-grant.js";
import type { IntegrationStatuses } from "./integration-statuses.js";
import { type RenameTerms, renameWrite } from "./rename-write.js";
import { Highlighted } from "./search-field.js";
import { MenuRow } from "./settings/menu-row.js";

/**
 * integration-row.tsx -- an integration's rows: one account's at a provider, as every surface that connects one draws it (setup's tools step, and a provider Settings › Integrations holds nothing at), a held provider's on Settings › Integrations' list, and its page's accounts and Disconnects.
 *
 * The row leads with the provider's mark, names the provider and, beside
 * it, the account where one is told apart (`serverAccountName`: "Notion ·
 * Acme"), and under it says where the connection stands once that needs
 * saying: connected, a sign-in the browser is waited on with Reopen and
 * Cancel, one that failed or never
 * finished with Try again, or one expired with Reconnect. A row with nothing
 * of that to say and not connected says instead what the provider gives
 * agents (`INTEGRATION_PURPOSE`), so a Connect is never pressed blind. A
 * connected or expired account's ⋯ keeps Reconnect (but where Reconnect is
 * the row's button), Disconnect (asked first), and, where the provider
 * allows, Add another account and Rename. Settings › Integrations' own words
 * (`settings/integrations-page.tsx`) say the rest of how a row behaves.
 */

/** The words a row says on its line and under it, fixed by the build. */
const ROW_LINE = {
  CONNECTED: INTEGRATION_STATUS_WORDS[INTEGRATION_STATUS.CONNECTED],
  CHECKING: INTEGRATION_ROW_WORDS.CHECKING,
  TOOLS_NOT_READ: readFailedWords("the tools"),
  NOT_OPENED: INTEGRATION_ROW_WORDS.NOT_OPENED,
  GITHUB_SIGN_IN: INTEGRATION_ROW_WORDS.GITHUB_SIGN_IN,
} as const;

/** What a row offers to mend its connection, on its button or in its ⋯. */
const ROW_ACT = {
  RECONNECT: INTEGRATION_ROW_WORDS.RECONNECT,
  ADD_ACCOUNT: INTEGRATION_ROW_WORDS.ADD_ACCOUNT,
  RENAME: INTEGRATION_ROW_WORDS.RENAME,
} as const;

/** Where a row's own grant stands: at rest, a sign-in being begun, or one being called off. */
const ROW_GRANT = {
  IDLE: "idle",
  CONNECTING: "connecting",
  CANCELING: "canceling",
} as const;

type RowGrant = (typeof ROW_GRANT)[keyof typeof ROW_GRANT];

const ACCEPTED: ActionResult = { status: ACTION_RESULT_STATUS.ACCEPTED };

/** What a row's line looks like: connected with its dot, a problem in the attention tint, a wait with its ring, or plain. */
const LINE_STATE = {
  CONNECTED: "connected",
  ATTENTION: "attention",
  WAITING: "waiting",
  PLAIN: "plain",
} as const;

type LineState = (typeof LINE_STATE)[keyof typeof LINE_STATE];

/** How `@repo/ui`'s state line stands for each line, a wait and a plain line alike unmarked. */
const ROW_STATE: Record<LineState, SettingsRowState> = {
  [LINE_STATE.CONNECTED]: SETTINGS_ROW_STATE.CONNECTED,
  [LINE_STATE.ATTENTION]: SETTINGS_ROW_STATE.ATTENTION,
  [LINE_STATE.WAITING]: SETTINGS_ROW_STATE.PLAIN,
  [LINE_STATE.PLAIN]: SETTINGS_ROW_STATE.PLAIN,
};

/** The line under a row's name, and how it looks. */
interface RowLine {
  readonly text: string;
  readonly state: LineState;
  /** The server's or the sign-in's own words behind `text`, quoted and naming who said them, on a line of their own. */
  readonly said?: string;
}

/** Someone else's words behind a row's line, where there are any. */
function saidOf(said: string | undefined): Pick<RowLine, "said"> {
  return said === undefined ? {} : { said };
}

/** A connected row's line, from how its server answered. */
function connectedLine(health: ConnectionHealth): RowLine {
  switch (health.kind) {
    case CONNECTION_HEALTH.WORKING:
      return { text: ROW_LINE.CONNECTED, state: LINE_STATE.CONNECTED };
    case CONNECTION_HEALTH.BROKEN:
      return { text: health.problem, state: LINE_STATE.ATTENTION, ...saidOf(health.said) };
    case CONNECTION_HEALTH.CHECKING:
      return { text: ROW_LINE.CHECKING, state: LINE_STATE.PLAIN };
    case CONNECTION_HEALTH.FAILED:
      return { text: ROW_LINE.TOOLS_NOT_READ, state: LINE_STATE.ATTENTION };
  }
}

/** A sign-in's line: its wait with the ring, a failure in the attention tint, or one unfinished, plain. */
function signInRowLine(provider: IntegrationProvider, signIn: SignIn): RowLine {
  const { text, problem, said } = signInLine(provider, signIn);

  if (signIn.kind === SIGN_IN.WAITING) return { text, state: LINE_STATE.WAITING };

  return { text, state: problem ? LINE_STATE.ATTENTION : LINE_STATE.PLAIN, ...saidOf(said) };
}

/**
 * The line under a row's name: a sign-in the window waits on or last waited
 * on, else a sign-in that expired, or nothing where the row's own control
 * already says it — a Connect, or a row whose status has not been read. A
 * connection under way is a sign-in the window waits on, since a read that
 * finds one pending begins it, so it has no line of its own here. A
 * connection that stands outranks a sign-in, which a read that finds it
 * connected ends anyway.
 */
function rowLine(
  provider: IntegrationProvider,
  status: IntegrationStatus | undefined,
  health: ConnectionHealth,
  signIn: SignIn | undefined,
): RowLine | undefined {
  if (status === INTEGRATION_STATUS.CONNECTED) return connectedLine(health);

  if (signIn !== undefined) return signInRowLine(provider, signIn);

  switch (status) {
    case INTEGRATION_STATUS.EXPIRED:
      return {
        text: INTEGRATION_STATUS_WORDS[INTEGRATION_STATUS.EXPIRED],
        state: LINE_STATE.ATTENTION,
      };
    case INTEGRATION_STATUS.PENDING:
    case INTEGRATION_STATUS.DISCONNECTED:
    case undefined:
    case INTEGRATION_STATUS.UNAVAILABLE:
      return undefined;
  }
}

/**
 * A row's line, with the ring before a wait's words, and where the server or
 * the sign-in said words of its own, those quoted on a plain line under ours.
 */
function RowLineText({ line }: { line: RowLine }): React.JSX.Element {
  const state = (
    <SettingsRowStateLine state={ROW_STATE[line.state]} block={line.said !== undefined}>
      {line.state === LINE_STATE.WAITING ? <SpinnerRing size={SPINNER_SIZE.SMALL} /> : null}
      {line.text}
    </SettingsRowStateLine>
  );

  if (line.said === undefined) return state;

  return (
    <>
      {state}
      <SettingsRowStateLine block>
        <ReplayMask>{line.said}</ReplayMask>
      </SettingsRowStateLine>
    </>
  );
}

/** The words a row marks where no search stands. */
const NO_TOKENS: readonly string[] = [];

/**
 * Disconnects one account: a Connect grant at the service, and GitHub by
 * unlinking the account's GitHub under the Mac's session, whose refusal is
 * the window's toast, so the dialog closes either way. Each answers once the
 * host's read carries where the account then stands, so an account past the
 * provider's first leaves the page with its row as the answer lands.
 */
function disconnectAccount(
  disconnectIntegration: (
    variables: ActVariables<typeof ACT_KIND.INTEGRATIONS_DISCONNECT>,
  ) => Promise<ActResult<typeof ACT_KIND.INTEGRATIONS_DISCONNECT>>,
  github: GitHubConnectControl,
  row: ServerRow,
): Promise<ActionResult> {
  const { provider, connection, name } = row;

  const refused: ActionResult = {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: INTEGRATION_REFUSED.DISCONNECT(name),
  };

  if (grantedBySignIn(provider)) return github.disconnect().then(() => ACCEPTED);

  return disconnectIntegration({
    provider,
    ...(connection === provider ? undefined : { connection }),
  }).then(
    (answer: IntegrationStatusView) => ("failure" in answer ? refused : ACCEPTED),
    () => refused,
  );
}

type RenameKind = typeof ACT_KIND.INTEGRATIONS_RENAME;

/** An account's rename at `provider` as its mutation is asked, by the connection it names; refused where the service answers a failure. */
function integrationRename(
  provider: ServerRow["provider"],
): RenameTerms<ActResult<RenameKind>, ActVariables<RenameKind>> {
  return {
    ask: (connection, label) => ({ provider, connection, label }),
    asked: ({ connection, label }) => ({ subjectId: connection, name: label }),
    refused: (answer) => "failure" in answer,
  };
}

/** A row's own grant as it stands: at rest, or begun or being called off, and what refused the last one. */
export interface RowGrantControl {
  readonly stage: RowGrant;
  /** Whether a grant or a Cancel is under way, which holds every other grant back. */
  readonly busy: boolean;
  /** Why the last grant begun here could not begin, said under the row. */
  readonly rejection: string | undefined;
  /** Begins the server's own sign-in: Connect, Reconnect, Try again, or Reopen. */
  readonly connect: () => void;
  /** Begins a sign-in to a new account at the provider. */
  readonly add: () => void;
  /** Ends the sign-in waited on, revoking nothing. */
  readonly cancel: () => void;
}

/**
 * One server's grant, as a row presses it: a sign-in begun for it, or for
 * a new account at its provider, or the one waited on called off, each
 * saying under the row where it could not go.
 */
export function useRowGrant(
  statuses: IntegrationStatuses,
  { provider, connection, name }: Pick<ServerRow, "provider" | "connection" | "name">,
): RowGrantControl {
  const { cancelSignIn } = statuses;
  const grant = useIntegrationGrant(statuses);
  // Note that the sign-in's own Cancel is the one busy while it is called off, as Connect is while one begins, and either holds every other grant back.
  const [stage, setStage] = useState<RowGrant>(ROW_GRANT.IDLE);
  const [rejection, setRejection] = useState<string | undefined>(undefined);

  /** How a grant begun went, said under the row where it could not begin. */
  const began = (outcome: (typeof GRANT_OUTCOME)[keyof typeof GRANT_OUTCOME]) => {
    // A Cancel under way stands until it answers, whatever a grant begun before it answers.
    setStage((now) => (now === ROW_GRANT.CANCELING ? now : ROW_GRANT.IDLE));

    if (outcome === GRANT_OUTCOME.NOT_OPENED) setRejection(ROW_LINE.NOT_OPENED);

    if (outcome === GRANT_OUTCOME.REFUSED) {
      setRejection(INTEGRATION_REFUSED.CONNECT(name));
    }
  };

  const connect = () => {
    setStage(ROW_GRANT.CONNECTING);
    setRejection(undefined);
    void grant.begin(connection).then(began);
  };

  const add = () => {
    setStage(ROW_GRANT.CONNECTING);
    setRejection(undefined);
    void grant.add(provider).then(began);
  };

  const cancel = () => {
    setStage(ROW_GRANT.CANCELING);
    setRejection(undefined);
    void cancelSignIn(connection).then((canceled) => {
      setStage(ROW_GRANT.IDLE);

      if (!canceled) setRejection(INTEGRATION_REFUSED.CANCEL(name));
    });
  };

  return { stage, busy: stage !== ROW_GRANT.IDLE, rejection, connect, add, cancel };
}

/** Where one server stands, as its row's control and line read it. */
interface RowStanding {
  readonly row: ServerRow;
  /** Where the connection stands, or nothing while it has not been read. */
  readonly status: IntegrationStatus | undefined;
  /** How a connected account's server answered when asked for its tools. */
  readonly health: ConnectionHealth;
  /** The sign-in the window waits on, or last waited on, where one stands. */
  readonly signIn: SignIn | undefined;
}

/**
 * The control a row offers for what it needs next: Reopen and Cancel while
 * the browser is waited on, Retry where its tools could not be read, and
 * its grant (Connect, Reconnect, or Try again) where it is not connected or
 * its connection broke in a way a sign-in mends; else none.
 */
function rowControl(
  { row, status, health, signIn }: RowStanding,
  grant: RowGrantControl,
  onRetryTools: () => void,
  describedBy?: string,
): ReactNode {
  const { name } = row;
  const connected = status === INTEGRATION_STATUS.CONNECTED;
  const broken = connected && health.kind === CONNECTION_HEALTH.BROKEN && health.reconnect;
  const waiting = !connected && signIn?.kind === SIGN_IN.WAITING;

  if (waiting) {
    return (
      <>
        <Button
          variant={BUTTON_VARIANT.QUIET}
          busy={grant.stage === ROW_GRANT.CONNECTING}
          busyLabel="Reopening the sign-in"
          disabled={grant.stage === ROW_GRANT.CANCELING}
          onClick={grant.connect}
        >
          {SIGN_IN_ACTION.REOPEN}
        </Button>
        <Button
          variant={BUTTON_VARIANT.OUTLINE}
          busy={grant.stage === ROW_GRANT.CANCELING}
          busyLabel="Canceling the sign-in"
          disabled={grant.stage === ROW_GRANT.CONNECTING}
          onClick={grant.cancel}
        >
          {SIGN_IN_ACTION.CANCEL}
        </Button>
      </>
    );
  }

  if (connected && health.kind === CONNECTION_HEALTH.FAILED) {
    return <RetryButton onRetry={onRetryTools} />;
  }

  const granting = !(
    status === undefined ||
    status === INTEGRATION_STATUS.UNAVAILABLE ||
    (connected && !broken)
  );

  if (!granting) return null;

  return (
    <Button
      variant={BUTTON_VARIANT.OUTLINE}
      // Note that the name starts with the words the button shows, so a voice command that says them finds it, and names the row, since several rows may offer the same words.
      label={`${grantLabel(status, signIn)} ${name}`}
      aria-describedby={describedBy}
      busy={grant.busy}
      busyLabel={`Connecting ${name}`}
      onClick={grant.connect}
    >
      {grantLabel(status, signIn)}
    </Button>
  );
}

/** One account's Disconnect, asked first in the confirm dialog while the service holds the account (`held`). */
function useDisconnect(row: ServerRow, held: boolean) {
  const github = useGitHubConnection();

  const disconnecting = useMutation({
    mutationKey: [ACT_KIND.INTEGRATIONS_DISCONNECT],
    mutationFn: () =>
      disconnectAccount(
        (variables) => sendAct(ACT_KIND.INTEGRATIONS_DISCONNECT, variables),
        github,
        row,
      ),
  });

  const disconnectAct = useConfirmAct(disconnecting, {
    send: () => disconnecting.mutateAsync(),
    answered: sameAnswer,
  });

  return useConfirmDialog(
    { subject: held, surfaceOpen: true },
    disconnectAct,
    confirmFailure(FAILURE_SURFACE.INTEGRATION_DISCONNECT),
  );
}

/** Whether the service still holds an account, connected or expired, which is what a Disconnect ends. */
function heldStatus(status: IntegrationStatus | undefined): boolean {
  return status === INTEGRATION_STATUS.CONNECTED || status === INTEGRATION_STATUS.EXPIRED;
}

/** The provider's mark a row leads with. */
function RowMark({ provider }: { provider: IntegrationProvider }): React.JSX.Element {
  return (
    <SettingsRowMark>
      <ProviderMark provider={provider} />
    </SettingsRowMark>
  );
}

/** One account's row at a provider, or a provider's where the account holds none there. */
export function IntegrationRow({
  row,
  status,
  health,
  statuses,
  tokens = NO_TOKENS,
  onRetryTools,
}: {
  row: ServerRow;
  /** Where the connection stands, or nothing while it has not been read; the row offers nothing until it has. */
  status: IntegrationStatus | undefined;
  /** How a connected account's server answered when asked for its tools. */
  health: ConnectionHealth;
  statuses: IntegrationStatuses;
  /** The words a search asks for, marked where they landed in the row's name. */
  tokens?: readonly string[];
  /** Asks the account's server for its tools again, offered where the read failed. */
  onRetryTools: () => void;
}): React.JSX.Element {
  const { provider, connection, name, account, accountName } = row;
  const renaming = useMutation(actMutation(ACT_KIND.INTEGRATIONS_RENAME));

  const rename = useInlineRename(
    account === undefined ? undefined : connection,
    renameWrite(renaming, integrationRename(provider)),
  );

  const grant = useRowGrant(statuses, row);
  const bySignIn = grantedBySignIn(provider);
  const signIn = statuses.signInOf(connection);
  // Several accounts at a provider are each renamed, and each disconnected leaving the others.
  const several = row.accounts > 1 && account !== undefined;

  /** A rename ended: a new label asked of the service, which the host draws over its read on the press, so every surface draws it at once; a refusal puts the old one back, reopens the field over the label asked, and is said under the row. */
  const renamed = ({ value: label }: InlineEditEnd) => {
    rename.end(label === account?.label ? undefined : label);
  };

  const connected = status === INTEGRATION_STATUS.CONNECTED;
  const expired = status === INTEGRATION_STATUS.EXPIRED;
  // An account the service still holds, connected or expired, is managed from its ⋯.
  const held = heldStatus(status);

  const disconnect = useDisconnect(row, held);

  const { busy } = grant;
  const line = rowLine(provider, status, health, signIn);
  const broken = connected && health.kind === CONNECTION_HEALTH.BROKEN && health.reconnect;

  // A broken or expired connection's Reconnect is the row's button, so its ⋯
  // keeps it only while the connection stands quiet.
  const reconnect = {
    label: ROW_ACT.RECONNECT,
    icon: <RefreshCwIcon />,
    disabled: busy,
    onSelect: grant.connect,
  };

  const leave = {
    label: INTEGRATION_ROW_WORDS.DISCONNECT,
    danger: true,
    onSelect: disconnect.ask,
  };

  const naming = several
    ? [{ label: ROW_ACT.RENAME, icon: <GLYPH.RENAME />, onSelect: rename.begin }]
    : [];

  const adding =
    !bySignIn && statuses.canAdd(provider) && row.accounts < INTEGRATION_ACCOUNTS_MAX
      ? [
          {
            label: ROW_ACT.ADD_ACCOUNT,
            icon: <PlusIcon />,
            disabled: busy,
            onSelect: grant.add,
          },
        ]
      : [];

  const actions = held
    ? [[...naming, ...adding], broken || expired ? [] : [reconnect], [leave]].filter(
        (group) => group.length > 0,
      )
    : [];

  return (
    // Note that a row is followed by its connection, because one that connects or disconnects leaves one section for the other and glides across rather than leaving one and arriving in the other.
    <Stack gap={GAP.NONE}>
      <MenuRow
        thing={name}
        actions={actions}
        anchor={connection}
        {...(bySignIn ? { heading: ROW_LINE.GITHUB_SIGN_IN } : undefined)}
        row={{
          // Note that every row of a provider ends in a short button, a ⋯, or both, so each keeps its end beside its name and lets its words wrap, rather than one row dropping its end below them; on a phone's width they drop as every row's do, so the name reads whole.
          controls: SETTINGS_ROW_CONTROLS.BESIDE_UNTIL_NARROW,
          leading: <RowMark provider={provider} />,
          label: <Highlighted text={INTEGRATION_NAME[provider]} tokens={tokens} />,
          // Note that the account's words are renamed by pressing them beside the provider's name, since the account is what a rename names.
          adornment:
            accountName === undefined ? undefined : (
              <RenamableName
                value={
                  account === undefined
                    ? accountName
                    : (rename.asked ?? integrationAccountLabel(account))
                }
                label={`${name} account name`}
                editing={rename.editing}
                onBegin={several ? rename.begin : undefined}
                maxLength={INTEGRATION_LABEL_MAX}
                onEnd={renamed}
              >
                <AccountWords words={accountName}>
                  <ReplayMask>
                    <Highlighted text={accountName} tokens={tokens} />
                  </ReplayMask>
                </AccountWords>
              </RenamableName>
            ),
          description:
            line === undefined ? (
              connected ? null : (
                INTEGRATION_PURPOSE[provider]
              )
            ) : (
              <RowLineText line={line} />
            ),
          // Note that a rename's refusal is the rename's own, so a connect begun meanwhile neither erases it nor is hidden by it.
          error: refusedShown(
            [rename.refused ? INTEGRATION_REFUSED.RENAME(name) : undefined, grant.rejection]
              .filter((words) => words !== undefined)
              .join(" "),
            FAILURE_SURFACE.INTEGRATION_RENAME,
          ),
          control: rowControl({ row, status, health, signIn }, grant, onRetryTools),
        }}
      />
      <ConfirmDialog
        open
        confirm={disconnect}
        question={{
          ...disconnectQuestion(name, provider, { bySignIn, several }),
          loss: CONFIRM_LOSS.AFFECTS_OTHERS,
          replayUnmasked: true,
          titleReplayMasked: true,
        }}
      />
    </Stack>
  );
}

/** A row's standing: where its connection stands, how its server answered, and its sign-in, read for it. */
function standingOf(
  row: ServerRow,
  statuses: IntegrationStatuses,
  healthOf: (server: string) => ConnectionHealth,
): RowStanding {
  return {
    row,
    status: statuses.statusOf(row.connection),
    health: healthOf(row.connection),
    signIn: statuses.signInOf(row.connection),
  };
}

/**
 * The line a held account says where it needs the developer: a problem in
 * the attention tint, or a sign-in the browser is waited on; none while it
 * works, is being checked, or was never connected.
 */
function neededLine({ row, status, health, signIn }: RowStanding): RowLine | undefined {
  if (!heldStatus(status)) return undefined;
  const line = rowLine(row.provider, status, health, signIn);

  return line?.state === LINE_STATE.ATTENTION || line?.state === LINE_STATE.WAITING
    ? line
    : undefined;
}

/**
 * A provider's row on Settings › Integrations' list, where the account
 * holds an account there: pressed anywhere it opens the provider's page
 * (`SettingsLinkRow`). It names the provider, and beside it the accounts
 * where they carry names ("Personal and Work"), and says under it what the
 * provider gives agents, or, where an account needs the developer, that
 * account's problem in the attention tint (naming it where there are
 * several), with the one control that mends it before the ›: Reconnect for
 * an expired sign-in, Reopen and Cancel while its sign-in is waited on, or
 * Retry where its tools could not be read.
 */
export function IntegrationLinkRow({
  provider,
  rows,
  statuses,
  healthOf,
  tokens = NO_TOKENS,
  onRetryTools,
  onOpen,
}: {
  provider: IntegrationProvider;
  /** The provider's rows, an account each. */
  rows: readonly ServerRow[];
  statuses: IntegrationStatuses;
  /** How a connected account's server answered when asked for its tools. */
  healthOf: (server: string) => ConnectionHealth;
  /** The words a search asks for, marked where they landed in the row's name. */
  tokens?: readonly string[];
  /** Asks an account's server for its tools again, offered where the read failed. */
  onRetryTools: (server: string) => void;
  /** Opens the provider's page. */
  onOpen: () => void;
}): React.JSX.Element {
  const standings = rows.map((row) => standingOf(row, statuses, healthOf));
  const held = standings.filter((standing) => heldStatus(standing.status));
  // Note that the row says the first account that needs the developer, so a provider with one expired account of two reads as needing a sign-in.
  const needing = held.find((standing) => neededLine(standing) !== undefined);
  const subject = needing ?? held[0] ?? standings[0];

  const grant = useRowGrant(
    statuses,
    subject?.row ?? { provider, connection: provider, name: INTEGRATION_NAME[provider] },
  );

  const names = held.flatMap((standing) =>
    standing.row.accountName === undefined ? [] : [standing.row.accountName],
  );

  const needed = needing === undefined ? undefined : neededLine(needing);
  const owner = held.length > 1 ? needing?.row.accountName : undefined;

  return (
    <SettingsLinkRow
      leading={<RowMark provider={provider} />}
      label={<Highlighted text={INTEGRATION_NAME[provider]} tokens={tokens} />}
      adornment={
        names.length === 0 ? undefined : (
          <AccountWords words={andList(names)}>
            <ReplayMask>
              <Highlighted text={andList(names)} tokens={tokens} />
            </ReplayMask>
          </AccountWords>
        )
      }
      description={
        needed === undefined ? (
          INTEGRATION_PURPOSE[provider]
        ) : (
          <RowLineText
            line={owner === undefined ? needed : { ...needed, text: `${owner}: ${needed.text}` }}
          />
        )
      }
      error={refusedShown(grant.rejection, FAILURE_SURFACE.INTEGRATION_RECONNECT)}
      onOpen={onOpen}
      control={
        needing === undefined
          ? undefined
          : (ids) =>
              rowControl(
                needing,
                grant,
                () => onRetryTools(needing.row.connection),
                ids["aria-describedby"],
              )
      }
    />
  );
}

/**
 * One account's row on its provider's page, led by the provider's mark and
 * named by the account (by the provider alone where the account carries no
 * name), saying under it only what needs saying: a sign-in expired, a
 * problem its server answered, a sign-in waited on, or one that did not
 * finish. Its one control is what it needs next (`rowControl`), and its ⋯
 * keeps what today's row kept short of Add another account, which heads
 * the page's accounts: Rename where the provider holds several, Reconnect
 * while the connection stands quiet, and, where the provider holds several
 * (`leaves`), Disconnect last in red, asked first; a provider's one account
 * keeps its Disconnect in a row of its own at the page's foot.
 */
export function IntegrationAccountRow({
  row,
  statuses,
  health,
  refusal,
  anchor,
  leaves = false,
  onRetryTools,
}: {
  row: ServerRow;
  statuses: IntegrationStatuses;
  /** How the account's server answered when asked for its tools. */
  health: ConnectionHealth;
  /** Whether its ⋯ keeps its Disconnect, as each of several accounts' does, rather than a row of its own at the page's foot. */
  leaves?: boolean;
  /** Why a press elsewhere on the page that acted for this account could not go, as Add account's. */
  refusal?: string | undefined;
  /** The id a pressed search result lands on. */
  anchor?: string | undefined;
  /** Asks the account's server for its tools again, offered where the read failed. */
  onRetryTools: () => void;
}): React.JSX.Element {
  const { provider, connection, name, account, accountName } = row;
  const status = statuses.statusOf(connection);
  const signIn = statuses.signInOf(connection);
  const renaming = useMutation(actMutation(ACT_KIND.INTEGRATIONS_RENAME));

  const rename = useInlineRename(
    account === undefined ? undefined : connection,
    renameWrite(renaming, integrationRename(provider)),
  );

  const grant = useRowGrant(statuses, row);
  const several = row.accounts > 1 && account !== undefined;
  const connected = status === INTEGRATION_STATUS.CONNECTED;
  const broken = connected && health.kind === CONNECTION_HEALTH.BROKEN && health.reconnect;

  // Note that an account that works says nothing under its name, since the page is the provider's and stands only for what it holds.
  const line =
    connected && health.kind === CONNECTION_HEALTH.WORKING
      ? undefined
      : rowLine(provider, status, health, signIn);

  const naming = several
    ? [{ label: ROW_ACT.RENAME, icon: <GLYPH.RENAME />, onSelect: rename.begin }]
    : [];

  const reconnect =
    connected && !broken
      ? [
          {
            label: ROW_ACT.RECONNECT,
            icon: <RefreshCwIcon />,
            disabled: grant.busy,
            onSelect: grant.connect,
          },
        ]
      : [];

  const held = heldStatus(status);
  const disconnect = useDisconnect(row, held && leaves);

  const leave =
    leaves && held
      ? [{ label: INTEGRATION_ROW_WORDS.DISCONNECT, danger: true, onSelect: disconnect.ask }]
      : [];

  const actions = held ? [naming, reconnect, leave].filter((group) => group.length > 0) : [];

  const words = accountName ?? INTEGRATION_NAME[provider];

  return (
    <Stack gap={GAP.NONE}>
      <MenuRow
        thing={name}
        actions={actions}
        {...(anchor === undefined ? undefined : { anchor })}
        {...(grantedBySignIn(provider) ? { heading: ROW_LINE.GITHUB_SIGN_IN } : undefined)}
        row={{
          controls: SETTINGS_ROW_CONTROLS.BESIDE_UNTIL_NARROW,
          leading: <RowMark provider={provider} />,
          label: (
            <RenamableName
              value={
                account === undefined || accountName === undefined
                  ? words
                  : (rename.asked ?? integrationAccountLabel(account))
              }
              label={`${name} account name`}
              editing={rename.editing}
              // Note that an account still waiting on its first sign-in is named by the service once it lands, so only one it holds is renamed.
              onBegin={several && held ? rename.begin : undefined}
              maxLength={INTEGRATION_LABEL_MAX}
              onEnd={({ value: label }: InlineEditEnd) =>
                rename.end(label === account?.label ? undefined : label)
              }
            >
              <ReplayMask>{words}</ReplayMask>
            </RenamableName>
          ),
          description: line === undefined ? undefined : <RowLineText line={line} />,
          error: refusedShown(
            [
              rename.refused ? INTEGRATION_REFUSED.RENAME(name) : undefined,
              grant.rejection,
              refusal,
            ]
              .filter((each) => each !== undefined)
              .join(" "),
            FAILURE_SURFACE.INTEGRATION_RENAME,
          ),
          control: rowControl({ row, status, health, signIn }, grant, onRetryTools),
        }}
      />
      {leaves ? (
        <ConfirmDialog
          open
          confirm={disconnect}
          question={{
            ...disconnectQuestion(name, provider, {
              bySignIn: grantedBySignIn(provider),
              several,
            }),
            loss: CONFIRM_LOSS.AFFECTS_OTHERS,
            replayUnmasked: true,
            titleReplayMasked: true,
          }}
        />
      ) : null}
    </Stack>
  );
}

/**
 * The Disconnect of a provider's one account, last on its page in a danger
 * outline, named for the provider, saying what goes, and asking first in
 * the confirm dialog, as the account's ⋯ once did. Where the provider
 * holds several, each account's ⋯ keeps its own instead.
 */
export function IntegrationDisconnectRow({ row }: { row: ServerRow }): React.JSX.Element {
  const { provider, name, account } = row;
  const disconnect = useDisconnect(row, true);
  const several = row.accounts > 1 && account !== undefined;

  const question = disconnectQuestion(name, provider, {
    bySignIn: grantedBySignIn(provider),
    several,
  });

  return (
    <>
      <SettingsRow
        label={
          <ReplayMask>{`${INTEGRATION_ROW_WORDS.DISCONNECT} ${several ? name : INTEGRATION_NAME[provider]}`}</ReplayMask>
        }
        description={question.body}
      >
        {(ids) => (
          <Button
            variant={BUTTON_VARIANT.DANGER_OUTLINE}
            label={`${INTEGRATION_ROW_WORDS.DISCONNECT} ${name}`}
            aria-describedby={ids["aria-describedby"]}
            busy={disconnect.busy}
            busyLabel={question.running}
            onClick={disconnect.ask}
          >
            {INTEGRATION_ROW_WORDS.DISCONNECT}
          </Button>
        )}
      </SettingsRow>
      <ConfirmDialog
        open
        confirm={disconnect}
        question={{
          ...question,
          loss: CONFIRM_LOSS.AFFECTS_OTHERS,
          replayUnmasked: true,
          titleReplayMasked: true,
        }}
      />
    </>
  );
}
