import {
  namedServers,
  providerGroups,
  type ServerRow,
  searchServers,
  serverRows,
} from "@repo/features/agent-servers-model";
import { type ConnectionHealth, connectionHealth } from "@repo/features/integration-health";
import { INTEGRATIONS_PAGE_WORDS } from "@repo/features/integration-settings-words";
import {
  INTEGRATION_NAME,
  INTEGRATION_PROVIDER,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_STATUS,
  integrationConnectionOf,
} from "@repo/features/integration-wire";
import { searchTokens } from "@repo/features/search-tokens";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { readingWords, SIGNED_OUT_WORDS } from "@repo/features/words";
import type { SettingsSubPage } from "@repo/settings/settings-views";
import { APP_COMMAND, APP_SHORTCUTS } from "@repo/settings/shortcuts";
import {
  ANNOUNCE,
  commandKeyshortcuts,
  GAP,
  SETTINGS_ROW_MARK_WIDTH,
  SETTINGS_SKELETON_CONTROL,
  SearchField,
  SettingsSection,
  type SettingsSectionSkeletonLayout,
  SettingsSectionsSkeleton,
  Shortcut,
  Stack,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { useRef, useState } from "react";
import { useAppCommand } from "../app-commands.js";
import { IntegrationLinkRow, IntegrationRow } from "../integration-row.js";
import { type IntegrationStatuses, useIntegrationStatuses } from "../integration-statuses.js";
import { useIntegrationToolReads } from "../integration-tools.js";
import { focusSearchField } from "../search-field.js";
import { useAnnounceShown } from "../use-announce-shown.js";
import { IntegrationProviderPage } from "./integration-provider-page.js";
import { ReadFailed } from "./marks.js";
import { SECTION, settingsSectionHead } from "./settings-sections.js";

/**
 * integrations-page.tsx -- Settings › Integrations: the services the account connects so our agents can use them.
 *
 * One row per provider, under Connected or Not connected as the MCP popover
 * sections its servers (`@repo/features/agent-servers-model`'s
 * `providerGroups`), each section in the order of the providers' names. A
 * provider the account holds an account at is one row that opens its page
 * (`IntegrationLinkRow`, `integration-provider-page.tsx`), however many
 * accounts it holds: its mark, its name, beside it the accounts' names
 * where they carry any ("Personal and Work"), and under it what it gives
 * agents, or where an account needs the developer, that account's problem
 * in the attention tint, with the one control that mends it before the ›:
 * Reconnect for a sign-in expired or a connection a sign-in mends, Reopen
 * and Cancel while its sign-in is waited on, Retry where its tools could
 * not be read. Its page holds what each account's ⋯ once did, Rename,
 * Reconnect, Add account, and Disconnect. A provider it holds nothing at is
 * the row every surface connects it from (`IntegrationRow`): what it gives
 * agents, and Connect; a sign-in begun waits on the browser with Reopen and
 * Cancel, and one that failed or never finished says so with Try again
 * (`integration-sign-in.ts`). A row that connects or disconnects moves
 * from one section into the other at once. A connection is said to work only once its server
 * answered with its tools; one whose server answered why it would not says
 * why instead (`integration-health.ts`). GitHub is granted by the
 * account's own GitHub (`integration-grant.ts`), which lets agents use
 * GitHub's tools as the developer and is linked nowhere else: its Connect
 * links that GitHub in the browser, and its Disconnect unlinks it under the
 * Mac's session, a refusal saying why in a toast. A workspace's
 * repositories are not this; they come from the GitHub connected in
 * Settings › Workspace. The window never sees a sign-in address; the host
 * opens it. Where every connection stands is read once for the page
 * (`integration-statuses.ts`), when it is drawn and whenever the window is
 * focused, which is how the developer comes back from the browser. A
 * provider this deployment does not offer the account has no row, as its
 * agents are never handed it. Every line is fixed by the build, but for
 * the one-line reason a provider's server gave, which the service passes
 * on only where it carries no credential. Agents are handed a connected
 * integration's every tool, so the page lists none: it says only whether
 * the connection works.
 *
 * The page has a search of its own above its rows, for the integrations,
 * apart from Settings' search in the sidebar, which finds pages and rows: it
 * finds what the MCP popover's search finds, by the same words
 * (`@repo/features/agent-servers-model`'s `searchServers`). Command-F lands in it
 * while the page shows, and Escape clears it, then lets go of the caret.
 * While a query stands, the page keeps only the providers it found, an
 * account's name finding its provider, in their sections, the words
 * marked; a query that finds nothing says so. Settings'
 * own search hands its query down when one of its results opens a row here
 * (`../desktop/desktop-settings.tsx`).
 *
 * The search is `@repo/ui`'s `SearchField`, each section its
 * `SettingsSection`, a provider held its `SettingsLinkRow` and one not
 * `MenuRow`'s `SettingsRow`, each led by the provider's mark, its line the
 * row's description. A row's Connect,
 * Reconnect, Try again, and Cancel are the outline `Button`, and Reopen the
 * quiet one beside Cancel.
 */

/** The page's search: the query standing in its field, held by Settings so its own search can hand one down. */
export interface IntegrationsFilter {
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
}

/** How the page's search field is found by the seek that lands Command-F's caret in it. */
const FILTER_INPUT_ID = "integrations-filter-input";

/** What the page's search field asks for. */
const FILTER_PLACEHOLDER = INTEGRATIONS_PAGE_WORDS.SEARCH;

const PAGE_LINE = {
  SIGNED_OUT: SIGNED_OUT_WORDS,
  READ_FAILED: INTEGRATIONS_PAGE_WORDS.READ_FAILED,
  NONE_OFFERED: INTEGRATIONS_PAGE_WORDS.NONE_OFFERED,
} as const;

/** How many of the offered providers' rows stand as connected while the statuses are read; the rest stand as not. */
const CONNECTED_SKELETON_ROWS = 2;

/**
 * The sections that stand while the statuses are read, a row to each offered
 * provider: a few connected, each ending in the › that opens its page, and the
 * rest not, each in its Connect under the line saying what it gives agents,
 * every one led by its mark, so the rows land in the height they
 * stood in.
 */
const INTEGRATIONS_SKELETON: readonly SettingsSectionSkeletonLayout[] = [
  {
    headed: true,
    rows: INTEGRATION_PROVIDER_LIST.slice(0, CONNECTED_SKELETON_ROWS).map(() => ({
      described: true,
      mark: SETTINGS_ROW_MARK_WIDTH,
      controls: [],
      end: [SETTINGS_SKELETON_CONTROL.MORE],
    })),
  },
  {
    headed: true,
    rows: INTEGRATION_PROVIDER_LIST.slice(CONNECTED_SKELETON_ROWS).map(() => ({
      described: true,
      mark: SETTINGS_ROW_MARK_WIDTH,
      controls: [SETTINGS_SKELETON_CONTROL.BUTTON],
    })),
  },
];

/** The provider a server name that parses as none would be drawn as; never reached, since every row's name is minted from a provider. */
const GITHUB = INTEGRATION_PROVIDER.GITHUB;

/**
 * The page's search field: a magnifier, the field, and a clear button while
 * a query stands, else Command-F's chord, which lands the caret here while
 * the page shows. Escape clears a query, then lets go of the caret, kept in
 * the field either way so it never leaves Settings behind it.
 */
function FilterField({ filter }: { filter: IntegrationsFilter }): React.JSX.Element {
  const field = useRef<HTMLInputElement | null>(null);
  const { query, onQueryChange } = filter;
  useAppCommand(APP_COMMAND.FIND, () => focusSearchField(FILTER_INPUT_ID));

  return (
    <search>
      <SearchField
        ref={field}
        id={FILTER_INPUT_ID}
        label={FILTER_PLACEHOLDER}
        placeholder={FILTER_PLACEHOLDER}
        keyShortcuts={commandKeyshortcuts(APP_COMMAND.FIND)}
        value={query}
        onChange={onQueryChange}
        shortcut={<Shortcut chord={APP_SHORTCUTS[APP_COMMAND.FIND].chord} />}
        onClear={() => onQueryChange("")}
        onEscape={() => {
          if (query.length > 0) onQueryChange("");
          else field.current?.blur();
        }}
      />
    </search>
  );
}

/** What stands where the search finds nothing, said politely as it lands and as the query changes. */
function NoMatchNote({ query }: { query: string }): React.JSX.Element {
  const words = INTEGRATIONS_PAGE_WORDS.NO_MATCH(query);
  useAnnounceShown(ANNOUNCE.POLITE, words);

  // Note that the note quotes the query, so it stays masked in a screen recording.
  return (
    <ReplayMask>
      <PageNote>{words}</PageNote>
    </ReplayMask>
  );
}

/**
 * Every offered provider's row, once where they stand has been read, so each
 * row is drawn whole at once, under the page's search; a read that failed
 * draws them all, offering nothing, and says so above them, with the way to
 * read again. A provider read as unavailable is not offered to the account
 * and has no row.
 */
function IntegrationRows({
  filter,
  onOpen,
}: {
  filter: IntegrationsFilter;
  onOpen: (provider: SettingsSubPage) => void;
}): React.JSX.Element {
  const statuses = useIntegrationStatuses();

  const { reads, retry } = useIntegrationToolReads(
    namedServers({
      statusOf: statuses.statusOf,
      accountsOf: statuses.accountsOf,
      standing: (status) => status === INTEGRATION_STATUS.CONNECTED,
    }).map((server) => server.connection),
  );

  const { query } = filter;

  const read = INTEGRATION_PROVIDER_LIST.some((provider) => statuses.statusOf(provider));

  if (!read && !statuses.readFailed) {
    return (
      <SettingsSectionsSkeleton
        label={readingWords("the integrations")}
        sections={INTEGRATIONS_SKELETON}
      />
    );
  }

  const healthOf = (server: string) =>
    connectionHealth(integrationConnectionOf(server)?.provider ?? GITHUB, reads[server]);

  // Note that the providers stand in the order of their names within each
  // section, so no provider is pinned above the rest by the order its value
  // set happens to list it in, and a provider's accounts keep their own order,
  // which its page lists them in.
  const rows = serverRows({
    statusOf: statuses.statusOf,
    healthOf,
    signInOf: statuses.signInOf,
    accountsOf: statuses.accountsOf,
    readFailed: statuses.readFailed,
    disabled: [],
  }).toSorted((one, other) =>
    INTEGRATION_NAME[one.provider].localeCompare(INTEGRATION_NAME[other.provider], "en"),
  );

  const tokens = searchTokens(query);
  // Note that a query finding one of a provider's accounts finds the provider, whose one row names them all.
  const foundProviders = new Set(searchServers(rows, query).map((row) => row.provider));
  const found = providerGroups(rows.filter((row) => foundProviders.has(row.provider)));

  return (
    <Stack gap={GAP.PAGE}>
      {statuses.readFailed ? (
        <SettingsSection>
          <ReadFailed
            line={PAGE_LINE.READ_FAILED}
            surface={FAILURE_SURFACE.INTEGRATIONS_READ}
            onRetry={() => void statuses.read()}
          />
        </SettingsSection>
      ) : null}
      {rows.length === 0 ? <PageNote>{PAGE_LINE.NONE_OFFERED}</PageNote> : null}
      {rows.length > 0 && found.length === 0 ? <NoMatchNote query={query} /> : null}
      {found.map((group) => (
        <SettingsSection
          key={group.heading ?? "unread"}
          {...settingsSectionHead(SECTION.INTEGRATIONS_GROUP, { group: group.heading })}
        >
          {group.providers.map((own) => (
            <ProviderRows
              key={own[0]?.provider}
              rows={own}
              statuses={statuses}
              healthOf={healthOf}
              tokens={tokens}
              onRetryTools={retry}
              onOpen={onOpen}
            />
          ))}
        </SettingsSection>
      ))}
    </Stack>
  );
}

/**
 * One provider on the list: where the account holds an account there, the
 * one row that opens its page; else its row to connect it, a sign-in under
 * way or one that did not finish on it, as every surface draws it.
 */
function ProviderRows({
  rows,
  statuses,
  healthOf,
  tokens,
  onRetryTools,
  onOpen,
}: {
  rows: readonly ServerRow[];
  statuses: IntegrationStatuses;
  healthOf: (server: string) => ConnectionHealth;
  tokens: readonly string[];
  onRetryTools: (server: string) => void;
  onOpen: (provider: SettingsSubPage) => void;
}): React.JSX.Element | null {
  const first = rows[0];

  if (first === undefined) return null;
  const { provider } = first;

  const held = rows.some((row) => {
    const status = statuses.statusOf(row.connection);

    return status === INTEGRATION_STATUS.CONNECTED || status === INTEGRATION_STATUS.EXPIRED;
  });

  if (held) {
    return (
      // Note that a provider is followed by its own name, which the row it is drawn as before it connects carries too, so it glides from one section to the other.
      <Stack gap={GAP.NONE}>
        <IntegrationLinkRow
          provider={provider}
          rows={rows}
          statuses={statuses}
          healthOf={healthOf}
          tokens={tokens}
          onRetryTools={onRetryTools}
          onOpen={() => onOpen(provider)}
        />
      </Stack>
    );
  }

  return (
    <>
      {rows.map((row) => (
        <IntegrationRow
          key={row.connection}
          row={row}
          status={statuses.statusOf(row.connection)}
          health={healthOf(row.connection)}
          statuses={statuses}
          tokens={tokens}
          onRetryTools={() => onRetryTools(row.connection)}
        />
      ))}
    </>
  );
}

/** A line the page says in its sections' place, in a description's muted words. */
function PageNote({ children }: { children: string }): React.JSX.Element {
  return (
    <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
      {children}
    </Text>
  );
}

/** The page's rows under its own search, the query held here where Settings does not hand the page one. */
function SearchedRows({
  filter,
  onOpen,
}: {
  filter: IntegrationsFilter | undefined;
  onOpen: (provider: SettingsSubPage) => void;
}): React.JSX.Element {
  const [query, setQuery] = useState("");
  const shown = filter ?? { query, onQueryChange: setQuery };

  return (
    <>
      <FilterField filter={shown} />
      <IntegrationRows filter={shown} onOpen={onOpen} />
    </>
  );
}

/** Opens nothing, where the page is drawn with no Settings around it to open a provider's page in. */
const OPENS_NOTHING = () => undefined;

export function IntegrationsSection({
  signedIn,
  filter,
  sub,
  onSubChange = OPENS_NOTHING,
}: {
  signedIn: boolean;
  /** The page's search, where Settings holds its query. */
  filter?: IntegrationsFilter | undefined;
  /** The provider whose page stands in the list's place, where one does. */
  sub?: SettingsSubPage | undefined;
  /** Opens a provider's page. */
  onSubChange?: ((sub: SettingsSubPage | undefined) => void) | undefined;
}): React.JSX.Element {
  if (!signedIn) return <PageNote>{PAGE_LINE.SIGNED_OUT}</PageNote>;

  if (sub !== undefined) return <IntegrationProviderPage provider={sub} />;

  return <SearchedRows filter={filter} onOpen={onSubChange} />;
}
