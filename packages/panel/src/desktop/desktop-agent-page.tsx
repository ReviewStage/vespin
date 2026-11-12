/**
 * desktop-agent-page.tsx -- an agent's own address, which opens the agent on its task, or says it is not found where it cannot be read.
 *
 * Every agent stands on a task, so an agent's page draws nothing of the
 * agent: its address, `/<workspace>/agent/<agentId>`, which an older link,
 * a step of the window's history, a reload, or a door naming an agent the
 * task list does not carry still lands on, opens the agent on its task, as
 * any door naming an agent does (`TasksControl.onShowAgent`). The agent is
 * read from the task list where it carries it, and else once by its id.
 * Until then the page stands in an agent tab's own shape saying Reading; an
 * agent the service does not hold for the reader, deleted or of a workspace
 * they are not in, is not found; and a read that did not land says so with
 * Retry, and Escape leaves it for wherever it was opened from. Its step is
 * never one Back or Forward goes to
 * (`places/routed-places.ts`'s `AGENT`), so Back from the task it opened on
 * passes over it.
 */

import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { readingWords } from "@repo/features/words";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import {
  ERROR_STATE_PLACEMENT,
  ErrorState,
  FILL_ELEMENT,
  Fill,
  NOT_FOUND_THING,
  NotFound,
  Toolbar,
} from "@repo/ui";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAppCommand } from "../app-commands.js";
import { unreadShown } from "../failure-report.js";
import { agentPageQueryOptions } from "../tasks/agent-reads.js";
import { AgentTabSkeleton } from "../tasks/agent-tab-skeleton.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { PhoneBack, PhoneHead, phoneBar } from "./phone-head.js";
import type { TaskHeadBack } from "./task-pane-switcher.js";

/** What the page says where the agent could not be read. */
const NOT_READ = "This agent could not be read.";

/** What a phone's bar names the page by. */
const PHONE_PLACE = "agent";

/** Where the agent of the page's address stands: on a task, nowhere the reader may open, not read yet, or not read at all. */
type AgentFound =
  | { readonly taskId: string }
  | { readonly missing: true }
  | { readonly reading: true }
  | { readonly failed: true; readonly onRetry: () => void };

/** The agent of `agentId` as the task list carries it, else as its one read by its id answered. */
function useAgentFound(tasks: TasksControl, agentId: string): AgentFound {
  const listed = tasks.liveAgents?.find((each) => each.id === agentId);
  const read = useQuery({ ...agentPageQueryOptions(agentId), enabled: listed === undefined });

  if (listed !== undefined) return { taskId: listed.planId };

  if (read.isPending) return { reading: true };
  const answer = read.data;

  if (answer !== undefined && !("failure" in answer)) return { taskId: answer.agent.planId };

  if (answer !== undefined && answer.failure === AGENT_CALL_FAILURE.NOT_FOUND) {
    return { missing: true };
  }

  return { failed: true, onRetry: () => void read.refetch() };
}

/** The page the agent of the address stands on while it is read, or the words saying why it is not opened. */
export function AgentRoutePage({
  tasks,
  away,
}: {
  tasks: TasksControl;
  /** A phone's way back out of the page, to the page it was opened from (`WindowHistory`'s `onLeave`); none elsewhere. */
  away?: TaskHeadBack | undefined;
}): React.JSX.Element {
  const { agentId } = useParams({ from: "/places/$workspace/agent/$agentId" });
  const found = useAgentFound(tasks, agentId);
  const taskId = "taskId" in found ? found.taskId : undefined;
  const { onShowAgent } = tasks;
  useAppCommand(APP_COMMAND.EXIT_AGENT_PAGE, tasks.agentView.onClose);
  useEffect(() => {
    if (taskId !== undefined) onShowAgent(taskId, agentId);
  }, [onShowAgent, taskId, agentId]);
  const back = away === undefined ? undefined : <PhoneBack back={away} />;

  if ("missing" in found) {
    return (
      <NotFound
        thing={NOT_FOUND_THING.AGENT}
        bar={back === undefined ? {} : phoneBar({ place: PHONE_PLACE, start: back, end: null })}
      />
    );
  }

  // In the page's own frame, so its row and sheet stand where the task's agent tab will.
  return (
    <div className="desktop-task relative flex min-h-0 flex-1" data-panel-open="false">
      <Fill as={FILL_ELEMENT.SECTION} className="agent-page" aria-label="Agent">
        {back === undefined ? (
          <Toolbar />
        ) : (
          <PhoneHead place={PHONE_PLACE} start={back} title={null} end={null} />
        )}
        {"failed" in found ? (
          <ErrorState
            failure={unreadShown(FAILURE_SURFACE.AGENTS_READ)}
            onRetry={found.onRetry}
            placement={ERROR_STATE_PLACEMENT.CENTERED}
          >
            {NOT_READ}
          </ErrorState>
        ) : (
          <Fill className="desktop-task-column">
            <AgentTabSkeleton label={readingWords("the agent")} />
          </Fill>
        )}
      </Fill>
    </div>
  );
}
