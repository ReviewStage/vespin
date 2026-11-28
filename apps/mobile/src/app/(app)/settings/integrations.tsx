// integrations.tsx -- Settings' Integrations page: each of the account's servers under Connected and Not connected, as the panel's page lists them; a connected one opening its own page, as iOS Settings opens an account, one to connect a press of its own that opens the provider's sign-in, one waited on with Cancel, and a search across them.

import {
  SERVER_ROW,
  type ServerRow,
  searchServers,
  serverGroups,
} from "@repo/features/agent-servers-model";
import { INTEGRATIONS_PAGE_WORDS } from "@repo/features/integration-settings-words";
import { readingWords } from "@repo/features/words";
import {
  ConnectionRow,
  EmptyState,
  GLYPH,
  INTEGRATION_MARK_ASSET,
  ListSection,
  PUSH_ROW_GOES,
  SCREEN_GROUND,
  Screen,
  SettingsForm,
} from "@repo/ui-native";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import {
  opensPage,
  rowLines,
  useIntegrations,
} from "../../../integrations/use-integrations-page.js";
import { SETTINGS_ROUTE } from "../../../settings-button.js";

export { ScreenBoundary as ErrorBoundary } from "../../../screen-boundary.js";

/** What the page says while it reads the integrations, as the panel's skeleton names it. */
const READING = readingWords("the integrations");

/** The glyph a page of integrations stands under. */
const INTEGRATIONS_SYMBOL = GLYPH.PLUG;

/** The rows whose act connects them, by the provider's sign-in out of the app: Connect, Reconnect, and Try again after one that did not go. */
const CONNECTS: ReadonlySet<ServerRow["kind"]> = new Set([
  SERVER_ROW.CONNECT,
  SERVER_ROW.RECONNECT,
  SERVER_ROW.TRY_AGAIN,
]);

/**
 * A row that opens no page of its own: one to connect, the whole row one
 * press ending in the arrow out, as iOS Settings stands "Add Account" rather
 * than a button inside a row, held while its last press is out; else its act
 * at its end, such as a sign-in's Cancel while it is waited on.
 */
function IntegrationRow({
  row,
  page,
}: {
  readonly row: ServerRow;
  readonly page: ReturnType<typeof useIntegrations>["page"];
}) {
  const act = page.actOf(row);
  const lines = rowLines(row, page.refusals.get(row.connection));
  const mark = INTEGRATION_MARK_ASSET[row.provider];

  if (act !== undefined && CONNECTS.has(row.kind)) {
    return (
      <ConnectionRow
        name={row.name}
        mark={mark}
        lines={lines}
        goes={PUSH_ROW_GOES.OUT}
        onOpen={() => {
          if (!act.disabled) act.onPress();
        }}
      />
    );
  }

  return (
    <ConnectionRow name={row.name} mark={mark} lines={lines} act={act} menu={page.menuOf(row)} />
  );
}

export default function IntegrationsScreen() {
  const router = useRouter();
  const { statuses, page, rows } = useIntegrations();
  const [query, setQuery] = useState("");
  const found = searchServers(rows, query);

  const open = (connection: string) =>
    router.push({ pathname: SETTINGS_ROUTE.INTEGRATION, params: { connection } });

  const body =
    statuses.answer === undefined ? (
      statuses.readFailed ? (
        <EmptyState
          title={INTEGRATIONS_PAGE_WORDS.READ_FAILED}
          symbol={GLYPH.FAILED}
          retry={page.retry}
        />
      ) : (
        <EmptyState title={READING} symbol={INTEGRATIONS_SYMBOL} loading />
      )
    ) : rows.length === 0 ? (
      <EmptyState title={INTEGRATIONS_PAGE_WORDS.NONE_OFFERED} symbol={INTEGRATIONS_SYMBOL} />
    ) : found.length === 0 ? (
      <EmptyState title={INTEGRATIONS_PAGE_WORDS.NO_MATCH(query)} symbol={GLYPH.SEARCH} />
    ) : (
      <SettingsForm>
        {serverGroups(found).map((group) => (
          <ListSection key={group.heading ?? ""} title={group.heading} count={group.rows.length}>
            {group.rows.map((row) =>
              opensPage(row, statuses) ? (
                <ConnectionRow
                  key={row.connection}
                  name={row.name}
                  mark={INTEGRATION_MARK_ASSET[row.provider]}
                  lines={rowLines(row, page.refusals.get(row.connection))}
                  onOpen={() => open(row.connection)}
                />
              ) : (
                <IntegrationRow key={row.connection} row={row} page={page} />
              ),
            )}
          </ListSection>
        ))}
      </SettingsForm>
    );

  return (
    <>
      <Stack.Screen>
        <Stack.SearchBar
          placeholder={INTEGRATIONS_PAGE_WORDS.SEARCH}
          onChangeText={(event) => setQuery(event.nativeEvent.text)}
          onCancelButtonPress={() => setQuery("")}
        />
      </Stack.Screen>
      <Screen ground={SCREEN_GROUND.GROUPED}>{body}</Screen>
    </>
  );
}
