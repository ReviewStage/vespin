/**
 * automation-preset-name.ts -- the names of the presets the Automations list suggests, below both the wire an automation made from one carries its name on and the presets themselves.
 *
 * Note that the names stand apart from the presets (`automation-presets.ts`),
 * because a preset is written in the wire's own trigger and target values,
 * and the wire reads these names: one module holding both would be a cycle.
 */

/** The presets the Automations list suggests, each by the name a new automation's page is opened from it with. */
export const AUTOMATION_PRESET = {
  MEMORY_DIGEST: "memory-digest",
  RED_MAIN_TRIAGE: "red-main-triage",
  SENTRY_ALERT_INVESTIGATION: "sentry-alert-investigation",
} as const;

export type AutomationPresetName = (typeof AUTOMATION_PRESET)[keyof typeof AUTOMATION_PRESET];
