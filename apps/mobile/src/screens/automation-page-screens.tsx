// automation-page-screens.tsx -- one automation's page, as the desktop's editor reads it: its switch and Run now, what fires it and when it runs next, its prompt, where its runs work and land, who it is for and who made it, and its newest runs, each opening the agent it started; its ⋯ runs it, turns it, copies its link, takes it over, and deletes it.

import { firingMark } from "@repo/features/automation-firing-mark";
import {
  automationNextRuns,
  automationOwner,
  automationRunLine,
  automationRunStanding,
  automationRunTitle,
  automationTriggerText,
  RUNS_SHOWN,
  RUNS_SHOWN_NONE,
  RUNS_SHOWN_WORDS,
  type RunsShown,
  shownRuns,
} from "@repo/features/automation-list-model";
import {
  AUTOMATION_TARGET,
  AUTOMATION_TRIGGER,
  type AutomationRunSummary,
  type AutomationSummary,
} from "@repo/features/automation-wire";
import {
  AUTOMATION_DELETE_WORDS,
  AUTOMATION_PHONE_WORDS,
  AUTOMATION_TAKE_OVER_WORDS,
  automationDeleteTitle,
  automationNextText,
  automationOwnerFor,
  automationOwnerName,
  automationWhereWords,
  READING_AUTOMATIONS,
} from "@repo/features/automation-words";
import { iosAgentRoute } from "@repo/features/ios-app-links";
import { markdownPlainText } from "@repo/features/markdown-plain-text";
import { effortLabel } from "@repo/features/model-effort";
import { modelLabel } from "@repo/features/model-label";
import { scheduledText, sinceText } from "@repo/features/time-format";
import type { Workspace } from "@repo/features/workspace-wire";
import { selectWorkspaces } from "@repo/host/app-state-reads";
import {
  ActionRow,
  AUTOMATION_ROW_LOOK,
  AutomationRow,
  type BarMenu,
  ConfirmAsk,
  EmptyState,
  FailedReadRow,
  firingLook,
  GLYPH,
  glyphSymbol,
  LIST_LOOK,
  ListSection,
  LoadingRow,
  NoteRow,
  PUSH_ROW_GOES,
  PushRow,
  RowForEach,
  RowList,
  SCREEN_GROUND,
  Screen,
  SettingsForm,
  StackBarMenu,
  ToggleRow,
  TRY_AGAIN_WORDS,
  useColors,
  useMinute,
  ValueRow,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { editAutomationRoute } from "../automations/automation-editor-route.js";
import { automationRoute, automationRunsRoute } from "../automations/automation-routes.js";
import {
  type AutomationActs,
  type AutomationMaker,
  copyAutomationLink,
  copyAutomationWebhookUrl,
  takesOver,
  useAutomationActs,
  useAutomationMaker,
  useAutomationRuns,
  useWorkspaceAutomations,
  useWorkspaceRuns,
} from "../automations/use-automations.js";
import { useChosenWorkspace } from "../chosen-workspace.js";
import { appStateQuery } from "../host/app-state-query.js";
import { useOnOwnTab } from "../tab-route.js";

/** The bar's title before the automation is read: none, since its name comes with it. */
const NO_BAR_TITLE = "";

/** How many of its runs the page lists, newest first, as the panel's history first shows a page of them. */
const RECENT_RUNS = 10;

/** How many of a schedule's next runs the page lists under what fires it, as the desktop's editor says them. */
const NEXT_RUNS_SHOWN = 3;

/** Says first what is said of the switch's row under its name: when it runs next, where it says. */
function switchDetail(automation: AutomationSummary, now: number): string | undefined {
  return automation.enabled ? automationNextText(automation, now) : undefined;
}

/** Whom an automation is for, as a line opens: "For Acme", "Just for you". */
function ownerLine(automation: AutomationSummary, workspace: Workspace): string {
  const words = automationOwnerFor(
    automationOwner(automation),
    workspace.name,
    automation.mine === true,
  );

  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/** The repositories its runs work in, the first named first, or None. */
function repositoryValue(automation: AutomationSummary): string {
  const repositories = automation.repositories ?? [];

  return repositories.length === 0
    ? AUTOMATION_PHONE_WORDS.NO_REPOSITORY_VALUE
    : repositories.join(", ");
}

/** Where its runs land: a new agent each run, or the same agent, started by its first run where none stands yet. */
function targetValue(automation: AutomationSummary): string {
  const target = automation.target;

  if (target?.kind !== AUTOMATION_TARGET.SAME_AGENT) return AUTOMATION_PHONE_WORDS.NEW_AGENT;

  return target.agentId === null
    ? `${AUTOMATION_PHONE_WORDS.SAME_AGENT} · ${AUTOMATION_PHONE_WORDS.FIRST_RUN_AGENT}`
    : AUTOMATION_PHONE_WORDS.SAME_AGENT;
}

/** The model a run's new agent starts on, and its effort, or the account's default as it stands when a run starts. */
function modelValue(automation: AutomationSummary): string {
  const choice = automation.action.choice;

  return choice === undefined
    ? AUTOMATION_PHONE_WORDS.DEFAULT_MODEL
    : `${modelLabel(choice.model)} · ${effortLabel(choice.effort)}`;
}

/** A switch's standing as a value row says it. */
function onOff(on: boolean): string {
  return on ? AUTOMATION_PHONE_WORDS.YES : AUTOMATION_PHONE_WORDS.NO;
}

/** The page's ⋯: Edit, Run now and its switch, then Copy link, then Take over where the reader may, then Delete in red, which asks first. */
function automationMenu(
  automation: AutomationSummary,
  workspace: Workspace,
  acts: AutomationActs,
  maker: AutomationMaker | undefined,
  askDelete: () => void,
  edit: () => void,
): BarMenu {
  const takeOver = takesOver(maker, workspace)
    ? [
        {
          label: AUTOMATION_TAKE_OVER_WORDS.ACT,
          symbol: GLYPH.PERSON,
          onPress: () => acts.takeOver(automation),
        },
      ]
    : [];

  return {
    label: AUTOMATION_PHONE_WORDS.MORE,
    symbol: GLYPH.MORE,
    choices: [],
    actions: [
      { label: AUTOMATION_PHONE_WORDS.EDIT, symbol: GLYPH.EDIT, onPress: edit },
      {
        label: AUTOMATION_PHONE_WORDS.RUN_NOW,
        symbol: GLYPH.RUN,
        onPress: () => acts.runNow(automation),
      },
      {
        label: automation.enabled
          ? AUTOMATION_PHONE_WORDS.TURN_OFF
          : AUTOMATION_PHONE_WORDS.TURN_ON,
        symbol: automation.enabled ? GLYPH.PAUSE : GLYPH.PLAY,
        onPress: () => acts.turn(automation, !automation.enabled),
      },
    ],
    groups: [
      {
        items: [
          {
            label: AUTOMATION_PHONE_WORDS.COPY_LINK,
            symbol: GLYPH.LINK,
            onPress: () => copyAutomationLink(automation, workspace),
          },
          ...takeOver,
        ],
      },
      {
        items: [
          {
            label: AUTOMATION_PHONE_WORDS.DELETE,
            symbol: GLYPH.DELETE,
            destructive: true,
            onPress: askDelete,
          },
        ],
      },
    ],
  };
}

/**
 * One automation's page, by the id it is opened with, in the workspace the
 * app works in: the automation once the list holds it, the reading state
 * before, and that it is gone once the list holds it no more.
 */
export function AutomationPageScreen({ automationId }: { readonly automationId: string }) {
  const { data: workspaces = [] } = useQuery({ ...appStateQuery, select: selectWorkspaces });
  const { chosen } = useChosenWorkspace(workspaces);

  if (chosen === undefined) return null;

  // Note that the page is drawn anew for each workspace, so nothing of one workspace's automation stands over another's.
  return <AutomationPage key={chosen.id} workspace={chosen} automationId={automationId} />;
}

function AutomationPage({
  workspace,
  automationId,
}: {
  readonly workspace: Workspace;
  readonly automationId: string;
}) {
  const read = useWorkspaceAutomations(workspace.id);
  const acts = useAutomationActs();
  const automation = read.rows?.find((each) => each.id === automationId);

  if (automation === undefined) {
    return (
      <>
        <Stack.Screen options={{ title: NO_BAR_TITLE }} />
        <Screen ground={SCREEN_GROUND.GROUPED}>
          {read.rows !== undefined ? (
            <EmptyState title={AUTOMATION_PHONE_WORDS.GONE} symbol={GLYPH.AUTOMATION} />
          ) : read.failed ? (
            <EmptyState
              title={AUTOMATION_PHONE_WORDS.FAILED}
              symbol={GLYPH.FAILED}
              readFailed
              retry={read.retry}
            />
          ) : (
            <EmptyState title={READING_AUTOMATIONS} symbol={GLYPH.AUTOMATION} loading />
          )}
        </Screen>
      </>
    );
  }

  return <AutomationDetail automation={automation} workspace={workspace} acts={acts} />;
}

function AutomationDetail({
  automation,
  workspace,
  acts,
}: {
  readonly automation: AutomationSummary;
  readonly workspace: Workspace;
  readonly acts: AutomationActs;
}) {
  const router = useRouter();
  const colors = useColors();
  const now = useMinute();
  const maker = useAutomationMaker(automation, workspace.id);
  const [asking, setAsking] = useState(false);
  const edit = () => router.push(editAutomationRoute(automation.id));
  const menu = automationMenu(automation, workspace, acts, maker, () => setAsking(true), edit);
  const nextRuns = automationNextRuns(automation, now, NEXT_RUNS_SHOWN);

  const webhookUrl =
    automation.trigger.kind === AUTOMATION_TRIGGER.WEBHOOK ? automation.webhookUrl : undefined;

  const sameAgent = automation.target?.kind === AUTOMATION_TARGET.SAME_AGENT;

  return (
    <>
      <Stack.Screen options={{ title: automation.name }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.View>
          <StackBarMenu menu={menu} />
        </Stack.Toolbar.View>
        {/* Note that Edit stands as a glyph before ⋯, as a page's main act stands in its bar; it is written after ⋯ because a right bar's first item stands at its edge. */}
        <Stack.Toolbar.Button
          icon={glyphSymbol(GLYPH.EDIT)}
          tintColor={colors.TEXT}
          accessibilityLabel={AUTOMATION_PHONE_WORDS.EDIT}
          onPress={edit}
        >
          {AUTOMATION_PHONE_WORDS.EDIT}
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Screen ground={SCREEN_GROUND.GROUPED}>
        <SettingsForm>
          <ListSection>
            <ToggleRow
              label={AUTOMATION_PHONE_WORDS.ON}
              detail={switchDetail(automation, now)}
              on={automation.enabled}
              onChange={(enabled) => acts.turn(automation, enabled)}
            />
            <ActionRow
              label={AUTOMATION_PHONE_WORDS.RUN_NOW}
              symbol={GLYPH.RUN}
              onPress={() => acts.runNow(automation)}
            />
          </ListSection>
          <ListSection
            title={AUTOMATION_PHONE_WORDS.TRIGGER}
            footer={
              nextRuns.length === 0
                ? undefined
                : `${AUTOMATION_PHONE_WORDS.NEXT_RUNS}: ${nextRuns
                    .map((at) => scheduledText(at, now))
                    .join(", ")}`
            }
          >
            <NoteRow
              {...firingLook(firingMark(automation.trigger))}
              words={automationTriggerText(automation.trigger, automation.repositories ?? [])}
              line={ownerLine(automation, workspace)}
            />
            {webhookUrl === undefined ? null : (
              <ActionRow
                label={AUTOMATION_PHONE_WORDS.COPY_URL}
                symbol={GLYPH.COPY}
                detail={webhookUrl}
                onPress={() => copyAutomationWebhookUrl(webhookUrl)}
              />
            )}
          </ListSection>
          <ListSection title={AUTOMATION_PHONE_WORDS.PROMPT}>
            <NoteRow
              words={markdownPlainText(automation.action.prompt)}
              line={automationWhereWords(automation)}
            />
          </ListSection>
          <ListSection title={AUTOMATION_PHONE_WORDS.WHERE_IT_RUNS}>
            <ValueRow
              label={AUTOMATION_PHONE_WORDS.REPOSITORY}
              value={automation.taskName ?? repositoryValue(automation)}
            />
            <ValueRow label={AUTOMATION_PHONE_WORDS.RUNS_LAND_IN} value={targetValue(automation)} />
            {sameAgent ? null : (
              <>
                <ValueRow label={AUTOMATION_PHONE_WORDS.MODEL} value={modelValue(automation)} />
                <ValueRow
                  label={AUTOMATION_PHONE_WORDS.ARCHIVE_SUCCESSFUL}
                  value={onOff(automation.archiveSuccessful === true)}
                />
              </>
            )}
            <ValueRow
              label={AUTOMATION_PHONE_WORDS.SLACK_DELIVERY}
              value={onOff(automation.slackDelivery === true)}
            />
          </ListSection>
          <ListSection title={AUTOMATION_PHONE_WORDS.SHARING}>
            <ValueRow
              label={AUTOMATION_PHONE_WORDS.OWNER}
              value={automationOwnerName(
                automationOwner(automation),
                workspace.name,
                automation.mine === true,
              )}
            />
            {maker === undefined ? null : (
              <ValueRow label={AUTOMATION_PHONE_WORDS.CREATED_BY} value={maker.name} />
            )}
          </ListSection>
          <RecentRuns automationId={automation.id} now={now} />
        </SettingsForm>
      </Screen>
      <ConfirmAsk
        title={automationDeleteTitle(automation.name)}
        message={AUTOMATION_DELETE_WORDS.BODY}
        act={AUTOMATION_DELETE_WORDS.VERB}
        destructive
        presented={asking}
        onDismiss={() => setAsking(false)}
        onAct={() => {
          setAsking(false);
          acts.remove(automation);

          // Note that the page gives way to the list it stood over as the deletion goes, rather than saying the automation is gone.
          if (router.canGoBack()) router.back();
        }}
      />
    </>
  );
}

/** Opens the agent a run started on the tab the page stands on, so Back returns to the runs; a run that started no agent takes no press. */
function useOpenRunAgent(): (run: AutomationRunSummary) => (() => void) | undefined {
  const router = useRouter();
  const onOwnTab = useOnOwnTab();

  return (run) => {
    const agentId = run.agent?.id;

    return agentId === undefined ? undefined : () => router.push(onOwnTab(iosAgentRoute(agentId)));
  };
}

/** One run's row: what fired it, how it went, and when, opening its agent. */
function AutomationRunRow({
  run,
  now,
  onPress,
}: {
  readonly run: AutomationRunSummary;
  readonly now: number;
  readonly onPress: (() => void) | undefined;
}) {
  return (
    <AutomationRow
      title={automationRunTitle(run)}
      line={automationRunLine(run)}
      standing={automationRunStanding(run)}
      {...firingLook(firingMark(run.firing))}
      when={sinceText(run.firedAt, now)}
      onPress={onPress}
    />
  );
}

/** The automation's newest runs, each with how it went and when it fired, opening the agent it started, and All runs under them where it made more. */
function RecentRuns({
  automationId,
  now,
}: {
  readonly automationId: string;
  readonly now: number;
}) {
  const read = useAutomationRuns(automationId);
  const openAgent = useOpenRunAgent();
  const router = useRouter();
  const onOwnTab = useOnOwnTab();
  const runs = read.rows;

  return (
    <ListSection
      title={AUTOMATION_PHONE_WORDS.RUNS}
      footer={runs?.length === 0 ? AUTOMATION_PHONE_WORDS.NO_RUNS : undefined}
    >
      {runs === undefined ? (
        read.failed ? (
          <FailedReadRow
            label={AUTOMATION_PHONE_WORDS.RUNS_FAILED}
            act={TRY_AGAIN_WORDS}
            onPress={read.retry}
          />
        ) : (
          <LoadingRow words={AUTOMATION_PHONE_WORDS.READING_RUNS} />
        )
      ) : (
        <>
          {runs.slice(0, RECENT_RUNS).map((run) => (
            <AutomationRunRow key={run.id} run={run} now={now} onPress={openAgent(run)} />
          ))}
          {runs.length > RECENT_RUNS ? (
            <PushRow
              label={AUTOMATION_PHONE_WORDS.ALL_RUNS}
              symbol={GLYPH.HISTORY}
              detail={String(runs.length)}
              goes={PUSH_ROW_GOES.PAGE}
              onPress={() => router.push(onOwnTab(automationRunsRoute(automationId)))}
            />
          ) : null}
        </>
      )}
    </ListSection>
  );
}

/**
 * Every run an automation made, newest first, its name in the bar, each run
 * opening the agent it started. Note that the rows go through `RowForEach`,
 * which mounts only those near the screen, so a history of thousands of runs
 * opens as fast as one of ten.
 */
export function AutomationRunsScreen({ automationId }: { readonly automationId: string }) {
  const { data: workspaces = [] } = useQuery({ ...appStateQuery, select: selectWorkspaces });
  const { chosen } = useChosenWorkspace(workspaces);
  const listed = useWorkspaceAutomations(chosen?.id);
  const read = useAutomationRuns(automationId);
  const openAgent = useOpenRunAgent();
  const now = useMinute();
  const runs = read.rows;
  const name = listed.rows?.find((each) => each.id === automationId)?.name;

  return (
    <>
      <Stack.Screen options={{ title: AUTOMATION_PHONE_WORDS.ALL_RUNS }} />
      <Screen ground={SCREEN_GROUND.GROUPED}>
        {runs === undefined ? (
          read.failed ? (
            <EmptyState
              title={AUTOMATION_PHONE_WORDS.RUNS_FAILED}
              symbol={GLYPH.FAILED}
              readFailed
              retry={read.retry}
            />
          ) : (
            <EmptyState
              title={AUTOMATION_PHONE_WORDS.READING_RUNS}
              symbol={GLYPH.HISTORY}
              loading
            />
          )
        ) : runs.length === 0 ? (
          <EmptyState title={AUTOMATION_PHONE_WORDS.NO_RUNS} symbol={GLYPH.HISTORY} />
        ) : (
          <SettingsForm>
            <ListSection title={name} count={runs.length}>
              <RowForEach data={runs} keyOf={runKey}>
                {(run) => <AutomationRunRow run={run} now={now} onPress={openAgent(run)} />}
              </RowForEach>
            </ListSection>
          </SettingsForm>
        )}
      </Screen>
    </>
  );
}

/** A run's row id in its list. */
function runKey(run: AutomationRunSummary): string {
  return run.id;
}

/** What the workspace's runs are called, in the bar, as the desktop's tab names them. */
const WORKSPACE_RUNS_TITLE = "Runs";

/** What the runs' scopes are heard as. */
const SHOW_RUNS = "Show";

/**
 * Every run of the workspace's automations, newest first, as the desktop's
 * Runs tab lists them: All, Running, and Failed as the list's scopes, each
 * counting what it keeps, each run named by its automation over what fired
 * it and how it went, opening its agent, or its automation where it started
 * none. Note that the rows go through `RowForEach`, so a long history opens
 * at once.
 */
export function WorkspaceRunsScreen() {
  const { data: workspaces = [] } = useQuery({ ...appStateQuery, select: selectWorkspaces });
  const { chosen } = useChosenWorkspace(workspaces);
  const read = useWorkspaceRuns(chosen?.id);
  const openAgent = useOpenRunAgent();
  const router = useRouter();
  const onOwnTab = useOnOwnTab();
  const now = useMinute();
  const [shown, setShown] = useState<RunsShown>(RUNS_SHOWN.ALL);
  const runs = read.rows;
  const kept = runs === undefined ? [] : shownRuns(runs, shown);

  const scopes = {
    label: SHOW_RUNS,
    scopes: Object.values(RUNS_SHOWN).map((each) => ({
      label: RUNS_SHOWN_WORDS[each],
      count:
        each === RUNS_SHOWN.ALL || runs === undefined ? undefined : shownRuns(runs, each).length,
      selected: shown === each,
      onPress: () => setShown(each),
    })),
  };

  const empty =
    runs === undefined ? (
      read.failed ? (
        <EmptyState
          title={AUTOMATION_PHONE_WORDS.RUNS_FAILED}
          symbol={GLYPH.FAILED}
          readFailed
          retry={read.retry}
        />
      ) : (
        <EmptyState title={AUTOMATION_PHONE_WORDS.READING_RUNS} symbol={GLYPH.HISTORY} loading />
      )
    ) : kept.length === 0 ? (
      <EmptyState title={RUNS_SHOWN_NONE[shown]} symbol={GLYPH.HISTORY} />
    ) : undefined;

  return (
    <>
      <Stack.Screen options={{ title: WORKSPACE_RUNS_TITLE }} />
      <Screen>
        <RowList look={LIST_LOOK.PLAIN} scopes={scopes} empty={empty}>
          <RowForEach data={kept} keyOf={runKey}>
            {(run) => (
              <AutomationRow
                look={AUTOMATION_ROW_LOOK.LIST}
                title={run.automation.name}
                line={`${automationRunTitle(run)} · ${automationRunLine(run)}`}
                standing={automationRunStanding(run)}
                {...firingLook(firingMark(run.firing))}
                when={sinceText(run.firedAt, now)}
                onPress={
                  openAgent(run) ??
                  (() => router.push(onOwnTab(automationRoute(run.automation.id))))
                }
              />
            )}
          </RowForEach>
        </RowList>
      </Screen>
    </>
  );
}
