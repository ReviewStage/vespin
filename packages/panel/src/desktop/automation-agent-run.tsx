import type { AgentSummary } from "@repo/features/agent-wire";
import {
  AGENT_STATUS_WORDS,
  type AutomationRunPlace,
  automationFiringTitle,
  automationRunLine,
  automationRunPlace,
} from "@repo/features/automation-list-model";
import { automationRun } from "@repo/features/model-label";
import { momentText, sinceText } from "@repo/features/time-format";
import {
  FiringGlyph,
  GAP,
  Inline,
  PAGER_AXIS,
  PAGER_COUNT,
  Pager,
  PaneBar,
  QuietWords,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  type ToolbarPlace,
  Tooltip,
  useMinute,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { useQuery } from "@tanstack/react-query";
import { automationsQuery } from "../live-reads.js";
import type { AutomationsDoor } from "../places/routed-doors.js";
import { AUTOMATIONS_PAGE } from "../tasks/automations-place.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { useAutomationRuns } from "./use-automation-runs.js";

/**
 * automation-agent-run.tsx -- what a run's task says of the automation run that started its agent: the path to its automation, the run's bar under the task's, and the arrows through the automation's other runs.
 *
 * An agent an automation's run started stands on a task the run made, so
 * that task's bar leads with where it came from, Automations
 * and then its automation, each a press back to that page (the
 * automation's editor), each wearing its glyph, the automation the glyph of
 * what fires it as its row in the Automations list does, so the two are
 * drawn alike, the agent's own name last. Under the bar the run's
 * own bar, a tab's (`PaneBar`), says what fired its run, as the automation's runs panel says it (the
 * firing's glyph and words), when it fired, and where the agent stands as a
 * badge, whose hint is the run's line as that panel reads it. At the bar's
 * end, before its ⋯, two arrows step to the agents of the automation's runs
 * either side, older to the left and newer to the right, with "Run 3 of 5"
 * between them, counted from the oldest. Only runs that started an agent are
 * stepped through, each agent once, at its newest run. The runs are the
 * automation's own, followed live as its runs panel follows them, so a
 * newer run lands while the task stands; an agent whose run is not among
 * them (an automation deleted, or a run older than the runs read) keeps its
 * path and draws no run's bar and no arrows.
 */

/** What the trail's outer place is called, as the automation editor's names it. */
const AUTOMATIONS_PLACE = "Automations";

/** What the arrows are called. */
const OLDER_RUN = "Older run";
const NEWER_RUN = "Newer run";

/** What the place between the arrows counts, as it says it: "Run 3 of 5". */
const RUN_NOUN = "Run";

/**
 * An automation's glyph: what fires it (a clock, GitHub's or Sentry's mark),
 * as its row in the Automations list wears it, read off the workspace's
 * automations; the automation's own glyph while they are not read, and for
 * one deleted since.
 */
export function AutomationGlyph({
  workspaceId,
  automationId,
}: {
  workspaceId: string | undefined;
  automationId: string | undefined;
}): React.JSX.Element {
  const { data } = useQuery(automationsQuery(workspaceId));
  const trigger = data?.find((automation) => automation.id === automationId)?.trigger;

  return trigger === undefined ? <GLYPH.AUTOMATION /> : <FiringGlyph of={trigger} />;
}

/** The trail an agent an automation started leads its bar with; none for any other agent. */
export function automationTrail(
  agent: Pick<AgentSummary, "automationId" | "automationName">,
  workspaceId: string | undefined,
  onOpen: AutomationsDoor["open"],
): readonly ToolbarPlace[] | undefined {
  // Note that a run from before its origin was kept has no name to lead with, so it draws none.
  const name = automationRun(agent)?.name;

  if (name === undefined) return undefined;
  const { automationId } = agent;

  const automations: ToolbarPlace = {
    label: AUTOMATIONS_PLACE,
    icon: <GLYPH.AUTOMATION />,
    onPress: () => onOpen({ kind: AUTOMATIONS_PAGE.LIST }),
  };

  // Note that an automation deleted since keeps its name on the agent, but there is no page to open.
  if (automationId === undefined) return [automations];

  return [
    automations,
    {
      label: name,
      icon: <AutomationGlyph workspaceId={workspaceId} automationId={automationId} />,
      onPress: () => onOpen({ kind: AUTOMATIONS_PAGE.EDIT, automationId }),
    },
  ];
}

/**
 * Opens the agent of an automation's run where it works: on its task, its
 * tab chosen, as any agent on a task opens, so the run's other agents stand
 * beside it as tabs; through its own address where the window does not list
 * it yet, which reads it and opens it on its task or says it is not found.
 */
export function openRunAgent(
  tasks: Pick<TasksControl, "liveAgents" | "onShowAgent" | "agentView">,
  agentId: string,
): void {
  const planId = tasks.liveAgents?.find((each) => each.id === agentId)?.planId;

  if (planId === undefined) tasks.agentView.onOpen(agentId);
  else tasks.onShowAgent(planId, agentId);
}

/** The agent an automation's run started on its task: the first started of the task's agents a run names, archived ones among them; none on a task no run made. */
export function runAgentOf(agents: readonly AgentSummary[]): AgentSummary | undefined {
  return agents
    .filter((agent) => automationRun(agent)?.name !== undefined)
    .reduce<AgentSummary | undefined>(
      (first, agent) => (first === undefined || agent.createdAt < first.createdAt ? agent : first),
      undefined,
    );
}

/** Where the page's agent's run stands among its automation's runs, followed live; none for an agent no automation started, or while its run is not read. */
export function useAutomationRunPlace(
  agent: Pick<AgentSummary, "id" | "automationId"> | undefined,
): AutomationRunPlace | undefined {
  const { read } = useAutomationRuns(agent?.automationId);

  if (agent === undefined || read === undefined || !("runs" in read)) return undefined;

  return automationRunPlace(read.runs, agent.id);
}

/** The run's bar under the page's, as tall and on the same ground as a tab's: what fired the run, when, and where its agent stands. */
export function AutomationRunStrip({
  place,
  status,
}: {
  place: AutomationRunPlace;
  /** The agent's own status, read live with the page's agent rather than off the run. */
  status: AgentSummary["status"];
}): React.JSX.Element {
  const now = useMinute();
  const { run } = place;
  const line = automationRunLine(run);

  return (
    <PaneBar
      mark={<FiringGlyph of={run.firing} />}
      title={automationFiringTitle(run.firing)}
      detail={
        <Inline gap={GAP.ITEM} wrap={false}>
          <Tooltip label={momentText(run.firedAt)}>
            <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              <ReplayUnmask>{sinceText(run.firedAt, now)}</ReplayUnmask>
            </Text>
          </Tooltip>
          <Tooltip label={line}>
            <span>
              <QuietWords>
                <ReplayUnmask>{AGENT_STATUS_WORDS[status]}</ReplayUnmask>
              </QuietWords>
            </span>
          </Tooltip>
        </Inline>
      }
    />
  );
}

/** The arrows through the automation's runs, older to the left and newer to the right, each stepped back at its end, and where this run stands between them. */
export function AutomationRunSteps({
  place,
  onOpenAgent,
}: {
  place: AutomationRunPlace;
  onOpenAgent: (agentId: string) => void;
}): React.JSX.Element {
  const { older, newer } = place;

  return (
    <Pager
      axis={PAGER_AXIS.HORIZONTAL}
      count={PAGER_COUNT.BETWEEN}
      place={{ at: place.at, total: place.count, noun: RUN_NOUN }}
      previous={{
        label: OLDER_RUN,
        onStep: older === undefined ? undefined : () => onOpenAgent(older),
      }}
      next={{
        label: NEWER_RUN,
        onStep: newer === undefined ? undefined : () => onOpenAgent(newer),
      }}
    />
  );
}
