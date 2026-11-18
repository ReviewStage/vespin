// mcp.tsx -- Settings' MCP & CLI page, as the panel's: the apps the account allowed to use the service over MCP, each by its name, where it signs in from, and when it was allowed and last active, and Disconnect, asked first; then the command-line tool, its sign-in with Sign out everywhere, or how to install it and sign it in, each command to copy. An app is connected from the computer it runs on, so the phone offers no Connect.

import { ACCOUNT_STATUS, signedInAccountId } from "@repo/credentials/snapshot";
import { CLI_COMMAND } from "@repo/features/cli-release";
import { CLI_SIGN_OUT_QUESTION, CLI_WORDS } from "@repo/features/cli-words";
import { LIVE_READ } from "@repo/features/live-wire";
import type { McpClient } from "@repo/features/mcp-client-wire";
import {
  listedMcpClients,
  MCP_CLIENTS_WORDS,
  mcpClientDestinations,
  mcpClientName,
  mcpClientRevokeQuestion,
  mcpClientRevokeRefused,
} from "@repo/features/mcp-clients-words";
import { FIRST_PARTY_OAUTH_CLIENT_ID } from "@repo/features/oauth-client-ids";
import { agoText, provenanceText } from "@repo/features/time-format";
import { readingWords } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { selectAccount } from "@repo/host/app-state-reads";
import {
  ActionRow,
  BUZZ,
  buzz,
  ConfirmAsk,
  ConnectionRow,
  FOOTER_TONE,
  ListSection,
  LoadingRow,
  SCREEN_GROUND,
  Screen,
  SettingsForm,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { setStringAsync } from "expo-clipboard";
import { useCallback, useState } from "react";
import { appStateQuery } from "../../host/app-state-query.js";
import { useHostActs } from "../../host/host-provider.js";
import { useLiveFollow } from "../../host/live-follow.js";
import { useWrite } from "../../use-write.js";

export { ScreenBoundary as ErrorBoundary } from "../../screen-boundary.js";

/** What the page says while it reads the apps, as the panel names it. */
const READING = readingWords("the connected apps");

/** What a command's row offers, which puts the command on the pasteboard for the computer it runs on. */
const COPY_WORD = "Copy";

/** What a Try again under a read that failed says. */
const TRY_AGAIN = "Try again";

/** Copies a command, with the system's tap of success, or says why it did not go. */
function copyCommand(command: string) {
  setStringAsync(command).then(
    () => buzz(BUZZ.SUCCESS),
    (cause: unknown) => console.error("The command was not copied.", cause),
  );
}

/** The command-line tool's own sign-in among the clients the account allowed, where it holds one, which the MCP list leaves out. */
function cliGrant(clients: readonly McpClient[]): McpClient | undefined {
  return clients.find((client) => client.clientId === FIRST_PARTY_OAUTH_CLIENT_ID.CLI);
}

/** The command's sign-in's line: signed in, and when it was last active, or else when it was allowed, as the panel's line reads. */
function grantLine(grant: McpClient, now: number): string {
  if (grant.lastRefreshedAt !== null) {
    return `${CLI_WORDS.SIGNED_IN} · Active ${agoText(grant.lastRefreshedAt, now)}`;
  }

  return grant.allowedAt === null
    ? CLI_WORDS.SIGNED_IN
    : `${CLI_WORDS.SIGNED_IN} ${provenanceText(grant.allowedAt, now)}`;
}

/** The command's install, and its sign-in where it has none, each with its command to copy, as the panel's steps say them. */
function CliSteps({ signedIn }: { readonly signedIn: boolean }) {
  return (
    <>
      <ConnectionRow
        name={CLI_WORDS.INSTALL_LABEL}
        lines={[{ text: CLI_COMMAND.NPM_INSTALL }, { text: CLI_WORDS.INSTALL_NPM }]}
        act={{ label: COPY_WORD, onPress: () => copyCommand(CLI_COMMAND.NPM_INSTALL) }}
      />
      {signedIn ? null : (
        <ConnectionRow
          name={CLI_WORDS.SIGN_IN_LABEL}
          lines={[{ text: CLI_COMMAND.LOGIN }, { text: CLI_WORDS.SIGN_IN_WORDS }]}
          act={{ label: COPY_WORD, onPress: () => copyCommand(CLI_COMMAND.LOGIN) }}
        />
      )}
    </>
  );
}

/** The apps the host holds for the account, as a `select`; none until read. */
function heldClients(accountId: string) {
  return (state: AppStateSnapshot) => state[LIVE_READ.MCP_CLIENTS][accountId];
}

/** An app's line: where it signs in from, when it was allowed, and when it last refreshed its access, where it has, as the panel's line reads. */
function clientLine(client: McpClient, now: number): string {
  return [
    mcpClientDestinations(client),
    ...(client.allowedAt === null ? [] : [`Allowed ${provenanceText(client.allowedAt, now)}`]),
    ...(client.lastRefreshedAt === null ? [] : [`Active ${agoText(client.lastRefreshedAt, now)}`]),
  ]
    .filter((part) => part.length > 0)
    .join(" · ");
}

export default function McpScreen() {
  const { data: account } = useQuery({ ...appStateQuery, select: selectAccount });
  const accountId = account === undefined ? undefined : signedInAccountId(account);

  if (accountId === undefined) return null;

  return <McpPage key={accountId} accountId={accountId} />;
}

function McpPage({ accountId }: { readonly accountId: string }) {
  const acts = useHostActs();
  const write = useWrite();
  const { data: account } = useQuery({ ...appStateQuery, select: selectAccount });
  // The sign-in asked of before it goes: an app's Disconnect, or the command's Sign out everywhere.
  const [asked, setAsked] = useState<{ readonly client: McpClient; readonly cli: boolean }>();
  // The apps disconnected while the page stands, which keep their row saying how long their access lasts, as the panel's do.
  const [revoked, setRevoked] = useState<ReadonlyMap<string, McpClient>>(new Map());
  // The command's sign-in signed out while the page stands, by when it was allowed, which stays signed out until the read drops it or a new sign-in replaces it.
  const [signedOutAt, setSignedOutAt] = useState<number | null | undefined>(undefined);
  useLiveFollow(accountId, () => acts[ACT_KIND.MCP_CLIENTS_FOLLOW]());

  const { data: held } = useQuery({
    ...appStateQuery,
    select: useCallback(heldClients(accountId), [accountId]),
  });

  const clients = held?.rows?.clients;
  const now = Date.now();
  const live = clients === undefined ? [] : listedMcpClients(clients);
  const listedGrant = clients === undefined ? undefined : cliGrant(clients);

  const grant =
    listedGrant === undefined ||
    (signedOutAt !== undefined && listedGrant.allowedAt === signedOutAt)
      ? undefined
      : listedGrant;

  const email = account?.status === ACCOUNT_STATUS.SIGNED_IN ? account.email : undefined;

  // Note that a disconnected app keeps its row only while the list shows that same grant or none; one that signed in again under its id comes back with a newer grant, and its live row with Disconnect.
  const standing = new Map(
    [...revoked].filter(([clientId, gone]) => {
      const row = live.find((client) => client.clientId === clientId);

      return row === undefined || row.allowedAt === gone.allowedAt;
    }),
  );

  const shown =
    clients === undefined
      ? []
      : [...live.filter((client) => !standing.has(client.clientId)), ...standing.values()].toSorted(
          (one, other) => (other.allowedAt ?? 0) - (one.allowedAt ?? 0),
        );

  const revoke = ({ client, cli }: { readonly client: McpClient; readonly cli: boolean }) =>
    void write(
      () =>
        acts[ACT_KIND.MCP_CLIENTS_REVOKE]({ clientId: client.clientId }).then((answer) => {
          if (!("failure" in answer)) {
            if (cli) setSignedOutAt(client.allowedAt);
            else setRevoked((now) => new Map(now).set(client.clientId, client));
          }

          return answer;
        }),
      {
        refused: (answer) =>
          !("failure" in answer)
            ? undefined
            : cli
              ? CLI_WORDS.SIGN_OUT_REFUSED
              : mcpClientRevokeRefused(mcpClientName(client)),
        retry: true,
      },
    );

  const retryRead = () =>
    void acts[ACT_KIND.MCP_CLIENTS_RETRY]().catch((cause: unknown) =>
      console.error("Reading the connected apps again did not go.", cause),
    );

  const mcpSection =
    clients === undefined ? (
      held?.failed === true ? (
        <ListSection
          title={MCP_CLIENTS_WORDS.TITLE}
          footer={MCP_CLIENTS_WORDS.READ_FAILED}
          footerTone={FOOTER_TONE.FAILURE}
        >
          <ActionRow label={TRY_AGAIN} onPress={retryRead} />
        </ListSection>
      ) : (
        <ListSection title={MCP_CLIENTS_WORDS.TITLE}>
          <LoadingRow words={READING} />
        </ListSection>
      )
    ) : (
      // Note that no app connected says so in the section's footer, with what the section is for, as iOS Settings says a list has none.
      <ListSection
        title={MCP_CLIENTS_WORDS.TITLE}
        footer={
          shown.length === 0
            ? `${MCP_CLIENTS_WORDS.NONE} ${MCP_CLIENTS_WORDS.CAPTION}`
            : MCP_CLIENTS_WORDS.CAPTION
        }
      >
        {shown.map((client) =>
          standing.has(client.clientId) ? (
            <ConnectionRow
              key={client.clientId}
              name={mcpClientName(client)}
              lines={[{ text: MCP_CLIENTS_WORDS.REVOKED }]}
            />
          ) : (
            <ConnectionRow
              key={client.clientId}
              name={mcpClientName(client)}
              lines={[{ text: clientLine(client, now) }]}
              menu={[
                {
                  label: MCP_CLIENTS_WORDS.DISCONNECT,
                  destructive: true,
                  onPress: () => setAsked({ client, cli: false }),
                },
              ]}
            />
          ),
        )}
      </ListSection>
    );

  // Note that the CLI section waits on the same read, since the command's sign-in is one of the clients the account allowed; until then it offers the steps alone.
  const cliSection = (
    <ListSection
      title={CLI_WORDS.TITLE}
      footer={
        clients === undefined && held?.failed === true
          ? CLI_WORDS.READ_FAILED
          : grant === undefined || email === undefined
            ? `${CLI_WORDS.NOT_SIGNED_IN} ${CLI_WORDS.CAPTION}`
            : CLI_WORDS.CAPTION
      }
    >
      {grant === undefined || email === undefined ? null : (
        <ConnectionRow
          name={email}
          lines={[{ text: grantLine(grant, now) }]}
          menu={[
            {
              label: CLI_WORDS.SIGN_OUT,
              destructive: true,
              onPress: () => setAsked({ client: grant, cli: true }),
            },
          ]}
        />
      )}
      <CliSteps signedIn={grant !== undefined && email !== undefined} />
    </ListSection>
  );

  const question =
    asked?.cli === true
      ? CLI_SIGN_OUT_QUESTION
      : mcpClientRevokeQuestion(asked === undefined ? "" : mcpClientName(asked.client));

  return (
    <>
      <Screen ground={SCREEN_GROUND.GROUPED}>
        <SettingsForm>
          {mcpSection}
          {cliSection}
        </SettingsForm>
      </Screen>
      <ConfirmAsk
        title={question.title}
        message={question.body}
        act={question.verb}
        destructive
        presented={asked !== undefined}
        onDismiss={() => setAsked(undefined)}
        onAct={() => {
          if (asked === undefined) return;
          const was = asked;
          setAsked(undefined);
          revoke(was);
        }}
      />
    </>
  );
}
