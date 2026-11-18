/**
 * admin-billing-wire.ts -- the Billing screen's answer as both sides of the read speak it: every workspace's sandbox usage in one UTC month, and what it would be billed.
 *
 * The figures are read from the service's own usage ledger, never from the
 * invoicing provider, so the screen answers whether or not billing is
 * switched on or the provider connected.
 */

import type { AdminBillingFigures } from "./admin-answer-wire.js";

/** One workspace's row: who it is, its month's figures, and whether the start gate would refuse it now. */
export interface AdminBillingWorkspace extends AdminBillingFigures {
  id: string;
  /** The workspace's name as its members read it; a personal one goes by its owner's name. */
  name: string;
  personal: boolean;
  /** Past the allowance in the current month with no billing set up; false for any past month. */
  wouldRefuse: boolean;
}

export interface AdminBilling {
  generatedAt: number;
  /** The UTC month the answer covers, as `YYYY-MM`. */
  month: string;
  /** The current UTC month, as `YYYY-MM`. */
  currentMonth: string;
  /** Every month the picker offers, newest first: the current one and each past month the ledger holds. */
  months: string[];
  /** The allowance every workspace is given free each month, in dollars. */
  includedUsd: number;
  totals: {
    usageUsd: number;
    /** Each workspace's usage past its allowance, summed. */
    billableUsd: number;
    /** Workspaces whose usage passed the allowance. */
    workspacesOver: number;
  };
  /** Every workspace with usage in the month, most first. */
  workspaces: AdminBillingWorkspace[];
}
