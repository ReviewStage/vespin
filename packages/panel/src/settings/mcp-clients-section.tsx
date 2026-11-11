import { signedInAccountId } from "@repo/credentials/snapshot";
import { MCP_ACCESS_TOKEN_MINUTES, type McpClient } from "@repo/features/mcp-client-wire";
import {
  cursorInstallUrl,
  MCP_ADD_COMMAND,
  MCP_COMMAND_AGENT,
  MCP_SERVER_NAME,
  shellLine,
} from "@repo/features/mcp-connect";
import { MODEL_PROVIDER } from "@repo/features/models-wire";
import { FIRST_PARTY_OAUTH_CLIENT_ID } from "@repo/features/oauth-client-ids";
import { ON_THIS_COMPUTER, oauthRedirectDestination } from "@repo/features/oauth-consent";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { readingWords } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import { SETTINGS_SEARCH_ROW, searchAnchorProps } from "@repo/settings/settings-anchors";
import {
  CHOICE_BAR_LOOK,
  CHOICE_BAR_SIZE,
  ChoiceBar,
  CONFIRM_LOSS,
  COPY_FIELD_PROMPT,
  COPY_FIELD_WIDTH,
  ConfirmDialog,
  CopyField,
  MARK_PROVIDER,
  OutsideLink,
  OutsideSteps,
  ProviderMark,
  SETTINGS_ROW_STATE,
  SETTINGS_SKELETON_CONTROL,
  SettingsBlock,
  SettingsLine,
  SettingsRow,
  SettingsRowMark,
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
import { GLYPH } from "@repo/ui/icons";
import { ReplayMask, ReplayWords } from "@repo/ui/session-replay-marks";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { actMutation } from "../act-mutations.js";
import { useConfirmAct } from "../confirm-act.js";
import { copyThroughShell } from "../copy-feedback.js";
import { confirmFailure, refusedShown } from "../failure-report.js";
import { HarnessMark } from "../harness-marks.js";
import { mcpClientsQuery, mcpClientsRetryMutation } from "../live-reads.js";
import { useOpenLink } from "../tasks/use-open-link.js";
import { appStateQuery, selectAccount } from "../use-app-state.js";
import { ReadFailed } from "./marks.js";
import { MenuRow } from "./menu-row.js";
import { SECTION as SECTION_HEAD, settingsSectionHead } from "./settings-sections.js";

/**
 * mcp-clients-section.tsx -- Settings › our MCP & CLI's MCP section: the outside agents the account let in, each revoked from its row, and how to connect one.
 *
 * An agent that signs a member in to the MCP server (Claude Code, Codex,
 * Cursor, Claude, ChatGPT) holds the member's Allow from the consent page
 * until it is revoked. The section lists every one the account allowed, read
 * by the host while the page shows and again whenever the window is focused
 * (`LIVE_READ.MCP_CLIENTS`): its name, where its sign-in returns to as the
 * consent page said it, when it was allowed, and when it last refreshed its
 * access. Its ⋯ holds Disconnect, as an integration's does, which
 * asks first in the confirm dialog, then cuts the agent off: its next
 * refresh is refused and its next sign-in asks again, but an access token it
 * already holds keeps working until it expires, so a row revoked stays on
 * the page saying so. A revoke that did not finish says so under its row,
 * which keeps its Disconnect, since an agent half revoked could sign in again
 * without being asked.
 *
 * Under them, Connect an app asks which agent, and then shows only that agent's
 * two steps (`OutsideSteps`), as its own docs say it adds a remote MCP
 * server signed in with OAuth: Claude Code, Codex, and VS Code by a command
 * with its Copy, Cursor by its install link, Claude and ChatGPT by the
 * server's address pasted in their own settings, and any other agent by the
 * address alone; then what is done in the agent. Under them it waits for the
 * agent to connect. An agent that arrives while the page shows, which is how
 * a member comes back from the browser, lights its row and is said to be
 * connected under the steps, in the wait's place.
 * While the account has none, a line says so over Connect an app. The
 * `vespin` command, which the read lists too, is left out of the list: its
 * sign-in stands in the CLI's section under this one (`cli-section.tsx`).
 *
 * Each agent is led by its brand's mark, in the picker and on its row, an
 * allowed agent's found by the name it registered under; Other stands in
 * the picker by its name alone, and a row whose agent the page does not
 * know wears a plain agent's glyph, so the rows' names stay in one column. The section is `@repo/ui`'s
 * `SettingsSection`, the agent asked for its segmented `ChoiceBar`, each
 * allowed agent `MenuRow`'s row, and an address or a command its `CopyField`.
 */

const SECTION = {
  CAPTION: `Use ${PRODUCT_NAME} from Claude Code, Cursor, ChatGPT, and other AI apps.`,
} as const;

/** The name each agent knows the server by in a command that adds it. */
const SERVER_NAME = MCP_SERVER_NAME;

const PAGE_LINE = {
  READ_FAILED: "The connected apps could not be read.",
  NONE: "No apps connected yet.",
  UNNAMED: "Unnamed app",
  AGENT: "App",
  CONNECT: "Connect an app",
  SERVER: "Server URL",
  DISCONNECT: "Disconnect",
  REVOKED: `Disconnected. Its access ends within ${MCP_ACCESS_TOKEN_MINUTES} minutes.`,
  THIS_COMPUTER: "This computer",
} as const;

/** The agents Connect an agent knows, in the order it offers them, any other last. */
const CONNECT_AGENT = {
  CLAUDE_CODE: "claudeCode",
  CODEX: "codex",
  CURSOR: "cursor",
  VS_CODE: "vsCode",
  CLAUDE: "claude",
  CHATGPT: "chatgpt",
  OTHER: "other",
} as const;

type ConnectAgent = (typeof CONNECT_AGENT)[keyof typeof CONNECT_AGENT];

/**
 * How one agent adds the server, as its own docs say it: its step's words,
 * and the one thing the step hands over, a command to copy, the server's
 * address to copy, or a link that installs it.
 */
interface ConnectStep {
  readonly name: string;
  /** Its brand's mark; any other agent has none. */
  readonly mark?: React.JSX.Element;
  /** Its first step, which the command, the address, or the install link stands under. */
  readonly first: string;
  /** Its second step, done in the agent itself. */
  readonly inAgent: string;
  /** A line under the second step, where the agent asks for more. */
  readonly note?: string;
  readonly command?: (serverUrl: string) => string;
  readonly address?: true;
  readonly install?: { readonly label: string; readonly url: (serverUrl: string) => string };
}

/** Each agent's two steps: the command, the address, or the install link, then what is done in the agent. */
const CONNECT_STEPS: Readonly<Record<ConnectAgent, ConnectStep>> = {
  [CONNECT_AGENT.CLAUDE_CODE]: {
    name: "Claude Code",
    mark: <HarnessMark provider={MODEL_PROVIDER.ANTHROPIC} />,
    first: "Run this in a terminal",
    inAgent: `Type /mcp in Claude Code, choose ${SERVER_NAME}, and sign in`,
    command: (serverUrl) => shellLine(MCP_ADD_COMMAND[MCP_COMMAND_AGENT.CLAUDE_CODE](serverUrl)),
  },
  [CONNECT_AGENT.CODEX]: {
    name: "Codex",
    mark: <HarnessMark provider={MODEL_PROVIDER.OPENAI} />,
    first: "Run this in a terminal",
    inAgent: "Sign in in the browser it opens",
    note: `If it doesn't open, run codex mcp login ${SERVER_NAME}.`,
    command: (serverUrl) => shellLine(MCP_ADD_COMMAND[MCP_COMMAND_AGENT.CODEX](serverUrl)),
  },
  [CONNECT_AGENT.CURSOR]: {
    name: "Cursor",
    mark: <ProviderMark provider={MARK_PROVIDER.CURSOR} />,
    first: `Add ${PRODUCT_NAME} to Cursor`,
    inAgent: `Sign in to ${SERVER_NAME} from Cursor's MCP settings`,
    install: { label: "Open in Cursor", url: cursorInstallUrl },
  },
  [CONNECT_AGENT.VS_CODE]: {
    name: "VS Code",
    mark: <ProviderMark provider={MARK_PROVIDER.VS_CODE} />,
    first: "Run this in a terminal",
    inAgent: `Start ${SERVER_NAME} from VS Code's MCP servers and sign in`,
    command: (serverUrl) => shellLine(MCP_ADD_COMMAND[MCP_COMMAND_AGENT.VS_CODE](serverUrl)),
  },
  [CONNECT_AGENT.CLAUDE]: {
    name: "Claude",
    mark: <ProviderMark provider={MARK_PROVIDER.CLAUDE} />,
    first: "Copy the server URL",
    inAgent:
      "In Claude, open Customize › Connectors, choose Add custom connector, paste it, then connect",
    note: "On a Team or Enterprise plan, an owner adds it in Organization settings › Connectors.",
    address: true,
  },
  [CONNECT_AGENT.CHATGPT]: {
    name: "ChatGPT",
    mark: <ProviderMark provider={MARK_PROVIDER.CHATGPT} />,
    first: "Copy the server URL",
    inAgent:
      "In ChatGPT, open Plugins, choose + › Add custom MCP server, paste it under Connection, then choose Create as a plugin",
    address: true,
  },
  [CONNECT_AGENT.OTHER]: {
    name: "Other",
    first: "Copy the server URL",
    inAgent: "Add it to any agent that supports remote MCP servers",
    note: "It signs in with OAuth.",
    address: true,
  },
};

/** The names an agent registers under where they are not the name the picker calls it by. */
const REGISTERED_AS: ReadonlyMap<string, ConnectAgent> = new Map([
  ["visual studio code", CONNECT_AGENT.VS_CODE],
]);

/** The mark an allowed agent's row leads with: its brand's, where the name it registered under is one the picker knows, or a plain agent's. */
function clientMark(client: McpClient): React.JSX.Element {
  const name = client.name?.trim().toLowerCase() ?? "";
  const agent =
    REGISTERED_AS.get(name) ??
    Object.values(CONNECT_AGENT).find((each) => CONNECT_STEPS[each].name.toLowerCase() === name);
  return (agent === undefined ? undefined : CONNECT_STEPS[agent].mark) ?? <GLYPH.AGENT />;
}

/** How many agents stand as rows while the read is out. */
const CLIENT_SKELETON_ROWS = 1;

/**
 * The section as it stands while the agents are read: a row to each agent
 * likely, ending in its ⋯, then Connect an app's two rows, the agent asked
 * for and its step.
 */
const SECTIONS_SKELETON: readonly SettingsSectionSkeletonShape[] = [
  {
    headed: true,
    rows: [
      ...Array.from({ length: CLIENT_SKELETON_ROWS }, () => ({
        described: true,
        controls: [],
        end: [SETTINGS_SKELETON_CONTROL.MORE],
      })),
      { described: false, controls: [SETTINGS_SKELETON_CONTROL.CHOICE] },
      { described: true, controls: [] },
    ],
  },
];

/** What an agent is called on its row: the name it registered under, or a plain one where it gave none. */
function clientName(client: McpClient): string {
  return client.name ?? PAGE_LINE.UNNAMED;
}

/**
 * Where an agent's sign-in returns to, each place once: the host the consent
 * page named, or This computer where it named an app on this computer, since
 * the row's line opens on it as a bare fact.
 */
function destinations(client: McpClient): string {
  const places = new Set(client.redirectUris.map(oauthRedirectDestination));
  return [...places]
    .map((place) => (place === ON_THIS_COMPUTER ? PAGE_LINE.THIS_COMPUTER : place))
    .join(", ");
}

/** An agent's line: where it returns to, when it was allowed, and when it last refreshed its access, where it has. */
function ClientLine({ client }: { client: McpClient }): React.JSX.Element {
  return (
    <>
      <ReplayMask>{destinations(client)}</ReplayMask>
      {client.allowedAt === null ? null : (
        <>
          {" · Allowed "}
          <Time at={client.allowedAt} look={TIME_LOOK.PROVENANCE} />
        </>
      )}
      {client.lastRefreshedAt === null ? null : (
        <>
          {" · Active "}
          <Time at={client.lastRefreshedAt} look={TIME_LOOK.AGO} />
        </>
      )}
    </>
  );
}

/** One agent the account allowed: its line and its ⋯ holding Disconnect, or, once revoked, how long what it holds lasts. */
function ClientRow({
  client,
  revoked,
  arrived,
  onRevoked,
}: {
  client: McpClient;
  revoked: boolean;
  /** Whether it was allowed while the page showed, which lights its row once. */
  arrived: boolean;
  onRevoked: (client: McpClient) => void;
}): React.JSX.Element {
  const { mutateAsync: sendMcpClientsRevoke, ...revoking } = useMutation(
    actMutation(ACT_KIND.MCP_CLIENTS_REVOKE),
  );
  const name = clientName(client);
  const [rejection, setRejection] = useState<string | undefined>(undefined);

  const refused: ActionResult = {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: `Revoking ${name} didn't finish. Try again.`,
  };
  const revoke = (): Promise<ActionResult> => {
    setRejection(undefined);
    return sendMcpClientsRevoke({ clientId: client.clientId }).then(
      (answer): ActionResult => {
        if ("failure" in answer) {
          setRejection(refused.reason);
          return refused;
        }
        onRevoked(client);
        return { status: ACTION_RESULT_STATUS.ACCEPTED };
      },
      () => {
        setRejection(refused.reason);
        return refused;
      },
    );
  };
  const confirmAct = useConfirmAct(revoking, {
    send: revoke,
    answered: (answer): ActionResult =>
      "failure" in answer ? refused : { status: ACTION_RESULT_STATUS.ACCEPTED },
    failed: () => refused,
  });
  const confirm = useConfirmDialog(
    { subject: !revoked, surfaceOpen: true },
    confirmAct,
    confirmFailure(FAILURE_SURFACE.MCP_CLIENT_REVOKE),
  );

  // Note that an agent that gave no name is called by the app's own words, which show in a screen recording.
  const named = client.name !== null;
  return (
    <>
      <MenuRow
        thing={name}
        actions={
          revoked
            ? []
            : [
                {
                  label: PAGE_LINE.DISCONNECT,
                  icon: <GLYPH.DISCONNECT />,
                  danger: true,
                  onSelect: confirm.ask,
                },
              ]
        }
        row={{
          leading: <SettingsRowMark>{clientMark(client)}</SettingsRowMark>,
          label: <ReplayWords masked={named}>{name}</ReplayWords>,
          description: revoked ? PAGE_LINE.REVOKED : <ClientLine client={client} />,
          error: refusedShown(rejection, FAILURE_SURFACE.MCP_CLIENT_REVOKE),
          landed: arrived,
        }}
      />
      <ConfirmDialog
        open
        confirm={confirm}
        question={{
          title: `Disconnect ${name}?`,
          body: `${name} can no longer use your ${PRODUCT_NAME} account. Access it already holds stops working within ${MCP_ACCESS_TOKEN_MINUTES} minutes.`,
          verb: "Disconnect agent",
          running: "Disconnecting",
          loss: CONFIRM_LOSS.AFFECTS_OTHERS,
          replayUnmasked: true,
          titleReplayMasked: named,
          bodyReplayMasked: named,
        }}
      />
    </>
  );
}

/** The agents the account allowed, and those revoked while the page shows, in the order they were allowed, newest first; never the `vespin` command, whose own Sign in section signs it out. */
function shownClients(
  listed: readonly McpClient[],
  revoked: ReadonlyMap<string, McpClient>,
): readonly McpClient[] {
  const standing = listed.filter(
    (client) =>
      client.clientId !== FIRST_PARTY_OAUTH_CLIENT_ID.CLI && !revoked.has(client.clientId),
  );
  return [...standing, ...revoked.values()].toSorted(
    (one, other) => (other.allowedAt ?? 0) - (one.allowedAt ?? 0),
  );
}

/**
 * One agent's two steps, and the wait for it to connect until it has: the
 * command or address to copy, or the link that installs it, then what is
 * done in the agent.
 */
function ConnectSteps({
  step,
  serverUrl,
  waiting,
}: {
  step: ConnectStep;
  serverUrl: string;
  waiting: boolean;
}): React.JSX.Element {
  const openLink = useOpenLink();
  const installUrl = step.install?.url(serverUrl);
  const copied = step.command?.(serverUrl) ?? (step.address === true ? serverUrl : undefined);
  return (
    <SettingsBlock>
      <OutsideSteps waiting={waiting ? connectWaiting(step) : undefined}>
        <Step number={1} title={step.first} state={STEP_STATE.CURRENT}>
          {step.install === undefined || installUrl === undefined ? null : (
            <OutsideLink href={installUrl} open={openLink}>
              {step.install.label}
            </OutsideLink>
          )}
          {copied === undefined ? null : (
            <CopyField
              label={step.command === undefined ? PAGE_LINE.SERVER : `${step.name} command`}
              value={copied}
              what={step.command === undefined ? "URL" : "command"}
              copy={copyThroughShell}
              width={COPY_FIELD_WIDTH.FULL}
              prompt={step.command === undefined ? COPY_FIELD_PROMPT.NONE : COPY_FIELD_PROMPT.SHELL}
            />
          )}
        </Step>
        <Step number={2} title={step.inAgent} state={STEP_STATE.CURRENT}>
          {step.note === undefined ? null : (
            <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              {step.note}
            </Text>
          )}
        </Step>
      </OutsideSteps>
    </SettingsBlock>
  );
}

/** What Connect an agent waits on: the agent picked, or any agent where none is named. */
function connectWaiting(step: ConnectStep): string {
  return step === CONNECT_STEPS[CONNECT_AGENT.OTHER]
    ? "Waiting for an agent to connect"
    : `Waiting for ${step.name} to connect`;
}

/** Connect an app's rows: which agent, that agent's one step, and the agent that just connected, once one has. */
function ConnectRows({
  serverUrl,
  arrived,
}: {
  serverUrl: string;
  arrived: McpClient | undefined;
}): React.JSX.Element {
  const [agent, setAgent] = useState<ConnectAgent>(CONNECT_AGENT.CLAUDE_CODE);
  return (
    <>
      <div {...searchAnchorProps(SETTINGS_SEARCH_ROW.MCP_CONNECT)}>
        <SettingsRow
          label={PAGE_LINE.CONNECT}
          below={() => (
            <ChoiceBar
              label={PAGE_LINE.AGENT}
              items={Object.values(CONNECT_AGENT).map((each) => ({
                value: each,
                label: CONNECT_STEPS[each].name,
                icon: CONNECT_STEPS[each].mark,
              }))}
              value={agent}
              look={CHOICE_BAR_LOOK.SEGMENTED}
              size={CHOICE_BAR_SIZE.COMPACT}
              onChange={setAgent}
            />
          )}
        />
      </div>
      <ConnectSteps
        step={CONNECT_STEPS[agent]}
        serverUrl={serverUrl}
        waiting={arrived === undefined}
      />
      {arrived === undefined ? null : (
        <SettingsLine>
          <SettingsRowStateLine state={SETTINGS_ROW_STATE.CONNECTED}>
            <ReplayWords masked={arrived.name !== null}>{clientName(arrived)}</ReplayWords> is
            connected.
          </SettingsRowStateLine>
        </SettingsLine>
      )}
    </>
  );
}

/**
 * The MCP section for the account signed in: the agents it allowed, or that
 * it has none yet, then Connect an app, as the CLI's section under it
 * stands its sign-in over its install.
 */
export function McpSection(): React.JSX.Element {
  const accountId = signedInAccountId(useQuery({ ...appStateQuery, select: selectAccount }).data);
  const read = useQuery(mcpClientsQuery(accountId));
  const retry = useMutation(mcpClientsRetryMutation());
  const rows = read.data;
  // The agents revoked while the page shows, which stand saying so after the read no longer lists them.
  const [revoked, setRevoked] = useState<ReadonlyMap<string, McpClient>>(new Map());
  // The agents the first read listed, so one allowed while the page shows is told apart as just connected.
  const [known, setKnown] = useState<ReadonlySet<string> | undefined>(undefined);
  if (rows !== undefined && known === undefined) {
    setKnown(new Set(rows.clients.map((client) => client.clientId)));
  }
  if (rows === undefined && !read.isError) {
    return (
      <SettingsSectionsSkeleton
        label={readingWords("the connected agents")}
        sections={SECTIONS_SKELETON}
      />
    );
  }
  const shown = rows === undefined ? [] : shownClients(rows.clients, revoked);
  const isNew = (client: McpClient) =>
    known !== undefined && !known.has(client.clientId) && !revoked.has(client.clientId);
  return (
    <SettingsSection {...settingsSectionHead(SECTION_HEAD.MCP_CLIENTS)} caption={SECTION.CAPTION}>
      {rows === undefined ? (
        <ReadFailed
          line={PAGE_LINE.READ_FAILED}
          surface={FAILURE_SURFACE.MCP_CLIENTS_READ}
          onRetry={() => retry.mutate()}
        />
      ) : (
        <>
          {shown.length === 0 ? (
            <SettingsLine>{PAGE_LINE.NONE}</SettingsLine>
          ) : (
            shown.map((client) => (
              <ClientRow
                key={client.clientId}
                client={client}
                revoked={revoked.has(client.clientId)}
                arrived={isNew(client)}
                onRevoked={(gone) =>
                  setRevoked((before) => new Map(before).set(gone.clientId, gone))
                }
              />
            ))
          )}
          <ConnectRows serverUrl={rows.serverUrl} arrived={shown.find(isNew)} />
        </>
      )}
    </SettingsSection>
  );
}
