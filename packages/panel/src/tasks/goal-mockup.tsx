/**
 * goal-mockup.tsx -- MOCKUP ONLY, not for merging: an agent's goal as it would stand in its tab, driven by a local store in place of the harness's goal events.
 *
 * Three surfaces, each drawn with the components its neighbors use:
 * - `GoalDock`, a row over the message box beside the queue and the pull
 *   request, saying what the goal is, where it stands, and its controls.
 * - `GoalLines`, the cards a goal leaves in the transcript as the checker
 *   answers each turn (Claude Code) or the goal's status moves (Codex),
 *   drawn as a line from GitHub is.
 * - `startMockGoal`, which `/goal <condition>` in the message box calls.
 *
 * `?goal=claude` (the default) or `?goal=codex` on the address picks the
 * harness, and `?goal=none` starts with no goal. While a goal is active the
 * store plays it forward every few seconds so the loop can be watched.
 */

import {
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  DISCLOSURE_FILL,
  IconButton,
  LIST_DENSITY,
  LIST_ROW_ACTIONS,
  LIST_VARIANT,
  List,
  ListRow,
  MESSAGE_LINE_ALIGN,
  MessageLine,
  OneLine,
  PauseIcon,
  PlayIcon,
} from "@repo/ui";
import { CircleCheckIcon, GLYPH } from "@repo/ui/icons";
import { MESSAGE_ROLE } from "@repo/wire";
import { type ReactNode, useEffect, useSyncExternalStore } from "react";
import { Message, RECEIVED_MESSAGE_CLASS } from "../ai-elements/message.js";
import { PLAN_BODY_LAYOUT, Plan, PlanContent, PlanHeader, PlanIcon } from "../ai-elements/plan.js";
import { COMPOSER_DOCK_CLASS } from "./agent-composer.js";
import { WorkingLine } from "./working-time.js";

const MOCK_HARNESS = { CLAUDE: "claude", CODEX: "codex" } as const;
type MockHarness = (typeof MOCK_HARNESS)[keyof typeof MOCK_HARNESS];

const MOCK_STATUS = {
  ACTIVE: "active",
  PAUSED: "paused",
  MET: "met",
  BUDGET: "budget",
} as const;
type MockStatus = (typeof MOCK_STATUS)[keyof typeof MOCK_STATUS];

const MOCK_EVENT = {
  SET: "set",
  NOT_MET: "not-met",
  MET: "met",
  PAUSED: "paused",
  RESUMED: "resumed",
  CLEARED: "cleared",
  BUDGET: "budget",
} as const;
type MockEventKind = (typeof MOCK_EVENT)[keyof typeof MOCK_EVENT];

interface MockEvent {
  readonly id: number;
  readonly kind: MockEventKind;
  readonly at: number;
  readonly turn?: number;
  readonly reason?: string;
}

interface MockGoal {
  readonly harness: MockHarness;
  readonly objective: string;
  readonly status: MockStatus;
  readonly startedAt: number;
  readonly turns: number;
  readonly tokens: number;
  readonly budget: number | undefined;
  readonly lastReason: string | undefined;
}

interface MockState {
  readonly goal: MockGoal | undefined;
  readonly events: readonly MockEvent[];
}

const MINUTE = 60_000;
const TICK_MS = Number(new URLSearchParams(window.location.search).get("goaltick") ?? 6_000);
const OBJECTIVE = "Every test in tests/billing passes and CI on #214 is green, without skipping or deleting a test";

/** What the checker says after each Claude Code turn, in order, before the goal holds. */
const CLAUDE_REASONS = [
  "3 of 14 billing tests still fail: proration rounds a cent off in invoice.test.ts.",
  "Billing tests pass locally, but CI on #214 hasn't run since the last push.",
  "CI on #214 is running; nothing in the transcript shows it green yet.",
];
const CLAUDE_MET =
  "The transcript shows all 14 billing tests passing and every check on #214 green, with no test skipped or removed.";

let nextId = 1;
const listeners = new Set<() => void>();

function harnessOfAddress(): MockHarness | undefined {
  const named = new URLSearchParams(window.location.search).get("goal");
  if (named === "none") return undefined;
  return named === MOCK_HARNESS.CODEX ? MOCK_HARNESS.CODEX : MOCK_HARNESS.CLAUDE;
}

function seeded(harness: MockHarness | undefined): MockState {
  if (harness === undefined) return { goal: undefined, events: [] };
  const now = Date.now();
  const startedAt = now - 12 * MINUTE;
  if (harness === MOCK_HARNESS.CODEX) {
    return {
      goal: {
        harness,
        objective: OBJECTIVE,
        status: MOCK_STATUS.ACTIVE,
        startedAt,
        turns: 3,
        tokens: 184_000,
        budget: 500_000,
        lastReason: undefined,
      },
      events: [{ id: nextId++, kind: MOCK_EVENT.SET, at: startedAt }],
    };
  }
  return {
    goal: {
      harness,
      objective: OBJECTIVE,
      status: MOCK_STATUS.ACTIVE,
      startedAt,
      turns: 2,
      tokens: 0,
      budget: undefined,
      lastReason: CLAUDE_REASONS[0],
    },
    events: [
      { id: nextId++, kind: MOCK_EVENT.SET, at: startedAt },
      { id: nextId++, kind: MOCK_EVENT.NOT_MET, at: now - 6 * MINUTE, turn: 1, reason: CLAUDE_REASONS[0] ?? "" },
    ],
  };
}

let state: MockState = seeded(harnessOfAddress());

function emit(next: MockState): void {
  state = next;
  for (const listener of listeners) listener();
}

function event(kind: MockEventKind, extra: Partial<MockEvent> = {}): MockEvent {
  return { id: nextId++, kind, at: Date.now(), ...extra };
}

function withGoal(goal: MockGoal | undefined, ...events: MockEvent[]): void {
  emit({ goal, events: [...state.events, ...events] });
}

/** One step of the loop: a turn ends and the goal answers it. */
function playForward(): void {
  const goal = state.goal;
  if (goal === undefined || goal.status !== MOCK_STATUS.ACTIVE) return;
  const ended = goal.turns;
  const turn = ended + 1;
  if (goal.harness === MOCK_HARNESS.CLAUDE) {
    const reason = CLAUDE_REASONS[ended - 1];
    if (reason === undefined) {
      withGoal(
        { ...goal, status: MOCK_STATUS.MET, lastReason: CLAUDE_MET },
        event(MOCK_EVENT.MET, { turn: ended, reason: CLAUDE_MET }),
      );
      return;
    }
    withGoal(
      { ...goal, turns: turn, lastReason: reason },
      event(MOCK_EVENT.NOT_MET, { turn: ended, reason }),
    );
    return;
  }
  const tokens = goal.tokens + 74_000;
  const budget = goal.budget ?? Number.POSITIVE_INFINITY;
  if (tokens >= budget) {
    withGoal(
      { ...goal, status: MOCK_STATUS.BUDGET, turns: turn, tokens: budget },
      event(MOCK_EVENT.BUDGET, {
        turn,
        reason:
          "Billing tests pass; CI on #214 still has one flaky check. Next step: rerun the checks, then confirm they're green.",
      }),
    );
    return;
  }
  if (turn >= 7) {
    withGoal(
      { ...goal, status: MOCK_STATUS.MET, turns: turn, tokens },
      event(MOCK_EVENT.MET, {
        turn,
        reason: "All 14 billing tests pass and every check on #214 is green.",
      }),
    );
    return;
  }
  withGoal({ ...goal, turns: turn, tokens });
}

/** Sets a goal, as `/goal <condition>` does. */
export function startMockGoal(objective: string): void {
  const harness = state.goal?.harness ?? harnessOfAddress() ?? MOCK_HARNESS.CLAUDE;
  const codex = harness === MOCK_HARNESS.CODEX;
  emit({
    goal: {
      harness,
      objective,
      status: MOCK_STATUS.ACTIVE,
      startedAt: Date.now(),
      turns: 1,
      tokens: codex ? 12_000 : 0,
      budget: codex ? 500_000 : undefined,
      lastReason: undefined,
    },
    events: [...state.events, event(MOCK_EVENT.SET)],
  });
}

function pause(): void {
  if (state.goal === undefined) return;
  withGoal({ ...state.goal, status: MOCK_STATUS.PAUSED }, event(MOCK_EVENT.PAUSED));
}

function resume(): void {
  if (state.goal === undefined) return;
  withGoal({ ...state.goal, status: MOCK_STATUS.ACTIVE }, event(MOCK_EVENT.RESUMED));
}

function clear(): void {
  const settled = state.goal?.status === MOCK_STATUS.MET || state.goal?.status === MOCK_STATUS.BUDGET;
  if (settled) withGoal(undefined);
  else withGoal(undefined, event(MOCK_EVENT.CLEARED));
}

function useMockGoal(): MockState {
  const read = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
  const active = read.goal?.status === MOCK_STATUS.ACTIVE;
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(playForward, TICK_MS);
    return () => clearInterval(timer);
  }, [active]);
  return read;
}

function elapsed(since: number): string {
  const minutes = Math.max(1, Math.round((Date.now() - since) / MINUTE));
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function thousands(tokens: number): string {
  return tokens >= 1_000_000 ? `${(tokens / 1_000_000).toFixed(1)}M` : `${Math.round(tokens / 1000)}k`;
}

function standingWords(goal: MockGoal): string {
  const codex = goal.harness === MOCK_HARNESS.CODEX;
  const spent = codex
    ? `${thousands(goal.tokens)}${goal.budget === undefined ? "" : ` of ${thousands(goal.budget)}`} tokens`
    : `Turn ${goal.turns}`;
  switch (goal.status) {
    case MOCK_STATUS.ACTIVE:
      return codex || goal.lastReason === undefined ? `Working · ${spent}` : `${spent} · ${goal.lastReason}`;
    case MOCK_STATUS.PAUSED:
      return `Paused · ${spent}`;
    case MOCK_STATUS.MET:
      return `Met after ${goal.turns} turns · ${elapsed(goal.startedAt)}`;
    case MOCK_STATUS.BUDGET:
      return `Budget reached · ${spent}`;
  }
}

/** The goal over the message box: what it is, where it stands, and what the reader may do with it. */
export function GoalDock(): ReactNode {
  const { goal } = useMockGoal();
  if (goal === undefined) return null;
  const codex = goal.harness === MOCK_HARNESS.CODEX;
  const settled = goal.status === MOCK_STATUS.MET || goal.status === MOCK_STATUS.BUDGET;
  return (
    <div className={`agent-goal-dock ${COMPOSER_DOCK_CLASS}`}>
      <List label="Goal" variant={LIST_VARIANT.CARD} density={LIST_DENSITY.COMPACT}>
        <ListRow
          leading={goal.status === MOCK_STATUS.MET ? <CircleCheckIcon /> : <GLYPH.GOAL />}
          title={<OneLine words={goal.objective}>{goal.objective}</OneLine>}
          description={standingWords(goal)}
          meta={settled ? undefined : elapsed(goal.startedAt)}
          muted={goal.status === MOCK_STATUS.PAUSED}
          actionsAt={LIST_ROW_ACTIONS.ALWAYS}
          actions={
            <>
              {/* Note that only Codex can pause a goal; Claude Code's only stop is clearing it. */}
              {!codex || settled ? null : goal.status === MOCK_STATUS.PAUSED ? (
                <Button
                  size={BUTTON_SIZE.COMPACT}
                  variant={BUTTON_VARIANT.QUIET}
                  icon={<PlayIcon />}
                  onClick={resume}
                >
                  Resume
                </Button>
              ) : (
                <Button
                  size={BUTTON_SIZE.COMPACT}
                  variant={BUTTON_VARIANT.QUIET}
                  icon={<PauseIcon />}
                  onClick={pause}
                >
                  Pause
                </Button>
              )}
              <IconButton
                size={BUTTON_SIZE.COMPACT}
                label={settled ? "Dismiss" : "Clear goal"}
                icon={<GLYPH.CLOSE />}
                onClick={clear}
              />
            </>
          }
        />
      </List>
    </div>
  );
}

function headWords(entry: MockEvent): string {
  switch (entry.kind) {
    case MOCK_EVENT.SET:
      return "Goal set";
    case MOCK_EVENT.NOT_MET:
      return "Goal not met yet";
    case MOCK_EVENT.MET:
      return "Goal met";
    case MOCK_EVENT.PAUSED:
      return "Goal paused";
    case MOCK_EVENT.RESUMED:
      return "Goal resumed";
    case MOCK_EVENT.CLEARED:
      return "Goal cleared";
    case MOCK_EVENT.BUDGET:
      return "Goal stopped at its token budget";
  }
}

/** One goal event as a received line's card: its head, and the checker's reason under its fold where it gave one. */
function GoalLineCard({ entry, objective }: { entry: MockEvent; objective: string }): ReactNode {
  const body = entry.kind === MOCK_EVENT.SET ? objective : entry.reason;
  const folds = body !== undefined;
  const turn = entry.turn === undefined ? "" : `Turn ${entry.turn}`;
  const preview = entry.kind === MOCK_EVENT.SET ? undefined : entry.reason;
  return (
    <Message from={MESSAGE_ROLE.ASSISTANT} className={RECEIVED_MESSAGE_CLASS}>
      <Plan
        open={folds ? undefined : false}
        fill={DISCLOSURE_FILL.ACTIONS}
        actions={
          <span className="flex min-w-0 flex-1 items-baseline gap-tight-gap py-row-inset">
            <OneLine className="flex-none text-muted-foreground">{headWords(entry)}</OneLine>
            {preview === undefined ? null : <OneLine className="min-w-0 flex-1">{preview}</OneLine>}
            {turn === "" ? null : (
              <OneLine className="ms-auto flex-none ps-tight-gap text-muted-foreground">{turn}</OneLine>
            )}
          </span>
        }
      >
        <PlanHeader folds={folds} aria-label={headWords(entry)}>
          <PlanIcon>{entry.kind === MOCK_EVENT.MET ? <CircleCheckIcon /> : <GLYPH.GOAL />}</PlanIcon>
        </PlanHeader>
        {folds ? (
          <PlanContent layout={PLAN_BODY_LAYOUT.STACK}>
            <p>{body}</p>
          </PlanContent>
        ) : null}
      </Plan>
      <MessageLine align={MESSAGE_LINE_ALIGN.START} at={entry.at} />
    </Message>
  );
}

/** Every card the goal left, at the transcript's end, and the working line while it runs. */
export function GoalLines(): ReactNode {
  const { goal, events } = useMockGoal();
  const objective = goal?.objective ?? OBJECTIVE;
  return (
    <>
      {events.map((entry) => (
        <GoalLineCard key={entry.id} entry={entry} objective={objective} />
      ))}
      {goal?.status === MOCK_STATUS.ACTIVE ? (
        <WorkingLine
          startedAt={goal.startedAt}
          words={goal.harness === MOCK_HARNESS.CODEX ? "Working toward the goal" : `Working toward the goal · turn ${goal.turns}`}
        />
      ) : null}
    </>
  );
}
