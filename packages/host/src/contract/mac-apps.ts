import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { MAC_APP_ACT_KIND } from "./kinds.js";

/**
 * mac-apps.ts -- an app on this Mac brought to the front, as a procedure.
 *
 * Main answers it itself (`apps/desktop/src/main/ipc/mac-app-acts.ts`).
 */

/** The app brought forward, by its bundle id, as an agent's computer call answered it. */
const macAppKeySchema = EffectSchema.Struct({
  bundleId: EffectSchema.String.check(
    EffectSchema.isPattern(/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/u),
  ),
});

export const macAppActsContract = {
  [MAC_APP_ACT_KIND.MAC_APP_SHOW]: actProcedure("Could not bring that app forward on this Mac.")
    .input(exactInput(macAppKeySchema))
    .output(EffectSchema.Void),
};
