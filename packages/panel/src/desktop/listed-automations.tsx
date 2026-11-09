import { listedIn } from "@repo/features/inbox-list-model";
import type { AppInboxTasklessItem } from "@repo/host/app-state";
import { type ReactNode, useCallback } from "react";
import { AutomationDirectory } from "../automation-directory.js";
import { useAutomationsDoor } from "../places/routed-doors.js";
import { AUTOMATIONS_PAGE } from "../tasks/automations-place.js";
import { useInboxTaskless } from "../tasks/use-inbox-slices.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";

/**
 * listed-automations.tsx -- the listed workspace's automations, read around the whole window, so an agent's card on Home's rows or in ⌘K names the automation that started it as the task's own does.
 *
 * They are read only while an agent the window lists names an automation: one on a listed task, one of
 * the open task's agents, or one with no task whose question waits in the
 * listed workspace. The open task and the Inbox stand directories of their
 * own, which share this read where they are of the listed workspace
 * (`automation-directory.tsx`).
 */

/** Whether an agent the window lists names the automation that started it: a listed task's, followed live, the open task's, or one with no task whose question waits in the listed workspace, as Home's rows name it. */
function namesAutomation(
  tasks: TasksControl,
  inboxTaskless: readonly AppInboxTasklessItem[],
): boolean {
  const listed = new Set(tasks.tasks.map((task) => task.id));
  const lines = (tasks.liveAgents ?? []).filter(
    (agent) => agent.planId !== null && listed.has(agent.planId) && agent.archivedAt === undefined,
  );
  const agents = [...(tasks.agents.agents ?? []), ...(tasks.agents.archived ?? [])];
  return (
    [...lines, ...agents].some((agent) => agent.automationId !== undefined) ||
    inboxTaskless.some(
      (waiting) => waiting.automationId !== null && listedIn(waiting, tasks.workspace?.id),
    )
  );
}

/** The listed workspace's automations for everything inside. */
export function ListedAutomations({
  tasks,
  children,
}: {
  tasks: TasksControl;
  children: ReactNode;
}): React.JSX.Element {
  const { open: onOpen } = useAutomationsDoor(tasks);
  const taskless = useInboxTaskless();
  const openAutomation = useCallback(
    (automationId: string) => onOpen({ kind: AUTOMATIONS_PAGE.EDIT, automationId }),
    [onOpen],
  );
  return (
    <AutomationDirectory
      workspace={tasks.workspace}
      wanted={namesAutomation(tasks, taskless)}
      onOpen={openAutomation}
    >
      {children}
    </AutomationDirectory>
  );
}
