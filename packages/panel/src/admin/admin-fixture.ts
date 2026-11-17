/**
 * admin-fixture.ts -- the admin dashboard's synthetic answers, for a fixture run's Admin place and a development tab's `admin.html?fixture=admin`: the fixture's admin signed in, the Overview's metrics staged, and every other read unanswered.
 *
 * A fixture run reaches no service, so the admin screens read these in its
 * place: the app's Admin through its act door (`settings-fixture.ts`), and
 * the web's standalone page through its own doors (`web-admin-doors.tsx`),
 * which signs in no one and holds nothing at the gate under the fixture.
 * Only the Overview's read is staged, its counts scaled to the window asked
 * and its admins left out unless asked for everyone, as the service answers
 * it; every other read is unanswered, which its screen words as its own
 * failure. Every person and count here is invented.
 */

import type { AdminMetrics, AdminRetentionCohort } from "@repo/features/admin-answer-wire";
import {
  ACTIVITY_FEATURE,
  AGENT_ORIGIN,
  FUNNEL_STEP,
  REACH_FEATURE,
} from "@repo/features/admin-overview-vocabulary";
import {
  ADMIN_METRICS_SCOPE,
  ADMIN_METRICS_SCOPE_PARAM,
  ADMIN_METRICS_WINDOW_DEFAULT,
  ADMIN_METRICS_WINDOW_PARAM,
  ADMIN_READ,
  ADMIN_UNANSWERED,
  type AdminReadAnswer,
  type AdminReadParams,
  adminMetricsScope,
  adminMetricsWindow,
} from "@repo/features/admin-wire";
import { type AdminReads, adminReadsAnswering } from "./admin-doors.js";
import type { ViewerAccount } from "./chrome/page-header.js";

/** When the fixture stands, from which every instant here is counted: a fixed one, never the clock, the one the other fixtures stand at. */
const NOW = Date.parse("2026-10-24T09:00:00Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** The fixture's account, signed in and an admin of the service, as `settings-fixture.ts` signs it in. */
const ACCOUNT_ID = "user-ada";

/** The `days` UTC days up to the fixture's day, oldest first, as YYYY-MM-DD. */
function trailingDays(days: number): readonly string[] {
  return Array.from({ length: days }, (_, index) =>
    new Date(NOW - (days - 1 - index) * DAY).toISOString().slice(0, 10),
  );
}

/** A count that rises over the window and dips at weekends, so a chart of it reads as a real one. */
function wave(index: number, base: number, step: number): number {
  const weekend = index % 7 === 5 || index % 7 === 6;

  return Math.round((base + index * step) * (weekend ? 0.4 : 1) + ((index * 7) % 5));
}

/** Six weekly cohorts, each retained a little less week on week, the newest still accruing. */
function cohorts(): AdminRetentionCohort[] {
  const weeks = 6;

  return Array.from({ length: weeks }, (_, cohort) => {
    const size = 18 + cohort * 4;
    const reached = weeks - cohort;

    return {
      weekStart: new Date(NOW - (weeks - cohort) * 7 * DAY).toISOString().slice(0, 10),
      size,
      cells: Array.from({ length: reached }, (_, offset) => {
        const activeAccounts = offset === 0 ? size : Math.round(size * (0.62 - offset * 0.07));

        return {
          offset,
          activeAccounts,
          share: activeAccounts / size,
          inProgress: offset === reached - 1,
        };
      }),
    };
  });
}

/** One of the most active accounts, its numbers counted over the window. */
function topAccount(id: string, name: string, activeDays: number, admin = false) {
  return {
    id,
    name,
    email: `${id.replace("user-", "")}@example.com`,
    image: null,
    admin,
    activeDays,
    tasks: activeDays * 2,
    agents: activeDays * 3,
    prsMerged: activeDays,
    lastSeenAt: NOW - activeDays * HOUR,
  };
}

/** How many of the fixture's accounts are admins, whom the Overview leaves out unless asked for everyone. */
const ADMIN_ACCOUNTS = 3;

/** Every other account, more than a quarter's signups add up to, so no window counts more new accounts than there are. */
const NON_ADMIN_ACCOUNTS = 640;

/**
 * The Overview's numbers over the window the read asks for, the last 30 days
 * where it names none, and over every account or every account but the
 * admins, as its Hide admins asks: a window's counts scaled to its length,
 * and the admins left out of the totals and the most active accounts.
 */
function adminMetrics(query: Readonly<Record<string, string>>): AdminMetrics {
  const windowDays =
    adminMetricsWindow(query[ADMIN_METRICS_WINDOW_PARAM]) ?? ADMIN_METRICS_WINDOW_DEFAULT;

  const adminsHidden =
    adminMetricsScope(query[ADMIN_METRICS_SCOPE_PARAM]) !== ADMIN_METRICS_SCOPE.ALL;

  // A month's active days scaled to the window, at least one and never more than the window holds.
  const activeIn = (monthly: number) =>
    Math.min(windowDays, Math.max(1, Math.round((monthly * windowDays) / 30)));

  const days = trailingDays(windowDays);
  const retention = { weeks: 6, cohorts: cohorts() };

  const funnel = [
    [FUNNEL_STEP.SIGNED_UP, 64],
    [FUNNEL_STEP.GITHUB_CONNECTED, 51],
    [FUNNEL_STEP.CREATED_TASK, 43],
    [FUNNEL_STEP.STARTED_AGENT, 27],
    [FUNNEL_STEP.OPENED_PR, 19],
    [FUNNEL_STEP.MERGED_PR, 14],
  ] as const;

  // The signups are the daily series summed, as the service counts them, so the total and the funnel's base agree with the bars.
  const dailySignups = days.map((day, index) => ({ day, count: wave(index, 1, 0.08) }));
  const signedUp = dailySignups.reduce((sum, day) => sum + day.count, 0);

  const reach = [
    [REACH_FEATURE.TASKS, 38],
    [REACH_FEATURE.AGENTS, 33],
    [REACH_FEATURE.INBOX, 26],
    [REACH_FEATURE.INTEGRATIONS, 29],
    [REACH_FEATURE.AUTOMATIONS, 9],
  ] as const;

  const activeDevelopers = adminsHidden ? 42 : 42 + ADMIN_ACCOUNTS;

  const topAccounts = [
    topAccount("user-maya", "Maya Okafor", activeIn(27)),
    topAccount(ACCOUNT_ID, "Ada Lovelace", activeIn(24), true),
    topAccount("user-theo", "Theo Lindqvist", activeIn(19)),
    topAccount("user-priya", "Priya Raman", activeIn(12)),
  ];

  return {
    generatedAt: NOW,
    windowDays,
    users: {
      total: adminsHidden ? NON_ADMIN_ACCOUNTS : NON_ADMIN_ACCOUNTS + ADMIN_ACCOUNTS,
      newInWindow: signedUp,
      signupTrend: { days: 7, recent: 18, prior: 14 },
      dailySignups,
    },
    overview: {
      headline: {
        activeDevelopers: { days: 7, recent: activeDevelopers, prior: 37 },
        tasksCreated: { days: 7, recent: 96, prior: 81 },
        agentsStarted: { days: 7, recent: 214, prior: 188 },
        prsMerged: { days: 7, recent: 71, prior: 66 },
        prsOpened: { opened: 102, merged: 64 },
      },
      agentOrigins: {
        agentsStarted: 214,
        origins: (
          [
            [AGENT_ORIGIN.AUTOMATION, 37],
            [AGENT_ORIGIN.SLACK, 18],
            [AGENT_ORIGIN.AGENT, 63],
            [AGENT_ORIGIN.HAND, 96],
          ] as const
        ).map(([origin, agents]) => ({ origin, agents, share: agents / 214 })),
      },
      activity: {
        daily: days.map((day, index) => ({
          day,
          [ACTIVITY_FEATURE.AGENTS_STARTED]: wave(index, 20, 0.6),
          [ACTIVITY_FEATURE.DESCRIPTION_REVISIONS]: wave(index, 34, 0.5),
          [ACTIVITY_FEATURE.INBOX_ANSWERED]: wave(index, 15, 0.4),
          [ACTIVITY_FEATURE.AUTOMATION_RUNS]: wave(index, 4, 0.2),
        })),
        trend: { days: 7, recent: 1840, prior: 1622 },
      },
      funnel: funnel.map(([step, monthly]) => {
        // Each step keeps its month's share of the signups, so no step outnumbers the one before it.
        const accounts = Math.round((signedUp * monthly) / 64);

        return { step, accounts, share: signedUp === 0 ? null : accounts / signedUp };
      }),
      reach: {
        activeDevelopers,
        features: reach.map(([feature, developers]) => ({
          feature,
          developers,
          share: developers / activeDevelopers,
        })),
      },
      topAccounts: adminsHidden ? topAccounts.filter((account) => !account.admin) : topAccounts,
      retention,
    },
    retention,
  };
}

/** What a fixture answers an admin read with, as the host's `admin.read` would: the Overview's metrics, and every other read unanswered. */
export function fixtureAdminRead({ procedure, query }: AdminReadParams): AdminReadAnswer {
  return procedure === ADMIN_READ.METRICS
    ? { answer: adminMetrics(query) }
    : { refused: ADMIN_UNANSWERED };
}

/** What the web's admin page stands on under a development tab's fixture, in place of the service and the session. */
export interface AdminFixture {
  /** The admin screens' reads, staged here, the star landing as asked. */
  readonly reads: AdminReads;
  /** Who stands signed in at the sidebar's foot: the fixture's account. */
  readonly viewer: ViewerAccount;
}

export const ADMIN_FIXTURE: AdminFixture = {
  reads: adminReadsAnswering(
    async (params) => fixtureAdminRead(params),
    async () => true,
  ),
  viewer: { name: "Ada Lovelace", email: "ada@example.com", image: undefined },
};
