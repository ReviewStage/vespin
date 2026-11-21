// automation.tsx -- one automation's page under Settings › Automations, by the `automation` id it is pushed with: its switch and Run now, what fires it and for whom, its prompt and where its runs work, read-only, and its recent runs, each opening the agent it started.

import {
  automationOwner,
  automationRunLine,
  automationRunStanding,
  automationRunTitle,
  automationTriggerText,
} from "@repo/features/automation-list-model";
import type { AutomationRunSummary, AutomationSummary } from "@repo/features/automation-wire";
import {
  AUTOMATION_PHONE_WORDS,
  automationNextText,
  automationOwnerFor,
  automationWhereWords,
  READING_AUTOMATIONS,
} from "@repo/features/automation-words";
import { iosAgentRoute } from "@repo/features/ios-app-links";
import { sinceText } from "@repo/features/time-format";
import type { Workspace } from "@repo/features/workspace-wire";
import { selectWorkspaces } from "@repo/host/app-state-reads";
import {
  ActionRow,
  AutomationRow,
  EmptyState,
  FailedReadRow,
  GLYPH,
  ListSection,
  LoadingRow,
  NoteRow,
  SCREEN_GROUND,
  Screen,
  SettingsForm,
  ToggleRow,
  TRY_AGAIN_WORDS,
  useMinute,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  type AutomationActs,
  useAutomationActs,
  useAutomationRuns,
  useWorkspaceAutomations,
} from "../../automations/use-automations.js";
import { useChosenWorkspace } from "../../chosen-workspace.js";
import { appStateQuery } from "../../host/app-state-query.js";
import { useOnTab } from "../../tab-route.js";

export { ScreenBoundary as ErrorBoundary } from "../../screen-boundary.js";

/** The bar's title before the automation is read: none, since its name comes with it. */
const NO_BAR_TITLE = "";

/** How many of its runs the page lists, newest first, as the panel's history first shows a page of them. */
const RUNS_SHOWN = 10;

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

export default function AutomationScreen() {
  const { data: workspaces = [] } = useQuery({ ...appStateQuery, select: selectWorkspaces });
  const { chosen } = useChosenWorkspace(workspaces);

  if (chosen === undefined) return null;

  return <AutomationPage key={chosen.id} workspace={chosen} />;
}

function AutomationPage({ workspace }: { readonly workspace: Workspace }) {
  const { automation: automationId = "" } = useLocalSearchParams<{ automation: string }>();
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
  const now = useMinute();

  return (
    <>
      <Stack.Screen options={{ title: automation.name }} />
      <Screen ground={SCREEN_GROUND.GROUPED}>
        <SettingsForm>
          <ListSection footer={AUTOMATION_PHONE_WORDS.MADE_ELSEWHERE}>
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
          <ListSection title={AUTOMATION_PHONE_WORDS.TRIGGER}>
            <NoteRow
              symbol={GLYPH.AUTOMATION}
              words={automationTriggerText(automation.trigger, automation.repositories ?? [])}
              line={ownerLine(automation, workspace)}
            />
          </ListSection>
          <ListSection title={AUTOMATION_PHONE_WORDS.PROMPT}>
            <NoteRow
              symbol={GLYPH.AGENT}
              words={automation.action.prompt}
              line={automationWhereWords(automation)}
            />
          </ListSection>
          <RecentRuns automationId={automation.id} now={now} />
        </SettingsForm>
      </Screen>
    </>
  );
}

/**
 * The automation's newest runs, each with how it went and when it fired,
 * opening the agent it started on the agent's own page, the Settings sheet
 * going as it opens, as a link out of a sheet does; a run that started no
 * agent takes no press.
 */
function RecentRuns({
  automationId,
  now,
}: {
  readonly automationId: string;
  readonly now: number;
}) {
  const router = useRouter();
  const onTab = useOnTab();
  const read = useAutomationRuns(automationId);
  const runs = read.rows;

  // Note that navigate, not push, goes back to the tabs under the sheet, closing it, and opens the agent on them.
  const openAgent = (run: AutomationRunSummary) => {
    const agentId = run.agent?.id;

    return agentId === undefined ? undefined : () => router.navigate(onTab(iosAgentRoute(agentId)));
  };

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
        runs
          .slice(0, RUNS_SHOWN)
          .map((run) => (
            <AutomationRow
              key={run.id}
              title={automationRunTitle(run)}
              line={automationRunLine(run)}
              standing={automationRunStanding(run)}
              symbol={GLYPH.AGENT}
              when={sinceText(run.firedAt, now)}
              onPress={openAgent(run)}
            />
          ))
      )}
    </ListSection>
  );
}
