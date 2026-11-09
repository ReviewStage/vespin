/**
 * mobile-runtime.ts -- the app's one runtime edge: the host composed and started on one runtime, which every act runs on, and drained as that runtime is disposed.
 *
 * This module is a runtime edge (`tools/anti-slop/effect-edges.json`), as
 * the web's `web-root.tsx` is: it builds the app's one runtime over the
 * host's layer (`compose-mobile.ts`) and hands the root what stands.
 * Nothing else in the app runs an Effect.
 */

import type { RunProfile } from "@repo/host/app-state";
import { Effect, type Layer, ManagedRuntime } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import type * as HttpClient from "effect/http/HttpClient";
import {
  composeMobile,
  type DeviceSeams,
  type MobileHost,
  MobileHostTag,
} from "./compose-mobile.js";

/** What the app's root hands the start: the device as the host reads it, and what this launch is. */
export interface MobileHostStartOptions {
  /** The profile a fixture run stands on; none for a live run. */
  readonly fixture: RunProfile | undefined;
  /** This build's version, as the app's config names it. */
  readonly appVersion: string;
  /** Where the host keeps its files. */
  readonly stateRoot: string;
  readonly device: DeviceSeams;
  /** The client every service call goes out on; the device's fetch where none is given. */
  readonly httpClient?: Layer.Layer<HttpClient.HttpClient>;
}

/** The host as started: what the screens read and act through, and its close, which drains it. */
export interface StandingMobileHost extends MobileHost {
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
  runtime = ManagedRuntime.make(
    composeMobile({
      httpClient,
      fork,
      fixture: options.fixture,
      appVersion: options.appVersion,
      stateRoot: options.stateRoot,
      device: options.device,
    }),
  );
  try {
    const host = await runtime.runPromise(MobileHostTag);
    return { bridge: host.bridge, acts: host.acts, close: () => runtime.dispose() };
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
}
