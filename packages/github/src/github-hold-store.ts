/**
 * github-hold-store.ts -- where a rate-limit hold is kept so every instance reads it, which the deployment implements.
 *
 * One instance refused by GitHub holds every instance, rather than each
 * finding the limit with a request of its own. The store is a tag, so this
 * package reaches no database: the service implements it over its own
 * table. A refusal writes its hold in one statement, so two instances
 * refused at once neither shorten the other's hold nor each count a strike:
 * the hold kept is the later of the one standing and the one asked for, and
 * a refusal while a hold stands is the same strike. `waits` names the
 * milliseconds each strike in a row holds for, the first strike first and
 * the last for every strike past it, so the backoff is stated once, here in
 * the module. A hold that lifted before `forgottenBefore` counts no strike.
 */

import { Context, type Effect, Schema } from "effect";
import type { GitHubRateScope } from "./github-identity.js";

/** One scope's hold as every instance reads it: when it lifts, and how many refusals in a row it follows. */
export interface GitHubHold {
  readonly heldUntil: Date;
  readonly strikes: number;
}

/** The store did not answer; the module sends rather than keep GitHub waiting on it. */
export class GitHubHoldStoreFailure extends Schema.TaggedError<GitHubHoldStoreFailure>()(
  "GitHubHoldStoreFailure",
  { cause: Schema.Defect() },
) {}

/** The holds every instance shares. */
export class GitHubHoldStore extends Context.Service<
  GitHubHoldStore,
  {
    /** The scope's hold as it stands, lifted or not, or nothing where no refusal is on record. */
    readonly read: (
      scope: GitHubRateScope,
    ) => Effect.Effect<GitHubHold | undefined, GitHubHoldStoreFailure>;
    /** Holds the scope for a refusal at `now`, answering the hold as it then stands. */
    readonly hold: (
      scope: GitHubRateScope,
      now: Date,
      waits: readonly [number, ...number[]],
      forgottenBefore: Date,
    ) => Effect.Effect<GitHubHold, GitHubHoldStoreFailure>;
    /** Lets go of the scope's hold once an answer at `now` came after it lifted; one standing past `now` stays. */
    readonly lift: (
      scope: GitHubRateScope,
      now: Date,
    ) => Effect.Effect<void, GitHubHoldStoreFailure>;
  }
>()("@repo/github/GitHubHoldStore") {}
