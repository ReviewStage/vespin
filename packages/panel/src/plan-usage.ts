import type { PlanUsage, SubscriptionKeySummary } from "@repo/features/provider-key-wire";
import { agoText } from "@repo/features/time-format";
import { PROGRESS_TONE, type UsageMeterRow } from "@repo/ui";

/**
 * plan-usage.ts -- a plan's usage windows as its meters draw them: each window's name, share used, and reset, and how old the reading is.
 *
 * A window is named from its length, never its place in the provider's
 * answer, since Codex's primary window is usually but not always the
 * 5-hour one: "5-hour", "Weekly", "Daily", "30-day"; and a window on one
 * model alone names the model after it, "Weekly (Opus)", as Claude Code's `/usage` does. Each
 * row carries when its window resets, which the meters say as every time is
 * said (`TIME_LOOK.UNTIL`). The rows keep the
 * order the service answers, the shortest window first. Every reading says
 * when it was heard (`updated`), "Updated just now" inside a minute, which
 * Settings draws under each plan's meters so a refresh shows it landed; a
 * place that says it only where it may be stale reads `heard`, set past
 * `STALE_MS`, as Codex's `/status` warns that its limits may be stale,
 * because a plan's usage is heard only from the turns that ran on it, and a
 * Codex plan's from ChatGPT besides as its keys are read.
 */

/** Minutes in an hour, a day, and a week. */
const MINUTES = { HOUR: 60, DAY: 24 * 60, WEEK: 7 * 24 * 60 } as const;

/** How old a reading may be before its meters say when it was heard. */
const STALE_MS = 15 * 60 * 1000;

/** Inside this long a reading is said to be heard just now. */
const JUST_NOW_MS = 60 * 1000;

/** The share at which a window is at its limit. */
const FULL_PERCENT = 100;

/** A window's length as its name says it: "5-hour", "Weekly". */
function lengthLabel(windowMins: number | undefined): string {
  if (windowMins === undefined) return "Limit";

  if (windowMins === MINUTES.WEEK) return "Weekly";

  if (windowMins === MINUTES.DAY) return "Daily";

  if (windowMins % MINUTES.DAY === 0) return `${String(windowMins / MINUTES.DAY)}-day`;

  if (windowMins % MINUTES.HOUR === 0) return `${String(windowMins / MINUTES.HOUR)}-hour`;

  return `${String(windowMins)}-minute`;
}

/** A window's name: its length, and the model it alone counts where it counts one, "Weekly (Opus)". */
function windowLabel(window: PlanUsage): string {
  const length = lengthLabel(window.windowMins);

  return window.model === undefined ? length : `${length} (${window.model})`;
}

/** When a window resets, where a clock can name it: a reset past the dates `Date` holds, as an undocumented answer could send, is none. */
function resetOf(window: PlanUsage): number | undefined {
  const { resetsAt } = window;

  return resetsAt === undefined || Number.isNaN(new Date(resetsAt).getTime())
    ? undefined
    : resetsAt;
}

/** One window as its meter row draws it. */
function windowRow(window: PlanUsage): UsageMeterRow {
  return {
    label: windowLabel(window),
    usedPercent: window.usedPercent,
    resetsAt: resetOf(window),
    tone: window.usedPercent >= FULL_PERCENT ? PROGRESS_TONE.ATTENTION : PROGRESS_TONE.WORKING,
  };
}

/** A plan's usage as its meters draw it: a row a window, when it was heard, and that again where it is not fresh. */
export interface PlanUsageMeters {
  readonly rows: readonly UsageMeterRow[];
  /** When it was heard, however fresh: "Updated just now", "Updated 4h ago". */
  readonly updated?: string;
  /** When it was heard, where that is not fresh. */
  readonly heard?: string;
}

/** When a reading was heard, as its meters say it. */
function updatedWords(heardAt: number, now: number): string {
  return now - heardAt < JUST_NOW_MS ? "Updated just now" : `Updated ${agoText(heardAt, now)}`;
}

/** A plan's usage as its meters draw it, in the order the service answers its windows; none before any is heard. */
export function planUsageMeters(
  plan: SubscriptionKeySummary,
  now: number,
): PlanUsageMeters | undefined {
  const windows = plan.usageWindows ?? (plan.usage === undefined ? [] : [plan.usage]);

  if (windows.length === 0) return undefined;
  const rows = windows.map(windowRow);
  const heardAt = plan.usageHeardAt;

  if (heardAt === undefined) return { rows };
  const updated = updatedWords(heardAt, now);

  return now - heardAt > STALE_MS ? { rows, updated, heard: updated } : { rows, updated };
}
