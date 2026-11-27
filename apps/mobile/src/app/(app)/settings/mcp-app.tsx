// mcp-app.tsx -- one app the account let in over MCP, as iOS Settings opens a device from its row: its name over where it signs in from, when it was allowed and last active, and Disconnect alone in red at its foot, asked first; once disconnected it goes back to MCP & CLI, whose row says how long its access lasts.

import { signedInAccountId } from "@repo/credentials/snapshot";
import {
  listedMcpClients,
  MCP_CLIENTS_WORDS,
  mcpClientDestinations,
  mcpClientName,
  mcpClientRevokeQuestion,
  mcpClientRevokeRefused,
} from "@repo/features/mcp-clients-words";
import { agoText, provenanceText } from "@repo/features/time-format";
import { ACT_KIND } from "@repo/host/acts";
import { selectAccount, selectMcpClients } from "@repo/host/app-state-reads";
import {
  ActionRow,
  ConfirmAsk,
  ListSection,
  SCREEN_GROUND,
  Screen,
  SettingsForm,
  ValueRow,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { appStateQuery } from "../../../host/app-state-query.js";
import { useHostActs } from "../../../host/host-provider.js";
import { SETTINGS_ROUTE } from "../../../settings-button.js";
import { useWrite } from "../../../use-write.js";

export { ScreenBoundary as ErrorBoundary } from "../../../screen-boundary.js";

/** What the app's facts are called, each a row of its page. */
const FACT = {
  SIGNS_IN_FROM: "Signs in from",
  ALLOWED: "Allowed",
  LAST_ACTIVE: "Last active",
} as const;

/** The bar's title before the app is read: none, since its name comes with it. */
const NO_BAR_TITLE = "";

export default function McpAppScreen() {
  const { client: clientId = "" } = useLocalSearchParams<{ client: string }>();
  const { data: account } = useQuery({ ...appStateQuery, select: selectAccount });
  const accountId = account === undefined ? undefined : signedInAccountId(account);

  if (accountId === undefined) return null;

  return <McpAppPage key={accountId} accountId={accountId} clientId={clientId} />;
}

function McpAppPage({
  accountId,
  clientId,
}: {
  readonly accountId: string;
  readonly clientId: string;
}) {
  const acts = useHostActs();
  const write = useWrite();
  const router = useRouter();
  const [asking, setAsking] = useState(false);

  const { data: held } = useQuery({
    ...appStateQuery,
    select: useCallback(selectMcpClients(accountId), [accountId]),
  });

  const clients = held?.rows?.clients;

  const client =
    clients === undefined
      ? undefined
      : listedMcpClients(clients).find((each) => each.clientId === clientId);

  // Note that an app no longer listed, disconnected elsewhere or never there, has no page left, so it goes back to the list.
  const gone = clients !== undefined && client === undefined;

  useEffect(() => {
    if (gone && router.canGoBack()) router.back();
  }, [gone, router]);

  if (client === undefined) return <Stack.Screen options={{ title: NO_BAR_TITLE }} />;

  const name = mcpClientName(client);
  const now = Date.now();
  const destinations = mcpClientDestinations(client);

  // Note that a disconnect that went returns to MCP & CLI by its route, naming the app, so the list keeps its row saying its access ends soon, as a disconnect from the list's own row did.
  const disconnect = () =>
    void write(
      () =>
        acts[ACT_KIND.MCP_CLIENTS_REVOKE]({ clientId: client.clientId }).then((answer) => {
          if (!("failure" in answer)) {
            router.navigate({ pathname: SETTINGS_ROUTE.MCP, params: { revoked: client.clientId } });
          }

          return answer;
        }),
      {
        refused: (answer) => ("failure" in answer ? mcpClientRevokeRefused(name) : undefined),
        retry: true,
      },
    );

  const question = mcpClientRevokeQuestion(name);

  return (
    <>
      <Stack.Screen options={{ title: name }} />
      <Screen ground={SCREEN_GROUND.GROUPED}>
        <SettingsForm>
          <ListSection footer={MCP_CLIENTS_WORDS.CAPTION}>
            {destinations.length === 0 ? null : (
              <ValueRow label={FACT.SIGNS_IN_FROM} value={destinations} />
            )}
            {client.allowedAt === null ? null : (
              <ValueRow label={FACT.ALLOWED} value={provenanceText(client.allowedAt, now)} />
            )}
            {client.lastRefreshedAt === null ? null : (
              <ValueRow label={FACT.LAST_ACTIVE} value={agoText(client.lastRefreshedAt, now)} />
            )}
          </ListSection>
          <ListSection>
            <ActionRow
              label={MCP_CLIENTS_WORDS.DISCONNECT}
              destructive
              onPress={() => setAsking(true)}
            />
          </ListSection>
        </SettingsForm>
      </Screen>
      <ConfirmAsk
        title={question.title}
        message={question.body}
        act={question.verb}
        destructive
        presented={asking}
        onDismiss={() => setAsking(false)}
        onAct={() => {
          setAsking(false);
          disconnect();
        }}
      />
    </>
  );
}
