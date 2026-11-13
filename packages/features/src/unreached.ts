/**
 * unreached.ts -- an act a caller settled because it never answered: the failure its words draw, with the error beneath.
 */

/**
 * An answer a caller settled an act that never answered into: the failure
 * its words draw, with the error beneath, which a shown failure reports. It
 * is the window's own and never crosses the act port, so it holds the error
 * itself, where an answer the host sends holds the facts of one
 * (`@repo/features/failure-facts`).
 */
export interface Unreached<Failure extends string> {
  readonly failure: Failure;
  readonly cause: unknown;
}

/** Settles an act that never answered into the failure given, with the error beneath. */
export function unreachedAs<const Failure extends string>(failure: Failure) {
  return (cause: unknown): Unreached<Failure> => ({ failure, cause });
}
