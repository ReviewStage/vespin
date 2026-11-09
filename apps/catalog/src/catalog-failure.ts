/**
 * catalog-failure.ts -- the failure every catalog example of a failure drawn in place stands on: reported nowhere, its details a fixed block like the one the panel builds, copied to the browser's own clipboard; and the same failure with Investigate offered, as the panel offers it to the team that works on the app.
 */

import { PRODUCT_NAME } from "@repo/features/product-name";
import type { ReportedFailure } from "@repo/ui/reported-failure";

/** What a failure's Copy details puts on the clipboard, as the panel builds it from the failure's report. */
const FAILURE_DETAILS = [
  `${PRODUCT_NAME} error details. Include these when you report this problem:`,
  "time: 2026-10-29T18:20:03.198Z",
  "failure.surface: tasks.read",
  "failure.kind: unexpected",
  "failure.code: unread",
].join("\n");

/** A failure as the panel would hand it, for an example to draw. */
export const CATALOG_FAILURE: ReportedFailure = {
  shown: () => FAILURE_DETAILS,
  hidden: () => undefined,
  copy: (text) => navigator.clipboard.writeText(text),
};

/** A press the catalog has nowhere to take. */
function stay(): void {}

/** The same failure with Investigate offered, whose press goes nowhere. */
export const CATALOG_INVESTIGABLE_FAILURE: ReportedFailure = {
  ...CATALOG_FAILURE,
  investigation: () => stay,
};
