/**
 * mac-app-acts.ts -- the act that brings an app an agent is using on this Mac to the front, answered on the act port.
 *
 * Only a panel brings one forward, so the procedure refuses any other window.
 */

import { actPortFor, type PlatformActProcedures, refuseUnlessPanel } from "@repo/host/act-port";
import { MAC_APP_ACT_KIND } from "@repo/host/contract";
import type { WebContents } from "electron";

type MacAppActKind = (typeof MAC_APP_ACT_KIND)[keyof typeof MAC_APP_ACT_KIND];

export interface MacAppActsDependencies {
  /** Brings the app with a bundle id to the front, as opening it from the Dock does; the host's own, or a test's. */
  showApp: (bundleId: string) => void;
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
      showApp(input.bundleId);
    }),
  };
}
