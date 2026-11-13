import { type ExperimentChoices, HOST_CAPABILITY, type HostCapability } from "@repo/settings";
import {
  SETTINGS_PAGE_GROUP,
  SETTINGS_PAGE_GROUP_HEADING,
  SETTINGS_PAGE_GROUPS,
  SETTINGS_PAGE_TITLE,
  SETTINGS_VIEW,
  type SettingsPageGroup,
  type SettingsView,
} from "@repo/settings/settings-views";
import { DisplayIcon, KeyboardIcon, LaptopIcon, PlugIcon, ProductMark } from "@repo/ui";
import {
  CloudCogIcon,
  FlaskConicalIcon,
  GLYPH,
  InfoIcon,
  SlidersHorizontalIcon,
} from "@repo/ui/icons";
import { settingsPageShown } from "./settings-rows.js";

/** A page's name and glyph. */
interface SettingsPage {
  readonly title: string;
  readonly icon: React.JSX.Element;
}

/**
 * Each page's glyph in the Settings sidebar, beside the name
 * `SETTINGS_PAGE_TITLE` gives it everywhere it is named. The name and the
 * glyph are the whole row: what a page holds is one press away. Account's
 * own page is Account, because it is where the account itself is kept, and
 * "Your profile" in the account menu opens the person page; the Workspace
 * page's row is Workspace under the listed workspace's name, and its head
 * names that workspace.
 */
const SETTINGS_PAGE_ICON = {
  [SETTINGS_VIEW.ACCOUNT]: <GLYPH.PERSON />,
  [SETTINGS_VIEW.PREFERENCES]: <SlidersHorizontalIcon />,
  [SETTINGS_VIEW.WORKSPACE]: <GLYPH.PEOPLE />,
  [SETTINGS_VIEW.ENVIRONMENT]: <CloudCogIcon />,
  [SETTINGS_VIEW.AGENTS]: <GLYPH.AGENT />,
  [SETTINGS_VIEW.HOSTS]: <GLYPH.HOST />,
  [SETTINGS_VIEW.INTEGRATIONS]: <PlugIcon />,
  // Note that the outside agents' and the command's page is marked for the product, never the protocol alone, because the MCP glyph marks the servers the window's own agents use.
  [SETTINGS_VIEW.MCP]: <ProductMark small glyph />,
  [SETTINGS_VIEW.SKILLS]: <GLYPH.SKILL />,
  [SETTINGS_VIEW.MEMORY]: <GLYPH.MEMORY />,
  [SETTINGS_VIEW.APPEARANCE]: <DisplayIcon />,
  [SETTINGS_VIEW.THIS_MAC]: <LaptopIcon />,
  [SETTINGS_VIEW.EXPERIMENTAL]: <FlaskConicalIcon />,
  [SETTINGS_VIEW.ABOUT]: <InfoIcon />,
  [SETTINGS_VIEW.SHORTCUTS]: <KeyboardIcon />,
} satisfies Record<SettingsView, React.JSX.Element>;

/**
 * The Workspace page's group of what the workspace connects for everyone, its
 * heading and its search result alike. Named for the workspace, because the
 * account's own Integrations page holds what the reader connects for
 * themself, and the two once shared one name.
 */
export const WORKSPACE_CONNECTIONS = "Workspace connections";

/** The last group's heading in a browser, which runs on whatever the reader holds rather than on a Mac. */
const THIS_DEVICE_HEADING = "This device";

/** Any page's name and glyph: what the Settings sidebar, a page's title, and the command palette name it by. */
export function settingsPageOf(view: SettingsView): SettingsPage {
  return { title: SETTINGS_PAGE_TITLE[view], icon: SETTINGS_PAGE_ICON[view] };
}

/** The Settings sidebar's groups with the pages this platform and the account's experiments offer, a group left with none dropped. */
export function shownSettingsPageGroups(
  capabilities: readonly HostCapability[],
  experiments: ExperimentChoices,
): readonly { readonly group: SettingsPageGroup; readonly pages: readonly SettingsView[] }[] {
  return SETTINGS_PAGE_GROUPS.map(({ group, pages }) => ({
    group,
    pages: pages.filter((page) => settingsPageShown(page, capabilities, experiments)),
  })).filter(({ pages }) => pages.length > 0);
}

/** A group's heading in the Settings sidebar, the first's where no workspace is listed; the machine's own group is named for the Mac only in the app installed there. */
export function settingsGroupHeadingOf(
  group: SettingsPageGroup,
  capabilities: readonly HostCapability[],
): string {
  if (
    group === SETTINGS_PAGE_GROUP.THIS_MAC &&
    !capabilities.includes(HOST_CAPABILITY.DESKTOP_APP)
  ) {
    return THIS_DEVICE_HEADING;
  }

  return SETTINGS_PAGE_GROUP_HEADING[group];
}
