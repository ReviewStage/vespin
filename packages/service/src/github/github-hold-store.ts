/**
 * github-hold-store.ts -- the `GitHubHoldStore` @repo/github is handed, kept in the deployment's `github_rate_hold` table so every instance reads one refusal's hold.
 *
 * The table keys a hold by one string column (`@repo/database/models/github-rate-holds`),
 * so each scope is written as the JSON of its kind and its one distinguishing
 * value: the App and every installation by kind alone, an installation by
 * its id, and a member by its token's digest, never the token. A store that
 * does not answer fails as `GitHubHoldStoreFailure`, which the module reads
 * as no hold, since GitHub is never kept waiting on the database.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import {
  holdGitHubIdentity,
  liftGitHubRateHold,
  readGitHubRateHold,
} from "@repo/database/models/github-rate-holds";
import {
  GitHubHoldStore,
  GitHubHoldStoreFailure,
  type GitHubRateScope,
  IDENTITY_KIND,
  RATE_SCOPE_KIND,
} from "@repo/github";
import { Effect, Layer } from "effect";

/** The row one scope's hold is kept under. */
function rowKeyOf(scope: GitHubRateScope): string {
  switch (scope.kind) {
    case IDENTITY_KIND.APP:
    case RATE_SCOPE_KIND.EVERY_INSTALLATION:
      return JSON.stringify([scope.kind]);
    case IDENTITY_KIND.INSTALLATION:
      return JSON.stringify([scope.kind, scope.installationId]);
    case IDENTITY_KIND.MEMBER:
      return JSON.stringify([scope.kind, scope.digest]);
  }
}

const failed = (cause: unknown) => new GitHubHoldStoreFailure({ cause });

/** The holds every instance shares, over the database the layer is built on. */
export const githubHoldStoreLayer: Layer.Layer<GitHubHoldStore, never, DatabaseServices> =
  Layer.effect(
    GitHubHoldStore,
    Effect.gen(function* () {
      const database = yield* Effect.context<DatabaseServices>();

      const stored = <A, E>(effect: Effect.Effect<A, E, DatabaseServices>) =>
        effect.pipe(Effect.provideContext(database), Effect.mapError(failed));

      return GitHubHoldStore.of({
        read: (scope) => stored(readGitHubRateHold(rowKeyOf(scope))),
        hold: (scope, now, waits, forgottenBefore) =>
          stored(holdGitHubIdentity(rowKeyOf(scope), now, waits, forgottenBefore)),
        lift: (scope, now) => stored(liftGitHubRateHold(rowKeyOf(scope), now)),
      });
    }),
  );
