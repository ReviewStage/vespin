/**
 * said.ts -- whether a slot says anything, read the one way every component with optional words reads it.
 */

import type { ReactNode } from "react";

/** Whether a slot says anything: nothing, `null`, `false`, and an empty string say nothing. */
export function said(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== "";
}
