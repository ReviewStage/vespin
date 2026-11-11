/**
 * fake-checkout-snapshots.ts -- scripted checkout snapshots for the runner's tests: each answers a snapshot named for the line it was asked under, in the checkout it was asked in, so an event that carries one says what the runner asked for without a git repository behind it.
 *
 * It stands at the one door the runner records a checkout through
 * (`checkout-snapshot.ts`'s `CheckoutSnapshots`); a test of the recording
 * itself runs the live one against a repository of its own.
 */

import { Effect, Layer } from "effect";
import { CheckoutSnapshots } from "../checkout-snapshot.js";
import type { CheckoutSnapshot } from "../protocol.js";

/** The snapshot the fake answers for a line: its commit named for the line, its `HEAD` for the checkout, on `main`. */
export function fakeSnapshotOf(cwd: string, lineId: string): CheckoutSnapshot {
  return { commit: `snapshot-of-${lineId}`, head: `head-of-${cwd}`, branch: "main" };
}

/** Snapshots answered as `fakeSnapshotOf` says, or none at all where `missing`, as a checkout that could not be recorded answers. */
export function fakeCheckoutSnapshots(missing = false) {
  const layer = Layer.succeed(CheckoutSnapshots, {
    take: (cwd, _agentId, lineId) =>
      Effect.succeed(missing ? undefined : fakeSnapshotOf(cwd, lineId)),
  });
  return { layer };
}
