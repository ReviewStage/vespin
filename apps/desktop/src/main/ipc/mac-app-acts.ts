/**
 * mac-app-acts.ts -- the act that brings an app an agent is using on this Mac to the front, answered on the act port.
 *
 * Only a panel brings one forward, so the procedure refuses any other window.
 */

import { actPortFor, type PlatformActProcedures, refuseUnlessPanel } from "@repo/host/act-port";
import { MAC_APP_ACT_KIND } from "@repo/host/contract";
import { Effect } from "effect";
import type { WebContents } from "electron";

type MacAppActKind = (typeof MAC_APP_ACT_KIND)[keyof typeof MAC_APP_ACT_KIND];

export interface MacAppActsDependencies {
  /** Brings the app with a bundle id to the front, as opening it from the Dock does, failing where it could not; the host's own, or a test's. */
  showApp: (bundleId: string) => Promise<void>;
}

const macAppPort = actPortFor<WebContents>();

export function macAppProcedures(
  dependencies: MacAppActsDependencies,
): Pick<PlatformActProcedures<WebContents>, MacAppActKind> {
  const { showApp } = dependencies;

  return {
    [MAC_APP_ACT_KIND.MAC_APP_SHOW]: macAppPort[MAC_APP_ACT_KIND.MAC_APP_SHOW].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      // Note that an app no longer installed fails to open, which the press says rather than passing it over.
      yield* Effect.tryPromise({
        try: () => showApp(input.bundleId),
        catch: () => errors.REFUSED(),
      });
    }),
  };
}
