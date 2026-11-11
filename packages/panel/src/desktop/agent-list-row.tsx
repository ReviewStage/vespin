import { AGENT_BOUNDS, type AgentPullRequest, type AgentSummary } from "@repo/features/agent-wire";
import {
  InlineEdit,
  RowHint,
  RowHintOptions,
  TASK_ROW_CELL,
  TaskRow,
  type TaskRowCell,
  TaskRowGlyph,
  Time,
} from "@repo/ui";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import type { VirtualRowPlace } from "@repo/ui/virtual-rows";
import { type ReactNode, useRef } from "react";
import { RENAME_FAILED } from "../tasks/agent-model.js";
import type { AgentSubject } from "../tasks/agent-ref.js";
import { useChangesPeople } from "../tasks/changes-people.js";
import { PullRequestCard, peopleOf } from "../tasks/pull-request-card.js";
import { PullRequestChip } from "../tasks/pull-request-chip.js";
import { RunsOnPlace } from "../tasks/runs-on.js";
import { AgentGlyph, agentEndMark } from "../tasks/tab-look.js";
import type { AgentsControl } from "../tasks/use-agents.js";
import { openerOf } from "../tasks/use-link-standing.js";
import { useRefocusAfterEdit } from "../use-refocus-after-edit.js";
import { rowMenu } from "./action-menu.js";
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
 * turn: how many of its threads wait on the developer, as the sidebar's Inbox row counts them (`WaitingCount`); its
 * pull request, where it opened one, as a chip of GitHub's mark in GitHub's
 * color for where it stands and its number (`pull-request-chip.tsx`),
 * hanging the pull request's one card, the agent whose it is and who it
 * names among what the card says (`pull-request-card.tsx`); and where it
 * runs (`runs-on.tsx`), Cloud or the device, with its failed mark once its
 * turn failed. Its time says when it last moved, and its ⋯ comes in over
 * it, as a task's does.
 *
 * A press opens the agent, and its ⋯, a right-click, a long press, and the
 * menu key offer the agent's one menu over the doors a row has
 * (`agent-actions.tsx`), as a task's row offers the task's wherever it
 * stands: Copy link, Rename, which turns the row's name into its field
 * until the edit ends, Archive, asking first while a teammate's agent
 * still works, and Permanently delete, asked first. A rename refused is
 * said under the name. A finger's row draws no ⋯ (`more`), its menu a long
 * press away. Its list chooses its rows together as a task list does, by
 * the box in a row's gutter, ⌘-click, ⇧-click, and ⌘A, and a row chosen
 * among several offers its list's acts on every one chosen instead, under
 * how many (`agents-selection.tsx`).
 */

/** The cells an agent's row draws, in a task's row's order. */
export const AGENT_ROW_CELLS = [
  TASK_ROW_CELL.STATUS,
  TASK_ROW_CELL.REPOSITORY,
  TASK_ROW_CELL.WAITING,
  TASK_ROW_CELL.PULL_REQUESTS,
  TASK_ROW_CELL.AGENTS,
  TASK_ROW_CELL.UPDATED,
] as const satisfies readonly TaskRowCell[];

/** What an agent's row is, naming its ⋯ and menu "Agent actions". */
const AGENT_THING = "Agent";

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
  /** Opens the agent, as its pull request's card offers too. */
  onPress: () => void;
  onOpenPullRequest: () => void;
}): React.JSX.Element {
  const { models, macs } = agents;
  const changesPeople = useChangesPeople(pullRequest === undefined ? undefined : agent.id);
  const people = pullRequest === undefined ? undefined : peopleOf(changesPeople, pullRequest);
  const { name } = subject;
  const actions = useAgentActions(agent, agents, {
    label: name,
    shown,
    terminals: { onOpenTerminal: undefined },
  });
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
        [TASK_ROW_CELL.WAITING]: <WaitingCount count={waits} />,
        [TASK_ROW_CELL.PULL_REQUESTS]:
          pullRequest === undefined ? null : (
            <ReplayMask>
              <PullRequestChip
                pullRequest={pullRequest}
                card={
                  <PullRequestCard
                    pullRequest={pullRequest}
                    place={{ taskId: agent.planId }}
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
            <RunsOnPlace agent={agent} devices={macs} />
            {agentEndMark(agent, true)}
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
            : rowMenu(AGENT_THING, agentMenuGroups(rowDoors(actions.doors)), shown, true)
      }
      more={more}
      hint={card === undefined || editing ? undefined : { Hint: RowHint, label: name }}
      onOpen={onPress}
      pressRef={press}
      place={place}
    >
      {actions.dialog}
    </TaskRow>
  );
  // Note that the card reaches the row's hint by its options, because the row takes its hint as a component, which must stay one across renders.
  return card === undefined ? row : <RowHintOptions card={card}>{row}</RowHintOptions>;
}
