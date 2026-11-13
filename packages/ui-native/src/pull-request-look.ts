// pull-request-look.ts -- the glyphs and tones a pull request's page wears: each check, how its checks went, and each reviewer, as the panel's Pull request tab draws them.

import {
  CHECK_STATE,
  CHECK_SUMMARY,
  type CheckState,
  type CheckSummary,
  REVIEW_STATE,
  type ReviewState,
} from "@repo/features/agent-wire";
import { GLYPH, type MarkLook } from "./glyph.js";
import { STATUS_TONE } from "./tokens/colors.js";

/**
 * Each check's glyph, the panel's own: passed a green
 * check, failed a red cross, and one still running or skipped quiet, since a
 * wait is work under way rather than something that needs you.
 */
export const CHECK_LOOK = {
  [CHECK_STATE.FAILED]: { symbol: GLYPH.REMOVE, tone: STATUS_TONE.DANGER },
  [CHECK_STATE.PENDING]: { symbol: GLYPH.CHECK_RUNNING, tone: STATUS_TONE.NEUTRAL },
  [CHECK_STATE.PASSED]: { symbol: GLYPH.CHECK, tone: STATUS_TONE.COMPLETE },
  [CHECK_STATE.SKIPPED]: { symbol: GLYPH.CHECK_SKIPPED, tone: STATUS_TONE.NEUTRAL },
} as const satisfies Record<CheckState, MarkLook>;

/** How the checks went, as their count's glyph says it beside the panel's Checks tab; none where there are none. */
export const CHECK_SUMMARY_LOOK = {
  [CHECK_SUMMARY.FAILING]: CHECK_LOOK[CHECK_STATE.FAILED],
  [CHECK_SUMMARY.PENDING]: CHECK_LOOK[CHECK_STATE.PENDING],
  [CHECK_SUMMARY.PASSING]: CHECK_LOOK[CHECK_STATE.PASSED],
  [CHECK_SUMMARY.NONE]: undefined,
} as const satisfies Record<CheckSummary, MarkLook | undefined>;

/**
 * Where each reviewer stands, as GitHub draws it: approved a green check,
 * changes asked for a red diff, a review asked for and not given an amber
 * dot, and a comment or a dismissed review quiet.
 */
export const REVIEW_LOOK = {
  [REVIEW_STATE.APPROVED]: { symbol: GLYPH.CHECK, tone: STATUS_TONE.COMPLETE },
  [REVIEW_STATE.CHANGES_REQUESTED]: { symbol: GLYPH.CHANGES, tone: STATUS_TONE.DANGER },
  [REVIEW_STATE.DISMISSED]: { symbol: GLYPH.CHECK_SKIPPED, tone: STATUS_TONE.NEUTRAL },
  [REVIEW_STATE.COMMENTED]: { symbol: GLYPH.COMMENT, tone: STATUS_TONE.NEUTRAL },
  [REVIEW_STATE.REQUESTED]: { symbol: GLYPH.STATUS, tone: STATUS_TONE.ATTENTION },
} as const satisfies Record<ReviewState, MarkLook>;
