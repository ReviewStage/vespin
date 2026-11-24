// integration.tsx -- one connection's own page, as iOS Settings opens an account from its row: its mark, name and where it stands, what it gives agents, its acts in the ink, and Disconnect alone in red at its foot, asked first.

import { SERVER_ROW } from "@repo/features/agent-servers-model";
import {
  INTEGRATION_ROW_WORDS,
  INTEGRATIONS_PAGE_WORDS,
} from "@repo/features/integration-settings-words";
import { INTEGRATION_STATUS_WORDS } from "@repo/features/integration-status-words";
import { INTEGRATION_PURPOSE, INTEGRATION_STATUS } from "@repo/features/integration-wire";
import { readingWords } from "@repo/features/words";
import {
  ActionRow,
  ConfirmAsk,
  ConnectionRow,
  EmptyState,
  GLYPH,
  INTEGRATION_MARK_ASSET,
  ListSection,
  SCREEN_GROUND,
  Screen,
  SettingsForm,
} from "@repo/ui-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import {
  disconnectAsked,
  opensPage,
  rowLines,
  useIntegrations,
} from "../../../integrations/use-integrations-page.js";

export { ScreenBoundary as ErrorBoundary } from "../../../screen-boundary.js";

/** What the page says while it reads the integrations, as Integrations says it. */
const READING = readingWords("the integrations");

/** The bar's title before the connection is read: none, since its name comes with it. */
const NO_BAR_TITLE = "";

export default function IntegrationScreen() {
  const { connection = "" } = useLocalSearchParams<{ connection: string }>();
  const router = useRouter();
  const { statuses, page, rows, asked, setAsked } = useIntegrations();
  const row = rows.find((each) => each.connection === connection);

  // Note that a sign-in begun here (Reconnect, Try again) keeps the page while it is waited on, with its Cancel and Reopen, as the row kept them.
  const shown =
    statuses.answer !== undefined &&
    row !== undefined &&
    (opensPage(row, statuses) || row.kind === SERVER_ROW.SIGNING_IN);

  // Note that a connection disconnected, here or elsewhere, has no page left, so it goes back to the list, where it stands under Not connected or is gone.
  const gone = statuses.answer !== undefined && !shown;

  useEffect(() => {
    if (gone && router.canGoBack()) router.back();
  }, [gone, router]);

  const question = disconnectAsked(asked);

  if (!shown || row === undefined) {
    return (
      <>
        <Stack.Screen options={{ title: NO_BAR_TITLE }} />
        <Screen ground={SCREEN_GROUND.GROUPED}>
          {statuses.answer !== undefined ? null : statuses.readFailed ? (
            <EmptyState
              title={INTEGRATIONS_PAGE_WORDS.READ_FAILED}
              symbol={GLYPH.FAILED}
              retry={page.retry}
            />
          ) : (
            <EmptyState title={READING} symbol={GLYPH.PLUG} loading />
          )}
        </Screen>
      </>
    );
  }

  const busy = page.busy.has(row.connection);
  const act = page.actOf(row);
  const lines = rowLines(row, page.refusals.get(row.connection));

  // Note that a connection that works says so on its own page, where the list's Connected header no longer stands over it.
  const said =
    lines.length === 0 ? [{ text: INTEGRATION_STATUS_WORDS[INTEGRATION_STATUS.CONNECTED] }] : lines;

  // Note that the page keeps its acts while one is out, dimmed, rather than dropping them as a row's menu does.
  const acts = [
    ...(act === undefined ? [] : [act]),
    ...page
      .menuOf(row, true)
      .filter((each) => each.destructive !== true)
      .map((each) => ({ label: each.label, disabled: busy, onPress: each.onPress })),
  ];

  return (
    <>
      <Stack.Screen options={{ title: row.name }} />
      <Screen ground={SCREEN_GROUND.GROUPED}>
        <SettingsForm>
          <ListSection footer={INTEGRATION_PURPOSE[row.provider]}>
            <ConnectionRow
              name={row.name}
              mark={INTEGRATION_MARK_ASSET[row.provider]}
              lines={said}
            />
          </ListSection>
          {acts.length === 0 ? null : (
            <ListSection>
              {acts.map((each) => (
                <ActionRow
                  key={each.label}
                  label={each.label}
                  disabled={each.disabled}
                  onPress={each.onPress}
                />
              ))}
            </ListSection>
          )}
          {row.kind === SERVER_ROW.SIGNING_IN ? null : (
            <ListSection>
              <ActionRow
                label={INTEGRATION_ROW_WORDS.DISCONNECT}
                destructive
                centered
                disabled={busy}
                onPress={() => setAsked(row)}
              />
            </ListSection>
          )}
        </SettingsForm>
      </Screen>
      <ConfirmAsk
        title={question?.title ?? ""}
        message={question?.body}
        act={question?.verb ?? ""}
        destructive
        presented={asked !== undefined}
        onDismiss={() => setAsked(undefined)}
        onAct={() => {
          if (asked === undefined) return;
          const asking = asked;
          setAsked(undefined);
          page.disconnect(asking);
        }}
      />
    </>
  );
}
