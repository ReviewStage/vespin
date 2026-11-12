/**
 * settings-section-guard.ts -- what the `settings-section-declared` rule
 * reads: the Settings pages' files, the section they draw, and the one call
 * a titled section takes its head from. The rule started clean, so it takes
 * no baseline.
 */
import { repositoryPathOf } from "./repository-path.ts";

export const SETTINGS_SECTION_GUARD_RULE = "vespin/settings-section-declared";

/** The folder the Settings pages are drawn from. */
const SETTINGS_PAGES = "packages/panel/src/settings/";

/** The `@repo/ui` section a Settings page draws its groups with. */
export const SETTINGS_SECTION = "SettingsSection";

/** The call a section's head is spread from, read from the section's one declaration (`settings-sections.tsx`). */
export const SECTION_HEAD = "settingsSectionHead";

/** The section's prop its head names it by, which comes only from its declaration; an untitled section may still wear an anchor, for a row the search finds that is no section. */
export const HEAD_PROP = "title";

/** Whether a file draws a Settings page. */
export function isSettingsPage(filename: string): boolean {
  return repositoryPathOf(filename).startsWith(SETTINGS_PAGES);
}
