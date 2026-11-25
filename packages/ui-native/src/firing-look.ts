// firing-look.ts -- the mark an automation or one of its runs leads with on the phone, drawn from `@repo/features/automation-firing-mark`'s `firingMark`, which the desktop's `FiringGlyph` draws from too: a provider's own mark from the asset catalog, else the glyph of a schedule, a webhook, or a run started by hand.

import { FIRING_MARK, type FiringMark } from "@repo/features/automation-firing-mark";
import { GLYPH, type Glyph } from "./glyph.js";
import { INTEGRATION_MARK_ASSET, type IntegrationMarkAsset } from "./integration-marks.js";

/** A firing's lead: the glyph a row stands at rest, and the provider's mark it stands in the glyph's place where it has one. */
export interface FiringLook {
  readonly symbol: Glyph;
  readonly mark?: IntegrationMarkAsset | undefined;
}

/**
 * Each glyph mark's glyph. Note that a webhook stands on the link's glyph
 * until the app's asset catalog holds the panel's webhook glyph, which a
 * native build adds.
 */
const FIRING_GLYPH = {
  [FIRING_MARK.SCHEDULE]: GLYPH.TIME,
  [FIRING_MARK.WEBHOOK]: GLYPH.LINK,
  [FIRING_MARK.MANUAL]: GLYPH.RUN,
} as const;

/** The lead a firing's mark stands as. */
export function firingLook(mark: FiringMark): FiringLook {
  if (mark.kind === FIRING_MARK.PROVIDER) {
    return { symbol: GLYPH.AUTOMATION, mark: INTEGRATION_MARK_ASSET[mark.provider] };
  }

  return { symbol: FIRING_GLYPH[mark.kind] };
}
