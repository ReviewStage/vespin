/**
 * automation-firing-mark.ts -- which mark an automation or one of its runs wears for what fires it, the desktop's tile and the phone's row alike: a provider's own mark for a GitHub or an integration's event, and a glyph for a schedule, a webhook, or a run started by hand.
 *
 * It says which mark, never how it is drawn, so `@repo/ui`'s `FiringGlyph`
 * and `@repo/ui-native`'s rows each draw it from their own icons and the two
 * never disagree on what fires an automation.
 */

import {
  AUTOMATION_FIRING,
  type AutomationFiring,
  type AutomationTrigger,
} from "./automation-wire.js";
import { INTEGRATION_PROVIDER, type IntegrationProvider } from "./integration-wire.js";

/** The marks a firing wears. */
export const FIRING_MARK = {
  /** A provider's own mark, GitHub's or an integration's (Sentry's). */
  PROVIDER: "provider",
  /** A schedule's clock. */
  SCHEDULE: "schedule",
  /** A webhook's hook. */
  WEBHOOK: "webhook",
  /** Run now's play, for a run started by hand. */
  MANUAL: "manual",
} as const;

/** One firing's mark: a provider's, by its provider, or one of the glyphs. */
export type FiringMark =
  | { readonly kind: typeof FIRING_MARK.PROVIDER; readonly provider: IntegrationProvider }
  | {
      readonly kind:
        | typeof FIRING_MARK.SCHEDULE
        | typeof FIRING_MARK.WEBHOOK
        | typeof FIRING_MARK.MANUAL;
    };

/** The mark of what fires an automation, or fired one of its runs. */
export function firingMark(of: AutomationFiring | AutomationTrigger): FiringMark {
  switch (of.kind) {
    case AUTOMATION_FIRING.GITHUB:
      return { kind: FIRING_MARK.PROVIDER, provider: INTEGRATION_PROVIDER.GITHUB };
    case AUTOMATION_FIRING.INTEGRATION:
      return { kind: FIRING_MARK.PROVIDER, provider: of.provider };
    case AUTOMATION_FIRING.WEBHOOK:
      return { kind: FIRING_MARK.WEBHOOK };
    case AUTOMATION_FIRING.MANUAL:
      return { kind: FIRING_MARK.MANUAL };
    case AUTOMATION_FIRING.SCHEDULE:
      return { kind: FIRING_MARK.SCHEDULE };
  }
}
