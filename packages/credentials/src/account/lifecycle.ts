/**
 * lifecycle.ts -- the account session's lifecycle: its kinds, the moves between them, and the one guard every move takes.
 */

/**
 * What an account session is doing apart from the account it holds: nothing,
 * a first sign-in's trip, a sign-in again's trip over a session that stands,
 * or a sign-out others wait on. Exactly one stands at a time.
 */
export const ACCOUNT_LIFECYCLE = {
  IDLE: "idle",
  SIGNING_IN: "signing-in",
  SIGNING_IN_AGAIN: "signing-in-again",
  SIGNING_OUT: "signing-out",
} as const;

export type AccountLifecycleKind = (typeof ACCOUNT_LIFECYCLE)[keyof typeof ACCOUNT_LIFECYCLE];

/**
 * Every move the lifecycle may make. A trip ends back at idle or is ended by
 * a sign-out; a sign-out ends at idle, or stands as itself with its waiting
 * presses withdrawn. Nothing starts while a sign-out stands: a sign-in waits
 * for it first.
 */
export const ACCOUNT_LIFECYCLE_MOVES = {
  [ACCOUNT_LIFECYCLE.IDLE]: [
    ACCOUNT_LIFECYCLE.SIGNING_IN,
    ACCOUNT_LIFECYCLE.SIGNING_IN_AGAIN,
    ACCOUNT_LIFECYCLE.SIGNING_OUT,
  ],
  [ACCOUNT_LIFECYCLE.SIGNING_IN]: [ACCOUNT_LIFECYCLE.IDLE, ACCOUNT_LIFECYCLE.SIGNING_OUT],
  [ACCOUNT_LIFECYCLE.SIGNING_IN_AGAIN]: [ACCOUNT_LIFECYCLE.IDLE, ACCOUNT_LIFECYCLE.SIGNING_OUT],
  [ACCOUNT_LIFECYCLE.SIGNING_OUT]: [ACCOUNT_LIFECYCLE.IDLE, ACCOUNT_LIFECYCLE.SIGNING_OUT],
} as const satisfies Record<AccountLifecycleKind, readonly AccountLifecycleKind[]>;

/** One lifecycle value, each kind carrying the payload its holder gives it. */
export type AccountLifecycle<Payloads extends Record<AccountLifecycleKind, object>> = {
  [Kind in AccountLifecycleKind]: { readonly kind: Kind } & Payloads[Kind];
}[AccountLifecycleKind];

/** The next lifecycle value, asserting the move is one the table allows. */
export function moveAccountLifecycle<Next extends { readonly kind: AccountLifecycleKind }>(
  from: { readonly kind: AccountLifecycleKind },
  next: Next,
): Next {
  const allowed: readonly AccountLifecycleKind[] = ACCOUNT_LIFECYCLE_MOVES[from.kind];

  if (!allowed.includes(next.kind)) {
    throw new Error(`Account lifecycle cannot move from ${from.kind} to ${next.kind}`);
  }

  return next;
}
