// length-count.ts -- how much of a field's length limit its words have taken, said once they near it, the panel's and the iPhone's alike.

import { formatCount } from "./number-format.js";

/** How far toward its limit a field's words go before its count shows. */
export const COUNTER_FROM = 0.8;

/** Whether a field's count shows: once its words reach four fifths of its limit. */
export function lengthCountShown(length: number, limit: number): boolean {
  return length >= limit * COUNTER_FROM;
}

/** A field's count as it reads, "3,420/4,000", its figures grouped as every count is. */
export function lengthCountWords(length: number, limit: number): string {
  return `${formatCount(length)}/${formatCount(limit)}`;
}
