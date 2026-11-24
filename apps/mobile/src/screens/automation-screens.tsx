// automation-screens.tsx -- the automations of the workspace the app works in, as the Automations tab and Settings' Automations page stand them: the workspace's first and then the reader's own, each with what fires it, when it runs next, and how its newest run went, opening its own page on a press, with Run now and its switch behind a swipe and a long press; made and changed on the desktop and the web.

import {
  AUTOMATION_RUN_STANDING,
  automationGroups,
  automationRunStanding,
} from "@repo/features/automation-list-model";
import type { AutomationSummary } from "@repo/features/automation-wire";
import {
  AUTOMATION_PHONE_WORDS,
  automationLastRunWords,
  automationOwnerName,
  automationPhoneLine,
  READING_AUTOMATIONS,
} from "@repo/features/automation-words";
import { sinceText } from "@repo/features/time-format";
import type { Workspace } from "@repo/features/workspace-wire";
import { selectWorkspaces } from "@repo/host/app-state-reads";
import {
  AutomationRow,
  EmptyState,
  GLYPH,
  ListSection,
  SCREEN_GROUND,
  Screen,
  SettingsForm,
  useMinute,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import {
  automationRowActs,
  useAutomationActs,
  useWorkspaceAutomations,
} from "../automations/use-automations.js";
import { useChosenWorkspace } from "../chosen-workspace.js";
import { appStateQuery } from "../host/app-state-query.js";
import { SETTINGS_ROUTE } from "../settings-button.js";

/** When an automation's newest run fired, at its row's end; none while it is at work, whose mark says so, or for one that never ran. */
function lastRunWhen(automation: AutomationSummary, now: number): string | undefined {
  const run = automation.lastRun;

  if (run === null || automationRunStanding(run) === AUTOMATION_RUN_STANDING.WORKING) {
    return undefined;
  }

  return sinceText(run.firedAt, now);
}

/**
 * The automations of the workspace the app works in, as the Automations tab
 * and Settings' Automations page both stand them; nothing until a workspace
 * is chosen.
 */
export function AutomationsScreen() {
  const { data: workspaces = [] } = useQuery({ ...appStateQuery, select: selectWorkspaces });
  const { chosen } = useChosenWorkspace(workspaces);

  if (chosen === undefined) return null;

  // Note that the page is drawn anew for each workspace, so nothing of one workspace's list stands over another's.
  return <AutomationsPage key={chosen.id} workspace={chosen} />;
}

function AutomationsPage({ workspace }: { readonly workspace: Workspace }) {
  const router = useRouter();
  const now = useMinute();
  const read = useWorkspaceAutomations(workspace.id);
  const acts = useAutomationActs();
  const automations = read.rows;
  const groups = automations === undefined ? [] : automationGroups(automations);

  // Note that an automation's page is Settings' own for now, anchored so it opens as Settings' sheet from the tab too, its Back going to Settings' list.
  const open = (automation: AutomationSummary) =>
    router.push(
      { pathname: SETTINGS_ROUTE.AUTOMATION, params: { automation: automation.id } },
      { withAnchor: true },
    );

  const body =
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
      <EmptyState
        title={AUTOMATION_PHONE_WORDS.EMPTY}
        description={AUTOMATION_PHONE_WORDS.MADE_ELSEWHERE}
        symbol={GLYPH.AUTOMATION}
      />
    ) : (
      <SettingsForm>
        {groups.map((group, index) => (
          <ListSection
            key={group.owner}
            title={automationOwnerName(group.owner, workspace.name, true)}
            footer={index === groups.length - 1 ? AUTOMATION_PHONE_WORDS.MADE_ELSEWHERE : undefined}
          >
            {group.automations.map((automation) => (
              <AutomationRow
                key={automation.id}
                title={automation.name}
                line={automationPhoneLine(automation, now)}
                standing={automationRunStanding(automation.lastRun)}
                standingWords={automationLastRunWords(automation)}
                symbol={GLYPH.AUTOMATION}
                when={lastRunWhen(automation, now)}
                faded={!automation.enabled}
                onPress={() => open(automation)}
                acts={automationRowActs(automation, acts)}
              />
            ))}
          </ListSection>
        ))}
      </SettingsForm>
    );

  return <Screen ground={SCREEN_GROUND.GROUPED}>{body}</Screen>;
}
