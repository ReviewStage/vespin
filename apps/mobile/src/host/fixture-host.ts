/**
 * fixture-host.ts -- a fixture run's host: the profile's synthetic data laid over the host's own document, so the screens read it as they read a live run's.
 *
 * The desktop's and the web's fixture runs lay the synthetic data over the
 * document on the window's side, as each delivery lands
 * (`@repo/panel`'s `tasks-fixture-loader.ts`). The app runs the host in its
 * own process and holds its document, so it lays the data into the document
 * itself, after the launch's bootstrap has been read into it and again after
 * each change the host writes (`compose-mobile.ts`): the Inbox profile's
 * account signed in, its tasks' items (`@repo/host/fixture-inbox`), which
 * the Inbox lists, and the tasks holding them, which name its rows. A live run, and a profile that stages nothing, is left as
 * the host wrote it, and a document already staged is handed nothing new.
 */

import { type AppStateSnapshot, RUN_PROFILE, type RunProfile } from "@repo/host/app-state";
import type { AppStateStore } from "@repo/host/client";
import type { ActPortClient, PortActKind, PortActPayload } from "@repo/host/contract";
import { inboxActAnswer, inboxAppState, inboxTasksView } from "@repo/host/fixture-inbox";
import { FIXTURE_IDS } from "@repo/host/fixture-stage";

/** The one workspace a fixture run's account is in. */
const FIXTURE_WORKSPACE_IDS: readonly string[] = [FIXTURE_IDS.WORKSPACE];

/** Each task list as staged, so a list staged already is never staged twice, which would list its tasks twice. */
const stagedLists = new WeakSet<AppStateSnapshot["tasks"]>();

/** The fixture's tasks laid over the list held, or the list held where it is staged already. */
function stagedTasks(held: AppStateSnapshot): AppStateSnapshot["tasks"] {
  if (stagedLists.has(held.tasks)) return held.tasks;
  const staged = inboxTasksView(held.run.profile, held.tasks);
  stagedLists.add(staged);
  return staged;
}

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
  const inbox = inboxAppState(held, FIXTURE_WORKSPACE_IDS);
  if (inbox === held) return;
  const staged = { ...inbox, tasks: stagedTasks(held) };
  state.update(stagedPatch(held, staged));
}

/**
 * The act port a fixture run's screens act through: each act the profile
 * answers, such as a mark, a thread's file read, or a reply or a resolve on
 * a thread, one of them refused (`inboxActAnswer`),
 * answered by the fixture, as the panel's fixture run answers it on the
 * window's side, and every other act sent to the host. Note that a mark is
 * echoed and moves no dot, as on the panel's.
 */
export function fixtureActs(acts: ActPortClient, profile: RunProfile): ActPortClient {
  return new Proxy(acts, {
    get(target, kind, receiver) {
      const sent: unknown = Reflect.get(target, kind, receiver);
      if (typeof kind !== "string" || typeof sent !== "function") return sent;
      return (payload: unknown, ...rest: unknown[]) => {
        // SAFETY: the port is keyed by act kind, and each function under a kind takes that kind's payload.
        const staged = inboxActAnswer(
          profile,
          kind as PortActKind,
          payload as PortActPayload<PortActKind>,
        );
        return staged === undefined
          ? Reflect.apply(sent, target, [payload, ...rest])
          : Promise.resolve(staged.answer);
      };
    },
  });
}
