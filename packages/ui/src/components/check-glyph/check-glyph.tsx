import { CHECK_STATE, type CheckState } from "@repo/features/agent-wire";
import type { ReactNode } from "react";
import { CheckIcon, CircleSlashIcon, XIcon } from "../../icons/icons.js";
import { SpinnerRing } from "../spinner/spinner.js";

/**
 * check-glyph.tsx -- where a check stands, as one glyph in its standing's ink: passed a green check, failed a red ×, running the ring every wait turns, and skipped a quiet slash.
 *
 * A pull request's Checks tab leads each check's row with it, and the Merge
 * queue page leads each pull request's row with the glyph for how the
 * queue's checks stand on it, so a check reads the same wherever it is
 * drawn. A running check is quiet rather than the working blue, since it is
 * work under way rather than something that needs the reader. The glyph is
 * decoration: the words beside it say where the check stands.
 */

/** The glyph a check wears for where it stands. */
const CHECK_GLYPHS = {
  [CHECK_STATE.FAILED]: <XIcon />,
  [CHECK_STATE.PENDING]: <SpinnerRing />,
  [CHECK_STATE.PASSED]: <CheckIcon />,
  [CHECK_STATE.SKIPPED]: <CircleSlashIcon />,
} as const satisfies Record<CheckState, ReactNode>;

/** The ink a check's glyph wears for where it stands: passed green, failed red, and one still running or skipped quiet. */
const CHECK_INK = {
  [CHECK_STATE.FAILED]: "text-destructive",
  [CHECK_STATE.PENDING]: "text-muted-foreground",
  [CHECK_STATE.PASSED]: "text-complete",
  [CHECK_STATE.SKIPPED]: "text-muted-foreground",
} as const satisfies Record<CheckState, string>;

/** A check's glyph for where it stands, in that standing's ink, in a box of a glyph's size which a running one's ring fills. */
export function CheckGlyph({ state }: { state: CheckState }): React.JSX.Element {
  return (
    <span
      className={`ui-check-glyph inline-grid size-check-glyph flex-none place-items-center [&>svg]:size-check-glyph ${CHECK_INK[state]}`}
      data-check-state={state}
      aria-hidden="true"
    >
      {CHECK_GLYPHS[state]}
    </span>
  );
}
