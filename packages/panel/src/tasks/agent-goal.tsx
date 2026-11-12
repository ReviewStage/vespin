/**
 * agent-goal.tsx -- an agent's goal as its tab draws it: the row docked over the message box, and the notices its moves leave in the transcript.
 *
 * The row is a card of one row, as the pull request's is over it
 * (`agent-published.tsx`): the goal's condition on one line, where it stands
 * at the row's end, the goal whole and how far it has run in the card its
 * hint hangs, a press bringing in its newest notice, and its acts at its end
 * as a queued message's are: Pause, Resume and Clear. A goal that wants the
 * developer says so on its own row, in its tone (`goalTone`): paused or out
 * of budget in the attention tone, a paused one's Resume standing on it, and
 * a blocked one in the danger tone. The notices are what the goal
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
  AttentionMark,
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  DISCLOSURE_FILL,
  HoverCard,
  HoverCardFigures,
  HoverCardHead,
  HoverCardNote,
  HoverCardRule,
  IconButton,
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
  type StatusTone,
  TIME_LOOK,
  Time,
  VisuallyHidden,
} from "@repo/ui";
import { CircleCheckIcon, CircleSlashIcon, GLYPH } from "@repo/ui/icons";
import { GOAL_EVENT, type GoalNotice } from "@repo/wire/ui-messages";
import { type ReactNode, useMemo } from "react";
import { PLAN_BODY_LAYOUT, Plan, PlanContent, PlanHeader, PlanIcon } from "../ai-elements/plan.js";
import { centerWithin } from "../scroll-within.js";
import { COMPOSER_DOCK_CLASS } from "./agent-composer.js";

/** The words the goal is named by where a menu or a list says what it acts on. */
const GOAL_THING = "Goal";

/** What a goal's notice says it did, as its card's head reads. */
const NOTICE_WORDS = {
  [GOAL_EVENT.SET]: "Goal set",
  [GOAL_EVENT.NOT_MET]: "Goal not met yet",
  [GOAL_EVENT.MET]: "Goal met",
  [GOAL_EVENT.IMPOSSIBLE]: "Goal blocked",
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

/**
 * The tone of a goal that wants the developer: paused or out of budget,
 * which only they can set going again, or one the checker found can't be
 * met; none for a goal under way, stopped, or met, which wants nothing of
 * them.
 */
function goalTone(goal: AgentGoal): StatusTone | undefined {
  switch (goal.state) {
    case AGENT_GOAL_STATE.PAUSED:
    case AGENT_GOAL_STATE.BUDGET_LIMITED:
      return STATUS_TONE.ATTENTION;
    case AGENT_GOAL_STATE.IMPOSSIBLE:
      return STATUS_TONE.DANGER;
    default:
      return undefined;
  }
}

/** The words a row's end stands in, its parts apart by the gap a pull request's row keeps between its state and its lines (`agent-published.tsx`). */
const STANDING_CLASS =
  "inline-flex items-center gap-icon-gap whitespace-nowrap align-top tabular-nums";

/** A count of turns, as the row and its card say it: "1 turn", "3 turns". */
function turnWords(turns: number): string {
  return turns === 1 ? "1 turn" : `${turns} turns`;
}

/** Where the goal stands, in the few words a row's end holds, as a pull request's row says its state and lines; while it runs, how far it has gone and for how long. */
function GoalStanding({ goal, working }: { goal: AgentGoal; working: boolean }): ReactNode {
  switch (goal.state) {
    case AGENT_GOAL_STATE.PAUSED:
      return (
        <span className={`${STANDING_CLASS} font-label text-attention`}>
          <AttentionMark />
          Paused
        </span>
      );
    case AGENT_GOAL_STATE.MET:
      // Note that the tick says the goal was met, in the ink a passed check wears, and its words say what it took.
      return (
        <span className={`${STANDING_CLASS} text-muted-foreground`}>
          <CircleCheckIcon
            className="size-attention-mark flex-none text-complete"
            aria-hidden="true"
          />
          <VisuallyHidden>Met in</VisuallyHidden>
          {goal.tokens === null ? turnWords(goal.turns) : `${TOKENS.format(goal.tokens)} tokens`}
        </span>
      );
    case AGENT_GOAL_STATE.IMPOSSIBLE:
      return <span className={`${STANDING_CLASS} font-label text-danger`}>Blocked</span>;
    case AGENT_GOAL_STATE.BUDGET_LIMITED:
      return (
        <span className={`${STANDING_CLASS} font-label text-attention`}>
          <AttentionMark />
          Budget reached
        </span>
      );
    default:
      // Note that a goal whose agent stopped working is still set, and the harness picks it up again on the next message.
      return working ? (
        <span className={`${STANDING_CLASS} text-muted-foreground`}>
          <span>{spentWords(goal)}</span>
          {goal.setAt === undefined ? null : <Time at={goal.setAt} look={TIME_LOOK.DURATION} />}
        </span>
      ) : (
        <span className={`${STANDING_CLASS} text-muted-foreground`}>Stopped</span>
      );
  }
}

/** The card the row hangs as the pointer rests on it: the goal whole, the checker's newest word, and how far it has run. */
function GoalCard({ goal, working }: { goal: AgentGoal; working: boolean }): ReactNode {
  const stopped = goal.state === AGENT_GOAL_STATE.ACTIVE && !working;

  return (
    <HoverCard>
      <HoverCardHead glyph={<GLYPH.GOAL />} name={goal.condition} sub={GOAL_THING} />
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
 * has none. `onPause`, `onResume` and `onClear` send the harness its
 * command, and are none where the reader may not write to the agent or the
 * harness takes no such command (only Codex pauses a goal). Its acts stand
 * at its end as a queued message's do (`agent-queue-dock.tsx`), on hover:
 * Pause while it runs and Clear until it settles; a paused goal's Resume
 * stands at rest, since the agent waits on it.
 */
export function GoalDock({
  messages,
  older,
  working,
  onBringIn,
  onPause,
  onResume,
  onClear,
}: {
  /** The transcript as the service stored it: a line still on its way, or refused, says nothing of the goal. */
  messages: readonly AgentTranscriptMessage[];
  /** Whether older pages of the transcript stand unread, which may hold the goal's setting. */
  older: boolean;
  /** Whether the agent is at work now, which a running goal's row counts its time by. */
  working: boolean;
  /** Takes the transcript to the end of a turn, by its id, where the goal's newest notice stands. */
  onBringIn: (messageId: string) => void;
  onPause: (() => void) | undefined;
  onResume: (() => void) | undefined;
  onClear: (() => void) | undefined;
}): ReactNode {
  const goal = useMemo(() => agentGoal(messages, older), [messages, older]);

  if (goal === undefined) return null;
  const paused = goal.state === AGENT_GOAL_STATE.PAUSED;
  const resume = paused ? onResume : undefined;
  const pause = goal.state === AGENT_GOAL_STATE.ACTIVE ? onPause : undefined;
  const clear = goalSettled(goal) ? undefined : onClear;

  const acts =
    resume === undefined && pause === undefined && clear === undefined ? undefined : (
      <>
        {resume === undefined ? null : (
          <Button
            size={BUTTON_SIZE.COMPACT}
            variant={BUTTON_VARIANT.OUTLINE}
            icon={<PlayIcon />}
            onClick={resume}
          >
            Resume
          </Button>
        )}
        {pause === undefined ? null : (
          <IconButton
            size={BUTTON_SIZE.COMPACT}
            label="Pause goal"
            icon={<PauseIcon />}
            onClick={pause}
          />
        )}
        {clear === undefined ? null : (
          <IconButton
            size={BUTTON_SIZE.COMPACT}
            label="Clear goal"
            icon={<GLYPH.CLOSE />}
            onClick={clear}
          />
        )}
      </>
    );

  return (
    <div className={`agent-goal-dock ${COMPOSER_DOCK_CLASS}`}>
      <List label={GOAL_THING} variant={LIST_VARIANT.CARD} fingerTall>
        <RowHintOptions card={<GoalCard goal={goal} working={working} />}>
          <ListRow
            leading={<GLYPH.GOAL />}
            title={goal.condition}
            titleReplayMasked
            meta={<GoalStanding goal={goal} working={working} />}
            hint={{ Hint: RowHint, label: goal.condition }}
            onPress={() => onBringIn(goal.messageId)}
            tone={goalTone(goal)}
            actions={acts}
            actionsAt={resume === undefined ? LIST_ROW_ACTIONS.HOVER : LIST_ROW_ACTIONS.ALWAYS}
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
