/**
 * admin-billing.ts -- what each workspace's sandboxes used in a UTC month and what it would be billed, shaped for the admin Billing screen, the Workspace page, and the account page.
 *
 * Every figure is read from the service's own usage ledger (`usage_charge`),
 * the same rows the start gate reads, so the screen answers whether or not
 * billing is switched on (`BILLING_LIVE`) or the invoicing provider is
 * connected. What is billable is the ledger's own rule
 * (`@repo/database/usage-vocabulary`): the allowance every workspace is
 * given free each month, and the usage past it. The answers carry names of
 * workspaces and the account faces every admin table draws, and dollars:
 * nothing a sandbox ran.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import {
  billableMicroUsd,
  INCLUDED_USAGE_MICRO_USD,
  withinIncludedUsage,
} from "@repo/database/usage-vocabulary";
import type {
  AdminAccountSandboxUsage,
  AdminBillingFigures,
  AdminBillingMemberUsage,
  AdminWorkspaceBilling,
  AdminWorkspaceOwner,
} from "@repo/features/admin-answer-wire";
import type { AdminBilling, AdminBillingWorkspace } from "@repo/features/admin-billing-wire";
import { type AdminBillingQuery, adminMonthKey, utcMonthKey } from "@repo/features/admin-wire";
import { Clock, Effect } from "effect";
import { ADMIN_REFUSAL, type AdminRefusal } from "./http-effect.js";
import { type AdminSeamEffect, unavailableSeam } from "./seam.js";

const MICRO_USD_PER_USD = 1_000_000;

/** One workspace's usage in the month the read covers, as the ledger sums it. */
export interface AdminBillingWorkspaceSource {
  id: string;
  name: string;
  personal: boolean;
  usageMicroUsd: number;
  /** Whether it has billing set up and no invoice given up on. */
  chargeable: boolean;
}

/** What the Billing read reads: the months the ledger holds, and the covered month's usage by workspace. */
export interface AdminBillingSource {
  /** Every UTC month with a charge, as `YYYY-MM`, in any order. */
  months: readonly string[];
  workspaces: readonly AdminBillingWorkspaceSource[];
}

/** What one workspace's page reads: its usage by month, and the current month's by member. */
export interface AdminWorkspaceBillingSource {
  months: readonly { month: string; usageMicroUsd: number }[];
  /** Whether it has billing set up and no invoice given up on. */
  chargeable: boolean;
  members: readonly {
    userId: string | null;
    account: AdminWorkspaceOwner | null;
    usageMicroUsd: number;
  }[];
}

function usd(microUsd: number): number {
  return microUsd / MICRO_USD_PER_USD;
}

/** A month's usage, the allowance, and what passes it, in dollars. */
function billingFigures(usageMicroUsd: number): AdminBillingFigures {
  return {
    usageUsd: usd(usageMicroUsd),
    includedUsd: usd(INCLUDED_USAGE_MICRO_USD),
    billableUsd: usd(billableMicroUsd(usageMicroUsd)),
  };
}

/**
 * Whether the start gate would refuse the workspace a cloud agent now: in
 * the current month, past the allowance, and with no billing it can be
 * charged through, which is billing set up and no invoice given up on.
 */
function wouldRefuse(
  month: string,
  currentMonth: string,
  usageMicroUsd: number,
  chargeable: boolean,
): boolean {
  return month === currentMonth && !chargeable && !withinIncludedUsage(usageMicroUsd);
}

/** Most usage first; the id breaks a tie, so a refresh keeps the order. */
function byUsage<Row extends { usageMicroUsd: number }>(
  idOf: (row: Row) => string,
): (left: Row, right: Row) => number {
  return (left, right) =>
    right.usageMicroUsd === left.usageMicroUsd
      ? idOf(left).localeCompare(idOf(right))
      : right.usageMicroUsd - left.usageMicroUsd;
}

/** The current month and every month the ledger holds, newest first, each once. */
function offeredMonths(held: readonly string[], currentMonth: string): string[] {
  return [...new Set([currentMonth, ...held])].sort().reverse();
}

/** Shapes the covered month's usage into the Billing screen's answer. */
export function buildAdminBilling(
  source: AdminBillingSource,
  month: string,
  now: number,
): AdminBilling {
  const currentMonth = utcMonthKey(now);

  const workspaces: AdminBillingWorkspace[] = [...source.workspaces]
    .sort(byUsage((row) => row.id))
    .map((row) => ({
      id: row.id,
      name: row.name,
      personal: row.personal,
      ...billingFigures(row.usageMicroUsd),
      wouldRefuse: wouldRefuse(month, currentMonth, row.usageMicroUsd, row.chargeable),
    }));

  const usageMicroUsd = source.workspaces.reduce((total, row) => total + row.usageMicroUsd, 0);

  const billable = source.workspaces.map((row) => billableMicroUsd(row.usageMicroUsd));

  return {
    generatedAt: now,
    month,
    currentMonth,
    months: offeredMonths(source.months, currentMonth),
    includedUsd: usd(INCLUDED_USAGE_MICRO_USD),
    totals: {
      usageUsd: usd(usageMicroUsd),
      billableUsd: usd(billable.reduce((total, each) => total + each, 0)),
      workspacesOver: billable.filter((each) => each > 0).length,
    },
    workspaces,
  };
}

/** Shapes one workspace's usage into its page's billing section. */
export function buildAdminWorkspaceBilling(
  source: AdminWorkspaceBillingSource,
  now: number,
): AdminWorkspaceBilling {
  const currentMonth = utcMonthKey(now);
  const usageByMonth = new Map(source.months.map((row) => [row.month, row.usageMicroUsd]));
  const currentUsage = usageByMonth.get(currentMonth) ?? 0;

  const members: AdminBillingMemberUsage[] = [...source.members]
    .sort(byUsage((row) => row.userId ?? ""))
    .map((row) => ({ userId: row.userId, account: row.account, usageUsd: usd(row.usageMicroUsd) }));

  return {
    currentMonth,
    months: offeredMonths([...usageByMonth.keys()], currentMonth).map((month) => ({
      month,
      ...billingFigures(usageByMonth.get(month) ?? 0),
    })),
    wouldRefuse: wouldRefuse(currentMonth, currentMonth, currentUsage, source.chargeable),
    members,
  };
}

/** Shapes one account's usage this month into its page's section, most first. */
export function buildAdminAccountSandboxUsage(
  workspaces: readonly AdminBillingWorkspaceSource[],
  now: number,
): AdminAccountSandboxUsage {
  return {
    month: utcMonthKey(now),
    workspaces: [...workspaces].sort(byUsage((row) => row.id)).map((row) => ({
      id: row.id,
      name: row.name,
      personal: row.personal,
      usageUsd: usd(row.usageMicroUsd),
    })),
  };
}

export interface AdminBillingOptions {
  query: AdminBillingQuery;
  /** The month's answer, its month as `YYYY-MM`. */
  readBilling: (month: string, now: number) => AdminSeamEffect<AdminBilling>;
}

/**
 * Answers the Billing read behind the gate every admin read stands behind:
 * a month that is no real `YYYY-MM` is a 400 before any seam is touched, and
 * a seam that fails is the same 503 every admin read answers.
 */
export function handleAdminBilling(
  options: AdminBillingOptions,
): Effect.Effect<AdminBilling, AdminRefusal, DatabaseServices> {
  return Effect.flatMap(Clock.currentTimeMillis, (now) => {
    const month = adminMonthKey(options.query.month, now);

    if (month === undefined) return Effect.fail(ADMIN_REFUSAL.INVALID_MONTH);

    return options
      .readBilling(month, now)
      .pipe(Effect.catchCause((cause) => unavailableSeam("admin billing read failed", cause)));
  });
}
