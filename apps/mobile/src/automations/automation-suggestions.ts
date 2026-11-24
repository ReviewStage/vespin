/**
 * automation-suggestions.ts -- the automations the Automations tab suggests under its own, as the desktop's list suggests them: each preset, the glyph it is shown with, the experiment it stands behind, and whether Sentry's events fire it.
 *
 * A preset is offered where its experiment is on in the workspace, or it
 * has none, and where no automation made from it already stands as the
 * reader's own or the workspace's: a teammate's personal one runs for that
 * teammate alone, so the reader is still offered their own.
 */

import { AUTOMATION_PRESET, type AutomationPresetName } from "@repo/features/automation-presets";
import { AUTOMATION_SCOPE, type AutomationSummary } from "@repo/features/automation-wire";
import type { WorkspaceExperiment } from "@repo/settings";
import { EXPERIMENT } from "@repo/settings";
import { GLYPH, type Glyph } from "@repo/ui-native";

/** One suggestion: its preset, its glyph, the workspace experiment it stands behind where it does, and whether Sentry's events fire it. */
export interface AutomationSuggestion {
  readonly preset: AutomationPresetName;
  readonly symbol: Glyph;
  readonly experiment?: WorkspaceExperiment;
  readonly sentry?: boolean;
}

/** The suggestions in the desktop's order. */
export const AUTOMATION_SUGGESTIONS: readonly AutomationSuggestion[] = [
  { preset: AUTOMATION_PRESET.MEMORY_DIGEST, symbol: GLYPH.MEMORY, experiment: EXPERIMENT.MEMORY },
  { preset: AUTOMATION_PRESET.RED_MAIN_TRIAGE, symbol: GLYPH.BRANCH },
  { preset: AUTOMATION_PRESET.SENTRY_ALERT_INVESTIGATION, symbol: GLYPH.FAILED, sentry: true },
];

/** The presets an automation the reader would otherwise be offered already stands for. */
export function takenPresets(listed: readonly AutomationSummary[]): ReadonlySet<string> {
  return new Set(
    listed.flatMap((automation) =>
      (automation.mine === true || automation.scope === AUTOMATION_SCOPE.WORKSPACE) &&
      automation.preset !== undefined &&
      automation.preset !== null
        ? [automation.preset]
        : [],
    ),
  );
}
