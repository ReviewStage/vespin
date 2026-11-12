// integrations.tsx -- Settings' Integrations page: each of the account's servers under Connected and Not connected, as the panel's page lists them; a connected server's tools read to say whether it works, with Try again where they couldn't be read; Connect opening the provider's sign-in in the system's authentication sheet, a sign-in waited on with Cancel, an account renamed where the provider holds several, and Disconnect asked first.

import {
  namedServers,
  SERVER_ROW,
  type ServerRow,
  searchServers,
  serverGroups,
  serverRows,
} from "@repo/features/agent-servers-model";
import {
  CONNECTION_HEALTH,
  type ConnectionHealth,
  connectionHealth,
} from "@repo/features/integration-health";
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
  INTEGRATION_LABEL_MAX,
  INTEGRATION_NAME,
  INTEGRATION_PURPOSE,
  INTEGRATION_STATUS,
  type IntegrationProvider,
  integrationAccountLabel,
  integrationConnectionOf,
} from "@repo/features/integration-wire";
import { readingWords, VERB } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import {
  askForName,
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
import {
  type IntegrationToolReads,
  useIntegrationTools,
} from "../../integrations/use-integration-tools.js";
import { useWrite } from "../../use-write.js";

export { ScreenBoundary as ErrorBoundary } from "../../screen-boundary.js";

/** What the page says while it reads the integrations, as the panel's skeleton names it. */
const READING = readingWords("the integrations");

/** The glyph a page of integrations stands under. */
const INTEGRATIONS_SYMBOL = "puzzlepiece.extension";

/** The health of a server whose name this build can't read, which no tools read stands under. */
const UNREAD_HEALTH: ConnectionHealth = { kind: CONNECTION_HEALTH.CHECKING };

/** No server switched off, since the page switches none for an agent. */
const NONE_OFF: readonly string[] = [];

/** What the rename alert asks, by the provider whose account it renames: "Rename Notion account". */
function renameTitle(provider: IntegrationProvider): string {
  return `${INTEGRATION_ROW_WORDS.RENAME} ${INTEGRATION_NAME[provider]} account`;
}

/**
 * A label cut to what the service keeps, on whole characters so an emoji
 * isn't split, and trimmed again so a cut never leaves a space at its end.
 */
function cutLabel(typed: string): string {
  let kept = "";

  for (const character of typed) {
    if (kept.length + character.length > INTEGRATION_LABEL_MAX) break;
    kept += character;
  }

  return kept.trim();
}

/** Whether the provider rides the account's own GitHub sign-in, which the desktop and the web connect. */
function bySignIn(provider: IntegrationProvider): boolean {
  return INTEGRATION_GRANT_OF[provider] === INTEGRATION_GRANT.GITHUB_SIGN_IN;
}

/** What a connected row says while its server's tools are read, and once they answered with tools, as the panel's row says it. */
function connectedWords(health: ConnectionHealth): string {
  return health.kind === CONNECTION_HEALTH.CHECKING
    ? INTEGRATION_ROW_WORDS.CHECKING
    : INTEGRATION_STATUS_WORDS[INTEGRATION_STATUS.CONNECTED];
}

/** A row's lines: where it stands or what it is for, the server's or the sign-in's own words under that, and why the last act on it did not go. */
function rowLines(
  row: ServerRow,
  health: ConnectionHealth,
  refusal: string | undefined,
): readonly ConnectionLine[] {
  const standing: ConnectionLine | undefined =
    row.problem !== undefined
      ? { text: row.problem, problem: true }
      : row.note !== undefined
        ? { text: row.note }
        : row.kind === SERVER_ROW.SWITCH
          ? { text: connectedWords(health) }
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

  // Note that every connected server's tools are read while the page stands, as the panel's page reads them, since a grant that stands says nothing of whether its server takes it.
  const tools = useIntegrationTools(
    namedServers({
      statusOf: statuses.statusOf,
      accountsOf: statuses.accountsOf,
      standing: (status) => status === INTEGRATION_STATUS.CONNECTED,
    }).map((server) => server.connection),
  );

  const healthOf = (server: string): ConnectionHealth => {
    const provider = integrationConnectionOf(server)?.provider;

    return provider === undefined
      ? UNREAD_HEALTH
      : connectionHealth(provider, tools.readOf(server));
  };

  const page = useIntegrationActs(statuses, tools, healthOf, setAsked);

  const rows = serverRows({
    statusOf: statuses.statusOf,
    healthOf,
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
                lines={rowLines(row, healthOf(row.connection), page.refusals.get(row.connection))}
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
 * it; Retry at the end of a connected one whose tools couldn't be read;
 * Cancel at the end of one waited on, Reopen in its menu; and, on one
 * connected, Rename where the provider holds several accounts, Add another
 * account where the provider offers it, and Disconnect, which asks first
 * (`onAsk`). A server that rides the account's GitHub sign-in offers only its
 * Retry here, as the desktop and the web connect it.
 */
function useIntegrationActs(
  statuses: IntegrationStatuses,
  tools: IntegrationToolReads,
  healthOf: (server: string) => ConnectionHealth,
  onAsk: (row: ServerRow) => void,
) {
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

  /**
   * Asks for an account's new label in the system's name alert, opened on
   * the label it has, as the panel renames it in place; the host draws the
   * label asked at once, and a refusal puts the old one back and is said
   * under the row. Note that a label past what the service keeps is cut to
   * it (`cutLabel`), as the panel's field takes no more.
   */
  const askRename = (row: ServerRow, account: NonNullable<ServerRow["account"]>) =>
    askForName({
      title: renameTitle(row.provider),
      act: INTEGRATION_ROW_WORDS.RENAME,
      name: integrationAccountLabel(account),
      onName: (typed) => {
        const label = cutLabel(typed);
        said(row.connection, undefined);
        void write(
          () =>
            acts[ACT_KIND.INTEGRATIONS_RENAME]({
              provider: row.provider,
              connection: row.connection,
              label,
            }),
          {
            refused: (answer) =>
              "failure" in answer ? INTEGRATION_REFUSED.RENAME(row.name) : undefined,
            inPlace: (words) => said(row.connection, words),
          },
        );
      },
    });

  const actOf = (
    row: ServerRow,
  ): { label: string; disabled: boolean; onPress: () => void } | undefined => {
    // Note that a connected server whose tools our own service couldn't read offers to read them again, as the panel's row offers Retry, whoever granted it.
    if (
      row.kind === SERVER_ROW.SWITCH &&
      healthOf(row.connection).kind === CONNECTION_HEALTH.FAILED
    ) {
      return { label: VERB.RETRY, disabled: false, onPress: () => tools.retry(row.connection) };
    }

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
    // Note that an expired account is told by its standing, as the panel's ⋯ tells it, so one whose sign-in again failed keeps its menu.
    const expired = statuses.statusOf(row.connection) === INTEGRATION_STATUS.EXPIRED;

    if (!connected && !expired) return [];

    const { account } = row;

    // Note that the menu stands in the panel's ⋯ order: Rename and Add another account, then Reconnect, then Disconnect. A working connection is signed in again from it; a broken one carries Reconnect as its own button.
    return [
      ...(row.accounts > 1 && account !== undefined
        ? [{ label: INTEGRATION_ROW_WORDS.RENAME, onPress: () => askRename(row, account) }]
        : []),
      ...(statuses.canAdd(row.provider)
        ? [{ label: INTEGRATION_ROW_WORDS.ADD_ACCOUNT, onPress: () => connect(row, true) }]
        : []),
      ...(row.kind === SERVER_ROW.SWITCH
        ? [{ label: INTEGRATION_ROW_WORDS.RECONNECT, onPress: () => connect(row) }]
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
