/**
 * agent-goal.tsx -- an agent's goal as its tab draws it: the row docked over the message box, and the notices its moves leave in the transcript.
 *
 * The row is a card of one row, as the pull request's is over it
 * (`agent-published.tsx`): the goal's condition on one line, where it stands
 * at the row's end, the goal whole and how far it has run in the card its
 * hint hangs, a press bringing in its newest notice, and its ⋯ and
 * right-click offering Copy goal and Clear goal. A paused goal says so on
 * its own row, its Resume standing there. The notices are what the goal
 * did, where it did it: its setting and each verdict of the checker as a
 * card a check's line is drawn as (`line-cards.tsx`), the checker's reason
 * in its fold, and a pause or a resume as a trail across the transcript, as
 * a new session's is. The goal is read from those notices
 * (`@repo/features/agent-goal-model`).
 */

import {
  AGENT_GOAL_STATE,
  type AgentGoal,
  agentGoal,
  goalSettled,
} from "@repo/features/agent-goal-model";
import type { AgentTranscriptMessage } from "@repo/features/agent-wire";
import {
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  DISCLOSURE_FILL,
  HoverCard,
  HoverCardFigures,
  HoverCardHead,
  HoverCardNote,
  HoverCardRule,
  LIST_ROW_ACTIONS,
  LIST_VARIANT,
  List,
  ListRow,
  NOTE_LINE_LOOK,
  NoteLine,
  OneLine,
  PauseIcon,
  PlayIcon,
  RowHint,
  RowHintOptions,
  STATUS_TONE,
  StatusWords,
  TIME_LOOK,
  Time,
} from "@repo/ui";
import { CircleCheckIcon, CircleSlashIcon, GLYPH } from "@repo/ui/icons";
import { GOAL_EVENT, type GoalNotice } from "@repo/wire/ui-messages";
import { type ReactNode, useMemo } from "react";
import { PLAN_BODY_LAYOUT, Plan, PlanContent, PlanHeader, PlanIcon } from "../ai-elements/plan.js";
import { useCoarsePointer } from "../coarse-pointer.js";
import { useCopyToast } from "../copy-feedback.js";
import { rowMenu } from "../desktop/action-menu.js";
import { centerWithin } from "../scroll-within.js";
import { COMPOSER_DOCK_CLASS } from "./agent-composer.js";

/** The words the goal is named by where a menu or a list says what it acts on. */
const GOAL_THING = "Goal";

/** What a goal's notice says it did, as its card's head reads. */
const NOTICE_WORDS = {
  [GOAL_EVENT.SET]: "Goal set",
  [GOAL_EVENT.NOT_MET]: "Goal not met yet",
  [GOAL_EVENT.MET]: "Goal met",
  [GOAL_EVENT.IMPOSSIBLE]: "Goal can't be met",
  [GOAL_EVENT.PAUSED]: "Goal paused. The agent stops after this turn.",
  [GOAL_EVENT.RESUMED]: "Goal resumed.",
  [GOAL_EVENT.BUDGET_LIMITED]: "Goal stopped at its token budget",
  [GOAL_EVENT.CLEARED]: "Goal cleared.",
} as const satisfies Record<GoalNotice["event"], string>;

/** A token count as the row says it: "184k", "1.2M". */
const TOKENS = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** The moves that are only a move of the goal's own standing, said as a trail rather than a card, since they carry nothing to read. */
const TRAILS: ReadonlySet<GoalNotice["event"]> = new Set([
  GOAL_EVENT.PAUSED,
  GOAL_EVENT.RESUMED,
  GOAL_EVENT.CLEARED,
]);

/** How much of its budget the goal has spent, or the turn it is on, as the row and its card say it. */
function spentWords(goal: AgentGoal): string {
  if (goal.tokens === null) return `Turn ${goal.turns}`;
  return goal.tokenBudget === null
    ? `${TOKENS.format(goal.tokens)} tokens`
    : `${TOKENS.format(goal.tokens)} of ${TOKENS.format(goal.tokenBudget)} tokens`;
}

/** The goal's mark: what it stands at once it settled or paused, its own glyph while it runs. */
function GoalMark({ goal }: { goal: AgentGoal }): ReactNode {
  switch (goal.state) {
    case AGENT_GOAL_STATE.MET:
      return <CircleCheckIcon />;
    case AGENT_GOAL_STATE.IMPOSSIBLE:
      return <CircleSlashIcon />;
    case AGENT_GOAL_STATE.PAUSED:
      return <PauseIcon />;
    default:
      return <GLYPH.GOAL />;
  }
}

/** Where the goal stands, in the few words a row's end holds, as a pull request's row says its state and lines; while it runs, how far it has gone and for how long. */
function GoalStanding({ goal, working }: { goal: AgentGoal; working: boolean }): ReactNode {
  switch (goal.state) {
    case AGENT_GOAL_STATE.PAUSED:
      return <StatusWords tone={STATUS_TONE.ATTENTION}>Paused</StatusWords>;
    case AGENT_GOAL_STATE.MET:
      return <span className="text-muted-foreground">{`Met · ${goal.turns} turns`}</span>;
    case AGENT_GOAL_STATE.IMPOSSIBLE:
      return <StatusWords tone={STATUS_TONE.DANGER}>Can't be met</StatusWords>;
    case AGENT_GOAL_STATE.BUDGET_LIMITED:
      return <span className="text-muted-foreground">Budget reached</span>;
    default:
      // Note that a goal whose agent stopped working is still set, and the harness picks it up again on the next message.
      return working ? (
        <span className="whitespace-nowrap text-muted-foreground tabular-nums">
          {`${spentWords(goal)} · `}
          {goal.setAt === undefined ? null : <Time at={goal.setAt} look={TIME_LOOK.DURATION} />}
        </span>
      ) : (
        <span className="text-muted-foreground">Stopped</span>
      );
  }
}

/** The card the row hangs as the pointer rests on it: the goal whole, the checker's newest word, and how far it has run. */
function GoalCard({ goal, working }: { goal: AgentGoal; working: boolean }): ReactNode {
  const stopped = goal.state === AGENT_GOAL_STATE.ACTIVE && !working;
  return (
    <HoverCard>
      <HoverCardHead glyph={<GoalMark goal={goal} />} name={goal.condition} sub={GOAL_THING} />
      {goal.reason === null ? null : <HoverCardNote>{goal.reason}</HoverCardNote>}
      {stopped ? (
        <HoverCardNote>
          The agent stopped before the goal was met. Your next message picks it up again.
        </HoverCardNote>
      ) : null}
      <HoverCardRule />
      <HoverCardFigures
        label="How far it has run"
        figures={[
          { label: "Turns", figure: String(goal.turns) },
          ...(goal.tokens === null ? [] : [{ label: "Tokens", figure: spentWords(goal) }]),
        ]}
      />
    </HoverCard>
  );
}

/**
 * The goal over the message box, while one stands: nothing where the agent
 * has none. `onClear` and `onResume` send the harness its command, and are
 * none where the reader may not write to the agent or the harness takes no
 * such command.
 */
export function GoalDock({
  messages,
  older,
  working,
  onBringIn,
  onClear,
  onResume,
}: {
  /** The transcript as the service stored it: a line still on its way, or refused, says nothing of the goal. */
  messages: readonly AgentTranscriptMessage[];
  /** Whether older pages of the transcript stand unread, which may hold the goal's setting. */
  older: boolean;
  /** Whether the agent is at work now, which a running goal's row counts its time by. */
  working: boolean;
  /** Takes the transcript to the end of a turn, by its id, where the goal's newest notice stands. */
  onBringIn: (messageId: string) => void;
  onClear: (() => void) | undefined;
  onResume: (() => void) | undefined;
}): ReactNode {
  const goal = useMemo(() => agentGoal(messages, older), [messages, older]);
  const coarse = useCoarsePointer();
  const copy = useCopyToast();
  if (goal === undefined) return null;
  const settled = goalSettled(goal);
  const paused = goal.state === AGENT_GOAL_STATE.PAUSED;
  const menu = rowMenu(
    GOAL_THING,
    [
      [
        {
          label: "Copy goal",
          icon: <GLYPH.COPY />,
          onSelect: () => copy(goal.condition, "Goal copied"),
        },
      ],
      ...(onClear === undefined || settled
        ? []
        : [[{ label: "Clear goal", icon: <GLYPH.CLOSE />, onSelect: onClear }]]),
    ],
    undefined,
    true,
  );
  const resume =
    paused && onResume !== undefined ? (
      <Button
        size={BUTTON_SIZE.COMPACT}
        variant={BUTTON_VARIANT.QUIET}
        icon={<PlayIcon />}
        onClick={onResume}
      >
        Resume
      </Button>
    ) : undefined;
  return (
    <div className={`agent-goal-dock ${COMPOSER_DOCK_CLASS}`}>
      <List label={GOAL_THING} variant={LIST_VARIANT.CARD} fingerTall>
        <RowHintOptions card={<GoalCard goal={goal} working={working} />}>
          <ListRow
            leading={<GoalMark goal={goal} />}
            title={goal.condition}
            titleReplayMasked
            meta={<GoalStanding goal={goal} working={working} />}
            hint={{ Hint: RowHint, label: goal.condition }}
            onPress={() => onBringIn(goal.messageId)}
            menu={menu}
            more={!coarse}
            muted={settled}
            // Note that a paused goal holds its Resume on its row, standing, so the pause is said where the goal is.
            {...(resume === undefined
              ? undefined
              : { actions: resume, actionsAt: LIST_ROW_ACTIONS.ALWAYS })}
          />
        </RowHintOptions>
      </List>
    </div>
  );
}

/**
 * Centers the newest goal notice the transcript draws, once the last piece
 * of the turn that holds it was brought in: a long turn is drawn in pieces,
 * and the goal's newest notice stands toward its end, in that piece or one
 * just before it, drawn beside it.
 */
export function centerNewestGoalNotice(row: HTMLElement): void {
  const log = row.closest('[role="log"]');
  if (!(log instanceof HTMLElement)) return;
  const notices = log.querySelectorAll("[data-goal-notice]");
  const newest = notices.item(notices.length - 1);
  if (newest instanceof HTMLElement) centerWithin(log, newest);
}

/** One move of the goal where it happened in the transcript: a trail for a move of its standing, a card for its setting and each verdict, the reason in its fold. */
export function GoalNoticeView({ notice }: { notice: GoalNotice }): ReactNode {
  if (TRAILS.has(notice.event)) {
    return (
      <NoteLine
        look={NOTE_LINE_LOOK.TRAIL}
        glyph={
          notice.event === GOAL_EVENT.PAUSED ? (
            <PauseIcon />
          ) : notice.event === GOAL_EVENT.RESUMED ? (
            <PlayIcon />
          ) : (
            <GLYPH.GOAL />
          )
        }
        data-goal-notice={notice.event}
      >
        {NOTICE_WORDS[notice.event]}
      </NoteLine>
    );
  }
  const body = notice.event === GOAL_EVENT.SET ? notice.condition : notice.reason;
  const folds = body !== null && body !== "";
  const said = NOTICE_WORDS[notice.event];
  const turn = notice.turns === null ? undefined : `Turn ${notice.turns}`;
  // Note that a notice stands at a received line's measure, as a check's card does, rather than across the column.
  return (
    <div className="max-w-bubble">
      <Plan
        data-goal-notice={notice.event}
        open={folds ? undefined : false}
        fill={DISCLOSURE_FILL.ACTIONS}
        actions={
          <span className="flex min-w-0 flex-1 items-baseline gap-tight-gap py-row-inset">
            <OneLine className="flex-none text-muted-foreground">{said}</OneLine>
            {notice.event === GOAL_EVENT.SET || body === null ? null : (
              <OneLine className="min-w-0 flex-1">{body}</OneLine>
            )}
            {turn === undefined ? null : (
              <OneLine className="ms-auto flex-none ps-tight-gap text-muted-foreground">
                {turn}
              </OneLine>
            )}
          </span>
        }
      >
        <PlanHeader folds={folds} aria-label={said}>
          <PlanIcon>
            {notice.event === GOAL_EVENT.MET ? (
              <CircleCheckIcon />
            ) : notice.event === GOAL_EVENT.IMPOSSIBLE ? (
              <CircleSlashIcon />
            ) : (
              <GLYPH.GOAL />
            )}
          </PlanIcon>
        </PlanHeader>
        {folds ? (
          <PlanContent layout={PLAN_BODY_LAYOUT.STACK}>
            <p>{body}</p>
          </PlanContent>
        ) : null}
      </Plan>
    </div>
  );
}
