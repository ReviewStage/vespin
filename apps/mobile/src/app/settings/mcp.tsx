// mcp.tsx -- Settings' MCP & CLI page, as the panel's: the apps the account allowed to use the service over MCP, each by its name over when it was last active, opening its own page with Disconnect; then the command-line tool, its sign-in with Sign out everywhere as a row of its own, and how to install it and sign it in, each command copied by a row of its own. An app is connected from the computer it runs on, so the phone offers no Connect.

import { ACCOUNT_STATUS, signedInAccountId } from "@repo/credentials/snapshot";
import { CLI_COMMAND } from "@repo/features/cli-release";
import { CLI_SIGN_OUT_QUESTION, CLI_WORDS } from "@repo/features/cli-words";
import type { McpClient } from "@repo/features/mcp-client-wire";
import {
  listedMcpClients,
  MCP_CLIENTS_WORDS,
  mcpClientDestinations,
  mcpClientName,
} from "@repo/features/mcp-clients-words";
import { FIRST_PARTY_OAUTH_CLIENT_ID } from "@repo/features/oauth-client-ids";
import { agoText, provenanceText } from "@repo/features/time-format";
import { readingWords } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import { selectAccount, selectMcpClients } from "@repo/host/app-state-reads";
import {
  ActionRow,
  BUZZ,
  buzz,
  ConfirmAsk,
  ConnectionRow,
  GLYPH,
  ListSection,
  LoadingRow,
  ReadFailedSection,
  SCREEN_GROUND,
  Screen,
  SettingsForm,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { setStringAsync } from "expo-clipboard";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { appStateQuery } from "../../host/app-state-query.js";
import { useHostActs } from "../../host/host-provider.js";
import { useLiveFollow } from "../../host/live-follow.js";
import { SETTINGS_ROUTE } from "../../settings-button.js";
import { useWrite } from "../../use-write.js";

export { ScreenBoundary as ErrorBoundary } from "../../screen-boundary.js";

/** What the page says while it reads the apps, as the panel names it. */
const READING = readingWords("the connected apps");

/** What each command's row says, which puts the command on the pasteboard for the computer it runs on. */
const COPY_COMMAND = {
  INSTALL: "Copy install command",
  SIGN_IN: "Copy sign-in command",
} as const;

/** What the CLI section says under its rows: how to install the command and sign it in, the commands spelled out, as the panel's steps say them. */
function cliFooter(signedIn: boolean): string {
  const install = `${CLI_WORDS.INSTALL_LABEL} with ${CLI_COMMAND.NPM_INSTALL}. ${CLI_WORDS.INSTALL_NPM}`;

  return signedIn
    ? `${CLI_WORDS.CAPTION} ${install}`
    : `${CLI_WORDS.NOT_SIGNED_IN} ${install} Then run ${CLI_COMMAND.LOGIN}. ${CLI_WORDS.SIGN_IN_WORDS}`;
}

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
    return `Active ${agoText(grant.lastRefreshedAt, now)}`;
  }

  return grant.allowedAt === null
    ? CLI_WORDS.SIGNED_IN
    : `${CLI_WORDS.SIGNED_IN} ${provenanceText(grant.allowedAt, now)}`;
}

/** The command's install, and its sign-in where it has none, each copied by a row of its own, as an iOS Settings act stands as its own row rather than a button inside one. */
function CliSteps({ signedIn }: { readonly signedIn: boolean }) {
  return (
    <>
      <ActionRow
        label={COPY_COMMAND.INSTALL}
        symbol={GLYPH.COPY}
        onPress={() => copyCommand(CLI_COMMAND.NPM_INSTALL)}
      />
      {signedIn ? null : (
        <ActionRow
          label={COPY_COMMAND.SIGN_IN}
          symbol={GLYPH.COPY}
          onPress={() => copyCommand(CLI_COMMAND.LOGIN)}
        />
      )}
    </>
  );
}

/** An app's line, one plain phrase: when it was last active, else when it was allowed, else where it signs in from; its page holds the rest. */
function clientLine(client: McpClient, now: number): string {
  if (client.lastRefreshedAt !== null) return `Active ${agoText(client.lastRefreshedAt, now)}`;

  return client.allowedAt === null
    ? mcpClientDestinations(client)
    : `Allowed ${provenanceText(client.allowedAt, now)}`;
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
  // The command's sign-in, asked of before Sign out everywhere takes it, as an app's own page asks before its Disconnect.
  const [asked, setAsked] = useState<McpClient | undefined>(undefined);
  const router = useRouter();
  // The app the page came back from disconnecting, which its row keeps saying how long its access lasts.
  const { revoked: revokedId } = useLocalSearchParams<{ revoked?: string }>();
  // The apps disconnected while the page stands, which keep their row saying how long their access lasts, as the panel's do.
  const [revoked, setRevoked] = useState<ReadonlyMap<string, McpClient>>(new Map());
  // The command's sign-in signed out while the page stands, by when it was allowed, which stays signed out until the read drops it or a new sign-in replaces it.
  const [signedOutAt, setSignedOutAt] = useState<number | null | undefined>(undefined);
  useLiveFollow(accountId, () => acts[ACT_KIND.MCP_CLIENTS_FOLLOW]());

  const { data: held } = useQuery({
    ...appStateQuery,
    select: useCallback(selectMcpClients(accountId), [accountId]),
  });

  const clients = held?.rows?.clients;
  const now = Date.now();
  const live = clients === undefined ? [] : listedMcpClients(clients);

  // Note that an app disconnected on its own page comes back named by the route, so its row says its access ends soon, as one disconnected here would; the name is then let go, so a later read drops the row.
  const cameBack =
    revokedId === undefined ? undefined : live.find((each) => each.clientId === revokedId);

  useEffect(() => {
    if (revokedId === undefined) return;

    if (cameBack !== undefined) setRevoked((now) => new Map(now).set(cameBack.clientId, cameBack));
    router.setParams({ revoked: undefined });
  }, [revokedId, cameBack, router]);
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

  const signOut = (client: McpClient) =>
    void write(
      () =>
        acts[ACT_KIND.MCP_CLIENTS_REVOKE]({ clientId: client.clientId }).then((answer) => {
          if (!("failure" in answer)) setSignedOutAt(client.allowedAt);

          return answer;
        }),
      {
        refused: (answer) => ("failure" in answer ? CLI_WORDS.SIGN_OUT_REFUSED : undefined),
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
        <ReadFailedSection
          title={MCP_CLIENTS_WORDS.TITLE}
          words={MCP_CLIENTS_WORDS.READ_FAILED}
          onRetry={retryRead}
        />
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
              onOpen={() =>
                router.push({
                  pathname: SETTINGS_ROUTE.MCP_APP,
                  params: { client: client.clientId },
                })
              }
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
          : cliFooter(grant !== undefined && email !== undefined)
      }
    >
      {grant === undefined || email === undefined ? null : (
        <>
          <ConnectionRow name={email} lines={[{ text: grantLine(grant, now) }]} />
          <ActionRow label={CLI_WORDS.SIGN_OUT} destructive onPress={() => setAsked(grant)} />
        </>
      )}
      <CliSteps signedIn={grant !== undefined && email !== undefined} />
    </ListSection>
  );

  return (
    <>
      <Screen ground={SCREEN_GROUND.GROUPED}>
        <SettingsForm>
          {mcpSection}
          {cliSection}
        </SettingsForm>
      </Screen>
      <ConfirmAsk
        title={CLI_SIGN_OUT_QUESTION.title}
        message={CLI_SIGN_OUT_QUESTION.body}
        act={CLI_SIGN_OUT_QUESTION.verb}
        destructive
        presented={asked !== undefined}
        onDismiss={() => setAsked(undefined)}
        onAct={() => {
          if (asked === undefined) return;
          const was = asked;
          setAsked(undefined);
          signOut(was);
        }}
      />
    </>
  );
}
