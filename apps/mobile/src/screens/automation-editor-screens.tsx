// automation-editor-screens.tsx -- New automation and an automation's Edit, as a sheet of the desktop's automation editor: its name, who owns it, what fires it, its prompt, and where its runs work; and the time zone its schedule is read in, pushed over it in the sheet.

import { signedInAccountId } from "@repo/credentials/snapshot";
import { handedServers, switchedServers } from "@repo/features/agent-servers-model";
import {
  type AutomationDraft,
  automationDraft,
  changeOf,
  createRequestOf,
  DRAFT_FIELD,
  type DraftDefaults,
  type DraftProblems,
  draftNextRuns,
  draftProblems,
  draftRepositories,
  draftTrigger,
  filterAdmitted,
  filterValuesOf,
  type GitHubTriggerSettings,
  repositoryHeld,
  SCHEDULE_KIND,
  type ScheduleDraft,
  sameDraft,
  withGithubEvent,
  withIntegrationEvent,
  withIntegrationFilters,
  withRepository,
  withScheduleKind,
} from "@repo/features/automation-draft-model";
import {
  AUTOMATION_EDITOR_SECTION,
  AUTOMATION_EDITOR_WORDS,
  AUTOMATION_TARGETS,
  AUTOMATION_TRIGGERS,
  GITHUB_EVENTS,
  GITHUB_SENDERS,
  GITHUB_SWITCH_WORDS,
  HOURLY_MINUTES,
  hourlyLabel,
  NEW_SECRET_REFUSAL_WORDS,
  nextRunWords,
  PULL_REQUEST_EVENTS,
  PULL_REQUEST_MOMENTS,
  RUNS_AGENT_WORDS,
  SCHEDULE_KINDS,
  SENTRY_EVENTS,
  SENTRY_LEVELS,
  SENTRY_WORDS,
  WEBHOOK_WORDS,
  WEEKDAYS,
  workspaceOwnerDetail,
  zoneLabel,
} from "@repo/features/automation-editor-words";
import { automationTriggerText } from "@repo/features/automation-list-model";
import {
  AUTOMATION_SCOPE,
  AUTOMATION_TARGET,
  AUTOMATION_TRIGGER,
  type AutomationSummary,
  GITHUB_TRIGGER_EVENT,
  type GitHubTriggerEvent,
  type IntegrationTriggerFilters,
} from "@repo/features/automation-wire";
import {
  AUTOMATION_PHONE_WORDS,
  AUTOMATION_SAVE_REFUSAL_WORDS,
  automationOwnerName,
  READING_AUTOMATIONS,
} from "@repo/features/automation-words";
import { readerZone } from "@repo/features/date-mention";
import { INTEGRATION_NAME, integrationConnectionOf } from "@repo/features/integration-wire";
import { LINK_DESTINATION, linkOf } from "@repo/features/link-grammar";
import { LIVE_READ } from "@repo/features/live-wire";
import { effortFor, effortsOf } from "@repo/features/model-effort";
import { agentName } from "@repo/features/model-label";
import { type CatalogModel, type ModelChoice, standardModelIdOf } from "@repo/features/models-wire";
import type { WorkspaceSentry } from "@repo/features/sentry-install-wire";
import { dayAndTimeText, timeZoneNames } from "@repo/features/time-format";
import { ACT_UNREACHED_WORDS, andList, MCP_SERVER_LABEL, readingWords } from "@repo/features/words";
import type { Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import {
  selectAccount,
  selectAgentDefault,
  selectIntegrations,
  selectWorkspaces,
} from "@repo/host/app-state-reads";
import { SETTINGS_PAGE } from "@repo/settings";
import {
  ActionRow,
  BAR_TITLE,
  BUZZ,
  buzz,
  ConfirmAsk,
  DATE_PICK_PART,
  DatePickRow,
  EmptyState,
  FOOTER_TONE,
  footerToneOf,
  GLYPH,
  glyphSymbol,
  ListSection,
  LoadingRow,
  MenuPickRow,
  PickRows,
  PUSH_ROW_GOES,
  PushRow,
  SCREEN_GROUND,
  Screen,
  SettingsForm,
  ToggleRow,
  useAsyncAction,
  useColors,
  ValueRow,
  WORDS_LOOK,
  WordsField,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { setStringAsync } from "expo-clipboard";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { timeZoneRoute } from "../automations/automation-editor-route.js";
import { useWorkspaceAutomations } from "../automations/use-automations.js";
import { useZonePick, useZonePicked } from "../automations/zone-pick.js";
import { useCloseSheet } from "../close-sheet.js";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs, useListedAgents } from "../host/host-provider.js";
import { useLiveFollow } from "../host/live-follow.js";
import { openInSafari } from "../open-link.js";
import {
  atSpeed,
  effortOptions,
  modelOptions,
  useModelCatalog,
  useRepositoryPick,
} from "../tasks/use-start.js";
import { useTasksWorkspace } from "../tasks/use-tasks.js";
import { DISCARD_CHANGES_WORDS, DISCARD_WORDS, useKeptWords } from "../use-kept-words.js";

/** What the sheet says where the editor itself has no word for it. */
const WORDS = {
  CANCEL: "Cancel",
  /** Where a schedule's custom cron is typed, as its field says before anything is. */
  CRON_PLACEHOLDER: "0 9 * * 1-5",
} as const;

/** The repository picker's choice of none, which a run then works in. Note that no repository's full name lacks its owner's slash, so this never names one. */
const NO_REPOSITORY_ID = "none";

/** How many of a schedule's next runs its footer names. */
const NEXT_RUNS_SHOWN = 3;

/** The agent picker's choice of the one its first run starts. Note that no agent's id is this word, so it never names one. */
const FIRST_RUN_ID = "first-run";

/** What the MCP servers' section says where the editor has no word of the desktop's to share. */
const SERVER_WORDS = {
  ALL_BUT: "All but",
  THEIRS: "Runs use its creator's connections, so only its creator can change them.",
  NONE: "No MCP servers are connected. Connect one in Settings › Integrations.",
} as const;

/** A switched-off server's connection as its row names it: its provider, and which of its accounts after the first. */
function switchedOffName(connection: string): string {
  const account = integrationConnectionOf(connection);

  if (account === undefined) return connection;
  const name = INTEGRATION_NAME[account.provider];

  return account.place === 1 ? name : `${name} (account ${account.place})`;
}

/** What a flow finds the name field by. */
const NAME_FIELD_ID = "automation-name";

/** Every zone the phone knows, or none where its JavaScript cannot list them, which then offers the zones at hand alone. */
function knownZones(): readonly string[] {
  try {
    return timeZoneNames();
  } catch {
    return [];
  }
}

/** A day and a time of day kept as wall clock, as the phone's own picker reads them: the time on any day, and the day at that time. */
function wallDate(schedule: ScheduleDraft): Date {
  const [year, month, day] =
    schedule.date === "" ? [2000, 1, 1] : schedule.date.split("-").map(Number);

  return new Date(year ?? 2000, (month ?? 1) - 1, day ?? 1, schedule.hour, schedule.minute);
}

/** A picked day as a one-time schedule keeps it, `YYYY-MM-DD`, read off the phone's own clock. */
function dayOf(picked: Date): string {
  const month = String(picked.getMonth() + 1).padStart(2, "0");
  const day = String(picked.getDate()).padStart(2, "0");

  return `${picked.getFullYear()}-${month}-${day}`;
}

/** Today at its start, on the phone's own clock: the first day a one-time schedule offers. */
function startOfToday(): Date {
  const now = new Date();

  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** What the schedule's section says under itself: its next runs, or none for one that runs no more. */
function nextRunsText(draft: AutomationDraft): string | undefined {
  const runs = draftNextRuns(draft, new Date(), NEXT_RUNS_SHOWN);

  return runs.length === 0 ? undefined : nextRunWords(runs.map(dayAndTimeText).join(", "));
}

/** The model and effort a picked model runs at: the effort the draft had where the model lists it, else the nearest it lists, as the panel's menu keeps it. */
function choiceAt(
  catalog: readonly CatalogModel[],
  model: string,
  shown: ModelChoice | undefined,
): ModelChoice | undefined {
  const effort = effortFor(effortsOf(catalog, model), shown?.effort);

  return effort === undefined ? undefined : { model, effort };
}

/** What the workspace's integrations say to the editor: whether its Slack bot is connected, so a run's result may be sent on Slack, and its Sentry, through whose installation a Sentry trigger's events arrive; neither while the read is out or failed. */
interface EditorIntegrations {
  readonly slackBot: boolean;
  readonly sentry: WorkspaceSentry | undefined;
}

/** The workspace's integrations as the editor reads them, followed while the sheet stands. */
function useEditorIntegrations(workspaceId: string): EditorIntegrations {
  const acts = useHostActs();
  useLiveFollow(workspaceId, (id) =>
    acts[ACT_KIND.WORKSPACE_INTEGRATIONS_FOLLOW]({ workspaceId: id }),
  );

  const select = useMemo(
    () => (state: AppStateSnapshot) => state[LIVE_READ.WORKSPACE_INTEGRATIONS][workspaceId]?.rows,
    [workspaceId],
  );

  const rows = useQuery({ ...appStateQuery, select }).data;

  return { slackBot: rows?.slack.team !== undefined, sentry: rows?.sentry };
}

/** The sheet's bar: its title, the system's ✕ (Cancel to VoiceOver), and its act, lit while none is out. */
function EditorBar({
  title,
  act,
  busy,
  onAct,
  onCancel,
}: {
  readonly title: string;
  readonly act: string;
  readonly busy: boolean;
  readonly onAct: () => void;
  readonly onCancel: () => void;
}) {
  const colors = useColors();

  // Note that the options are made once for their title and colors, because the stack sets a screen's options again whenever a new object comes, which a key typed would make.
  const options = useMemo(
    () => ({
      headerShown: true,
      title,
      headerTintColor: colors.TEXT,
      headerTitleStyle: { ...BAR_TITLE.SCREEN, color: colors.TEXT },
      headerShadowVisible: false,
      contentStyle: { backgroundColor: colors.GROUPED },
    }),
    [title, colors],
  );

  return (
    <>
      <Stack.Screen options={options} />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button
          icon={glyphSymbol(GLYPH.CLOSE)}
          accessibilityLabel={WORDS.CANCEL}
          onPress={onCancel}
        />
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          variant="prominent"
          tintColor={colors.ACCENT}
          disabled={busy}
          onPress={onAct}
        >
          {act}
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
    </>
  );
}

/**
 * The schedule's rows, as the desktop's: how often; then the time, the day
 * and time, the day of a one-time one and its time, the minutes past the
 * hour, or the cron that kind asks for, each in the system's own picker;
 * then the zone it is read in, pushed and searched since every zone is
 * listed. A time and a day are handed to the picker as wall clock, so the
 * phone's own zone never moves them.
 */
function ScheduleRows({
  draft,
  onSchedule,
}: {
  readonly draft: AutomationDraft;
  readonly onSchedule: (schedule: ScheduleDraft) => void;
}) {
  const router = useRouter();
  const { schedule } = draft;
  const wall = wallDate(schedule);

  const time = (
    <DatePickRow
      label={AUTOMATION_EDITOR_WORDS.TIME}
      value={wall}
      part={DATE_PICK_PART.TIME}
      onPick={(picked) =>
        onSchedule({ ...schedule, hour: picked.getHours(), minute: picked.getMinutes() })
      }
    />
  );

  // Note that a minute a custom cron or another editor wrote stands among the offered ones, so the menu never shows nothing picked.
  const minutes: readonly number[] = HOURLY_MINUTES.some((minute) => minute === schedule.minute)
    ? HOURLY_MINUTES
    : [...HOURLY_MINUTES, schedule.minute].toSorted((one, other) => one - other);

  return (
    <>
      <MenuPickRow
        label={AUTOMATION_EDITOR_WORDS.RUNS}
        options={SCHEDULE_KINDS.map((kind) => ({ id: kind.value, label: kind.label }))}
        picked={schedule.kind}
        onPick={(id) => {
          const kind = SCHEDULE_KINDS.find((each) => each.value === id)?.value;

          if (kind !== undefined) onSchedule(withScheduleKind(draft, kind, new Date()));
        }}
      />
      {schedule.kind === SCHEDULE_KIND.HOURLY ? (
        <MenuPickRow
          label={AUTOMATION_EDITOR_WORDS.MINUTES_PAST}
          options={minutes.map((minute) => ({ id: String(minute), label: hourlyLabel(minute) }))}
          picked={String(schedule.minute)}
          onPick={(id) => onSchedule({ ...schedule, minute: Number(id) })}
        />
      ) : null}
      {schedule.kind === SCHEDULE_KIND.WEEKLY ? (
        <MenuPickRow
          label={AUTOMATION_EDITOR_WORDS.DAY}
          options={WEEKDAYS.map((day, weekday) => ({ id: String(weekday), label: day }))}
          picked={String(schedule.weekday)}
          onPick={(id) => onSchedule({ ...schedule, weekday: Number(id) })}
        />
      ) : null}
      {schedule.kind === SCHEDULE_KIND.ONCE ? (
        <DatePickRow
          label={AUTOMATION_EDITOR_WORDS.DATE}
          value={wall}
          part={DATE_PICK_PART.DAY}
          earliest={startOfToday()}
          onPick={(picked) => onSchedule({ ...schedule, date: dayOf(picked) })}
        />
      ) : null}
      {schedule.kind === SCHEDULE_KIND.CUSTOM ? (
        <WordsField
          look={WORDS_LOOK.LINE}
          label={AUTOMATION_EDITOR_WORDS.CRON}
          placeholder={WORDS.CRON_PLACEHOLDER}
          initialWords={schedule.cron}
          verbatim
          onWords={(cron) => onSchedule({ ...schedule, cron })}
        />
      ) : schedule.kind === SCHEDULE_KIND.HOURLY ? null : (
        time
      )}
      <PushRow
        label={AUTOMATION_EDITOR_WORDS.TIME_ZONE}
        detail={zoneLabel(draft.timezone)}
        goes={PUSH_ROW_GOES.PAGE}
        onPress={() => router.push(timeZoneRoute(draft.timezone))}
      />
    </>
  );
}

/** The model and effort a new agent runs on, from the catalog, the account's default until one is picked. */
function ModelRows({
  choice,
  onChoice,
}: {
  readonly choice: ModelChoice | null;
  readonly onChoice: (choice: ModelChoice) => void;
}) {
  const catalog = useModelCatalog()?.models;
  const { data: fallback } = useQuery({ ...appStateQuery, select: selectAgentDefault });
  const shown = choice ?? fallback;
  const models = useMemo(() => (catalog === undefined ? [] : modelOptions(catalog)), [catalog]);

  if (catalog === undefined || shown === undefined) {
    return <LoadingRow words={AUTOMATION_EDITOR_WORDS.DEFAULT_MODEL} />;
  }

  return (
    <>
      <MenuPickRow
        label={AUTOMATION_EDITOR_WORDS.MODEL}
        options={models}
        picked={standardModelIdOf(shown.model)}
        onPick={(model) => {
          const picked = choiceAt(catalog, atSpeed(catalog, model, shown.model), shown);

          if (picked !== undefined) onChoice(picked);
        }}
      />
      <MenuPickRow
        label={AUTOMATION_EDITOR_WORDS.EFFORT}
        options={effortOptions(catalog, shown.model)}
        picked={shown.effort}
        onPick={(effort) => onChoice({ model: shown.model, effort })}
      />
    </>
  );
}

/**
 * The editor's form over a draft, as the desktop's: the name; who owns it,
 * where the workspace is one others share; what fires it, a schedule edited
 * whole and any other trigger kept as it was saved and said; the prompt;
 * and where its runs work. Save, or Create for a new one, sends what the
 * draft changed, or makes it, and closes the sheet once it lands; a
 * refusal says why under the name and keeps the sheet. What stops a save
 * is said under the row it is about once Save was pressed. A draft written
 * in asks before Cancel or a swipe lets it go.
 */
/** A list with a value in it or out of it, as a switch leaves it. */
function toggled<Value>(list: readonly Value[], value: Value, on: boolean): readonly Value[] {
  return on
    ? [...list.filter((each) => each !== value), value]
    : list.filter((each) => each !== value);
}

/** Copies what a webhook's row holds to the pasteboard for its sender, with the system's tap of success, or says on the console why it could not. */
function copyForSender(words: string): void {
  setStringAsync(words)
    .then(() => buzz(BUZZ.SUCCESS))
    .catch((cause: unknown) => {
      console.error("The webhook's words could not be copied.", cause);
      buzz(BUZZ.ERROR);
    });
}

/**
 * A GitHub trigger's rows, as the desktop's: the event it fires on, then a
 * switch each for whose events fire it, the moments an update fires on,
 * whether drafts are skipped and forks heard, and whether prereleases are
 * heard, each standing only for the events it speaks to. A check names no
 * sender, so it stands none, and a merged pull request is never a draft.
 */
function GitHubRows({
  event,
  settings,
  onEvent,
  onSettings,
}: {
  readonly event: GitHubTriggerEvent;
  readonly settings: GitHubTriggerSettings;
  readonly onEvent: (event: GitHubTriggerEvent) => void;
  readonly onSettings: (settings: GitHubTriggerSettings) => void;
}) {
  const checks = event === GITHUB_TRIGGER_EVENT.CHECK_FAILED;
  const pullRequest = PULL_REQUEST_EVENTS.has(event);

  return (
    <>
      <MenuPickRow
        label={AUTOMATION_EDITOR_WORDS.EVENT}
        options={GITHUB_EVENTS.map((each) => ({ id: each.value, label: each.label }))}
        picked={event}
        onPick={(id) => {
          const picked = GITHUB_EVENTS.find((each) => each.value === id)?.value;

          if (picked !== undefined) onEvent(picked);
        }}
      />
      {checks
        ? null
        : GITHUB_SENDERS.map((choice) => (
            <ToggleRow
              key={choice.value}
              label={choice.label}
              detail={choice.detail}
              on={settings.senders.includes(choice.value)}
              onChange={(on) =>
                onSettings({ ...settings, senders: toggled(settings.senders, choice.value, on) })
              }
            />
          ))}
      {event === GITHUB_TRIGGER_EVENT.PULL_REQUEST_UPDATED
        ? PULL_REQUEST_MOMENTS.map((choice) => (
            <ToggleRow
              key={choice.value}
              label={choice.label}
              detail={choice.detail}
              on={settings.moments.includes(choice.value)}
              onChange={(on) =>
                onSettings({ ...settings, moments: toggled(settings.moments, choice.value, on) })
              }
            />
          ))
        : null}
      {pullRequest && event !== GITHUB_TRIGGER_EVENT.PULL_REQUEST_MERGED ? (
        <ToggleRow
          label={GITHUB_SWITCH_WORDS.SKIP_DRAFTS}
          on={!settings.drafts}
          onChange={(skip) => onSettings({ ...settings, drafts: !skip })}
        />
      ) : null}
      {pullRequest ? (
        <ToggleRow
          label={GITHUB_SWITCH_WORDS.INCLUDE_FORKS}
          detail={GITHUB_SWITCH_WORDS.FORKS_DETAIL}
          on={settings.forks}
          onChange={(forks) => onSettings({ ...settings, forks })}
        />
      ) : null}
      {event === GITHUB_TRIGGER_EVENT.RELEASE_PUBLISHED ? (
        <ToggleRow
          label={GITHUB_SWITCH_WORDS.INCLUDE_PRERELEASES}
          on={settings.prereleases}
          onChange={(prereleases) => onSettings({ ...settings, prereleases })}
        />
      ) : null}
    </>
  );
}

/**
 * One of a Sentry trigger's filters, under its own heading: its values
 * written comma-separated, read back into the draft as they are typed.
 * Note that the words typed stand in the field's own state, so a comma
 * still to be followed by a value is not taken away.
 */
function FilterSection({
  title,
  detail,
  values,
  problem,
  onValues,
}: {
  readonly title: string;
  readonly detail: string;
  readonly values: readonly string[];
  readonly problem: string | undefined;
  readonly onValues: (values: readonly string[]) => void;
}) {
  return (
    <ListSection title={title} footer={problem ?? detail} footerTone={footerToneOf(problem)}>
      <WordsField
        look={WORDS_LOOK.LINE}
        label={title}
        placeholder={SENTRY_WORDS.ALL}
        initialWords={values.join(", ")}
        verbatim
        onWords={(typed) => onValues(filterValuesOf(typed))}
      />
    </ListSection>
  );
}

/**
 * A Sentry trigger's sections after its Trigger section, as the desktop's
 * rows: the projects and environments it keeps to, and its levels, a switch
 * each, none on for every level. Where the workspace has no Sentry
 * installed, a section says so in their place, its press opening the
 * workspace's Settings page on the web, where Sentry is installed.
 */
function SentrySections({
  draft,
  sentry,
  workspace,
  problems,
  onDraft,
}: {
  readonly draft: AutomationDraft;
  readonly sentry: WorkspaceSentry | undefined;
  readonly workspace: Workspace;
  readonly problems: DraftProblems;
  readonly onDraft: (patch: Partial<AutomationDraft>) => void;
}) {
  // Note that a read still out, or one that failed, installs nothing, so a saved trigger stays editable.
  if (sentry !== undefined && sentry.installations.length === 0) {
    return (
      <ListSection title={SENTRY_WORDS.NOT_INSTALLED} footer={SENTRY_WORDS.INSTALL_DETAIL}>
        <PushRow
          label={SENTRY_WORDS.INSTALL}
          goes={PUSH_ROW_GOES.OUT}
          onPress={() =>
            openInSafari(
              linkOf(
                { kind: LINK_DESTINATION.SETTINGS, page: SETTINGS_PAGE.WORKSPACE },
                workspace.slug ?? workspace.id,
              ),
            )
          }
        />
      </ListSection>
    );
  }

  const filters = draft.integrationTrigger.filters;
  const filter = (next: IntegrationTriggerFilters) => onDraft(withIntegrationFilters(draft, next));
  const problem = problems[DRAFT_FIELD.FILTERS];
  const levels = filters?.level ?? [];

  return (
    <>
      <FilterSection
        title={SENTRY_WORDS.PROJECTS}
        detail={SENTRY_WORDS.PROJECTS_DETAIL}
        values={filters?.project ?? []}
        problem={filterAdmitted(filters?.project) ? undefined : problem}
        onValues={(project) => filter({ project })}
      />
      <FilterSection
        title={SENTRY_WORDS.ENVIRONMENTS}
        detail={SENTRY_WORDS.ENVIRONMENTS_DETAIL}
        values={filters?.environment ?? []}
        problem={filterAdmitted(filters?.environment) ? undefined : problem}
        onValues={(environment) => filter({ environment })}
      />
      <ListSection title={SENTRY_WORDS.LEVELS} footer={SENTRY_WORDS.LEVELS_DETAIL}>
        {SENTRY_LEVELS.map((choice) => (
          <ToggleRow
            key={choice.value}
            label={choice.label}
            on={levels.includes(choice.value)}
            onChange={(on) => filter({ level: toggled(levels, choice.value, on) })}
          />
        ))}
      </ListSection>
    </>
  );
}

/**
 * The agent a same-agent automation's runs go to: the one its first run
 * starts, or one of the agents the app lists in its workspace, by name; one
 * it was saved with that the app no longer lists stays picked under words
 * that say so.
 */
function RunsAgentRow({
  agentId,
  workspaceId,
  onAgent,
}: {
  readonly agentId: string | null;
  readonly workspaceId: string;
  readonly onAgent: (agentId: string | null) => void;
}) {
  const agents = useListedAgents();

  const listed = agents
    .filter((agent) => agent.workspaceId === workspaceId)
    .map((agent) => ({ id: agent.id, label: agentName(agent) }));

  const options = [
    { id: FIRST_RUN_ID, label: RUNS_AGENT_WORDS.FIRST_RUN },
    ...(agentId === null || listed.some((option) => option.id === agentId)
      ? []
      : [{ id: agentId, label: RUNS_AGENT_WORDS.NO_LONGER_LISTED }]),
    ...listed,
  ];

  return (
    <MenuPickRow
      label={RUNS_AGENT_WORDS.AGENT}
      options={options}
      picked={agentId ?? FIRST_RUN_ID}
      onPick={(id) => onAgent(id === FIRST_RUN_ID ? null : id)}
    />
  );
}

/**
 * Which of the owner's connected MCP servers a run's new agent is handed,
 * a switch each, every one on until switched off, as the agent box's
 * servers popover offers them. A run starts on its creator's connections,
 * so only its creator switches them; anyone else reads which were switched
 * off. A server not connected is connected in Settings.
 */
function ServerSections({
  mine,
  disabled,
  onDisabled,
}: {
  readonly mine: boolean;
  readonly disabled: readonly string[];
  readonly onDisabled: (disabled: readonly string[]) => void;
}) {
  const acts = useHostActs();
  const { data: account } = useQuery({ ...appStateQuery, select: selectAccount });
  useLiveFollow(signedInAccountId(account), () => acts[ACT_KIND.INTEGRATIONS_FOLLOW]());
  const answer = useQuery({ ...appStateQuery, select: selectIntegrations }).data?.rows;

  if (!mine) {
    return (
      <ListSection title={MCP_SERVER_LABEL.many} footer={SERVER_WORDS.THEIRS}>
        <ValueRow
          label={MCP_SERVER_LABEL.many}
          value={
            disabled.length === 0
              ? SENTRY_WORDS.ALL
              : `${SERVER_WORDS.ALL_BUT} ${andList(disabled.map(switchedOffName))}`
          }
        />
      </ListSection>
    );
  }

  const servers = answer === undefined ? undefined : handedServers(answer, disabled);

  return (
    <ListSection
      title={MCP_SERVER_LABEL.many}
      footer={servers?.length === 0 ? SERVER_WORDS.NONE : undefined}
    >
      {servers === undefined ? (
        <LoadingRow words={readingWords("your MCP servers")} />
      ) : (
        servers.map((server) => (
          <ToggleRow
            key={server.connection}
            label={server.name}
            on={server.on}
            onChange={(on) => onDisabled(switchedServers(disabled, server.connection, on))}
          />
        ))
      )}
    </ListSection>
  );
}

/** A webhook's secret as the write that minted it answered it, which this sheet alone holds, and the address its sender posts it to. */
interface MintedSecret {
  readonly secret: string;
  readonly address: string | undefined;
}

/**
 * A webhook's rows once it is saved as one: its address to copy, and New
 * secret, which asks first, since the new one stops the one a sender holds,
 * and then shows the new one once (`SecretRows`). Before it is saved as a
 * webhook, its footer says a save gives it both.
 */
function WebhookRows({
  automation,
  onMinted,
}: {
  readonly automation: AutomationSummary | undefined;
  readonly onMinted: (minted: MintedSecret) => void;
}) {
  const acts = useHostActs();
  const minting = useAsyncAction(() => ACT_UNREACHED_WORDS);
  const [asking, setAsking] = useState(false);

  const address =
    automation?.trigger.kind === AUTOMATION_TRIGGER.WEBHOOK ? automation.webhookUrl : undefined;

  if (automation === undefined || address === undefined) return null;

  const mint = () =>
    void minting.run(() =>
      acts[ACT_KIND.AUTOMATIONS_NEW_WEBHOOK_SECRET]({ automationId: automation.id }).then(
        (answer) => {
          if ("failure" in answer) return NEW_SECRET_REFUSAL_WORDS[answer.failure];

          if (answer.webhookSecret !== undefined) {
            onMinted({ secret: answer.webhookSecret, address });
          }

          return undefined;
        },
      ),
    );

  return (
    <>
      <ActionRow
        label={WEBHOOK_WORDS.COPY_ADDRESS}
        symbol={GLYPH.COPY}
        detail={address}
        onPress={() => copyForSender(address)}
      />
      <ActionRow
        label={WEBHOOK_WORDS.NEW_SECRET}
        disabled={minting.running}
        detail={minting.refusal}
        onPress={() => setAsking(true)}
      />
      <ConfirmAsk
        title={WEBHOOK_WORDS.NEW_SECRET_TITLE}
        message={WEBHOOK_WORDS.NEW_SECRET_BODY}
        act={WEBHOOK_WORDS.NEW_SECRET_VERB}
        destructive
        presented={asking}
        onDismiss={() => setAsking(false)}
        onAct={() => {
          setAsking(false);
          mint();
        }}
      />
    </>
  );
}

/**
 * A webhook's secret, shown the one time the write that minted it answers,
 * in the sheet that asked and nowhere else, as root AGENTS.md allows it: its
 * address and its secret, each to copy, and said never to be shown again.
 * Done closes the sheet, and the secret goes with it.
 */
function SecretScreen({
  minted,
  onDone,
}: {
  readonly minted: MintedSecret;
  readonly onDone: () => void;
}) {
  return (
    <>
      <EditorBar
        title={WEBHOOK_WORDS.SECRET}
        act={WEBHOOK_WORDS.DONE}
        busy={false}
        onAct={onDone}
        onCancel={onDone}
      />
      <Screen ground={SCREEN_GROUND.GROUPED}>
        <SettingsForm>
          {minted.address === undefined ? null : (
            <ListSection title={WEBHOOK_WORDS.ADDRESS} footer={WEBHOOK_WORDS.ADDRESS_DETAIL}>
              <ActionRow
                label={WEBHOOK_WORDS.COPY_ADDRESS}
                symbol={GLYPH.COPY}
                detail={minted.address}
                onPress={() => copyForSender(minted.address ?? "")}
              />
            </ListSection>
          )}
          <ListSection title={WEBHOOK_WORDS.SECRET} footer={WEBHOOK_WORDS.SECRET_ONCE}>
            <ActionRow
              label={WEBHOOK_WORDS.COPY_SECRET}
              symbol={GLYPH.COPY}
              detail={minted.secret}
              onPress={() => copyForSender(minted.secret)}
            />
          </ListSection>
        </SettingsForm>
      </Screen>
    </>
  );
}

function EditorForm({
  automation,
  workspace,
  offersOwner,
}: {
  readonly automation: AutomationSummary | undefined;
  readonly workspace: Workspace;
  readonly offersOwner: boolean;
}) {
  const acts = useHostActs();
  const repositories = useRepositoryPick(workspace);
  const { slackBot, sentry } = useEditorIntegrations(workspace.id);
  const saving = useAsyncAction(() => ACT_UNREACHED_WORDS);

  const [defaults] = useState<DraftDefaults>(() => ({
    timezone: readerZone(),
    owner: AUTOMATION_SCOPE.PERSONAL,
  }));

  const [start, setStart] = useState(() => automationDraft(automation, defaults));
  const [draft, setDraft] = useState(start);
  const [shownProblems, setShownProblems] = useState(false);
  const [seeded, setSeeded] = useState(automation !== undefined);
  // Note that a minted secret stands in this sheet's state alone, never the app's document, so it goes with the sheet.
  const [minted, setMinted] = useState<MintedSecret | undefined>(undefined);

  // Note that a new automation starts in the repository the account's tasks were about lately, as New task does, once the repositories are read.
  useEffect(() => {
    if (seeded || repositories.picked === undefined) return;
    const repository = repositories.picked;
    setSeeded(true);
    setStart((was) => ({ ...was, repository }));
    setDraft((was) => (was.repository === null ? { ...was, repository } : was));
  }, [seeded, repositories.picked]);

  useZonePicked((timezone) => edit({ timezone }));

  const saved = automation === undefined ? undefined : automationDraft(automation, defaults);
  const written = !sameDraft(draft, saved ?? start);
  const kept = useKeptWords(written);
  const close = useCloseSheet(kept);
  const problems = draftProblems(draft, repositoryHeld(automation), new Date(), saved);
  const shown = shownProblems ? problems : {};
  const mine = automation === undefined || automation.mine === true;
  const taskBacked = automation !== undefined && automation.taskId !== null;

  function edit(patch: Partial<AutomationDraft>) {
    setDraft((was) => ({ ...was, ...patch }));
    saving.clear();
  }

  const leave = () => {
    kept.release();
    close();
  };

  const save = () => {
    if (Object.keys(problems).length > 0) {
      setShownProblems(true);

      return;
    }

    const change = automation === undefined ? undefined : changeOf(draft, automation, defaults);

    if (automation !== undefined && change === undefined) {
      leave();

      return;
    }

    void saving.run(() =>
      (automation === undefined
        ? acts[ACT_KIND.AUTOMATIONS_CREATE](createRequestOf(draft, workspace.id))
        : acts[ACT_KIND.AUTOMATIONS_CHANGE]({ automationId: automation.id, change: change ?? {} })
      ).then((answer) => {
        if ("failure" in answer) return AUTOMATION_SAVE_REFUSAL_WORDS[answer.failure];

        // A save that made the webhook a secret stays open to show it once, as the desktop's editor does; any other closes.
        if (
          answer.automation.trigger.kind === AUTOMATION_TRIGGER.WEBHOOK &&
          answer.webhookSecret !== undefined
        ) {
          kept.release();
          setMinted({ secret: answer.webhookSecret, address: answer.automation.webhookUrl });

          return undefined;
        }

        leave();

        return undefined;
      }),
    );
  };

  // Note that Sentry is offered only where this deployment holds the integration, or where it was saved so, as the desktop's menu marks it unpickable.
  const triggers = AUTOMATION_TRIGGERS.filter(
    (trigger) =>
      trigger.value !== AUTOMATION_TRIGGER.INTEGRATION ||
      sentry?.configured !== false ||
      trigger.value === saved?.triggerKind,
  );

  const integration = draft.triggerKind === AUTOMATION_TRIGGER.INTEGRATION;

  const webhook = draft.triggerKind === AUTOMATION_TRIGGER.WEBHOOK;
  const github = draft.triggerKind === AUTOMATION_TRIGGER.GITHUB;

  const scheduled = draft.triggerKind === AUTOMATION_TRIGGER.SCHEDULE;
  const scheduleProblem = shown[DRAFT_FIELD.SCHEDULE];
  const nameNote = saving.refusal ?? shown[DRAFT_FIELD.NAME];

  // A repository the workspace no longer lists still stands as picked, so the menu never shows none picked.
  const repositoryOptions = [
    ...(draft.triggerKind === AUTOMATION_TRIGGER.GITHUB
      ? []
      : [{ id: NO_REPOSITORY_ID, label: AUTOMATION_EDITOR_WORDS.NO_REPOSITORY }]),
    ...(draft.repository === null ||
    repositories.options.some((option) => option.id === draft.repository)
      ? []
      : [{ id: draft.repository, label: draft.repository }]),
    ...repositories.options,
  ];

  const ownerName = (owner: typeof draft.owner) => automationOwnerName(owner, workspace.name, mine);

  if (minted !== undefined) return <SecretScreen minted={minted} onDone={leave} />;

  return (
    <>
      <EditorBar
        title={
          automation === undefined ? AUTOMATION_EDITOR_WORDS.NEW : AUTOMATION_EDITOR_WORDS.EDIT
        }
        act={
          automation === undefined
            ? saving.running
              ? AUTOMATION_EDITOR_WORDS.CREATING
              : AUTOMATION_EDITOR_WORDS.CREATE
            : saving.running
              ? AUTOMATION_EDITOR_WORDS.SAVING
              : AUTOMATION_EDITOR_WORDS.SAVE
        }
        busy={saving.running}
        onAct={save}
        onCancel={close}
      />
      <ConfirmAsk
        title={automation === undefined ? DISCARD_WORDS.QUESTION : DISCARD_CHANGES_WORDS.QUESTION}
        act={automation === undefined ? DISCARD_WORDS.DISCARD : DISCARD_CHANGES_WORDS.DISCARD}
        destructive
        presented={kept.asking}
        onAct={kept.discard}
        onDismiss={kept.stay}
      />
      <Screen ground={SCREEN_GROUND.GROUPED}>
        <SettingsForm>
          <ListSection
            title={AUTOMATION_EDITOR_WORDS.NAME}
            footer={nameNote}
            footerTone={footerToneOf(nameNote)}
          >
            <WordsField
              look={WORDS_LOOK.LINE}
              placeholder={AUTOMATION_EDITOR_WORDS.NAME_PLACEHOLDER}
              initialWords={draft.name}
              autoFocus={automation === undefined}
              onWords={(name) => edit({ name })}
              testId={NAME_FIELD_ID}
            />
          </ListSection>
          {offersOwner ? (
            <ListSection
              title={AUTOMATION_EDITOR_SECTION.SHARING}
              footer={
                draft.owner === AUTOMATION_SCOPE.WORKSPACE
                  ? workspaceOwnerDetail(
                      workspace.name,
                      mine ? AUTOMATION_EDITOR_WORDS.YOU : AUTOMATION_EDITOR_WORDS.ITS_CREATOR,
                    )
                  : AUTOMATION_EDITOR_WORDS.PERSONAL_OWNER_DETAIL
              }
            >
              <MenuPickRow
                label={AUTOMATION_EDITOR_WORDS.OWNER}
                options={[AUTOMATION_SCOPE.PERSONAL, AUTOMATION_SCOPE.WORKSPACE].map((owner) => ({
                  id: owner,
                  label: ownerName(owner),
                }))}
                picked={draft.owner}
                onPick={(id) =>
                  edit({
                    owner:
                      id === AUTOMATION_SCOPE.WORKSPACE
                        ? AUTOMATION_SCOPE.WORKSPACE
                        : AUTOMATION_SCOPE.PERSONAL,
                  })
                }
              />
            </ListSection>
          ) : null}
          <ListSection
            title={AUTOMATION_EDITOR_SECTION.TRIGGER}
            footer={
              scheduleProblem ??
              (scheduled
                ? nextRunsText(draft)
                : github
                  ? automationTriggerText(draftTrigger(draft), draftRepositories(draft))
                  : webhook
                    ? automation?.trigger.kind === AUTOMATION_TRIGGER.WEBHOOK
                      ? WEBHOOK_WORDS.ADDRESS_DETAIL
                      : WEBHOOK_WORDS.SAVE_FIRST
                    : SENTRY_EVENTS.find((each) => each.value === draft.integrationTrigger.event)
                        ?.detail)
            }
            footerTone={footerToneOf(scheduleProblem)}
          >
            {triggers.length > 1 ? (
              <MenuPickRow
                label={AUTOMATION_EDITOR_WORDS.TYPE}
                options={triggers.map((trigger) => ({ id: trigger.value, label: trigger.label }))}
                picked={draft.triggerKind}
                onPick={(id) => {
                  const kind = triggers.find((trigger) => trigger.value === id)?.value;

                  if (kind !== undefined) edit({ triggerKind: kind });
                }}
              />
            ) : null}
            {scheduled ? (
              <ScheduleRows draft={draft} onSchedule={(schedule) => edit({ schedule })} />
            ) : github ? (
              <GitHubRows
                event={draft.githubEvent}
                settings={draft.githubSettings}
                onEvent={(event) => edit(withGithubEvent(draft, event))}
                onSettings={(githubSettings) => edit({ githubSettings })}
              />
            ) : webhook ? (
              <WebhookRows automation={automation} onMinted={setMinted} />
            ) : (
              <MenuPickRow
                label={AUTOMATION_EDITOR_WORDS.EVENT}
                options={SENTRY_EVENTS.map((each) => ({ id: each.value, label: each.label }))}
                picked={draft.integrationTrigger.event}
                onPick={(id) => {
                  const picked = SENTRY_EVENTS.find((each) => each.value === id)?.value;

                  if (picked !== undefined) edit(withIntegrationEvent(draft, picked));
                }}
              />
            )}
          </ListSection>
          {integration ? (
            <SentrySections
              draft={draft}
              sentry={sentry}
              workspace={workspace}
              problems={shown}
              onDraft={edit}
            />
          ) : null}
          <ListSection
            title={AUTOMATION_EDITOR_SECTION.PROMPT}
            footer={shown[DRAFT_FIELD.PROMPT]}
            footerTone={FOOTER_TONE.FAILURE}
          >
            <WordsField
              placeholder={AUTOMATION_EDITOR_WORDS.PROMPT_PLACEHOLDER}
              label={AUTOMATION_EDITOR_SECTION.PROMPT}
              initialWords={draft.prompt}
              onWords={(prompt) => edit({ prompt })}
            />
          </ListSection>
          <ListSection
            title={AUTOMATION_EDITOR_SECTION.WHERE_IT_RUNS}
            footer={
              shown[DRAFT_FIELD.REPOSITORY] ??
              repositories.failed ??
              (draft.target === AUTOMATION_TARGET.SAME_AGENT
                ? draft.agentId === null
                  ? AUTOMATION_EDITOR_WORDS.FIRST_RUN_DETAIL
                  : AUTOMATION_EDITOR_WORDS.AGENT_DETAIL
                : taskBacked
                  ? AUTOMATION_EDITOR_WORDS.TASK_REPOSITORY
                  : undefined)
            }
            footerTone={footerToneOf(shown[DRAFT_FIELD.REPOSITORY] ?? repositories.failed)}
          >
            {taskBacked ? (
              <ValueRow
                label={AUTOMATION_EDITOR_WORDS.REPOSITORY}
                value={automation?.repositories?.[0] ?? AUTOMATION_EDITOR_WORDS.NO_REPOSITORY}
              />
            ) : repositories.read || repositoryOptions.length > 1 ? (
              <MenuPickRow
                label={AUTOMATION_EDITOR_WORDS.REPOSITORY}
                options={repositoryOptions}
                picked={draft.repository ?? NO_REPOSITORY_ID}
                onPick={(id) => edit(withRepository(draft, id === NO_REPOSITORY_ID ? null : id))}
              />
            ) : (
              <LoadingRow words={readingWords("the repositories")} />
            )}
            <MenuPickRow
              label={AUTOMATION_EDITOR_WORDS.RUNS_LAND_IN}
              options={AUTOMATION_TARGETS.map((target) => ({
                id: target.value,
                label: target.label,
              }))}
              picked={draft.target}
              onPick={(id) =>
                edit({
                  target:
                    id === AUTOMATION_TARGET.SAME_AGENT
                      ? AUTOMATION_TARGET.SAME_AGENT
                      : AUTOMATION_TARGET.NEW_AGENT,
                })
              }
            />
            {draft.target === AUTOMATION_TARGET.SAME_AGENT ? (
              <RunsAgentRow
                agentId={draft.agentId}
                workspaceId={workspace.id}
                onAgent={(agentId) => edit({ agentId })}
              />
            ) : (
              <>
                <ModelRows choice={draft.choice} onChoice={(choice) => edit({ choice })} />
                <ToggleRow
                  label={AUTOMATION_EDITOR_WORDS.MARK_DONE}
                  on={draft.archiveSuccessful}
                  onChange={(archiveSuccessful) => edit({ archiveSuccessful })}
                />
              </>
            )}
            {/* Note that a saved delivery stays offered once the bot is gone, so it can still be turned off. */}
            {slackBot || automation?.slackDelivery === true ? (
              <ToggleRow
                label={AUTOMATION_EDITOR_WORDS.SLACK_RESULT}
                on={draft.slackDelivery}
                onChange={(slackDelivery) => edit({ slackDelivery })}
              />
            ) : null}
          </ListSection>
          {draft.target === AUTOMATION_TARGET.SAME_AGENT ? null : (
            <ServerSections
              mine={mine}
              disabled={draft.disabledServers}
              onDisabled={(disabledServers) => edit({ disabledServers })}
            />
          )}
        </SettingsForm>
      </Screen>
    </>
  );
}

/**
 * New automation, or an automation's Edit where the route's `automation`
 * names one, in the workspace the app works in. Edit waits on the
 * workspace's automations, read as the list reads them, and says so while
 * they are read, where they could not be, and where the automation is gone.
 */
export function AutomationEditorScreen() {
  const { automation: automationId } = useLocalSearchParams<{ automation?: string }>();
  const workspace = useTasksWorkspace();
  const { data: workspaces = [] } = useQuery({ ...appStateQuery, select: selectWorkspaces });
  const read = useWorkspaceAutomations(automationId === undefined ? undefined : workspace?.id);
  const leave = useCloseSheet();
  const automation = read.rows?.find((each) => each.id === automationId);
  // Note that the account's first workspace is its personal one, where everything is its own, so only another offers an owner.
  const offersOwner = workspace !== undefined && workspaces[0]?.id !== workspace.id;

  if (workspace === undefined || (automationId !== undefined && automation === undefined)) {
    return (
      <>
        <EditorBar
          title={AUTOMATION_EDITOR_WORDS.EDIT}
          act={AUTOMATION_EDITOR_WORDS.SAVE}
          busy
          onAct={leave}
          onCancel={leave}
        />
        <Screen ground={SCREEN_GROUND.GROUPED}>
          {read.rows !== undefined ? (
            <EmptyState title={AUTOMATION_PHONE_WORDS.GONE} symbol={GLYPH.AUTOMATION} />
          ) : read.failed ? (
            <EmptyState
              title={AUTOMATION_PHONE_WORDS.FAILED}
              symbol={GLYPH.FAILED}
              retry={read.retry}
            />
          ) : (
            <EmptyState title={READING_AUTOMATIONS} symbol={GLYPH.AUTOMATION} loading />
          )}
        </Screen>
      </>
    );
  }

  return (
    <EditorForm
      key={workspace.id}
      automation={automation}
      workspace={workspace}
      offersOwner={offersOwner}
    />
  );
}

/**
 * The time zone a schedule is read in, as the desktop's zone menu lists
 * them: every zone the phone knows, the one picked checked, searched by the
 * bar's field. A pick hands the zone to the editor under it and goes back.
 */
export function TimeZoneScreen() {
  const { zone = "" } = useLocalSearchParams<{ zone?: string }>();
  const router = useRouter();
  const pick = useZonePick();
  const [query, setQuery] = useState("");

  const [zones] = useState(() => {
    const known = knownZones();
    const here = [zone, readerZone()].filter((each) => each !== "" && !known.includes(each));

    return [...new Set([...here, ...known])];
  });

  const needle = query.trim().toLowerCase();

  const found = zones.filter(
    (each) => needle === "" || zoneLabel(each).toLowerCase().includes(needle),
  );

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: AUTOMATION_EDITOR_WORDS.TIME_ZONE }}>
        <Stack.SearchBar
          placeholder={AUTOMATION_EDITOR_WORDS.SEARCH_ZONES}
          onChangeText={(event) => setQuery(event.nativeEvent.text)}
          onCancelButtonPress={() => setQuery("")}
        />
      </Stack.Screen>
      <Screen ground={SCREEN_GROUND.GROUPED}>
        {found.length === 0 ? (
          <EmptyState title={AUTOMATION_EDITOR_WORDS.NO_ZONES} symbol={GLYPH.SEARCH} />
        ) : (
          <SettingsForm>
            <ListSection>
              <PickRows
                options={found.map((each) => ({ id: each, label: zoneLabel(each) }))}
                picked={zone}
                onPick={(picked) => {
                  pick(picked);
                  router.back();
                }}
              />
            </ListSection>
          </SettingsForm>
        )}
      </Screen>
    </>
  );
}
