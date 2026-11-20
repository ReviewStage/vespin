import {
  AGENT_BOUNDS,
  AGENT_KIND,
  type AgentPullRequest,
  type AgentSummary,
} from "@repo/features/agent-wire";
import { openerOf } from "@repo/features/link-standing-model";
import { machineAsksByAgent } from "@repo/features/machine-ask-live";
import { readsUnread } from "@repo/features/read-mark";
import {
  STARTED_STANDING,
  type StartedAgentsStanding,
  startedHeard,
  startedShown,
} from "@repo/features/task-agents-model";
import { selectAgentPinned } from "@repo/host/app-state-reads";
import {
  InlineEdit,
  type ListRowFold,
  type ListRowNest,
  RowHint,
  RowHintOptions,
  TASK_ROW_CELL,
  TASK_ROW_EDGES,
  TaskRow,
  type TaskRowCell,
  TaskRowGlyph,
  Time,
  WorkingCount,
} from "@repo/ui";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import type { VirtualRowPlace } from "@repo/ui/virtual-rows";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useMemo, useRef } from "react";
import { commandAction, PANEL_COMMAND } from "../command-items.js";
import { useMachineAsks } from "../machine-asks.js";
import { failedUnderMark } from "../state-glyph.js";
import { RENAME_FAILED } from "../tasks/agent-model.js";
import type { AgentSubject } from "../tasks/agent-ref.js";
import { changesAddressOf, useChangesPeople } from "../tasks/changes-people.js";
import { PullRequestCard, peopleOf } from "../tasks/pull-request-card.js";
import { PullRequestChip } from "../tasks/pull-request-chip.js";
import { RunsOnPlace } from "../tasks/runs-on.js";
import { AgentGlyph, agentEndMark } from "../tasks/tab-look.js";
import type { AgentsControl } from "../tasks/use-agents.js";
import { useAgentPinWrite } from "../tasks/use-pin-writes.js";
import { appStateQuery, selectFixtureStaged } from "../use-app-state.js";
import { useRefocusAfterEdit } from "../use-refocus-after-edit.js";
import { type MenuEntry, rowMenu } from "./action-menu.js";
import { agentMenuGroups, rowDoors, useAgentActions } from "./agent-actions.js";
import { WaitingCount } from "./task-row-parts.js";
import { type ChosenRows, chosenRowMenu } from "./tasks-selection.js";

/**
 * agent-list-row.tsx -- one agent as every list of agents draws it, at the head of a task's description and on a person's page alike, in a task's row's anatomy, offering the agent's one menu, so the lists never drift.
 *
 * The row is a `TaskRow` in a list of its own (`TaskRows`, or
 * `VirtualTaskRows` where it draws only the rows near the view), its cells
 * `AGENT_ROW_CELLS`, so an agent's glyph stands in the status column at a
 * status chip's size (`TaskRowGlyph`), its name where a task's name stands,
 * and its time where a task's time stands, lining up with the task rows
 * beside it. Its glyph is its tab's (`AgentGlyph`), which gives way to the
 * working mark while the agent works, and its name is masked in a screen
 * recording; its task is its card's to name. Its trailing run holds, in
 * turn: how many of its threads wait on the developer, as the sidebar's Inbox row counts them (`WaitingCount`);
 * how many of the agents it started, at every depth, still work, led by
 * the working mark (`WorkingCount`), where its list nests the agents it
 * started under it (`depth`, `nest`, `fold`) as a task's sub-tasks nest,
 * and nothing once none does; it counts no share done, as a task counts
 * its sub-tasks, since an agent at rest may work again; its
 * pull request, where it opened one, as a chip of GitHub's mark in GitHub's
 * color for where it stands and its number (`pull-request-chip.tsx`),
 * hanging the pull request's one card, the agent whose it is and who it
 * names among what the card says (`pull-request-card.tsx`); and where it
 * runs (`runs-on.tsx`), Cloud or the device, unless its list leaves that out
 * (`runsOn`), as the sidebar's Managers do, with its failed mark once its
 * turn failed, or once an agent it started failed, its hint saying how
 * many, so a fold never hides a failure. Its time says when it last moved, and its ⋯ comes in over
 * it, as a task's does.
 *
 * A press opens the agent, and its ⋯, a right-click, a long press, and the
 * menu key offer the agent's one menu over the doors a row has
 * (`agent-actions.tsx`), as a task's row offers the task's wherever it
 * stands, led by Pin, or Unpin once the reader pinned it, the reader's own
 * pin of the agent, which stands it under the sidebar's Pinned (an archived
 * agent's row offers neither, as an archived agent stands under no pin): Copy link, Rename, which turns the row's name into its field
 * until the edit ends, or for a Manager Settings…, the card that names it, Archive, asking first while a teammate's agent
 * still works, and Permanently delete, asked first. A rename refused is
 * said under the name. A finger's row draws no ⋯ (`more`), its menu a long
 * press away. Its list chooses its rows together as a task list does, by
 * the box in a row's gutter, ⌘-click, ⇧-click, and ⌘A, unless its list
 * chooses none (`choosable`), as the sidebar's Managers do, its row then
 * keeping no gutter for a box it never draws, and a row chosen
 * among several offers its list's acts on every one chosen instead, under
 * how many (`agents-selection.tsx`). An archived agent's row stands settled,
 * its name in the muted ink, as a done task's does, and its menu offers
 * Unarchive in Archive's place. A Manager's row stands unread, its name in
 * the heavier weight, while its chat said something after the reader's
 * mark of it (`chatUnread`), but on the Manager's own page standing open,
 * whose chat the reader sees as it lands, and in a staged run.
 */

/** The cells an agent's row draws, in a task's row's order. */
export const AGENT_ROW_CELLS = [
  TASK_ROW_CELL.STATUS,
  TASK_ROW_CELL.REPOSITORY,
  TASK_ROW_CELL.WAITING,
  TASK_ROW_CELL.SUB_TASKS,
  TASK_ROW_CELL.PULL_REQUESTS,
  TASK_ROW_CELL.AGENTS,
  TASK_ROW_CELL.UPDATED,
] as const satisfies readonly TaskRowCell[];

/** What an agent's row is, naming its ⋯ and menu "Agent actions". */
const AGENT_THING = "Agent";

/** Pin or Unpin, whichever the agent is not yet, in a group of its own, for an unarchived agent; none for an archived one, whose pin stands nowhere. */
function pinGroups(
  agent: AgentSummary,
  pinned: boolean,
  onPin: (agentId: string, pinned: boolean) => void,
  subject: Parameters<typeof commandAction>[2],
): MenuEntry[][] {
  if (agent.archivedAt !== undefined) return [];
  const command = pinned ? PANEL_COMMAND.UNPIN_AGENT : PANEL_COMMAND.PIN_AGENT;

  return [[commandAction(command, () => onPin(agent.id, !pinned), subject)]];
}

/** Whether a Manager's chat said something after the reader's mark of it (`read-mark.ts`); never a coder's, whose row carries no mark. */
function chatUnread(agent: AgentSummary): boolean {
  if (agent.kind !== AGENT_KIND.MANAGER || agent.saidAt === undefined) return false;

  return readsUnread(
    { ...(agent.readThrough === undefined ? undefined : { readThrough: agent.readThrough }) },
    agent.saidAt,
  );
}

/** One agent's row; see the module's head. */
export function AgentListRow({
  agent,
  agents,
  shown,
  subject,
  at,
  card,
  pullRequest,
  waits = 0,
  chosen,
  place,
  more,
  settled = false,
  current = false,
  runsOn = true,
  choosable = true,
  depth,
  nest,
  fold,
  started,
  onPress,
  onOpenPullRequest,
}: {
  agent: AgentSummary;
  /** The agents control its menu acts through, which gives its models and the member's devices too. */
  agents: AgentsControl;
  /** Whether the list is on screen, which its menu and its Archive's question ask on. */
  shown: boolean;
  /** What it is called and what its card says, which its pull request's card names too. */
  subject: AgentSubject;
  /** Epoch milliseconds it last moved (`agentLastMovedAt`). */
  at: number;
  /** The card the row hangs; none where the place hangs none. */
  card: ReactNode | undefined;
  pullRequest: AgentPullRequest | undefined;
  /** How many of its threads wait on the developer. */
  waits?: number | undefined;
  /** The selection it stands in, where it is one of several its list chose (`AgentsSelection.chosenOf`), whose menu it offers instead of its own; none otherwise. */
  chosen: ChosenRows | undefined;
  /** Where it stands in its list's run of rows, where the list draws only those near the view (`VirtualRows`). */
  place?: VirtualRowPlace | undefined;
  /** Whether it draws its ⋯, as its list does. */
  more?: boolean | undefined;
  /** Whether it stands settled beside the agents still listed, its name in the muted ink: an archived agent. */
  settled?: boolean | undefined;
  /** Whether it is the agent its window stands open on, its own page, in the current fill, as a sidebar marks its open row. */
  current?: boolean | undefined;
  /** Whether it says where it runs, Cloud or the device, as every list but the sidebar's Managers does; its failed mark stands either way. */
  runsOn?: boolean | undefined;
  /** Whether its list may choose it among several, by the box in its gutter, ⌘-click, ⇧-click, and ⌘A, as every list of agents but the sidebar's Managers does. */
  choosable?: boolean | undefined;
  /** How deep it stands nested under the agent that started it: at the top unless said. */
  depth?: number | undefined;
  /** Where it stands among the agents nested beside it, in a list that nests them; none in one that nests none. */
  nest?: ListRowNest | undefined;
  /** The agents it started, nested under it, which it folds; none where it started none. */
  fold?: ListRowFold | undefined;
  /** Where the agents it started stand, at every depth; none where it started none. */
  started?: StartedAgentsStanding | undefined;
  /** Opens the agent, as its pull request's card offers too. */
  onPress: () => void;
  onOpenPullRequest: () => void;
}): React.JSX.Element {
  const { models, macs } = agents;
  const changesPeople = useChangesPeople(changesAddressOf(pullRequest?.url));
  const people = pullRequest === undefined ? undefined : peopleOf(changesPeople, pullRequest);
  const { name } = subject;

  const actions = useAgentActions(agent, agents, {
    label: name,
    shown,
    terminals: { onOpenTerminal: undefined },
  });

  const staged = useQuery({ ...appStateQuery, select: selectFixtureStaged }).data === true;
  const selectPinned = useMemo(() => selectAgentPinned(agent.id), [agent.id]);
  const pinned = useQuery({ ...appStateQuery, select: selectPinned }).data === true;
  const onPin = useAgentPinWrite();

  // Note that the developer's machines' asks for the agent count as needing them beside its threads.
  const asked = machineAsksByAgent(useMachineAsks()).get(agent.id) ?? 0;
  const press = useRef<HTMLButtonElement | null>(null);
  const { rename } = actions;
  const editing = rename?.editing === true;
  const endedByKey = useRefocusAfterEdit(editing, press);

  const row = (
    <TaskRow
      taskId={agent.id}
      name={name}
      cells={AGENT_ROW_CELLS}
      content={{
        [TASK_ROW_CELL.STATUS]: (
          <TaskRowGlyph>
            <AgentGlyph agent={agent} />
          </TaskRowGlyph>
        ),
        [TASK_ROW_CELL.WAITING]: <WaitingCount count={waits + asked} />,
        [TASK_ROW_CELL.SUB_TASKS]:
          started === undefined ? null : (
            <WorkingCount
              count={started.working}
              words={startedShown(started.working, STARTED_STANDING.WORKING)}
              label={startedHeard(started.working, STARTED_STANDING.WORKING)}
            />
          ),
        [TASK_ROW_CELL.PULL_REQUESTS]:
          pullRequest === undefined ? null : (
            <ReplayMask>
              <PullRequestChip
                pullRequest={pullRequest}
                card={
                  <PullRequestCard
                    pullRequest={pullRequest}
                    place={{ taskId: agent.taskId }}
                    lines={pullRequest}
                    files={pullRequest.changedFiles}
                    opener={people?.author ?? openerOf(pullRequest)}
                    agent={{ subject, models, onOpen: onPress }}
                    reviewers={people?.reviewers}
                  />
                }
                onOpen={onOpenPullRequest}
              />
            </ReplayMask>
          ),
        [TASK_ROW_CELL.AGENTS]: (
          <ReplayMask>
            {runsOn ? <RunsOnPlace agent={agent} devices={macs} /> : null}
            {agentEndMark(agent, true) ??
              (started === undefined || started.failed === 0
                ? null
                : failedUnderMark(startedHeard(started.failed, STARTED_STANDING.FAILED)))}
          </ReplayMask>
        ),
        [TASK_ROW_CELL.UPDATED]: <Time at={at} hint={false} />,
      }}
      editor={
        editing ? (
          <InlineEdit
            value={rename.asked ?? name}
            label="Agent name"
            maxLength={AGENT_BOUNDS.MAX_TITLE_CHARS}
            editing
            onEnd={(edit) => {
              endedByKey(edit.byKey);
              rename.end(edit.value);
            }}
          />
        ) : undefined
      }
      note={rename?.refused === true ? RENAME_FAILED : undefined}
      menu={
        editing
          ? undefined
          : chosen !== undefined
            ? chosenRowMenu(AGENT_THING, chosen, shown)
            : rowMenu(
                AGENT_THING,
                [
                  ...pinGroups(agent, pinned, onPin, actions.subject),
                  ...agentMenuGroups(rowDoors(actions.doors)),
                ],
                shown,
                true,
              )
      }
      more={more}
      settled={settled}
      unread={!staged && !current && chatUnread(agent)}
      edges={choosable ? TASK_ROW_EDGES.LIST : TASK_ROW_EDGES.UNCHOSEN}
      choosable={choosable}
      current={current}
      hint={card === undefined || editing ? undefined : { Hint: RowHint, label: name }}
      onOpen={onPress}
      pressRef={press}
      place={place}
      depth={depth}
      nest={nest}
      fold={fold}
    >
      {actions.dialog}
    </TaskRow>
  );

  // Note that the card reaches the row's hint by its options, because the row takes its hint as a component, which must stay one across renders.
  return card === undefined ? row : <RowHintOptions card={card}>{row}</RowHintOptions>;
}
