/**
 * fake-checkout-snapshots.ts -- scripted checkout snapshots for the runner's tests: each answers a snapshot named for the line it was asked under, in the checkout it was asked in, so an event that carries one says what the runner asked for without a git repository behind it.
 *
 * It stands at the one door the runner records a checkout through
 * (`checkout-snapshot.ts`'s `CheckoutSnapshots`); a test of the recording
 * itself runs the live one against a repository of its own.
 */

import { Effect, Layer } from "effect";
import { CheckoutSnapshots } from "../checkout-snapshot.js";
import type { CheckoutSnapshot, TurnFilesSummary } from "../protocol.js";

/** The snapshot the fake answers for a line: its commit named for the line, its `HEAD` for the checkout, on `main`. */
export function fakeSnapshotOf(cwd: string, lineId: string): CheckoutSnapshot {
  return { commit: `snapshot-of-${lineId}`, head: `head-of-${cwd}`, branch: "main" };
}

/** The files the fake says a turn changed, from the snapshot it opened on: one file named for that snapshot. */
export function fakeFilesOf(from: string): TurnFilesSummary {
  return {
    files: [{ path: `since-${from}.ts`, additions: 2, deletions: 1 }],
    total: 1,
    additions: 2,
    deletions: 1,
  };
}

/** Snapshots answered as `fakeSnapshotOf` says, or none at all where `missing`, as a checkout that could not be recorded answers; a turn changed the files `fakeFilesOf` names where `changed`, and none otherwise. */
export function fakeCheckoutSnapshots(missing = false, changed = false) {
  const layer = Layer.succeed(CheckoutSnapshots, {
    take: (cwd, _agentId, lineId) =>
      Effect.succeed(missing ? undefined : fakeSnapshotOf(cwd, lineId)),
    summarize: (_cwd, from) => Effect.succeed(changed ? fakeFilesOf(from) : undefined),
  });

  return { layer };
}
