/**
 * mobile-runtime.ts -- the app's one runtime edge: the host composed and started on one runtime, which every act runs on, and drained as that runtime is disposed.
 *
 * This module is a runtime edge, as
 * the web's `web-root.tsx` is: it builds the app's one runtime over the
 * host's layer (`compose-mobile.ts`) and hands the root what stands.
 * Nothing else in the app runs an Effect.
 */

import type { RunProfile } from "@repo/host/app-state";
import { followStream, type OpenedStream } from "@repo/host/follow-stream";
import { Effect, Fiber, Layer, ManagedRuntime, Scheduler } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import type * as HttpClient from "effect/http/HttpClient";
import { Settings } from "react-native";
import {
  composeMobile,
  type DeviceSeams,
  type MobileHost,
  MobileHostTag,
} from "./compose-mobile.js";

/**
 * The scheduler every fiber of the host yields through: each yield a task of
 * its own (`setTimeout`), so React's render and the app's timers run between
 * the host's steps. Note that Effect's default scheduler yields through
 * `setImmediate`, which React Native's new architecture runs as a microtask,
 * so no yield ever left the JS task it began in: the host's work after it
 * stood, its task list drawn a chunk at a time among it, held the screens'
 * first render until all of it was done, about 0.9 s of a cold launch at a
 * busy account's scale on the iPhone 18 Pro simulator.
 */
/** PROBE ONLY: how long the host's rounds run in one JS task before one yields a task to React, from the launch's `-probeSliceMs`. */
const SLICE_MS = Number(Settings.get("probeSliceMs") ?? 50);
/** PROBE ONLY: a pause this long between two of the host's rounds means the thread did other work or none, so the next opens a slice of its own. */
const GAP_MS = 4;

/** PROBE ONLY: each hop the host's scheduler made, counted with how long it waited, for the launch probe to write. */
const hops = {
  sliceMs: SLICE_MS,
  count: 0,
  totalMs: 0,
  maxMs: 0,
  rounds: 0,
  maxRoundMs: 0,
  maxSliceMs: 0,
};
(globalThis as Record<string, unknown>).__launchYields = hops;

let sliceStart = Number.NEGATIVE_INFINITY;
let roundEnded = Number.NEGATIVE_INFINITY;
let inRound = false;

const round = (run: () => void, start: number) => {
  inRound = true;
  try {
    run();
  } finally {
    inRound = false;
    roundEnded = performance.now();
    hops.rounds += 1;
    hops.maxRoundMs = Math.max(hops.maxRoundMs, roundEnded - start);
    hops.maxSliceMs = Math.max(hops.maxSliceMs, roundEnded - sliceStart);
  }
};

const yieldingScheduler = new Scheduler.MixedScheduler("async", (run) => {
  const queued = performance.now();

  // Note that a round stays in the JS task it was asked in until the slice is spent, or opens a fresh one where the thread paused.
  if ((!inRound && queued - roundEnded > GAP_MS) || queued - sliceStart < SLICE_MS) {
    let canceled = false;

    queueMicrotask(() => {
      if (canceled) return;
      const start = performance.now();

      if (start - roundEnded > GAP_MS) sliceStart = start;
      round(run, start);
    });

    return () => {
      canceled = true;
    };
  }

  const timer = setTimeout(() => {
    const start = performance.now();
    const waited = start - queued;

    hops.count += 1;
    hops.totalMs += waited;
    hops.maxMs = Math.max(hops.maxMs, waited);
    sliceStart = start;
    round(run, start);
  }, 0);

  return () => clearTimeout(timer);
});

/** What the app's root hands the start: the device as the host reads it, and what this launch is. */
export interface MobileHostStartOptions {
  /** The profile a fixture run stands on; none for a live run. */
  readonly fixture: RunProfile | undefined;
  /** Whether a fixture run stands as the service's refusal of an old build leaves it; never in a live run. */
  readonly fixtureUpdateNeeded?: boolean | undefined;
  /** Whether a fixture run holds a machine's ask for an agent's command; never in a live run. */
  readonly fixtureMachineAsk?: boolean | undefined;
  readonly fixtureSetupOwed?: boolean | undefined;
  readonly fixtureInboxOff?: boolean | undefined;
  /** Whether a fixture run refuses the writes a flow presses; never in a live run. */
  readonly fixtureRefusesWrites?: boolean | undefined;
  /** This build's version, as the app's config names it. */
  readonly appVersion: string;
  /** Where the host keeps its files. */
  readonly stateRoot: string;
  readonly device: DeviceSeams;
  /** The client every service call goes out on; the device's fetch where none is given. */
  readonly httpClient?: Layer.Layer<HttpClient.HttpClient>;
  /** Effect's reporters the host's runtime stands on, Sentry's among them; Effect's own where none is given. */
  readonly errorReporting?: Layer.Layer<never>;
}

/** A stream the screens hold open on the act port, such as a transcript's follow, until the stop handed back is called. */
export type HostFollow = <View>(
  open: () => Promise<OpenedStream<View>>,
  take: (view: View) => void,
) => () => void;

/** The host as started: what the screens read and act through, the follows they hold open, and its close, which drains it. */
export interface StandingMobileHost extends MobileHost {
  readonly follow: HostFollow;
  readonly close: () => Promise<void>;
}

/**
 * Composes the host and reads what stands once every composer has started
 * and the first bootstrap is in the document. A host that cannot stand
 * rejects, its runtime disposed, so the root can say so.
 */
export async function startMobileHost(
  options: MobileHostStartOptions,
): Promise<StandingMobileHost> {
  const httpClient = options.httpClient ?? FetchHttpClient.layer;
  // Note that a count is forked only once the host stands, by which time the runtime is set.
  let runtime: ManagedRuntime.ManagedRuntime<MobileHostTag, unknown>;

  // A defect in a count is reported, as the desktop's acts are.
  const fork = (effect: Effect.Effect<void>): void => {
    runtime.runFork(Effect.withErrorReporting(effect, { defectsOnly: true }));
  };

  // The reporters and the scheduler stand beneath the host, so every fiber it forks and every act reports and yields through them.
  runtime = ManagedRuntime.make(
    Layer.provideMerge(
      composeMobile({
        httpClient,
        fork,
        fixture: options.fixture,
        fixtureUpdateNeeded: options.fixtureUpdateNeeded,
        fixtureMachineAsk: options.fixtureMachineAsk,
        fixtureSetupOwed: options.fixtureSetupOwed,
        fixtureInboxOff: options.fixtureInboxOff,
        fixtureRefusesWrites: options.fixtureRefusesWrites,
        appVersion: options.appVersion,
        stateRoot: options.stateRoot,
        device: options.device,
      }),
      Layer.merge(
        options.errorReporting ?? Layer.empty,
        Layer.succeed(Scheduler.Scheduler, yieldingScheduler),
      ),
    ),
  );

  try {
    const host = await runtime.runPromise(MobileHostTag);

    // A follow runs on the host's runtime, opened again as it breaks, until its stop interrupts it.
    const follow: HostFollow = (open, take) => {
      const fiber = runtime.runFork(followStream(open, take));

      return () => {
        runtime.runFork(Fiber.interrupt(fiber));
      };
    };

    return { bridge: host.bridge, acts: host.acts, follow, close: () => runtime.dispose() };
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
}
