/**
 * agent-goal.tsx -- an agent's goal as its tab draws it: the row docked over the message box, built as the pull request's row is (`agent-published.tsx`), and the notices its moves leave in the transcript.
 *
 * The goal is read from those notices (`@repo/features/agent-goal-model`),
 * and the row moves the moment a `/goal` line goes rather than once the
 * harness answers. While the Goals experiment is off, neither stands anywhere.
 */

import {
  AGENT_GOAL_STATE,
  type AgentGoal,
  GOAL_ASK_WAIT_MS,
  goalAsShown,
  goalSettled,
  goalVerdict,
  readGoal,
} from "@repo/features/agent-goal-model";
import type { AgentTranscriptMessage } from "@repo/features/agent-wire";
import { EXPERIMENT } from "@repo/settings";
import {
  BUTTON_SIZE,
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
import { useQuery } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { PLAN_BODY_LAYOUT, Plan, PlanContent, PlanHeader, PlanIcon } from "../ai-elements/plan.js";
import { appStateQuery, selectExperiment } from "../use-app-state.js";
import { COMPOSER_DOCK_CLASS } from "./agent-composer.js";
import { TranscriptWords } from "./transcript-blocks.js";

/** The words the goal is named by where a menu or a list says what it acts on. */
const GOAL_THING = "Goal";

/** What a goal's notice says it did, as its card's head reads. */
const NOTICE_WORDS = {
  [GOAL_EVENT.SET]: "Goal set.",
  [GOAL_EVENT.NOT_MET]: "Goal not met yet",
  [GOAL_EVENT.MET]: "Goal met",
  [GOAL_EVENT.IMPOSSIBLE]: "Goal blocked",
  [GOAL_EVENT.PAUSED]: "Goal paused. The agent stops after this turn.",
  [GOAL_EVENT.RESUMED]: "Goal resumed",
  [GOAL_EVENT.BUDGET_LIMITED]: "Goal stopped at its token budget",
  [GOAL_EVENT.CLEARED]: "Goal cleared",
} as const satisfies Record<GoalNotice["event"], string>;

/** A token count as the row says it: "184k", "1.2M". */
const TOKENS = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** The moves said as a trail rather than a card, since they carry nothing to read: the goal's end once met, and each move of its standing. */
const TRAILS: ReadonlySet<GoalNotice["event"]> = new Set([
  GOAL_EVENT.MET,
  GOAL_EVENT.PAUSED,
  GOAL_EVENT.RESUMED,
  GOAL_EVENT.CLEARED,
]);

/** The conditions the transcript's goals stand under (`goalConditions`), which a verdict must name to be drawn as a goal's: Claude Code says a project's own Stop hook in the same shape. */
export const GoalConditions = createContext<ReadonlySet<string>>(new Set());

/** How much of its budget the goal spent, as its card says it once it settled: "184k tokens", "184k of 500k tokens". */
function tokenWords(tokens: number, budget: number | null): string {
  return budget === null
    ? `${TOKENS.format(tokens)} tokens`
    : `${TOKENS.format(tokens)} of ${TOKENS.format(budget)} tokens`;
}

/** Whether the harness counts the goal's turns (Claude Code) rather than its tokens (Codex, the one harness whose notices carry tokens). */
function countsTurns(goal: AgentGoal): boolean {
  return goal.tokens === null;
}

/** The tone of a goal that wants the developer: paused or out of budget in the attention tone, blocked in the danger tone. */
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

/** Whether the Goals experiment is on, which every goal surface stands behind. */
function useGoalsOn(): boolean {
  return useQuery({ ...appStateQuery, select: selectExperiment(EXPERIMENT.GOALS) }).data === true;
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
      return <span className={`${STANDING_CLASS} font-label text-attention`}>Paused</span>;
    case AGENT_GOAL_STATE.MET:
      return (
        <span className={`${STANDING_CLASS} text-muted-foreground`}>
          <CircleCheckIcon
            className="size-attention-mark flex-none text-complete"
            aria-hidden="true"
          />
          <VisuallyHidden>Met in</VisuallyHidden>
          {countsTurns(goal) ? turnWords(goal.turns) : `${TOKENS.format(goal.tokens ?? 0)} tokens`}
        </span>
      );
    case AGENT_GOAL_STATE.IMPOSSIBLE:
      return <span className={`${STANDING_CLASS} font-label text-danger`}>Blocked</span>;
    case AGENT_GOAL_STATE.BUDGET_LIMITED:
      return <span className={`${STANDING_CLASS} font-label text-attention`}>Budget reached</span>;
    default:
      // Note that a goal whose agent stopped working is still set, and the harness picks it up again on the next message.
      return working ? (
        <span className={`${STANDING_CLASS} text-muted-foreground`}>
          {countsTurns(goal) ? <span>{`Turn ${goal.turns}`}</span> : null}
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

  const figures = countsTurns(goal)
    ? [{ label: "Turns", figure: String(goal.turns) }]
    : goal.tokens !== null && goalSettled(goal)
      ? [{ label: "Tokens", figure: tokenWords(goal.tokens, goal.tokenBudget) }]
      : [];

  return (
    <HoverCard>
      <HoverCardHead glyph={<GLYPH.GOAL />} name={goal.condition} sub={GOAL_THING} />
      {goal.reason === null ? null : <HoverCardNote>{goal.reason}</HoverCardNote>}
      {stopped ? (
        <HoverCardNote>
          The agent stopped before the goal was met. Your next message picks it up again.
        </HoverCardNote>
      ) : null}
      {figures.length === 0 ? null : (
        <>
          <HoverCardRule />
          <HoverCardFigures label="How far it has run" figures={figures} />
        </>
      )}
    </HoverCard>
  );
}

/** The goal over the message box, while one stands. Each act is none where the reader may not write to the agent or the harness takes no such command; a paused goal's play stands at rest, since the agent waits on it. */
export function GoalDock({
  messages,
  going,
  older,
  working,
  onPause,
  onResume,
  onClear,
}: {
  /** The transcript as the service stored it: a line still on its way, or refused, says nothing of the goal. */
  messages: readonly AgentTranscriptMessage[];
  /** The words of the lines the developer sent that the transcript has not read back yet, a goal line among them moving the goal at once. */
  going: readonly string[];
  /** Whether older pages of the transcript stand unread, which may hold the goal's setting. */
  older: boolean;
  /** Whether the agent is at work now, which a running goal's row counts its time by. */
  working: boolean;
  onPause: (() => void) | undefined;
  onResume: (() => void) | undefined;
  onClear: (() => void) | undefined;
}): ReactNode {
  const goalsOn = useGoalsOn();
  const read = useMemo(() => readGoal(messages, older), [messages, older]);
  const [now, setNow] = useState(() => Date.now());
  const sentAt = read.asked?.sentAt;

  // An ask the harness never answers stops moving the row once it waited its while, which the row is drawn again for.
  useEffect(() => {
    if (sentAt === undefined) return undefined;
    const left = sentAt + GOAL_ASK_WAIT_MS - Date.now();

    // An ask that already waited its while moves the row no more, which the row is drawn again for now.
    if (left <= 0) {
      setNow(Date.now());

      return undefined;
    }

    const timer = setTimeout(() => setNow(Date.now()), left);

    return () => clearTimeout(timer);
  }, [sentAt]);

  const goal = goalAsShown(read, going, working, now);

  if (goal === undefined || !goalsOn) return null;
  const paused = goal.state === AGENT_GOAL_STATE.PAUSED;
  const resume = paused ? onResume : undefined;
  const pause = goal.state === AGENT_GOAL_STATE.ACTIVE ? onPause : undefined;
  const clear = goalSettled(goal) ? undefined : onClear;

  const acts =
    resume === undefined && pause === undefined && clear === undefined ? undefined : (
      <>
        {resume === undefined ? null : (
          <IconButton
            size={BUTTON_SIZE.COMPACT}
            label="Resume goal"
            icon={<PlayIcon />}
            onClick={resume}
          />
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
            tone={goalTone(goal)}
            actions={acts}
            actionsAt={resume === undefined ? LIST_ROW_ACTIONS.HOVER : LIST_ROW_ACTIONS.ALWAYS}
          />
        </RowHintOptions>
      </List>
    </div>
  );
}

/** The glyph that leads a goal's trail: a met goal's tick in the ink the row's tick wears. */
function trailGlyph(event: GoalNotice["event"]): ReactNode {
  switch (event) {
    case GOAL_EVENT.PAUSED:
      return <PauseIcon />;
    case GOAL_EVENT.RESUMED:
      return <PlayIcon />;
    case GOAL_EVENT.MET:
      return <CircleCheckIcon className="text-complete" />;
    default:
      return <GLYPH.GOAL />;
  }
}

/** One move of the goal where it happened in the transcript: nothing for its setting, a trail for its end once met and each move of its standing, and a card for each verdict and any other end, the reason in its fold. */
export function GoalNoticeView({ notice: stored }: { notice: GoalNotice }): ReactNode {
  const goalsOn = useGoalsOn();
  const conditions = useContext(GoalConditions);
  const notice = stored.event === GOAL_EVENT.NOT_MET ? goalVerdict(stored, conditions) : stored;

  // Note that the goal's setting draws nothing, because the developer's own `/goal` message says it just above, and a project's own Stop hook draws nothing, as before goals.
  if (!goalsOn || notice === undefined || notice.event === GOAL_EVENT.SET) return null;

  if (TRAILS.has(notice.event)) {
    return (
      <NoteLine look={NOTE_LINE_LOOK.TRAIL} glyph={trailGlyph(notice.event)} data-goal-trail="">
        {NOTICE_WORDS[notice.event]}
      </NoteLine>
    );
  }

  const body = notice.reason;
  const folds = body !== null && body !== "";
  const said = NOTICE_WORDS[notice.event];
  const turn = notice.turns === null ? undefined : `Turn ${notice.turns}`;

  // Note that a notice stands at a received line's measure, as a check's card does, rather than across the column.
  return (
    <div className="max-w-bubble" data-goal-card="">
      <Plan
        open={folds ? undefined : false}
        fill={DISCLOSURE_FILL.ACTIONS}
        actions={
          <span className="flex min-w-0 flex-1 items-baseline gap-tight-gap py-row-inset">
            <OneLine className="flex-none text-muted-foreground">{said}</OneLine>
            {body === null ? null : (
              <OneLine className="agent-goal-preview min-w-0 flex-1">{body}</OneLine>
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
            {notice.event === GOAL_EVENT.IMPOSSIBLE ? <CircleSlashIcon /> : <GLYPH.GOAL />}
          </PlanIcon>
        </PlanHeader>
        {folds ? (
          <PlanContent layout={PLAN_BODY_LAYOUT.STACK}>
            <TranscriptWords text={body} />
          </PlanContent>
        ) : null}
      </Plan>
    </div>
  );
}
