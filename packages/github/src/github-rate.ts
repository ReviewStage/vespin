/**
 * github-rate.ts -- GitHub's rate-limit rules as the module keeps them: holds after a refusal, shared across instances, and the members' reserve.
 *
 * GitHub's rules are the design
 * (https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api#exceeding-the-rate-limit,
 * https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#handle-rate-limit-errors-appropriately):
 * after a rate-limit refusal ask nothing again before `retry-after` seconds
 * have passed, or before `x-ratelimit-reset` where `x-ratelimit-remaining` is
 * 0, or else before at least a minute has, waiting exponentially longer as
 * the refusals repeat, because an integration that keeps asking while
 * limited may be banned. So a refusal holds its scope here and in the
 * `GitHubHoldStore`, and every later request under it is refused before it
 * is sent until the hold is over. An instance trusts its last read of a
 * scope's shared hold for `RATE.SHARED_READ_FOR`, so it may send in the
 * seconds after another instance was refused; and a store that does not
 * answer holds nothing, because GitHub is never kept waiting on it.
 *
 * Work no member waits on (`GitHubPriority`) also leaves the members a share
 * of the hour: once an answer says less than `RATE.MEMBER_SHARE` of an
 * identity's core quota is left, its background requests are refused until
 * GitHub's reset, and a member's are still sent. The share is read from
 * GitHub's own `x-ratelimit-*` headers, which every instance reads alike, so
 * it is kept in no store.
 *
 * Every log line here carries the identity's kind (and an installation's
 * id), the route's template, and GitHub's own counters: never a token.
 */

import { Clock, Context, Duration, Effect } from "effect";
import type { Kept } from "./github-fetch.js";
import { type GitHubHold, GitHubHoldStore } from "./github-hold-store.js";
import {
  type GitHubIdentity,
  type GitHubIdentityKind,
  type GitHubRateScope,
  IDENTITY_KIND,
} from "./github-identity.js";

const RATE = {
  /** The wait GitHub asks for a rate limit that names none, and the first step of the backoff. */
  MINIMUM_HOLD: Duration.minutes(1),
  /** The longest a repeated refusal is backed off. */
  MAXIMUM_HOLD: Duration.minutes(15),
  /** How long an instance trusts its last read of a scope's shared hold. */
  SHARED_READ_FOR: Duration.seconds(5),
  /** The part of an identity's hourly core quota background work leaves for the members' own requests. */
  MEMBER_SHARE: 0.25,
} as const;

/** The quota GitHub counts REST requests against, as `x-ratelimit-resource` names it. */
const CORE_RESOURCE = "core";

/** Whether a request is one a member waits on, or background work that leaves the members their reserve. */
export const PRIORITY = { MEMBER: "member", BACKGROUND: "background" } as const;

export type GitHubPriorityValue = (typeof PRIORITY)[keyof typeof PRIORITY];

/** The priority of the GitHub requests made under it; a member's unless said. */
export const GitHubPriority = Context.Reference<GitHubPriorityValue>(
  "@repo/github/GitHubPriority",
  { defaultValue: () => PRIORITY.MEMBER },
);

/** One hold as this instance keeps it: when it lifts, and how many refusals in a row it follows. */
interface LocalHold {
  readonly until: number;
  readonly strikes: number;
}

/** One scope's holds as this instance knows them: its own, and its last read of the shared one. */
export interface HoldState {
  readonly scope: GitHubRateScope;
  local: LocalHold | undefined;
  shared: { readonly readAt: number; readonly hold: LocalHold | undefined } | undefined;
}

/** GitHub's own counters from an identity's last answer. */
interface RateHeaders {
  readonly resource: string | undefined;
  readonly limit: number;
  readonly remaining: number;
  readonly reset: number;
}

/** One identity as this instance knows it. */
export interface IdentityState {
  readonly identity: GitHubIdentity;
  /** The scope its own refusals hold. */
  readonly own: HoldState;
  /** The scope its secondary refusals hold: the App's and every installation's, or a member's own. */
  readonly secondary: HoldState;
  /** When the background reserve lifts, where it stands. */
  reserveUntil: number | undefined;
  rate: RateHeaders | undefined;
  readonly kept: Kept;
}

/** The headers of an answer, as Octokit hands them. */
export type AnswerHeaders = Readonly<Record<string, string | number | undefined>>;

/** What one request was, for a log line: its method and its route's template. */
export interface RouteOf {
  readonly method: string;
  readonly url: string;
}

/** A request refused before it was sent, because a hold or the reserve stands. */
export class HeldRequest extends Error {
  /** Whose hold refused it, and when the hold lifts. */
  readonly held: { readonly identity: GitHubIdentityKind; readonly until: number };

  constructor(held: { readonly identity: GitHubIdentityKind; readonly until: number }) {
    super("GitHub rate limit: held until GitHub's wait is over");
    this.name = "HeldRequest";
    this.held = held;
  }
}

/** A new scope with no hold known. */
export function holdStateOf(scope: GitHubRateScope): HoldState {
  return { scope, local: undefined, shared: undefined };
}

/** The identity as a log line may carry it: its kind, and an installation's id. */
function loggedIdentity(identity: GitHubIdentity): Record<string, string | number> {
  return identity.kind === IDENTITY_KIND.INSTALLATION
    ? { identity: identity.kind, installationId: identity.installationId }
    : { identity: identity.kind };
}

function headerNumber(headers: AnswerHeaders, name: string): number {
  const value = headers[name];

  return value === undefined ? Number.NaN : Number(value);
}

/** The backoff the refusal numbered `strikes` in a row waits at least, before what GitHub named. */
function backoffFor(strikes: number): Duration.Duration {
  return Duration.min(Duration.times(RATE.MINIMUM_HOLD, 2 ** (strikes - 1)), RATE.MAXIMUM_HOLD);
}

/**
 * How long a refusal holds: the wait GitHub named, or a minute where it
 * named none, the first time; each refusal after it in a row waits at least
 * twice as long as the one before, up to `RATE.MAXIMUM_HOLD`, though a wait
 * GitHub named is kept whole.
 */
function holdFor(stated: Duration.Duration | undefined, strikes: number): Duration.Duration {
  const floor = strikes === 1 ? Duration.zero : backoffFor(strikes);

  return Duration.max(stated ?? RATE.MINIMUM_HOLD, floor);
}

/** The milliseconds each refusal in a row holds for, up to the first whose backoff reached the most, as the store reads them. */
function waitsFor(stated: Duration.Duration | undefined): [number, ...number[]] {
  const waits: [number, ...number[]] = [Duration.toMillis(holdFor(stated, 1))];
  let strikes = 1;

  while (Duration.isLessThan(backoffFor(strikes), RATE.MAXIMUM_HOLD)) {
    strikes += 1;
    waits.push(Duration.toMillis(holdFor(stated, strikes)));
  }

  return waits;
}

function localOf(stored: GitHubHold): LocalHold {
  return { until: stored.heldUntil.getTime(), strikes: stored.strikes };
}

/** A statement on the store, which logs its failure and answers nothing rather than keep GitHub waiting. */
function unblocking<A, E>(
  statement: Effect.Effect<A, E>,
  failed: string,
): Effect.Effect<A | undefined> {
  return Effect.catch(statement, (error) =>
    Effect.as(Effect.logWarning(failed, { error: String(error) }), undefined),
  );
}

/** The scope's shared hold as last read, read again once that read is past trusting. */
const sharedHold = Effect.fnUntraced(function* (state: HoldState, now: number) {
  const read = state.shared;

  if (read !== undefined && now - read.readAt < Duration.toMillis(RATE.SHARED_READ_FOR)) {
    return read.hold;
  }

  const store = yield* GitHubHoldStore;

  const stored = yield* unblocking(
    store.read(state.scope),
    "github: shared rate hold unread; sending",
  );

  const hold = stored === undefined ? undefined : localOf(stored);
  state.shared = { readAt: now, hold };

  return hold;
});

/** When the identity's hold lifts, where one stands on any scope it is under. */
export const heldUntil = Effect.fnUntraced(function* (state: IdentityState) {
  const now = yield* Clock.currentTimeMillis;
  let until: number | undefined;

  for (const scope of new Set([state.own, state.secondary])) {
    const local = scope.local !== undefined && now < scope.local.until ? scope.local : undefined;
    const hold = local ?? (yield* sharedHold(scope, now));

    if (hold !== undefined && now < hold.until) until = Math.max(until ?? 0, hold.until);
  }

  return until;
});

/** When the identity's background reserve lifts, where it stands now. */
export const reservedUntil = Effect.fnUntraced(function* (state: IdentityState) {
  const now = yield* Clock.currentTimeMillis;
  const until = state.reserveUntil;

  return until !== undefined && now < until ? until : undefined;
});

/** Keeps GitHub's counters from an answer, so a refusal's log line can carry them. */
export function recordRate(state: IdentityState, headers: AnswerHeaders): void {
  const limit = headerNumber(headers, "x-ratelimit-limit");

  if (Number.isNaN(limit)) return;
  const resource = headers["x-ratelimit-resource"];

  state.rate = {
    resource: resource === undefined ? undefined : String(resource),
    limit,
    remaining: headerNumber(headers, "x-ratelimit-remaining"),
    reset: headerNumber(headers, "x-ratelimit-reset"),
  };
}

/**
 * Holds `scope` for a refusal of one of the identity's requests: here, and
 * where every instance reads it. `stated` is the wait GitHub named.
 */
export const refused = Effect.fnUntraced(function* (
  state: IdentityState,
  scope: HoldState,
  stated: Duration.Duration | undefined,
  route: RouteOf,
) {
  const now = yield* Clock.currentTimeMillis;
  const standing = scope.local;

  // Note that a hold long lifted counts no strike, as the store's statement reads it.
  const remembered =
    standing !== undefined && standing.until + Duration.toMillis(RATE.MAXIMUM_HOLD) >= now
      ? standing
      : undefined;

  const holding = remembered !== undefined && now < remembered.until;
  // Note that refusals of requests already out as the hold began are one strike, not one each.
  const strikes = (remembered?.strikes ?? 0) + (holding ? 0 : 1);
  const until = Math.max(remembered?.until ?? 0, now + Duration.toMillis(holdFor(stated, strikes)));
  scope.local = { until, strikes };
  const store = yield* GitHubHoldStore;
  const forgottenBefore = new Date(now - Duration.toMillis(RATE.MAXIMUM_HOLD));

  const everywhere = yield* unblocking(
    store.hold(scope.scope, new Date(now), waitsFor(stated), forgottenBefore),
    "github: shared rate hold unwritten; holding this instance alone",
  );

  const shared = everywhere === undefined ? undefined : localOf(everywhere);

  if (shared !== undefined) scope.shared = { readAt: now, hold: shared };
  yield* Effect.logWarning("github: rate limited; holding requests", {
    ...loggedIdentity(state.identity),
    scope: scope.scope.kind,
    method: route.method,
    route: route.url,
    resource: state.rate?.resource,
    limit: state.rate?.limit,
    remaining: state.rate?.remaining,
    reset: state.rate?.reset,
    heldForSeconds: Math.ceil((Math.max(until, shared?.until ?? 0) - now) / 1000),
    strikes: shared?.strikes ?? strikes,
  });
});

/** Lets go of the holds an answer under 400 came after, here and in the store, where they are over. */
const lifted = Effect.fnUntraced(function* (state: IdentityState, now: number) {
  for (const scope of new Set([state.own, state.secondary])) {
    if (scope.local !== undefined && now >= scope.local.until) scope.local = undefined;
    const shared = scope.shared?.hold;

    if (shared === undefined || now < shared.until) continue;
    scope.shared = { readAt: now, hold: undefined };
    const store = yield* GitHubHoldStore;
    yield* unblocking(
      store.lift(scope.scope, new Date(now)),
      "github: shared rate hold not lifted",
    );
  }
});

/** Starts the background reserve once an answer says less than the members' share of the identity's core quota is left. */
const reserved = Effect.fnUntraced(function* (state: IdentityState, route: RouteOf, now: number) {
  const rate = state.rate;

  if (rate === undefined || rate.resource !== CORE_RESOURCE) return;
  const reset = rate.reset * 1000;

  // Note that a header GitHub left out reads as no number, which is under and past nothing.
  if (!(rate.remaining < rate.limit * RATE.MEMBER_SHARE) || !(reset > now)) return;

  if ((state.reserveUntil ?? 0) >= reset) return;
  state.reserveUntil = reset;
  yield* Effect.logWarning("github: quota low; holding background requests", {
    ...loggedIdentity(state.identity),
    method: route.method,
    route: route.url,
    resource: rate.resource,
    limit: rate.limit,
    remaining: rate.remaining,
    reset: rate.reset,
    heldForSeconds: Math.ceil((reset - now) / 1000),
  });
});

/** Reads an answer under 400: GitHub's counters, the reserve, and any hold now over. */
export const answered = Effect.fnUntraced(function* (
  state: IdentityState,
  route: RouteOf,
  headers: AnswerHeaders,
) {
  const now = yield* Clock.currentTimeMillis;
  recordRate(state, headers);
  yield* reserved(state, route, now);
  yield* lifted(state, now);
});
