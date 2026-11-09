/**
 * fixture-host.ts -- a fixture run's host: the profile's synthetic data laid over the host's own document, so the screens read it as they read a live run's.
 *
 * The desktop's and the web's fixture runs lay the synthetic data over the
 * document on the window's side, as each delivery lands
 * (`@repo/panel`'s `tasks-fixture-loader.ts`). The app runs the host in its
 * own process and holds its document, so it lays the data into the document
 * itself, after the launch's bootstrap has been read into it and again after
 * each change the host writes (`compose-mobile.ts`): the Inbox profile's
 * account signed in and its tasks' items (`@repo/host/fixture-inbox`), which
 * the Inbox lists. A live run, and a profile that stages nothing, is left as
 * the host wrote it, and a document already staged is handed nothing new.
 */

import { type AppStateSnapshot, RUN_PROFILE } from "@repo/host/app-state";
import type { AppStateStore } from "@repo/host/client";
import { inboxAppState } from "@repo/host/fixture-inbox";
import { FIXTURE_IDS } from "@repo/host/fixture-stage";

/** The one workspace a fixture run's account is in. */
const FIXTURE_WORKSPACE_IDS: readonly string[] = [FIXTURE_IDS.WORKSPACE];

/** What the store is handed: whole slices of the document. */
type StorePatch = Parameters<AppStateStore["update"]>[0];

/** The slices of the document as staged that differ from the document as held, which is what the store is handed. */
function stagedPatch(held: AppStateSnapshot, staged: AppStateSnapshot): StorePatch {
  // SAFETY: the keys of a snapshot are its slices beside the window's facts and the version, which are the store's own to keep and are left out here.
  const names = Object.keys(staged) as (keyof AppStateSnapshot)[];
  return Object.fromEntries(
    names
      .filter((name) => name !== "window" && name !== "version" && staged[name] !== held[name])
      .map((name) => [name, staged[name]]),
  ) as StorePatch;
}

/** Lays the fixture profile's data over the host's document; nothing in a live run. */
export function stageFixture(state: Pick<AppStateStore, "snapshot" | "update">): void {
  const snapshot = state.snapshot();
  if (!snapshot.run.fixtureMode || snapshot.run.profile === RUN_PROFILE.IDLE) return;
  const held: AppStateSnapshot = { ...snapshot, window: { fullScreen: false } };
  const staged = inboxAppState(held, FIXTURE_WORKSPACE_IDS);
  if (staged === held) return;
  state.update(stagedPatch(held, staged));
}
