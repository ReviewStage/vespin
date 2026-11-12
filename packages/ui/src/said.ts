/**
 * said.ts -- whether a slot says anything, or draws anything, read the one way every component with an optional slot reads it.
 */

import { Predicate } from "effect";
import type { ReactNode } from "react";

/** Whether a slot says anything: nothing, `null`, `false`, and an empty string say nothing. */
export function said(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== "";
}

/** Whether a node draws anything: none, null, and a boolean, as a condition leaves it, draw nothing; an empty string still counts, unlike `said`. */
export function drawsSomething(node: ReactNode): boolean {
  return node !== undefined && node !== null && !Predicate.isBoolean(node);
}
