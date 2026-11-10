import type { PlanUsage, SubscriptionKeySummary } from "@repo/features/provider-key-wire";
import { agoText, distanceText } from "@repo/features/time-format";
import { PROGRESS_TONE, type UsageMeterRow } from "@repo/ui";

/**
 * plan-usage.ts -- a plan's usage windows as its meters draw them: each window's name, share used, and reset, and how old the reading is.
 *
 * A window is named from its length, never its place in the provider's
 * answer, since Codex's primary window is usually but not always the
 * 5-hour one: "5-hour", "Weekly", "Daily", "30-day". A reading older than
 * `STALE_MS` says when it was heard, as Codex's `/status` warns that its
 * limits may be stale, because a plan's usage is heard only from the turns
 * that ran on it, and a Codex plan's from ChatGPT besides as its keys are
 * read.
 */

/** Minutes in an hour, a day, and a week. */
const MINUTES = { HOUR: 60, DAY: 24 * 60, WEEK: 7 * 24 * 60 } as const;

/** How old a reading may be before its meters say when it was heard. */
const STALE_MS = 15 * 60 * 1000;

/** The share at which a window is at its limit. */
const FULL_PERCENT = 100;

/** A window's name, by its length: "5-hour", "Weekly". */
function windowLabel(windowMins: number | undefined): string {
  if (windowMins === undefined) return "Limit";
  if (windowMins === MINUTES.WEEK) return "Weekly";
  if (windowMins === MINUTES.DAY) return "Daily";
  if (windowMins % MINUTES.DAY === 0) return `${String(windowMins / MINUTES.DAY)}-day`;
  if (windowMins % MINUTES.HOUR === 0) return `${String(windowMins / MINUTES.HOUR)}-hour`;
  return `${String(windowMins)}-minute`;
}

/** One window as its meter row draws it. */
function windowRow(window: PlanUsage, now: number): UsageMeterRow {
  return {
    label: windowLabel(window.windowMins),
    usedPercent: window.usedPercent,
    resets: window.resetsAt === undefined ? undefined : distanceText(window.resetsAt - now),
    tone: window.usedPercent >= FULL_PERCENT ? PROGRESS_TONE.ATTENTION : PROGRESS_TONE.WORKING,
  };
}

/** A plan's usage as its meters draw it: a row a window, and when it was heard where that is not fresh. */
export interface PlanUsageMeters {
  readonly rows: readonly UsageMeterRow[];
  readonly heard?: string;
}

/** A plan's usage as its meters draw it, the shortest window first; none before any is heard. */
export function planUsageMeters(
  plan: SubscriptionKeySummary,
  now: number,
): PlanUsageMeters | undefined {
  const windows = plan.usageWindows ?? (plan.usage === undefined ? [] : [plan.usage]);
  if (windows.length === 0) return undefined;
  const rows = windows
    .toSorted((a, b) => (a.windowMins ?? 0) - (b.windowMins ?? 0))
    .map((window) => windowRow(window, now));
  const heardAt = plan.usageHeardAt;
  return heardAt !== undefined && now - heardAt > STALE_MS
    ? { rows, heard: `Updated ${agoText(heardAt, now)}` }
    : { rows };
}
