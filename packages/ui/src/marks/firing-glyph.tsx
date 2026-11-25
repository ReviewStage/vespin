import { FIRING_MARK, firingMark } from "@repo/features/automation-firing-mark";
import type { AutomationFiring, AutomationTrigger } from "@repo/features/automation-wire";
import React from "react";
import { ClockIcon, PlayIcon, WebhookIcon } from "../icons/icons.js";
import { ProviderMark } from "./provider-mark.js";

// `tsx` executes imported workspace-package JSX with the classic runtime.
void React;

/**
 * firing-glyph.tsx -- what fires an automation or fired one of its runs, as the glyph its tile or row wears.
 *
 * A schedule wears its clock, a GitHub event GitHub's mark, an integration's
 * event that provider's mark (Sentry's), a webhook its hook, and a run the
 * developer started by hand Run now's play, so an automation's row and its
 * runs say what fires them in one glyph, at the glyph cell of whatever leads
 * with it.
 */

/** What fires an automation or fired a run, as its glyph: the mark `firingMark` names, drawn from the panel's icons. */
export function FiringGlyph({
  of,
}: {
  of: AutomationFiring | AutomationTrigger;
}): React.JSX.Element {
  const mark = firingMark(of);

  switch (mark.kind) {
    case FIRING_MARK.PROVIDER:
      return <ProviderMark provider={mark.provider} />;
    case FIRING_MARK.WEBHOOK:
      return <WebhookIcon />;
    case FIRING_MARK.MANUAL:
      return <PlayIcon />;
    case FIRING_MARK.SCHEDULE:
      return <ClockIcon />;
  }
}
