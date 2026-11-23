// launch-phases.ts -- how long a launch took to reach each of its phases, the bundle evaluated, the account read, the local copy opened, the host composed and stood, the screens first drawn, and the Inbox first grouped, and how many documents it took, for `app:ready` to count beside its own time and the launch's trace to hold.

import { probe, probeOnce } from "./launch-probe.js";

/** React Native's own startup marks, which its `performance` holds beside the web's and its types leave out. */
interface StartupPerformance {
  readonly rnStartupTiming?: { readonly startTime?: number | null };
}

/** A launch's phases, in the order a launch reaches them. */
export const LAUNCH_PHASE = {
  /** The root layout's module evaluated, so the bundle's eager modules have run. */
  EVALUATED: "evaluated",
  /** The account's tokens first read from the Keychain. */
  ACCOUNT: "account",
  /** The host's local copy first opened. */
  LOCAL: "local",
  /** The host composed, before its first document is read. */
  STARTED: "started",
  /** The screens first drawn, as the splash is let go over them (`splash.ts`). */
  SCREENS: "screens",
  /** The Inbox's holders first grouped from a document (`useInboxGroupsIn`). */
  INBOX: "inbox",
} as const;

export type LaunchPhase = (typeof LAUNCH_PHASE)[keyof typeof LAUNCH_PHASE];

/** How long after the launch's start this launch's host stood; none before it stands. */
let stood: { readonly ms: number | undefined } | undefined;

/** How long after the launch's start each phase was first reached; a phase not yet reached is absent. */
const reached = new Map<LaunchPhase, number | undefined>();

/** How many documents the host wrote into the screens' client since it started. */
let delivered = 0;

/**
 * The time since React Native's own start of this launch, in milliseconds, or
 * none where the runtime keeps no start. Note that the start is
 * `APP_STARTUP_START`, which React Native marks just before Hermes runs the
 * bundle, so the native launch before it isn't in the time.
 */
export function sinceLaunch(): number | undefined {
  // Note that React Native's startup timing is read inside a guard, since a runtime that keeps none throws on the read.
  try {
    // SAFETY: React Native's `performance` holds `rnStartupTiming` (react-native/src/private/webapis/performance/Performance.js); every member is read as optional.
    const start = (performance as Performance & StartupPerformance).rnStartupTiming?.startTime;

    return start === null || start === undefined ? undefined : performance.now() - start;
  } catch {
    return undefined;
  }
}

/** Notes that the host starts, clearing what an earlier start noted, the bundle's evaluation aside. */
export function noteHostStarting(): void {
  stood = undefined;
  delivered = 0;
  reached.delete(LAUNCH_PHASE.ACCOUNT);
  reached.delete(LAUNCH_PHASE.LOCAL);
  reached.delete(LAUNCH_PHASE.STARTED);
  reached.delete(LAUNCH_PHASE.INBOX);
}

/** Notes that the host wrote one more document into the screens' client. */
export function noteDelivered(): void {
  delivered += 1;
  probe("delivered", delivered);
}

/** How many documents the host wrote into the screens' client since it started. */
export function launchDelivered(): number {
  return delivered;
}

/** Notes that the launch reached `phase`, the first time alone, so a later read or open of the same thing moves nothing. */
export function noteLaunchPhase(phase: LaunchPhase): void {
  if (!reached.has(phase)) {
    reached.set(phase, sinceLaunch());
    probeOnce(`phase:${phase}`);
  }
}

/** When this launch started, in epoch milliseconds, as React Native marks it (`sinceLaunch`); none where the runtime keeps no start. */
export function launchStartedAt(): number | undefined {
  const since = sinceLaunch();

  return since === undefined ? undefined : Date.now() - since;
}

/** How long after the launch's start it first reached `phase`; none before it does, or where the runtime keeps no start. */
export function launchPhaseMs(phase: LaunchPhase): number | undefined {
  return reached.get(phase);
}

/** Notes, once the host stood, how long it took. */
export function noteHostStood(): void {
  probeOnce("stood");
  stood = { ms: sinceLaunch() };
}

/** How long this launch's host took to stand, once it stood; none before. */
export function launchStood(): typeof stood {
  return stood;
}
