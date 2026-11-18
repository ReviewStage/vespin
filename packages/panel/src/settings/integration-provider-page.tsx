import { namedServers, serverRows } from "@repo/features/agent-servers-model";
import { connectionHealth } from "@repo/features/integration-health";
import {
  INTEGRATION_ROW_WORDS,
  INTEGRATIONS_PAGE_WORDS,
} from "@repo/features/integration-settings-words";
import {
  INTEGRATION_ACCOUNTS_MAX,
  INTEGRATION_NAME,
  INTEGRATION_STATUS,
  type IntegrationProvider,
} from "@repo/features/integration-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { readingWords } from "@repo/features/words";
import {
  BUTTON_VARIANT,
  Button,
  GAP,
  ProviderMark,
  SETTINGS_ROW_MARK_WIDTH,
  SETTINGS_SKELETON_CONTROL,
  SettingsRow,
  SettingsRowMark,
  SettingsSection,
  type SettingsSectionSkeletonLayout,
  SettingsSectionsSkeleton,
  Stack,
} from "@repo/ui";
import { PlusIcon } from "@repo/ui/icons";
import { grantedBySignIn } from "../integration-grant.js";
import {
  IntegrationAccountRow,
  IntegrationDisconnectRow,
  IntegrationRow,
  useRowGrant,
} from "../integration-row.js";
import { type IntegrationStatuses, useIntegrationStatuses } from "../integration-statuses.js";
import { useIntegrationToolReads } from "../integration-tools.js";
import { ReadFailed } from "./marks.js";
import { SECTION, settingsSectionHead } from "./settings-sections.js";

/**
 * integration-provider-page.tsx -- Settings › Integrations › one provider: the accounts the account holds there, what each needs, and the way to end each.
 *
 * The list's row of a provider the account holds an account at opens this
 * page (`integrations-page.tsx`), as do Settings' search, ⌘K, and a link
 * naming it (`/settings/integrations/<provider>`). It holds what each
 * account's ⋯ held on the list before, in its own place:
 *
 * - The provider's accounts, headed "<Provider> accounts", each a row named
 *   by the account (`IntegrationAccountRow`), its ⋯ keeping Rename where
 *   there are several and Reconnect while it stands quiet, and its button
 *   what it needs next: Reconnect for an expired sign-in or a connection a
 *   sign-in mends, Reopen and Cancel while the browser is waited on, Try
 *   again after one that did not finish, Retry where its tools could not be
 *   read. Add account stands in the section's head where the provider
 *   offers another, and an account it adds waits as a row of its own.
 * - Last, where the provider holds one account, its Disconnect, a danger
 *   outline that asks first; where it holds several, each account's ⋯
 *   keeps its own Disconnect instead, so the page stays one row an account.
 *
 * A provider the account holds nothing at stands as the list's own row
 * for it, with Connect, so a link landing here before the sign-in does
 * still offers it; one the deployment does not offer says it isn't
 * available here, as Workspace's pages do.
 */

/** What the page says where the deployment does not offer the provider to the account, as a link written for another deployment lands on it. */
const NOT_OFFERED = (name: string) => `${name} isn't available here.`;

/** What Add account says in the accounts' head, and while its sign-in is begun. */
const ADD_ACCOUNT = {
  PRESS: "Add account",
  RUNNING: "Opening the sign-in",
} as const;

/** What stands while where the provider stands is read: its accounts' section, one account in it, then its Disconnect. */
const PROVIDER_SKELETON: readonly SettingsSectionSkeletonLayout[] = [
  {
    headed: true,
    rows: [{ described: false, mark: SETTINGS_ROW_MARK_WIDTH, controls: [], end: [] }],
  },
  {
    headed: false,
    rows: [{ described: true, controls: [SETTINGS_SKELETON_CONTROL.BUTTON] }],
  },
];

/** Whether the service holds the account a server names, connected or expired. */
function heldBy(statuses: IntegrationStatuses, server: string): boolean {
  const status = statuses.statusOf(server);

  return status === INTEGRATION_STATUS.CONNECTED || status === INTEGRATION_STATUS.EXPIRED;
}

/** The provider's page once where it stands has been read. */
export function IntegrationProviderPage({
  provider,
}: {
  provider: IntegrationProvider;
}): React.JSX.Element {
  const statuses = useIntegrationStatuses();
  const name = INTEGRATION_NAME[provider];

  const { reads, retry } = useIntegrationToolReads(
    namedServers({
      statusOf: statuses.statusOf,
      accountsOf: statuses.accountsOf,
      standing: (status) => status === INTEGRATION_STATUS.CONNECTED,
    })
      .filter((server) => server.provider === provider)
      .map((server) => server.connection),
  );

  const adding = useRowGrant(statuses, { provider, connection: provider, name });
  const healthOf = (server: string) => connectionHealth(provider, reads[server]);
  const status = statuses.statusOf(provider);

  if (status === undefined && !statuses.readFailed) {
    return (
      <SettingsSectionsSkeleton
        label={readingWords("the integrations")}
        sections={PROVIDER_SKELETON}
      />
    );
  }

  if (statuses.readFailed) {
    return (
      <SettingsSection>
        <ReadFailed
          line={INTEGRATIONS_PAGE_WORDS.READ_FAILED}
          surface={FAILURE_SURFACE.INTEGRATIONS_READ}
          onRetry={() => void statuses.read()}
        />
      </SettingsSection>
    );
  }

  if (status === INTEGRATION_STATUS.UNAVAILABLE) {
    return (
      <SettingsSection>
        <SettingsRow
          leading={
            <SettingsRowMark>
              <ProviderMark provider={provider} />
            </SettingsRowMark>
          }
          label={name}
          description={NOT_OFFERED(name)}
        />
      </SettingsSection>
    );
  }

  const rows = serverRows({
    statusOf: statuses.statusOf,
    healthOf,
    signInOf: statuses.signInOf,
    accountsOf: statuses.accountsOf,
    readFailed: statuses.readFailed,
    disabled: [],
  }).filter((row) => row.provider === provider);

  const held = rows.filter((row) => heldBy(statuses, row.connection));

  // A provider the account holds nothing at stands as the list draws it, with Connect.
  if (held.length === 0) {
    return (
      <SettingsSection>
        {rows.map((row) => (
          <IntegrationRow
            key={row.connection}
            row={row}
            status={statuses.statusOf(row.connection)}
            health={healthOf(row.connection)}
            statuses={statuses}
            onRetryTools={() => retry(row.connection)}
          />
        ))}
      </SettingsSection>
    );
  }

  const addable =
    !grantedBySignIn(provider) &&
    statuses.canAdd(provider) &&
    (rows[0]?.accounts ?? 0) < INTEGRATION_ACCOUNTS_MAX;

  return (
    <Stack gap={GAP.PAGE}>
      <SettingsSection
        {...settingsSectionHead(SECTION.INTEGRATION_ACCOUNTS, { group: `${name} accounts` })}
        action={
          addable ? (
            <Button
              variant={BUTTON_VARIANT.OUTLINE}
              icon={<PlusIcon />}
              label={`${INTEGRATION_ROW_WORDS.ADD_ACCOUNT} at ${name}`}
              busy={adding.busy}
              busyLabel={ADD_ACCOUNT.RUNNING}
              onClick={adding.add}
            >
              {ADD_ACCOUNT.PRESS}
            </Button>
          ) : undefined
        }
      >
        {rows.map((row, at) => (
          <IntegrationAccountRow
            key={row.connection}
            row={row}
            statuses={statuses}
            health={healthOf(row.connection)}
            // Note that Add account's refusal is said under the first account, the row nearest the press, and a search result lands there.
            refusal={at === 0 ? adding.rejection : undefined}
            anchor={at === 0 ? provider : undefined}
            leaves={held.length > 1}
            onRetryTools={() => retry(row.connection)}
          />
        ))}
      </SettingsSection>
      {/* Note that one account's Disconnect stands last as a row of its own, while several accounts each keep theirs in their ⋯, so two accounts are never four rows. */}
      {held.length === 1 && held[0] !== undefined ? (
        <SettingsSection>
          <IntegrationDisconnectRow row={held[0]} />
        </SettingsSection>
      ) : null}
    </Stack>
  );
}
