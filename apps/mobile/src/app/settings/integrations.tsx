// integrations.tsx -- Settings' Integrations page: each of the account's servers under Connected and Not connected, as the panel's page lists them; Connect opening the provider's sign-in in the system's authentication sheet, a sign-in waited on with Cancel, and Disconnect asked first.

import {
  SERVER_ROW,
  type ServerRow,
  searchServers,
  serverGroups,
  serverRows,
} from "@repo/features/agent-servers-model";
import { CONNECTION_HEALTH, type ConnectionHealth } from "@repo/features/integration-health";
import {
  disconnectQuestion,
  grantLabel,
  INTEGRATION_REFUSED,
  INTEGRATION_ROW_WORDS,
  INTEGRATIONS_PAGE_WORDS,
} from "@repo/features/integration-settings-words";
import { SIGN_IN, SIGN_IN_ACTION } from "@repo/features/integration-sign-in";
import { INTEGRATION_STATUS_WORDS } from "@repo/features/integration-status-words";
import { INTEGRATION_CALL_FAILURE } from "@repo/features/integration-view";
import {
  INTEGRATION_GRANT,
  INTEGRATION_GRANT_OF,
  INTEGRATION_PURPOSE,
  INTEGRATION_STATUS,
  type IntegrationProvider,
  integrationConnectionOf,
} from "@repo/features/integration-wire";
import { readingWords, VERB } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import {
  ConfirmAsk,
  type ConnectionLine,
  ConnectionRow,
  EmptyState,
  ListSection,
  type MemberRowAct,
  Screen,
  SettingsForm,
} from "@repo/ui-native";
import { Stack } from "expo-router";
import { useState } from "react";
import { useHostActs } from "../../host/host-provider.js";
import {
  type IntegrationStatuses,
  useIntegrationStatuses,
} from "../../integrations/use-integration-statuses.js";
import { useWrite } from "../../use-write.js";

export { ScreenBoundary as ErrorBoundary } from "../../screen-boundary.js";

/** What the page says while it reads the integrations, as the panel's skeleton names it. */
const READING = readingWords("the integrations");

/** The glyph a page of integrations stands under. */
const INTEGRATIONS_SYMBOL = "puzzlepiece.extension";

/** A server's health on the phone, which reads no tools: its connection's standing alone says whether it is connected. */
const UNREAD_HEALTH: ConnectionHealth = { kind: CONNECTION_HEALTH.CHECKING };

/** No server switched off, since the page switches none for an agent. */
const NONE_OFF: readonly string[] = [];

/** Whether the provider rides the account's own GitHub sign-in, which the desktop and the web connect. */
function bySignIn(provider: IntegrationProvider): boolean {
  return INTEGRATION_GRANT_OF[provider] === INTEGRATION_GRANT.GITHUB_SIGN_IN;
}

/** A row's lines: where it stands or what it is for, the server's or the sign-in's own words under that, and why the last act on it did not go. */
function rowLines(row: ServerRow, refusal: string | undefined): readonly ConnectionLine[] {
  const standing: ConnectionLine | undefined =
    row.problem !== undefined
      ? { text: row.problem, problem: true }
      : row.note !== undefined
        ? { text: row.note }
        : row.kind === SERVER_ROW.SWITCH
          ? { text: INTEGRATION_STATUS_WORDS[INTEGRATION_STATUS.CONNECTED] }
          : row.kind === SERVER_ROW.RECONNECT
            ? { text: INTEGRATION_STATUS_WORDS[INTEGRATION_STATUS.EXPIRED], problem: true }
            : row.kind === SERVER_ROW.CONNECT
              ? { text: INTEGRATION_PURPOSE[row.provider] }
              : undefined;

  return [
    ...(standing === undefined ? [] : [standing]),
    ...(row.said === undefined ? [] : [{ text: row.said }]),
    ...(bySignIn(row.provider) ? [{ text: INTEGRATION_ROW_WORDS.GITHUB_SIGN_IN }] : []),
    ...(refusal === undefined ? [] : [{ text: refusal, problem: true }]),
  ];
}

export default function IntegrationsScreen() {
  const statuses = useIntegrationStatuses();
  const [query, setQuery] = useState("");
  const [asked, setAsked] = useState<ServerRow | undefined>(undefined);
  const page = useIntegrationActs(statuses, setAsked);

  const rows = serverRows({
    statusOf: statuses.statusOf,
    healthOf: () => UNREAD_HEALTH,
    signInOf: (server) => statuses.signIns.get(server),
    accountsOf: statuses.accountsOf,
    readFailed: statuses.readFailed,
    disabled: NONE_OFF,
  });

  const found = searchServers(rows, query);

  const body =
    statuses.answer === undefined ? (
      statuses.readFailed ? (
        <EmptyState
          title={INTEGRATIONS_PAGE_WORDS.READ_FAILED}
          symbol="exclamationmark.triangle"
          action={{ label: VERB.RETRY, onPress: page.retry }}
        />
      ) : (
        <EmptyState title={READING} symbol={INTEGRATIONS_SYMBOL} loading />
      )
    ) : rows.length === 0 ? (
      <EmptyState title={INTEGRATIONS_PAGE_WORDS.NONE_OFFERED} symbol={INTEGRATIONS_SYMBOL} />
    ) : found.length === 0 ? (
      <EmptyState title={INTEGRATIONS_PAGE_WORDS.NO_MATCH(query)} symbol="magnifyingglass" />
    ) : (
      <SettingsForm>
        {serverGroups(found).map((group) => (
          <ListSection key={group.heading ?? ""} title={group.heading} count={group.rows.length}>
            {group.rows.map((row) => (
              <ConnectionRow
                key={row.connection}
                name={row.name}
                lines={rowLines(row, page.refusals.get(row.connection))}
                act={page.actOf(row)}
                menu={page.menuOf(row)}
              />
            ))}
          </ListSection>
        ))}
      </SettingsForm>
    );

  const question =
    asked === undefined
      ? undefined
      : disconnectQuestion(asked.name, asked.provider, {
          bySignIn: bySignIn(asked.provider),
          several: asked.accounts > 1 && asked.account !== undefined,
        });

  return (
    <>
      <Stack.Screen>
        <Stack.SearchBar
          placeholder={INTEGRATIONS_PAGE_WORDS.SEARCH}
          onChangeText={(event) => setQuery(event.nativeEvent.text)}
          onCancelButtonPress={() => setQuery("")}
        />
      </Stack.Screen>
      <Screen>{body}</Screen>
      <ConfirmAsk
        title={question?.title ?? ""}
        message={question?.body}
        act={question?.verb ?? ""}
        destructive
        presented={asked !== undefined}
        onDismiss={() => setAsked(undefined)}
        onAct={() => {
          if (asked === undefined) return;
          const row = asked;
          setAsked(undefined);
          page.disconnect(row);
        }}
      />
    </>
  );
}

/**
 * What each row offers, and why its last act did not go: a grant (Connect,
 * Reconnect, or Try again) at its end, which opens the sign-in and waits on
 * it; Cancel at the end of one waited on, Reopen in its menu; and, on one
 * connected, Add another account where the provider offers it and
 * Disconnect, which asks first (`onAsk`). A server that rides the account's
 * GitHub sign-in offers nothing here, as the desktop and the web connect it.
 */
function useIntegrationActs(statuses: IntegrationStatuses, onAsk: (row: ServerRow) => void) {
  const acts = useHostActs();
  const write = useWrite();
  // Why each row's last act did not go, by its server, said under it in place.
  const [refusals, setRefusals] = useState<ReadonlyMap<string, string>>(new Map());

  const said = (server: string, words: string | undefined) =>
    setRefusals((now) => {
      const next = new Map(now);

      if (words === undefined) next.delete(server);
      else next.set(server, words);

      return next;
    });

  // The rows whose act is out, which take no second press until it answers, as the panel holds a row busy.
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());

  /** Runs `act` for `server` unless one is out for it, holding the row busy until it settles. */
  const held = (server: string, act: () => Promise<boolean>) => {
    if (busy.has(server)) return;
    setBusy((now) => new Set(now).add(server));
    void act().finally(() =>
      setBusy((now) => {
        const next = new Set(now);
        next.delete(server);

        return next;
      }),
    );
  };

  const connect = (row: ServerRow, add = false) => {
    const { provider, connection, name } = row;
    const place = integrationConnectionOf(connection)?.place ?? 1;
    // Note that an added account the service no longer holds, its first sign-in having ended, is signed in afresh as a new one, as the panel's grant begins it; one still waiting is reopened under its own name.
    const ended = statuses.signIns.get(connection)?.kind !== SIGN_IN.WAITING;
    const anew = add || (place > 1 && !statuses.listed(connection) && ended);
    said(connection, undefined);
    held(connection, () =>
      write(
        () =>
          acts[ACT_KIND.INTEGRATIONS_CONNECT]({
            provider,
            ...(anew ? { add: true } : connection === provider ? undefined : { connection }),
          }).then((answer) => {
            if (!("failure" in answer)) statuses.signInBegun(answer.connection ?? connection);

            return answer;
          }),
        {
          refused: (answer) =>
            "failure" in answer
              ? answer.failure === INTEGRATION_CALL_FAILURE.NOT_OPENED
                ? INTEGRATION_ROW_WORDS.NOT_OPENED
                : INTEGRATION_REFUSED.CONNECT(name)
              : undefined,
          inPlace: (words) => said(connection, words),
        },
      ),
    );
  };

  const cancel = (row: ServerRow) => {
    said(row.connection, undefined);
    held(row.connection, () =>
      statuses.cancelSignIn(row.connection).then((canceled) => {
        if (!canceled) said(row.connection, INTEGRATION_REFUSED.CANCEL(row.name));

        return canceled;
      }),
    );
  };

  const disconnect = (row: ServerRow) => {
    const { provider, connection, name } = row;
    said(connection, undefined);
    held(connection, () =>
      write(
        () =>
          acts[ACT_KIND.INTEGRATIONS_DISCONNECT]({
            provider,
            ...(connection === provider ? undefined : { connection }),
          }),
        {
          refused: (answer) =>
            "failure" in answer ? INTEGRATION_REFUSED.DISCONNECT(name) : undefined,
          inPlace: (words) => said(connection, words),
        },
      ),
    );
  };

  const actOf = (
    row: ServerRow,
  ): { label: string; disabled: boolean; onPress: () => void } | undefined => {
    if (bySignIn(row.provider)) return undefined;
    const disabled = busy.has(row.connection);

    switch (row.kind) {
      case SERVER_ROW.CONNECT:
      case SERVER_ROW.RECONNECT:
      case SERVER_ROW.TRY_AGAIN:
        return {
          label: grantLabel(
            statuses.statusOf(row.connection),
            statuses.signIns.get(row.connection),
          ),
          disabled,
          onPress: () => connect(row),
        };
      case SERVER_ROW.SIGNING_IN:
        return { label: SIGN_IN_ACTION.CANCEL, disabled, onPress: () => cancel(row) };
      case SERVER_ROW.SWITCH:
      case SERVER_ROW.QUIET:
      case SERVER_ROW.RETRY:
        return undefined;
    }
  };

  const menuOf = (row: ServerRow): readonly MemberRowAct[] => {
    if (bySignIn(row.provider)) return [];

    if (row.kind === SERVER_ROW.SIGNING_IN) {
      return [{ label: SIGN_IN_ACTION.REOPEN, onPress: () => connect(row) }];
    }

    const connected = statuses.statusOf(row.connection) === INTEGRATION_STATUS.CONNECTED;
    const expired = row.kind === SERVER_ROW.RECONNECT;

    if (!connected && !expired) return [];

    // Note that a working connection is signed in again from its menu, as the panel's ⋯ offers it; a broken one carries Reconnect as its own button.
    return [
      ...(row.kind === SERVER_ROW.SWITCH
        ? [{ label: INTEGRATION_ROW_WORDS.RECONNECT, onPress: () => connect(row) }]
        : []),
      ...(statuses.canAdd(row.provider)
        ? [{ label: INTEGRATION_ROW_WORDS.ADD_ACCOUNT, onPress: () => connect(row, true) }]
        : []),
      { label: INTEGRATION_ROW_WORDS.DISCONNECT, destructive: true, onPress: () => onAsk(row) },
    ];
  };

  const retry = () =>
    void acts[ACT_KIND.INTEGRATIONS_RETRY]().catch((cause: unknown) =>
      console.error("Reading the integrations again did not go.", cause),
    );

  return { refusals, actOf, menuOf, disconnect, retry };
}
