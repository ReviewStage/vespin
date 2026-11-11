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
 * the Inbox lists, the tasks holding them, which name its rows, and, where
 * the launch asks, the service's refusal of an old build. A live run, and a profile that stages nothing, is left as
 * the host wrote it, and a document already staged is handed nothing new.
 */

import { ACT_KIND } from "@repo/host/acts";
import { type AppStateSnapshot, RUN_PROFILE, type RunProfile } from "@repo/host/app-state";
import type { AppStateStore } from "@repo/host/client";
import type {
  ActPortClient,
  PortActKind,
  PortActPayload,
  PortActResult,
} from "@repo/host/contract";
import {
  type InboxReminders,
  inboxActAnswer,
  inboxAppState,
  inboxRemindersAppState,
  inboxTasksView,
  olderPageAnswer,
  olderPageAppState,
  type PullRequestMove,
  pullRequestMoveOf,
  pullRequestPartsAppState,
} from "@repo/host/fixture-inbox";
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

/** The moves each run's changes made to the fixture's pull requests, by the store the run stages, each map replaced whole as a change lands so a staging reads it anew. */
const MOVES = new WeakMap<object, ReadonlyMap<number, PullRequestMove>>();

/** How many reads of the invitations agent's older page each run's screens asked, by the store the run stages. */
const OLDER_ASKS = new WeakMap<object, number>();

/** No pull request moved yet. */
const NO_MOVES: ReadonlyMap<number, PullRequestMove> = new Map();

/** The reminders each run set on the fixture's items, by the store the run stages, each map replaced whole as one is set. */
const REMINDERS = new WeakMap<object, InboxReminders>();

/** No reminder set yet. */
const NO_REMINDERS: InboxReminders = new Map();

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

/** The network as held, or with the service refusing this build as older than it serves where the launch asks for that; the slice held where it says so already. */
function stagedNetwork(held: AppStateSnapshot, updateNeeded: boolean): AppStateSnapshot["network"] {
  if (!updateNeeded || held.network.updateNeeded === true) return held.network;
  return { ...held.network, updateNeeded: true };
}

/**
 * Lays the fixture profile's data over the host's document; nothing in a
 * live run. Where `updateNeeded`, as `-updateNeeded true` asks, the network
 * stands as the service's refusal of an old build leaves it, so a flow
 * shoots the screen that asks for the update (`maestro/update-needed.yaml`).
 */
export function stageFixture(
  state: Pick<AppStateStore, "snapshot" | "update">,
  updateNeeded = false,
): void {
  const snapshot = state.snapshot();
  if (!snapshot.run.fixtureMode || snapshot.run.profile === RUN_PROFILE.IDLE) return;
  const held: AppStateSnapshot = { ...snapshot, window: { fullScreen: false } };
  const inbox = inboxAppState(held, FIXTURE_WORKSPACE_IDS);
  if (inbox === held) return;
  const parts = olderPageAppState(
    pullRequestPartsAppState(inbox, MOVES.get(state) ?? NO_MOVES),
    OLDER_ASKS.get(state) ?? 0,
  );
  const reminded = inboxRemindersAppState(parts, REMINDERS.get(state) ?? NO_REMINDERS);
  const staged = {
    ...reminded,
    tasks: stagedTasks(held),
    network: stagedNetwork(held, updateNeeded),
  };
  state.update(stagedPatch(held, staged));
}

/** Keeps a reminder the fixture took, set or cleared, and lays it over the document at once, as the host draws one; nothing for any other act. */
function keepReminder(
  state: Pick<AppStateStore, "snapshot" | "update">,
  kind: PortActKind,
  payload: PortActPayload<PortActKind>,
): void {
  if (kind !== ACT_KIND.AGENTS_INBOX_REMIND) return;
  // SAFETY: the payload is the kind's, which the guard above names.
  const { itemId, until } = payload as PortActPayload<typeof ACT_KIND.AGENTS_INBOX_REMIND>;
  REMINDERS.set(state, new Map(REMINDERS.get(state) ?? NO_REMINDERS).set(itemId, until));
  stageFixture(state);
}

/** Keeps how a change the fixture took moved its pull request, and lays it over the document at once; nothing for any other act. */
function keepMove(
  state: Pick<AppStateStore, "snapshot" | "update">,
  kind: PortActKind,
  payload: PortActPayload<PortActKind>,
): void {
  if (kind !== ACT_KIND.AGENTS_PULL_REQUEST_ACTION) return;
  // SAFETY: the payload is the kind's, which the guard above names.
  const { number, request } = payload as PortActPayload<typeof ACT_KIND.AGENTS_PULL_REQUEST_ACTION>;
  const move = pullRequestMoveOf(request);
  if (number === undefined || move === undefined) return;
  MOVES.set(state, new Map(MOVES.get(state) ?? NO_MOVES).set(number, move));
  stageFixture(state);
}

/** What a read of the invitations agent's older page answers, counted, its page laid over the document at once where it lands; none for any other act or transcript. */
function olderRead(
  state: Pick<AppStateStore, "snapshot" | "update">,
  profile: RunProfile,
  kind: PortActKind,
  payload: PortActPayload<PortActKind>,
): PortActResult<typeof ACT_KIND.AGENTS_TRANSCRIPT_OLDER> | undefined {
  if (kind !== ACT_KIND.AGENTS_TRANSCRIPT_OLDER) return undefined;
  const asks = (OLDER_ASKS.get(state) ?? 0) + 1;
  // SAFETY: the payload is the kind's, which the guard above names.
  const params = payload as PortActPayload<typeof ACT_KIND.AGENTS_TRANSCRIPT_OLDER>;
  const answer = olderPageAnswer(profile, params, asks);
  if (answer === undefined) return undefined;
  OLDER_ASKS.set(state, asks);
  stageFixture(state);
  return answer;
}

/**
 * The act port a fixture run's screens act through: each act the profile
 * answers, such as a mark, a thread's file read, or a reply or a resolve on
 * a thread, one of them refused (`inboxActAnswer`),
 * answered by the fixture, as the panel's fixture run answers it on the
 * window's side, and every other act sent to the host. The invitations
 * agent's older page is read as the service would read it, though its first
 * read is not heard back, so a flow sees Try again, and the next lays the
 * page before the transcript's first message. Note that a mark is
 * echoed and moves no dot, as on the panel's, but a change to one of the
 * fixture's pull requests moves it on the document of `state`, as GitHub
 * would, so a screen draws it merged or out of the queue, and a reminder
 * set or cleared moves its item there, as the host draws one, so the Inbox
 * puts it away under Reminders.
 */
export function fixtureActs(
  acts: ActPortClient,
  profile: RunProfile,
  state: Pick<AppStateStore, "snapshot" | "update">,
): ActPortClient {
  return new Proxy(acts, {
    get(target, kind, receiver) {
      const sent: unknown = Reflect.get(target, kind, receiver);
      if (typeof kind !== "string" || typeof sent !== "function") return sent;
      return (payload: unknown, ...rest: unknown[]) => {
        // SAFETY: the port is keyed by act kind, and each function under a kind takes that kind's payload.
        const asked = payload as PortActPayload<PortActKind>;
        const older = olderRead(state, profile, kind as PortActKind, asked);
        if (older !== undefined) return Promise.resolve(older);
        // SAFETY: the port is keyed by act kind, and each function under a kind takes that kind's payload.
        const staged = inboxActAnswer(
          profile,
          kind as PortActKind,
          payload as PortActPayload<PortActKind>,
        );
        if (staged === undefined) return Reflect.apply(sent, target, [payload, ...rest]);
        // SAFETY: as above.
        keepMove(state, kind as PortActKind, payload as PortActPayload<PortActKind>);
        // SAFETY: as above.
        keepReminder(state, kind as PortActKind, payload as PortActPayload<PortActKind>);
        return Promise.resolve(staged.answer);
      };
    },
  });
}
