// automation-editor-screens.tsx -- New automation and an automation's Edit, as a sheet of the desktop's automation editor: its name, who owns it, what fires it, its prompt, and where its runs work; and the time zone its schedule is read in, pushed over it in the sheet.

import {
  type AutomationDraft,
  automationDraft,
  changeOf,
  createRequestOf,
  DRAFT_FIELD,
  type DraftDefaults,
  draftNextRuns,
  draftProblems,
  draftTrigger,
  repositoryHeld,
  SCHEDULE_KIND,
  type ScheduleDraft,
  sameDraft,
  withRepository,
  withScheduleKind,
} from "@repo/features/automation-draft-model";
import {
  AUTOMATION_EDITOR_SECTION,
  AUTOMATION_EDITOR_WORDS,
  AUTOMATION_TARGETS,
  AUTOMATION_TRIGGERS,
  HOURLY_MINUTES,
  hourlyLabel,
  nextRunWords,
  SCHEDULE_KINDS,
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
} from "@repo/features/automation-wire";
import {
  AUTOMATION_PHONE_WORDS,
  AUTOMATION_SAVE_REFUSAL_WORDS,
  automationOwnerName,
  READING_AUTOMATIONS,
} from "@repo/features/automation-words";
import { readerZone } from "@repo/features/date-mention";
import { LIVE_READ } from "@repo/features/live-wire";
import { effortFor, effortsOf } from "@repo/features/model-effort";
import { type CatalogModel, type ModelChoice, standardModelIdOf } from "@repo/features/models-wire";
import { dayAndTimeText, timeZoneNames } from "@repo/features/time-format";
import { ACT_UNREACHED_WORDS, readingWords } from "@repo/features/words";
import type { Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { selectAgentDefault, selectWorkspaces } from "@repo/host/app-state-reads";
import {
  BAR_TITLE,
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
  NoteRow,
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
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { timeZoneRoute } from "../automations/automation-editor-route.js";
import { useWorkspaceAutomations } from "../automations/use-automations.js";
import { useZonePick, useZonePicked } from "../automations/zone-pick.js";
import { useCloseSheet } from "../close-sheet.js";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import { useLiveFollow } from "../host/live-follow.js";
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
  /** A trigger this sheet does not edit yet, said under its sentence. */
  TRIGGER_ELSEWHERE: "Change this trigger on the desktop or the web for now.",
  /** Where a schedule's custom cron is typed, as its field says before anything is. */
  CRON_PLACEHOLDER: "0 9 * * 1-5",
} as const;

/** The repository picker's choice of none, which a run then works in. Note that no repository's full name lacks its owner's slash, so this never names one. */
const NO_REPOSITORY_ID = "none";

/** How many of a schedule's next runs its footer names. */
const NEXT_RUNS_SHOWN = 3;

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

/** Whether the workspace's Slack bot is connected, so a run's result may be sent on Slack, followed while the sheet stands; not while its read is out or failed. */
function useSlackBot(workspaceId: string): boolean {
  const acts = useHostActs();
  useLiveFollow(workspaceId, (id) =>
    acts[ACT_KIND.WORKSPACE_INTEGRATIONS_FOLLOW]({ workspaceId: id }),
  );

  const select = useMemo(
    () => (state: AppStateSnapshot) =>
      state[LIVE_READ.WORKSPACE_INTEGRATIONS][workspaceId]?.rows?.slack.team !== undefined,
    [workspaceId],
  );

  return useQuery({ ...appStateQuery, select }).data === true;
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
  const slackBot = useSlackBot(workspace.id);
  const saving = useAsyncAction(() => ACT_UNREACHED_WORDS);

  const [defaults] = useState<DraftDefaults>(() => ({
    timezone: readerZone(),
    owner: AUTOMATION_SCOPE.PERSONAL,
  }));

  const [start, setStart] = useState(() => automationDraft(automation, defaults));
  const [draft, setDraft] = useState(start);
  const [shownProblems, setShownProblems] = useState(false);
  const [seeded, setSeeded] = useState(automation !== undefined);

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
        leave();

        return undefined;
      }),
    );
  };

  // Note that only a schedule is edited here, so a trigger of another kind is offered beside it only where it was saved so.
  const triggers = AUTOMATION_TRIGGERS.filter(
    (trigger) =>
      trigger.value === AUTOMATION_TRIGGER.SCHEDULE || trigger.value === saved?.triggerKind,
  );

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
              scheduled
                ? (scheduleProblem ?? nextRunsText(draft))
                : (scheduleProblem ?? WORDS.TRIGGER_ELSEWHERE)
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
            ) : (
              <NoteRow
                symbol={GLYPH.AUTOMATION}
                words={automationTriggerText(draftTrigger(draft), automation?.repositories ?? [])}
                line={
                  AUTOMATION_TRIGGERS.find((each) => each.value === draft.triggerKind)?.label ?? ""
                }
              />
            )}
          </ListSection>
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
            {draft.target === AUTOMATION_TARGET.SAME_AGENT ? null : (
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
