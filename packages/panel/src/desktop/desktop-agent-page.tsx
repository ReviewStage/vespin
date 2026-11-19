/**
 * desktop-agent-page.tsx -- an agent's own address, which opens an agent on a task on its task, draws an agent on no task as its own page, or says it is not found where it cannot be read.
 *
 * An agent on a task is drawn there, so its page draws nothing of it: its
 * address, `/<workspace>/agent/<agentId>`, which an older link, a step of
 * the window's history, a reload, or a door naming an agent the task list
 * does not carry still lands on, opens the agent on its task, as any door
 * naming an agent does (`TasksControl.onShowAgent`). An agent on no task,
 * as a Manager is, has no other place, so its page is its own: a head
 * naming it with its one menu (`agentMenuGroups`), and its conversation
 * with its box, the pane its tab on a task draws (`AgentPane`), no tabs
 * beside it. The agent is read from the task list where it carries it,
 * and else once by its id.
 * Until then the page stands in an agent tab's own shape saying Reading; an
 * agent the service does not hold for the reader, deleted or of a workspace
 * they are not in, is not found; and a read that did not land says so with
 * Retry. Its step is never one Back or Forward goes to
 * (`places/routed-places.ts`'s `AGENT`), so Back from the task it opened on
 * passes over it.
 */

import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
import { AGENT_BOUNDS, type ListedAgent, listedAgentOfPage } from "@repo/features/agent-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { TOOL_TARGET, type ToolTarget } from "@repo/features/tool-call-model";
import { readingWords } from "@repo/features/words";
import {
  ERROR_STATE_PLACEMENT,
  ErrorState,
  FILL_ELEMENT,
  Fill,
  moreLabel,
  NOT_FOUND_THING,
  NotFound,
  Toolbar,
  type ToolbarTitleEdit,
  useMenu,
} from "@repo/ui";
import { agentTab } from "@repo/ui/tab-strip-model";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { unreadShown } from "../failure-report.js";
import { agentName } from "../tasks/agent-model.js";
import { agentPageQueryOptions } from "../tasks/agent-reads.js";
import { AgentTabSkeleton } from "../tasks/agent-tab-skeleton.js";
import type { AgentsControl } from "../tasks/use-agents.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { ActionMenu } from "./action-menu.js";
import { agentMenuGroups, useAgentActions } from "./agent-actions.js";
import { AgentPane } from "./main-tabs.js";
import type { TaskHeadBack } from "./phone-head.js";
import { PhoneBack, PhoneHead, PlaceMore, phoneBar } from "./phone-head.js";
import { taskCards } from "./side-panel.js";
import { useTabViews } from "./strip-tabs.js";

/** What the page says where the agent could not be read. */
const NOT_READ = "This agent could not be read.";

/** What a phone's bar names the page by. */
const PHONE_PLACE = "agent";

/** What the agent's menu is named, as its head's ⋯ names it. */
const AGENT_THING = "Agent";

/** Where the agent of the page's address stands: on a task, on none, nowhere the reader may open, not read yet, or not read at all. */
type AgentFound =
  | { readonly taskId: string }
  | { readonly agent: ListedAgent }
  | { readonly missing: true }
  | { readonly reading: true }
  | { readonly failed: true; readonly onRetry: () => void };

/** The agent found on its task, or on none, where its page draws it. */
function placeFound(agent: ListedAgent): AgentFound {
  return agent.taskId === null ? { agent } : { taskId: agent.taskId };
}

/** The agent of `agentId` as the task list carries it, else as its one read by its id answered. */
function useAgentFound(tasks: TasksControl, agentId: string): AgentFound {
  const listed = tasks.liveAgents?.find((each) => each.id === agentId);
  const read = useQuery({ ...agentPageQueryOptions(agentId), enabled: listed === undefined });

  if (listed !== undefined) return placeFound(listed);

  if (read.isPending) return { reading: true };
  const answer = read.data;

  if (answer !== undefined && !("failure" in answer)) {
    return placeFound(listedAgentOfPage(answer.agent));
  }

  if (answer !== undefined && answer.failure === AGENT_CALL_FAILURE.NOT_FOUND) {
    return { missing: true };
  }

  return { failed: true, onRetry: () => void read.refetch() };
}

/**
 * The window's agents control with the page's agent its only one, among
 * the archived where it is archived, as a task's lists its own, so its
 * pane, its box, and its menu read and write it as its tab on a task does.
 */
function useOwnAgents(tasks: TasksControl, agent: ListedAgent): AgentsControl {
  const control = tasks.agents;

  return useMemo(() => {
    const archived = agent.archivedAt !== undefined;

    return {
      ...control,
      agents: archived ? [] : [agent],
      archived: archived ? [agent] : [],
      agentIds: [agent.id],
      heldIds: [agent.id],
    };
  }, [control, agent]);
}

/**
 * The head of an agent on no task: its name, a right-click on which opens
 * its one menu and whose Rename turns it into the name's field, and ⋯
 * holding the same menu; on a phone, its way back before them.
 */
function OwnAgentHead({
  tasks,
  agents,
  agent,
  label,
  away,
}: {
  tasks: TasksControl;
  agents: AgentsControl;
  agent: ListedAgent;
  label: string;
  away: TaskHeadBack | undefined;
}): React.JSX.Element {
  const { shown } = tasks;
  const titleMenu = useMenu(shown);

  const actions = useAgentActions(agent, agents, {
    label,
    shown,
    // Note that no side panel stands beside the page, so it opens no terminal.
    terminals: { onOpenTerminal: undefined },
    onDeleted: away?.onPress,
  });

  const groups = agentMenuGroups({ ...actions.doors, subject: actions.subject });
  const { rename } = actions;
  const editing = rename?.editing === true;

  const titleEdit: ToolbarTitleEdit | undefined = editing
    ? {
        label: "Agent name",
        maxLength: AGENT_BOUNDS.MAX_TITLE_CHARS,
        onEnd: (end) => rename.end(end.value),
      }
    : undefined;

  const more = <PlaceMore thing={AGENT_THING} shown={shown} groups={() => groups} />;

  return (
    <>
      {away === undefined ? (
        <Toolbar
          title={editing ? (rename.asked ?? label) : label}
          titleMenu={{ contextMenu: titleMenu.contextMenu(), keyMenu: titleMenu.keyMenu }}
          titleEdit={titleEdit}
          actions={more}
        />
      ) : (
        <PhoneHead
          place={PHONE_PLACE}
          start={<PhoneBack back={away} />}
          title={editing ? (rename.asked ?? label) : label}
          titleEdit={titleEdit}
          end={more}
        />
      )}
      {titleMenu.drawn === undefined ? null : (
        <ActionMenu
          label={moreLabel(AGENT_THING)}
          menu={titleMenu.drawn}
          groups={groups}
          onClose={titleMenu.close}
        />
      )}
      {actions.dialog}
    </>
  );
}

/**
 * An agent on no task as its own page draws it: its head, and under it its
 * conversation and box, the pane its tab on a task draws, a row naming a
 * task opening that task, and one naming anything else opening nothing.
 */
function OwnAgentPage({
  tasks,
  agent,
  away,
}: {
  tasks: TasksControl;
  agent: ListedAgent;
  away: TaskHeadBack | undefined;
}): React.JSX.Element {
  const agents = useOwnAgents(tasks, agent);
  const views = useTabViews();
  const label = agentName(agent, agents.models);
  const cards = taskCards({ agents, held: views.held, chosen: () => false, pages: undefined });

  const openTarget = (target: ToolTarget) => {
    if (target.kind !== TOOL_TARGET.TASK) return;

    if (target.agent === undefined) tasks.onShowTask(target.task);
    else tasks.onShowAgent(target.task, target.agent);
  };

  return (
    <div className="desktop-task relative flex min-h-0 flex-1" data-panel-open="false">
      <Fill as={FILL_ELEMENT.SECTION} className="agent-page" aria-label={label}>
        <OwnAgentHead tasks={tasks} agents={agents} agent={agent} label={label} away={away} />
        <Fill className="desktop-task-column">
          <AgentPane
            label={label}
            tabbed={false}
            tab={agentTab(agent.id)}
            agents={agents}
            shown={tasks.shown}
            views={views}
            // Note that a worker's tab stands on a task's strip alone, so its row only follows its standing.
            onOpenDelegation={(_agent, callId, _task, status) =>
              views.onWorkerStatus(callId, status)
            }
            onOpenTarget={openTarget}
            cards={cards}
          />
        </Fill>
      </Fill>
    </div>
  );
}

/** The page the agent of the address stands on: its own where it is on no task, else what stands while it is read, or the words saying why it is not opened. */
export function AgentRoutePage({
  tasks,
  away,
}: {
  tasks: TasksControl;
  /** A phone's way back out of the page, the window's Back; none elsewhere. */
  away?: TaskHeadBack | undefined;
}): React.JSX.Element {
  const { agentId } = useParams({ from: "/places/$workspace/agent/$agentId" });
  const found = useAgentFound(tasks, agentId);
  const taskId = "taskId" in found ? found.taskId : undefined;
  const { onShowAgent } = tasks;
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

  if ("agent" in found)
    return <OwnAgentPage key={agentId} tasks={tasks} agent={found.agent} away={away} />;

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
