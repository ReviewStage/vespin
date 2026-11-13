import { Cron, DateTime, Option, Result } from "effect";

/**
 * automation-schedule.ts -- when a scheduled automation is next due: its cron read in its time zone, held to a floor on how often it fires, or the one date and time it runs at.
 *
 * A repeating schedule is five-field cron (minute, hour, day of month, month, day of
 * week) read in the IANA zone the automation names, so "nine every weekday"
 * in New York is nine there in January and in July alike, and a time a
 * daylight-saving change skips or repeats is Effect's `Cron` to settle. A
 * schedule that would fire more often than `MIN_INTERVAL_MS` anywhere in
 * its next `INTERVAL_SAMPLE` firings is refused, because every firing starts
 * a coding agent and a minute's cron is a runaway, not a schedule. It is
 * declared here, beside the wire, so the service that fires a schedule and
 * the window that shows its next run read it the same way.
 *
 * A schedule that runs once is a date and a time of day, `YYYY-MM-DDTHH:mm`,
 * read as the wall clock of its zone, as Vercel Schedules reads a one-time
 * schedule's `at`; a time a daylight-saving change skips is read an hour
 * on, as the zone's clocks read it. It is due at that instant alone, and
 * one already past is refused, since it would never run.
 */

const AUTOMATION_SCHEDULE = {
  /** The shortest gap a schedule may leave between two firings. */
  MIN_INTERVAL_MS: 15 * 60_000,
  /** How many firings ahead the floor is checked over. */
  INTERVAL_SAMPLE: 64,
  /**
   * How late past its due instant a firing may still run: a sweep that
   * missed a schedule by more, a deployment or the cron itself down, moves
   * it on to its next instant rather than starting a stale run.
   */
  MISFIRE_GRACE_MS: 60 * 60_000,
} as const;

/** The schedules a picker offers before anyone writes cron, each read in the automation's zone. */
export const SCHEDULE_PRESET = {
  HOURLY: "0 * * * *",
  DAILY: "0 9 * * *",
  WEEKDAYS: "0 9 * * 1-5",
  WEEKLY: "0 9 * * 1",
} as const;

/** Why a schedule was refused. */
export const SCHEDULE_REFUSAL = {
  /** The expression is not five-field cron. */
  CRON: "cron",
  /** The zone is not one the IANA database names. */
  TIMEZONE: "timezone",
  /** It fires more often than the floor allows. */
  TOO_FREQUENT: "too-frequent",
  /** A one-time schedule's date and time is no real one. */
  AT: "at",
  /** A one-time schedule's date and time has passed. */
  PAST: "past",
} as const;

export type ScheduleRefusal = (typeof SCHEDULE_REFUSAL)[keyof typeof SCHEDULE_REFUSAL];

/** A schedule as a trigger names it: the cron, or the date and time it runs once, and the zone it is read in. */
type Schedule =
  | { readonly cron: string; readonly timezone: string }
  | { readonly at: string; readonly timezone: string };

/** A one-time schedule's date and time as it is spelled: `YYYY-MM-DDTHH:mm`. */
const ONCE_AT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/u;

/** The number of fields five-field cron spells. */
const CRON_FIELDS = 5;

/** Whether any two firings of the next sample fall closer than the floor. */
function firesTooOften(cron: Cron.Cron, from: Date): boolean {
  let previous: Date | undefined;
  let taken = 0;

  for (const at of Cron.sequence(cron, from)) {
    if (
      previous !== undefined &&
      at.getTime() - previous.getTime() < AUTOMATION_SCHEDULE.MIN_INTERVAL_MS
    ) {
      return true;
    }

    previous = at;
    taken += 1;

    if (taken >= AUTOMATION_SCHEDULE.INTERVAL_SAMPLE) return false;
  }

  return false;
}

/** A repeating schedule read for firing, or why it cannot be, with the floor checked from `from`. */
function readCron(
  cron: string,
  timezone: string,
  from: Date,
): Result.Result<Cron.Cron, ScheduleRefusal> {
  if (cron.trim().split(/\s+/u).length !== CRON_FIELDS) {
    return Result.fail(SCHEDULE_REFUSAL.CRON);
  }

  const zone = DateTime.zoneMakeNamed(timezone);

  if (Option.isNone(zone)) return Result.fail(SCHEDULE_REFUSAL.TIMEZONE);
  const parsed = Cron.parse(cron, zone.value);

  if (Result.isFailure(parsed)) return Result.fail(SCHEDULE_REFUSAL.CRON);

  if (firesTooOften(parsed.success, from)) return Result.fail(SCHEDULE_REFUSAL.TOO_FREQUENT);

  return Result.succeed(parsed.success);
}

/**
 * The instant a one-time schedule names, its date and time read on its
 * zone's wall clock, or why it names none. Note that the date is checked
 * against a calendar first, because a zone's reading would roll the 31st
 * of November over into December rather than refuse it.
 */
function readOnce(at: string, timezone: string): Result.Result<Date, ScheduleRefusal> {
  const spelled = ONCE_AT.exec(at);

  if (spelled === null) return Result.fail(SCHEDULE_REFUSAL.AT);
  const [year, month, day, hour, minute] = spelled.slice(1).map(Number);
  const wall = new Date(Date.UTC(year ?? 0, (month ?? 0) - 1, day, hour, minute));

  if (
    wall.getUTCFullYear() !== year ||
    wall.getUTCMonth() + 1 !== month ||
    wall.getUTCDate() !== day ||
    wall.getUTCHours() !== hour ||
    wall.getUTCMinutes() !== minute
  ) {
    return Result.fail(SCHEDULE_REFUSAL.AT);
  }

  if (Option.isNone(DateTime.zoneMakeNamed(timezone))) {
    return Result.fail(SCHEDULE_REFUSAL.TIMEZONE);
  }

  const zoned = DateTime.makeZoned(wall, { timeZone: timezone, adjustForTimeZone: true });

  return Option.isSome(zoned)
    ? Result.succeed(new Date(DateTime.toEpochMillis(zoned.value)))
    : Result.fail(SCHEDULE_REFUSAL.AT);
}

/** The instant a one-time schedule runs at, whether or not it has passed; nothing for one that names no instant. */
export function onceInstant(schedule: {
  readonly at: string;
  readonly timezone: string;
}): Date | undefined {
  return Result.getOrUndefined(readOnce(schedule.at, schedule.timezone));
}

/**
 * The schedule read for firing, answering the first instant strictly after
 * `from` it is due, or why it cannot be: a cron with the floor checked from
 * `from`, or a one-time schedule whose instant is still to come.
 */
export function readSchedule(schedule: Schedule, from: Date): Result.Result<Date, ScheduleRefusal> {
  if ("at" in schedule) {
    return Result.flatMap(readOnce(schedule.at, schedule.timezone), (instant) =>
      instant.getTime() > from.getTime()
        ? Result.succeed(instant)
        : Result.fail(SCHEDULE_REFUSAL.PAST),
    );
  }

  return Result.map(readCron(schedule.cron, schedule.timezone, from), (cron) =>
    Cron.next(cron, from),
  );
}

/** The first instant strictly after `after` the schedule is due; nothing for a schedule that cannot be read, or a one-time one already past. */
export function nextScheduledRun(schedule: Schedule, after: Date): Date | undefined {
  return Result.getOrUndefined(readSchedule(schedule, after));
}
