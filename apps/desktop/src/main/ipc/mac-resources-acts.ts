/**
 * mac-resources-acts.ts -- the act that answers what this Mac spends on the app now, answered on the act port.
 *
 * Only a panel asks, from its Resources popover, every few seconds while it
 * stands open, so the procedure refuses any other window. The read itself is
 * main's (`../native/mac-resources.ts`).
 */

import { actPortFor, type PlatformActProcedures, refuseUnlessPanel } from "@repo/host/act-port";
import { MAC_RESOURCES_ACT_KIND, type MacResources } from "@repo/host/contract";
import type { Effect } from "effect";
import type { WebContents } from "electron";

type MacResourcesActKind = (typeof MAC_RESOURCES_ACT_KIND)[keyof typeof MAC_RESOURCES_ACT_KIND];

export interface MacResourcesActsDependencies {
  /** The app's processes now; main's read of the process table, or a test's. */
  read: Effect.Effect<MacResources>;
}

const macResourcesPort = actPortFor<WebContents>();

export function macResourcesProcedures(
  dependencies: MacResourcesActsDependencies,
): Pick<PlatformActProcedures<WebContents>, MacResourcesActKind> {
  const { read } = dependencies;
  return {
    [MAC_RESOURCES_ACT_KIND.MAC_RESOURCES_READ]: macResourcesPort[
      MAC_RESOURCES_ACT_KIND.MAC_RESOURCES_READ
    ].effect(function* ({ context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* read;
    }),
  };
}
