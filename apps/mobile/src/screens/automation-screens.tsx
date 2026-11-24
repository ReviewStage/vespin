// automation-screens.tsx -- the Automations tab's list, as the desktop's Automations page lists them: the workspace's and then the reader's own, each in the order View options chose, a finished one-time automation folded under Finished, each row opening its page, with Run now and its switch behind a swipe and a long press, then Copy link, Take over, and Delete.

import { CREATE_WITH_AGENT_WORDS } from "@repo/features/automation-agent-brief";
import {
  AUTOMATION_RUN_STANDING,
  AUTOMATIONS_ORDER,
  AUTOMATIONS_ORDER_WORDS,
  type AutomationsOrder,
  automationGroups,
  automationRunStanding,
  automationTriggerText,
  DEFAULT_AUTOMATIONS_ORDER,
  finishedAutomations,
} from "@repo/features/automation-list-model";
import { automationPreset } from "@repo/features/automation-presets";
import type { AutomationSummary } from "@repo/features/automation-wire";
import {
  AUTOMATION_DELETE_WORDS,
  AUTOMATION_PHONE_WORDS,
  AUTOMATION_SUGGESTION_WORDS,
  AUTOMATION_TAKE_OVER_WORDS,
  automationDeleteTitle,
  automationLastRunWords,
  automationOwnerName,
  automationPhoneLine,
  READING_AUTOMATIONS,
} from "@repo/features/automation-words";
import { matchesTokens, searchTokens } from "@repo/features/search-tokens";
import { TASKS_VIEW_WORDS } from "@repo/features/tasks-page-model";
import { sinceText } from "@repo/features/time-format";
import { managesWorkspace } from "@repo/features/workspace-role";
import type { Workspace } from "@repo/features/workspace-wire";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { selectWorkspaceExperiment, selectWorkspaces } from "@repo/host/app-state-reads";
import {
  AUTOMATION_ROW_LOOK,
  AutomationRow,
  type BarMenu,
  ConfirmAsk,
  EmptyState,
  GLYPH,
  glyphSymbol,
  LIST_LOOK,
  ListColumn,
  ListSection,
  NoSelection,
  ROW_ACTION_TONE,
  RowForEach,
  RowList,
  Screen,
  StackBarMenu,
  useMinute,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { createContext, type ReactNode, useContext, useMemo, useState } from "react";
import { newAutomationRoute } from "../automations/automation-editor-route.js";
import {
  AUTOMATION_RUNS_ROUTE,
  automationRoute,
  CREATE_WITH_AGENT_ROUTE,
} from "../automations/automation-routes.js";
import {
  AUTOMATION_SUGGESTIONS,
  type AutomationSuggestion,
  takenPresets,
} from "../automations/automation-suggestions.js";
import { useAutomationsOrder } from "../automations/automations-order.js";
import {
  type AutomationActs,
  automationRowActs,
  copyAutomationLink,
  takesOver,
  useAutomationActs,
  useAutomationMaker,
  useWorkspaceAutomations,
  useWorkspaceIntegrations,
} from "../automations/use-automations.js";
import { useChosenWorkspace } from "../chosen-workspace.js";
import { appStateQuery } from "../host/app-state-query.js";
import { useHeldSearchPlacement, useRefilledSearchField } from "../search-field.js";
import { SettingsBarButton } from "../settings-button.js";
import { APP_SIDEBAR } from "../sidebar-shown.js";
import { TabColumns } from "../split-columns.js";
import { useOnOwnTab } from "../tab-route.js";
import { useWorkspaceSwitcher } from "../workspace-switcher.js";
import { PLUS_TAB, useComposeAction, useSplitBuild } from "./app-sidebar.js";

/** What the list's field says before anything is typed. */
const SEARCH_AUTOMATIONS = "Search automations";

/** What the folded group of finished one-time automations is called, as the desktop's list calls it. */
const FINISHED = "Finished";

/** What the list says where a search keeps none. */
const NO_MATCH = "No automations match.";

/** What the bar's + is called, as the desktop's page names its act. */
const NEW_AUTOMATION = "New automation";

/** What the workspace's runs are called, on the bar's button that opens them, as the desktop's tab names them. */
const RUNS = "Runs";

/** What an iPad's page column says before an automation is opened beside the list. */
const NO_AUTOMATION_SELECTED = "No automation selected";

/** What View options is called, on its button and to VoiceOver. */
const VIEW_OPTIONS = "View options";

/** Each order's glyph on Order by, the Tasks tab's own where it orders alike. */
const ORDER_GLYPH = {
  [AUTOMATIONS_ORDER.CREATED]: GLYPH.SCHEDULE_ADD,
  [AUTOMATIONS_ORDER.NAME]: GLYPH.LIST,
  [AUTOMATIONS_ORDER.LAST_RUN]: GLYPH.HISTORY,
  [AUTOMATIONS_ORDER.NEXT_RUN]: GLYPH.SCHEDULES,
} as const;

/** When an automation's newest run fired, at its row's end; none while it is at work, whose mark says so, or for one that never ran. */
function lastRunWhen(automation: AutomationSummary, now: number): string | undefined {
  const run = automation.lastRun;

  if (run === null || automationRunStanding(run) === AUTOMATION_RUN_STANDING.WORKING) {
    return undefined;
  }

  return sinceText(run.firedAt, now);
}

/** View options: Order by, its choice checked, then Reset view while the order is not the one the list starts in. */
function viewMenu(order: AutomationsOrder, setOrder: (next: AutomationsOrder) => void): BarMenu {
  const changed = order !== DEFAULT_AUTOMATIONS_ORDER;

  return {
    label: VIEW_OPTIONS,
    symbol: GLYPH.FILTER,
    choices: [],
    actions: [],
    groups: [
      {
        items: [
          {
            label: TASKS_VIEW_WORDS.ORDER_BY,
            symbol: GLYPH.TIME,
            choices: Object.values(AUTOMATIONS_ORDER).map((each) => ({
              label: AUTOMATIONS_ORDER_WORDS[each],
              symbol: ORDER_GLYPH[each],
              on: order === each,
              onPress: () => setOrder(each),
            })),
            actions: [],
          },
        ],
      },
      {
        items: [
          {
            label: TASKS_VIEW_WORDS.RESET_VIEW,
            symbol: GLYPH.RESTORE,
            disabled: !changed,
            onPress: () => setOrder(DEFAULT_AUTOMATIONS_ORDER),
          },
        ],
      },
    ],
  };
}

/** Whether an automation stands among what the search's words find: its name, or what fires it. */
function found(automation: AutomationSummary, tokens: readonly string[]): boolean {
  return matchesTokens(
    [automation.name, automationTriggerText(automation.trigger, automation.repositories ?? [])],
    tokens,
  );
}

/**
 * The Automations tab's root: the workspace the app works in, its
 * automations listed under who owns them, its switcher leading the bar, View
 * options and search beside it. Note that it is drawn anew for each
 * workspace, so nothing of one workspace's list stands over another's.
 */
export function AutomationsScreen() {
  return APP_SIDEBAR ? <AutomationsPageScreen /> : <AutomationsStackScreen />;
}

/**
 * The Automations tab's root on an iPad: an automation opened beside its
 * list, pushed on its own stack, as Mail stands a message beside its
 * mailbox, and none before one is, New task leading its bar; the list
 * stands in the middle column (`AutomationsListColumn`).
 */
function AutomationsPageScreen() {
  const compose = useComposeAction();
  const build = useSplitBuild();

  return (
    <>
      {/* Note that the root keeps its title while its bar is hidden, because a page pushed over it names its back button by it. */}
      <Stack.Screen options={{ headerShown: false, title: AUTOMATION_PHONE_WORDS.TITLE }} />
      <TabColumns
        build={build}
        sidebar={null}
        detail={<NoSelection title={NO_AUTOMATION_SELECTED} />}
        detailBar={{ lead: [compose] }}
      />
    </>
  );
}

/** The automations' search, held above an iPad's split view for its list column, so it outlives a turn to another place and back. */
const AutomationsSearchContext = createContext<
  { readonly search: string; readonly setSearch: (search: string) => void } | undefined
>(undefined);

/** What an iPad's Automations holds above the system's split view: its list's search. */
export function AutomationsSearchProvider({ children }: { readonly children: ReactNode }) {
  const [search, setSearch] = useState("");
  const held = useMemo(() => ({ search, setSearch }), [search]);

  return <AutomationsSearchContext value={held}>{children}</AutomationsSearchContext>;
}

/**
 * The automations in an iPad's middle column, beside the sidebar: the
 * workspace's automations under who owns them, under the column's title,
 * search, View options, Runs and New automation. Note that the sidebar
 * holds the workspace switcher, so the list's bar stands none.
 */
export function AutomationsListColumn() {
  const held = useContext(AutomationsSearchContext);
  const { data: workspaces = [] } = useQuery({ ...appStateQuery, select: selectWorkspaces });
  const { chosen } = useChosenWorkspace(workspaces);
  const { order, setOrder } = useAutomationsOrder();
  const router = useRouter();
  const onOwnTab = useOnOwnTab();

  if (held === undefined)
    throw new Error("An iPad's automations stand under AutomationsSearchProvider.");

  const { search, setSearch } = held;

  return (
    <ListColumn
      view={
        chosen === undefined ? null : (
          <AutomationsList key={chosen.id} workspace={chosen} order={order} search={search} />
        )
      }
      bar={{
        title: AUTOMATION_PHONE_WORDS.TITLE,
        menu: viewMenu(order, setOrder),
        acts: [
          {
            label: RUNS,
            symbol: GLYPH.HISTORY,
            onPress: () => router.push(onOwnTab(AUTOMATION_RUNS_ROUTE)),
          },
          {
            label: NEW_AUTOMATION,
            symbol: GLYPH.ADD,
            onPress: () => router.push(newAutomationRoute()),
          },
        ],
        search: { placeholder: SEARCH_AUTOMATIONS, text: search, onChange: setSearch },
      }}
    />
  );
}

/** The Automations tab's root under the Stack's bar, on an iPhone. */
function AutomationsStackScreen() {
  const { data: workspaces = [] } = useQuery({ ...appStateQuery, select: selectWorkspaces });
  const { chosen } = useChosenWorkspace(workspaces);
  const switcher = useWorkspaceSwitcher();
  const { order, setOrder } = useAutomationsOrder();
  const [search, setSearch] = useState("");
  const field = useRefilledSearchField(search);
  const placement = useHeldSearchPlacement(search);
  const menu = viewMenu(order, setOrder);
  const router = useRouter();
  const onOwnTab = useOnOwnTab();
  const compose = useComposeAction();

  return (
    <>
      <Stack.Screen options={{ title: AUTOMATION_PHONE_WORDS.TITLE }}>
        <Stack.SearchBar
          ref={field}
          placeholder={SEARCH_AUTOMATIONS}
          placement={placement}
          allowToolbarIntegration={false}
          onChangeText={(event) => setSearch(event.nativeEvent.text)}
          onCancelButtonPress={() => setSearch("")}
        />
      </Stack.Screen>
      <SettingsBarButton switcher={switcher} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.View>
          <StackBarMenu menu={menu} />
        </Stack.Toolbar.View>
        {/* Note that Runs stands beside View options, as the desktop's page stands its Runs tab beside the list, since every run's agent is found there. */}
        <Stack.Toolbar.Button
          icon={glyphSymbol(GLYPH.HISTORY)}
          accessibilityLabel={RUNS}
          onPress={() => router.push(onOwnTab(AUTOMATION_RUNS_ROUTE))}
        />
        <Stack.Toolbar.Button
          icon={glyphSymbol(GLYPH.ADD)}
          accessibilityLabel={NEW_AUTOMATION}
          onPress={() => router.push(newAutomationRoute())}
        />
        {/* Note that an iPad's tab bar has no round +, so its list's bar offers New task too, as every tab root's does. */}
        {PLUS_TAB ? null : (
          <Stack.Toolbar.Button
            icon={compose.symbol === undefined ? undefined : glyphSymbol(compose.symbol)}
            accessibilityLabel={compose.label}
            onPress={compose.onPress}
          />
        )}
      </Stack.Toolbar>
      <Screen>
        {chosen === undefined ? null : (
          <AutomationsList key={chosen.id} workspace={chosen} order={order} search={search} />
        )}
      </Screen>
    </>
  );
}

function AutomationsList({
  workspace,
  order,
  search,
}: {
  readonly workspace: Workspace;
  readonly order: AutomationsOrder;
  readonly search: string;
}) {
  const router = useRouter();
  const onOwnTab = useOnOwnTab();
  const now = useMinute();
  const read = useWorkspaceAutomations(workspace.id);
  const acts = useAutomationActs();
  const [asking, setAsking] = useState<AutomationSummary | undefined>(undefined);
  // Note that Finished opens folded, as the desktop's group does, since a one-time automation that ran is done with.
  const [finishedFolded, setFinishedFolded] = useState(true);
  const tokens = searchTokens(search);
  const automations = read.rows?.filter((automation) => found(automation, tokens));
  const groups = automations === undefined ? [] : automationGroups(automations, order);
  const finished = automations === undefined ? [] : finishedAutomations(automations, order);

  // Note that a Delete asked about one deleted elsewhere since withdraws its question.
  const asked =
    asking !== undefined && read.rows?.some((each) => each.id === asking.id) === true
      ? asking
      : undefined;

  const open = (automation: AutomationSummary) =>
    router.push(onOwnTab(automationRoute(automation.id)));

  const row = (automation: AutomationSummary) => (
    <AutomationListRow
      automation={automation}
      workspace={workspace}
      acts={acts}
      now={now}
      onOpen={() => open(automation)}
      onAskDelete={() => setAsking(automation)}
    />
  );

  // Note that the suggestions stand only once the list is read and no search narrows it, so a preset already made is never offered.
  const suggested = read.rows !== undefined && tokens.length === 0;

  const empty =
    automations === undefined ? (
      read.failed ? (
        <EmptyState
          title={AUTOMATION_PHONE_WORDS.FAILED}
          symbol={GLYPH.FAILED}
          retry={read.retry}
        />
      ) : (
        <EmptyState title={READING_AUTOMATIONS} symbol={GLYPH.AUTOMATION} loading />
      )
    ) : automations.length === 0 ? (
      tokens.length > 0 ? (
        <EmptyState title={NO_MATCH} symbol={GLYPH.SEARCH} />
      ) : (
        <EmptyState title={AUTOMATION_PHONE_WORDS.EMPTY} symbol={GLYPH.AUTOMATION} />
      )
    ) : undefined;

  // Note that with nothing listed, the suggestions stand in the empty state's place, Create with an agent first, as the desktop's list offers them under its line saying there are none.
  const offering = suggested;

  return (
    <>
      <RowList
        look={LIST_LOOK.PLAIN}
        searched={search}
        empty={offering && automations?.length === 0 ? undefined : empty}
      >
        {groups.map((group) => (
          <ListSection
            key={group.owner}
            title={automationOwnerName(group.owner, workspace.name, true)}
            count={group.automations.length}
          >
            <RowForEach data={group.automations} keyOf={automationKey}>
              {row}
            </RowForEach>
          </ListSection>
        ))}
        {finished.length === 0 ? null : (
          <ListSection
            title={FINISHED}
            count={finished.length}
            foldable
            folded={finishedFolded}
            onFold={setFinishedFolded}
          >
            <RowForEach data={finished} keyOf={automationKey}>
              {row}
            </RowForEach>
          </ListSection>
        )}
        {suggested ? <SuggestedAutomations listed={read.rows ?? []} workspace={workspace} /> : null}
      </RowList>
      <ConfirmAsk
        title={automationDeleteTitle(asked?.name)}
        message={AUTOMATION_DELETE_WORDS.BODY}
        act={AUTOMATION_DELETE_WORDS.VERB}
        destructive
        presented={asked !== undefined}
        onDismiss={() => setAsking(undefined)}
        onAct={() => {
          if (asked === undefined) return;
          setAsking(undefined);
          acts.remove(asked);
        }}
      />
    </>
  );
}

/** The suggestions the workspace's experiments allow that no listed automation already stands for. */
function useOfferedSuggestions(
  listed: readonly AutomationSummary[],
  workspaceId: string,
): readonly AutomationSuggestion[] {
  const select = useMemo(
    () => (state: AppStateSnapshot) =>
      AUTOMATION_SUGGESTIONS.filter(
        (each) =>
          each.experiment === undefined ||
          selectWorkspaceExperiment(workspaceId, each.experiment)(state),
      ),
    [workspaceId],
  );

  const allowed = useQuery({ ...appStateQuery, select }).data ?? NO_SUGGESTIONS;
  const taken = takenPresets(listed);

  return allowed.filter((each) => !taken.has(each.preset));
}

/** No suggestions, as before the document is read. */
const NO_SUGGESTIONS: readonly AutomationSuggestion[] = [];

/**
 * The automations the list suggests under its own, as the desktop's list
 * does: Create with an agent first, which opens New task's sheet for an
 * agent that makes one from the member's words, then each preset a row
 * whose press opens New automation filled in from it, to look over and
 * Create. One fired by Sentry while the workspace
 * has none says so under its words: an owner or an admin is told to connect
 * it, which the editor's Sentry section does; a member is told whom to ask,
 * and the row takes no press. One fired by Sentry on a deployment that holds
 * no Sentry integration, or while the read is out, is not offered.
 */
function SuggestedAutomations({
  listed,
  workspace,
}: {
  readonly listed: readonly AutomationSummary[];
  readonly workspace: Workspace;
}) {
  const router = useRouter();
  const offered = useOfferedSuggestions(listed, workspace.id);
  const { sentry } = useWorkspaceIntegrations(workspace.id);
  const manages = managesWorkspace(workspace);

  const rows = offered.flatMap((suggestion) => {
    if (suggestion.sentry === true && (sentry === undefined || !sentry.configured)) return [];

    const needs = suggestion.sentry === true && sentry?.installations.length === 0;
    const filled = automationPreset(suggestion.preset);

    return [
      <AutomationRow
        key={suggestion.preset}
        look={AUTOMATION_ROW_LOOK.LIST}
        title={filled.name}
        line={filled.description}
        standing={AUTOMATION_RUN_STANDING.REST}
        standingWords={
          needs
            ? manages
              ? AUTOMATION_SUGGESTION_WORDS.CONNECT_SENTRY
              : AUTOMATION_SUGGESTION_WORDS.ASK_SENTRY
            : undefined
        }
        symbol={suggestion.symbol}
        onPress={
          needs && !manages ? undefined : () => router.push(newAutomationRoute(suggestion.preset))
        }
      />,
    ];
  });

  // Note that Create with an agent heads the suggestions, as the desktop stands it beside New automation, so an automation no preset fits is a sentence away.
  return (
    <ListSection title={AUTOMATION_SUGGESTION_WORDS.SUGGESTED}>
      <AutomationRow
        look={AUTOMATION_ROW_LOOK.LIST}
        title={CREATE_WITH_AGENT_WORDS.TITLE}
        line={CREATE_WITH_AGENT_WORDS.PLACEHOLDER}
        standing={AUTOMATION_RUN_STANDING.REST}
        symbol={GLYPH.AGENT}
        onPress={() => router.push(CREATE_WITH_AGENT_ROUTE)}
      />
      {rows}
    </ListSection>
  );
}

/** An automation's row id in the list. */
function automationKey(automation: AutomationSummary): string {
  return automation.id;
}

/**
 * One automation's row: what fires it and when it runs next, how its newest
 * run went, and when, faded while it is off. Its swipe and long press hold
 * Run now and its switch; its long press then Copy link and, for an owner or
 * an admin where its creator left, Take over; and Delete, red behind a
 * swipe from the trailing edge and last in the menu, asks first.
 */
function AutomationListRow({
  automation,
  workspace,
  acts,
  now,
  onOpen,
  onAskDelete,
}: {
  readonly automation: AutomationSummary;
  readonly workspace: Workspace;
  readonly acts: AutomationActs;
  readonly now: number;
  readonly onOpen: () => void;
  readonly onAskDelete: () => void;
}) {
  const maker = useAutomationMaker(automation, workspace.id);

  const takeOver = takesOver(maker, workspace)
    ? [
        {
          label: AUTOMATION_TAKE_OVER_WORDS.ACT,
          symbol: GLYPH.PERSON,
          tone: ROW_ACTION_TONE.NEUTRAL,
          onPress: () => acts.takeOver(automation),
        },
      ]
    : [];

  return (
    <AutomationRow
      look={AUTOMATION_ROW_LOOK.LIST}
      title={automation.name}
      line={automationPhoneLine(automation, now)}
      standing={automationRunStanding(automation.lastRun)}
      standingWords={automationLastRunWords(automation)}
      symbol={GLYPH.AUTOMATION}
      when={lastRunWhen(automation, now)}
      faded={!automation.enabled}
      onPress={onOpen}
      acts={automationRowActs(automation, acts)}
      more={[
        [
          {
            label: AUTOMATION_PHONE_WORDS.COPY_LINK,
            symbol: GLYPH.LINK,
            tone: ROW_ACTION_TONE.NEUTRAL,
            onPress: () => copyAutomationLink(automation, workspace),
          },
          ...takeOver,
        ],
      ]}
      remove={{
        label: AUTOMATION_PHONE_WORDS.DELETE,
        symbol: GLYPH.DELETE,
        tone: ROW_ACTION_TONE.DESTRUCTIVE,
        onPress: onAskDelete,
      }}
    />
  );
}
