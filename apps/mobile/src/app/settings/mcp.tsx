// mcp.tsx -- Settings' MCP page: the apps the account allowed to use Vespin over MCP, each by its name, where it signs in from, and when it was allowed and last active, and Disconnect, asked first; an app is connected from the computer it runs on, so the phone offers no Connect.

import { signedInAccountId } from "@repo/credentials/snapshot";
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
import { agoText, provenanceText } from "@repo/features/time-format";
import { readingWords, VERB } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { selectAccount } from "@repo/host/app-state-reads";
import {
  ConfirmAsk,
  ConnectionRow,
  EmptyState,
  ListSection,
  Screen,
  SettingsForm,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { appStateQuery } from "../../host/app-state-query.js";
import { useHostActs } from "../../host/host-provider.js";
import { useLiveFollow } from "../../host/live-follow.js";
import { useWrite } from "../../use-write.js";

export { ScreenBoundary as ErrorBoundary } from "../../screen-boundary.js";

/** What the page says while it reads the apps, as the panel names it. */
const READING = readingWords("the connected apps");

/** The glyph a page of connected apps stands under. */
const MCP_SYMBOL = "app.connected.to.app.below.fill";

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
  const [asked, setAsked] = useState<McpClient | undefined>(undefined);
  // The apps disconnected while the page stands, which keep their row saying how long their access lasts, as the panel's do.
  const [revoked, setRevoked] = useState<ReadonlyMap<string, McpClient>>(new Map());
  useLiveFollow(accountId, () => acts[ACT_KIND.MCP_CLIENTS_FOLLOW]());

  const { data: held } = useQuery({
    ...appStateQuery,
    select: useCallback(heldClients(accountId), [accountId]),
  });

  const clients = held?.rows?.clients;
  const now = Date.now();

  const shown =
    clients === undefined
      ? []
      : [
          ...listedMcpClients(clients).filter((client) => !revoked.has(client.clientId)),
          ...revoked.values(),
        ].toSorted((one, other) => (other.allowedAt ?? 0) - (one.allowedAt ?? 0));

  const revoke = (client: McpClient) =>
    void write(
      () =>
        acts[ACT_KIND.MCP_CLIENTS_REVOKE]({ clientId: client.clientId }).then((answer) => {
          if (!("failure" in answer)) {
            setRevoked((now) => new Map(now).set(client.clientId, client));
          }

          return answer;
        }),
      {
        refused: (answer) =>
          "failure" in answer ? mcpClientRevokeRefused(mcpClientName(client)) : undefined,
        retry: true,
      },
    );

  const body =
    clients === undefined ? (
      held?.failed === true ? (
        <EmptyState
          title={MCP_CLIENTS_WORDS.READ_FAILED}
          symbol="exclamationmark.triangle"
          action={{
            label: VERB.RETRY,
            onPress: () =>
              void acts[ACT_KIND.MCP_CLIENTS_RETRY]().catch((cause: unknown) =>
                console.error("Reading the connected apps again did not go.", cause),
              ),
          }}
        />
      ) : (
        <EmptyState title={READING} symbol={MCP_SYMBOL} loading />
      )
    ) : (
      <SettingsForm>
        <ListSection
          count={shown.length}
          footer={shown.length === 0 ? MCP_CLIENTS_WORDS.NONE : MCP_CLIENTS_WORDS.CAPTION}
        >
          {shown.map((client) =>
            revoked.has(client.clientId) ? (
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
                    onPress: () => setAsked(client),
                  },
                ]}
              />
            ),
          )}
        </ListSection>
      </SettingsForm>
    );

  const question = mcpClientRevokeQuestion(asked === undefined ? "" : mcpClientName(asked));

  return (
    <>
      <Screen>{body}</Screen>
      <ConfirmAsk
        title={question.title}
        message={question.body}
        act={question.verb}
        destructive
        presented={asked !== undefined}
        onDismiss={() => setAsked(undefined)}
        onAct={() => {
          if (asked === undefined) return;
          const client = asked;
          setAsked(undefined);
          revoke(client);
        }}
      />
    </>
  );
}
