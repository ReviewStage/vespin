import type { AgentPullRequest, AgentSummary } from "@repo/features/agent-wire";
import type { CatalogModel, MacOffer } from "@repo/features/models-wire";
import {
  type ListRowMenu,
  OneLine,
  RowHint,
  RowHintOptions,
  TASK_ROW_CELL,
  TASK_ROW_EDGES,
  TaskRow,
  type TaskRowCell,
  type TaskRowEdges,
  TaskRowGlyph,
  Time,
} from "@repo/ui";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import type { VirtualRowPlace } from "@repo/ui/virtual-rows";
import type { ReactNode, RefObject } from "react";
import type { AgentSubject } from "../tasks/agent-ref.js";
import { useChangesPeople } from "../tasks/changes-people.js";
import { PullRequestCard, peopleOf } from "../tasks/pull-request-card.js";
import { PullRequestChip } from "../tasks/pull-request-chip.js";
import { RunsOnPlace } from "../tasks/runs-on.js";
import { AgentGlyph, agentEndMark } from "../tasks/tab-look.js";
import { openerOf } from "../tasks/use-link-standing.js";
import { WaitingCount } from "./task-row-parts.js";

/**
 * agent-list-row.tsx -- one agent as a list of agents draws it, at the head of a task's description and on a person's page alike, in a task's row's anatomy: its glyph wearing where it stands, its name, then one trailing run packed against when it last moved.
 *
 * The row is a `TaskRow` in a list of its own (`TaskRows`, or
 * `VirtualTaskRows` where it draws only the rows near the view), its cells
 * `AGENT_ROW_CELLS`, so an agent's glyph stands in the status column at a
 * status chip's size (`TaskRowGlyph`), its name where a task's name stands,
 * and its time where a task's time stands, lining up with the task rows
 * beside it. Its glyph is its tab's (`AgentGlyph`), which gives way to the
 * working mark while the agent works, and its name is masked in a screen
 * recording. Its trailing run holds, in turn: what the place says it is
 * about (`about`), such as the task a person's agent works on, muted where
 * a task's repository stands; how many of its threads wait on the
 * developer, as the sidebar's Inbox row counts them (`WaitingCount`); its
 * pull request, where it opened one, as a chip of GitHub's mark in GitHub's
 * color for where it stands and its number (`pull-request-chip.tsx`),
 * hanging the pull request's one card, the agent whose it is and who it
 * names among what the card says (`pull-request-card.tsx`); and where it
 * runs (`runs-on.tsx`), Cloud or the device, with its failed mark once its
 * turn failed. Its time says when it last moved, and its ⋯ comes in over
 * it, as a task's does. While its name is edited (`editor`) the field
 * stands in the name's place and the row hangs no hint; what went wrong
 * with the row, such as a rename refused, stands under the name (`note`).
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

/** One agent's row; see the module's head. */
export function AgentListRow({
  agent,
  subject,
  at,
  editor,
  card,
  models,
  devices,
  pullRequest,
  waits = 0,
  note,
  about,
  edges,
  place,
  pressRef,
  menu,
  more,
  onPress,
  onOpenPullRequest,
  children,
}: {
  agent: AgentSummary;
  /** What it is called and what its card says, which its pull request's card names too. */
  subject: AgentSubject;
  /** Epoch milliseconds it last moved (`agentLastMovedAt`). */
  at: number;
  /** The field its name gives way to while it is renamed; none while it is not. */
  editor?: ReactNode;
  /** The card the row hangs; none where the place hangs none. */
  card: ReactNode | undefined;
  models: readonly CatalogModel[] | undefined;
  /** The member's devices, which give a device's platform (`RunsOnPlace`). */
  devices: readonly MacOffer[] | undefined;
  pullRequest: AgentPullRequest | undefined;
  /** How many of its threads wait on the developer. */
  waits?: number | undefined;
  /** What went wrong with the row, said under its name. */
  note?: ReactNode;
  /** What the place says the agent is about, leading its trailing run. */
  about?: string | undefined;
  /** What room it keeps at its edges, its list's (`TaskRows`'s `edges`). */
  edges?: TaskRowEdges | undefined;
  /** Where it stands in its list's run of rows, where the list draws only those near the view (`VirtualRows`). */
  place?: VirtualRowPlace | undefined;
  /** Its press, for what focuses it again once an edit ends. */
  pressRef?: RefObject<HTMLButtonElement | null> | undefined;
  menu?: ListRowMenu | undefined;
  more?: boolean | undefined;
  /** Opens the agent, as its pull request's card offers too. */
  onPress: () => void;
  onOpenPullRequest: () => void;
  /** What stands beside its cells and draws nothing in the grid: a dialog its menu opens. */
  children?: ReactNode;
}): React.JSX.Element {
  const changesPeople = useChangesPeople(pullRequest === undefined ? undefined : agent.id);
  const people = pullRequest === undefined ? undefined : peopleOf(changesPeople, pullRequest);
  const { name } = subject;
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
        [TASK_ROW_CELL.REPOSITORY]:
          about === undefined ? null : (
            <OneLine words={about}>
              <ReplayMask>{about}</ReplayMask>
            </OneLine>
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
            <RunsOnPlace agent={agent} devices={devices} />
            {agentEndMark(agent, true)}
          </ReplayMask>
        ),
        [TASK_ROW_CELL.UPDATED]: <Time at={at} hint={false} />,
      }}
      editor={editor}
      note={note}
      menu={menu}
      more={more}
      edges={edges ?? TASK_ROW_EDGES.UNCHOSEN}
      hint={card === undefined || editor !== undefined ? undefined : { Hint: RowHint, label: name }}
      onOpen={onPress}
      pressRef={pressRef}
      place={place}
    >
      {children}
    </TaskRow>
  );
  // Note that the card reaches the row's hint by its options, because the row takes its hint as a component, which must stay one across renders.
  return card === undefined ? row : <RowHintOptions card={card}>{row}</RowHintOptions>;
}

/**
 * A start a list of agents offers after its agents, as New agent, in the
 * agents' own columns: its glyph where theirs stand and its label where
 * their names do, and, while it is unavailable, why, where an agent's
 * task stands.
 */
export function AgentStartRow({
  label,
  glyph,
  detail,
  disabled = false,
  edges,
  onStart,
}: {
  label: string;
  glyph: ReactNode;
  /** Why it is unavailable, where it is. */
  detail?: string | undefined;
  disabled?: boolean | undefined;
  /** What room it keeps at its edges, its list's (`TaskRows`'s `edges`). */
  edges?: TaskRowEdges | undefined;
  onStart: () => void;
}): React.JSX.Element {
  return (
    <TaskRow
      taskId={label}
      name={label}
      cells={AGENT_ROW_CELLS}
      content={{
        [TASK_ROW_CELL.STATUS]: <TaskRowGlyph>{glyph}</TaskRowGlyph>,
        [TASK_ROW_CELL.REPOSITORY]: detail,
      }}
      edges={edges ?? TASK_ROW_EDGES.UNCHOSEN}
      disabled={disabled}
      onOpen={onStart}
    />
  );
}
