import { MACHINES_WORDS } from "@repo/features/machines-settings-words";
import { SKILLS_LINE, workspaceGroupTitle } from "@repo/features/skills-settings-words";
import type { Workspace } from "@repo/features/workspace-wire";
import { EXPERIMENT, experimentOn } from "@repo/settings";
import { SETTINGS_SEARCH_ROW } from "@repo/settings/settings-anchors";
import { SETTINGS_SECTION, SETTINGS_VIEW, type SettingsView } from "@repo/settings/settings-views";
import {
  CHAPTERS_GROUP_TITLE,
  FILES_CHANGED_GROUP_TITLE,
  WRITING_GROUP_TITLE,
} from "@repo/settings/shortcuts";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import type { ReactNode } from "react";
import type { SettingsSearchEntry, SettingsSearchInput } from "../settings-search.js";
import { WORKSPACE_CONNECTIONS } from "./pages.js";

/**
 * settings-sections.tsx -- every titled section of a Settings page, declared once: the page draws its head from here and the settings search finds it from here.
 *
 * A section's head and its search result used to be written twice, the
 * head on its page and the result in the search's own list, and a section
 * whose result nobody wrote was drawn but never found. Here each section
 * says how it is found: by its own head, which the search then offers as a
 * result landing on the section, under the same condition the page draws
 * it on; row by row, where every row under it is already indexed from the
 * declaration it is drawn from; or by its page's name alone, where it is
 * drawn only from data the search does not hold. A page draws a titled
 * section's head only through `settingsSectionHead`, which
 * `anti-slop/settings-section-declared` holds, so a section added to a page
 * is declared here, and so found, in the same change.
 */

/** How a section is found by the settings search. */
const SECTION_FOUND = {
  /** By its own head: a result of its own that lands on the section, offered while `drawn` holds. */
  HEAD: "head",
  /** Row by row: its head is no result, because every row under it is indexed from the declaration it is drawn from. */
  ROWS: "rows",
  /** By its page's name alone, because it is drawn only from data the search does not hold. */
  PAGE: "page",
} as const;

/**
 * The declarations a section found row by row may draw its rows from, each
 * one the search reads every row of. A section of rows the search does not
 * index is no section of these: it is found by its head.
 */
const SECTION_ROWS = {
  /** Stored settings, drawn and indexed from `APP_SETTING_SCHEMA`. */
  SCHEMA: "schema",
  /** The window's chords and keys, drawn and indexed from `@repo/settings/shortcuts`. */
  SHORTCUTS: "shortcuts",
  /** The integrations, drawn and indexed from `INTEGRATION_PROVIDER_LIST`. */
  INTEGRATIONS: "integrations",
} as const;

type SectionRows = (typeof SECTION_ROWS)[keyof typeof SECTION_ROWS];

/** Words that may hold a workspace's name, masked in a screen recording from `maskedFrom` on. */
interface SectionWords {
  readonly text: string;
  readonly maskedFrom?: number;
}

/** A section found by its own head. */
interface HeadSectionBase {
  readonly found: typeof SECTION_FOUND.HEAD;
  readonly page: SettingsView;
  /** Its result's name, where that says what the section is for better than its head; its head otherwise. */
  readonly label?: string;
  /** The words it is found by beside its name. */
  readonly words: string;
  /** Whether the page draws it right now, judged from what the search reads. */
  readonly drawn: (input: SettingsSearchInput) => boolean;
}

/** A section found by its head, named by fixed words. */
interface FixedHeadSection extends HeadSectionBase {
  readonly head: string;
  readonly headFor?: undefined;
}

/** A section found by its head, named for the workspace Settings shows. */
interface WorkspaceHeadSection extends HeadSectionBase {
  readonly head?: undefined;
  readonly headFor: (workspace: Workspace) => SectionWords;
}

type HeadSection = FixedHeadSection | WorkspaceHeadSection;

/** A section found row by row; its head is its rows' own group's name where the page draws several from one declaration. */
interface RowsSection {
  readonly found: typeof SECTION_FOUND.ROWS;
  readonly rows: SectionRows;
  readonly head?: string;
}

/** A section found by its page's name alone. */
interface PageSection {
  readonly found: typeof SECTION_FOUND.PAGE;
  readonly head: string;
}

type SectionDeclaration = HeadSection | RowsSection | PageSection;

/** The words every Cloud environment section is found by beside its own. */
const CLOUD_WORDS = "cloud sandbox";

/** The words Experimental's group for everyone in a workspace is named by, before the workspace's own name. */
const EXPERIMENTS_WORKSPACE_LABEL = "For everyone in ";

/** Whether the workspace Settings shows is drawn on, as every workspace page's sections need. */
function workspaceShown(input: SettingsSearchInput): boolean {
  return input.workspace !== undefined;
}

/** Whether an account is signed in, as every account section needs. */
function accountDrawn(input: SettingsSearchInput): boolean {
  return input.accountDrawn;
}

/**
 * Each titled section's key. A section found by its head is keyed by the
 * anchor it wears, the same one a Settings link or a pressed result lands
 * on; the others by a key of their own.
 */
export const SECTION = {
  MEMBERS: SETTINGS_SECTION.MEMBERS,
  WORKSPACE_CONNECTIONS: SETTINGS_SECTION.GITHUB_REPOSITORIES,
  ENVIRONMENT_VARIABLES: SETTINGS_SEARCH_ROW.ENVIRONMENT_VARIABLES,
  ENVIRONMENT_INSTALL: SETTINGS_SEARCH_ROW.ENVIRONMENT_INSTALL,
  ENVIRONMENT_SETUP: SETTINGS_SEARCH_ROW.ENVIRONMENT_SETUP,
  ENVIRONMENT_RUN_ACTIONS: SETTINGS_SEARCH_ROW.ENVIRONMENT_RUN_ACTIONS,
  ADD_HOSTS: SETTINGS_SEARCH_ROW.ADD_HOSTS,
  HOSTS: SETTINGS_SEARCH_ROW.HOSTS,
  MCP_CLIENTS: SETTINGS_SEARCH_ROW.MCP_CLIENTS,
  CLI_SIGN_IN: SETTINGS_SEARCH_ROW.CLI_SIGN_IN,
  /** Skills' first group, the workspace's or, in the account's first workspace, the reader's own, whose heading holds its Add skill. */
  SKILLS_FIRST: SETTINGS_SEARCH_ROW.ADD_SKILL,
  /** Skills' group of the reader's own, under the workspace's in a workspace of several members. */
  SKILLS_PERSONAL: SETTINGS_SEARCH_ROW.SKILLS_PERSONAL,
  EXPERIMENTS_WORKSPACE: SETTINGS_SEARCH_ROW.EXPERIMENTS_WORKSPACE,
  EXPERIMENTS_ACCOUNT: SETTINGS_SEARCH_ROW.EXPERIMENTS_ACCOUNT,
  PREFERENCES_GENERAL: "preferences-general",
  PREFERENCES_AGENTS: "preferences-agents",
  PRIVACY: "privacy",
  NEW_AGENTS: "new-agents",
  STARTUP: "startup",
  DICTATION: "dictation",
  NOTIFICATIONS: "notifications",
  YOUR_SOUNDS: "your-sounds",
  APPEARANCE_GROUP: "appearance-group",
  INTEGRATIONS_GROUP: "integrations-group",
  SHORTCUTS_GROUP: "shortcuts-group",
  SHORTCUTS_WRITING: "shortcuts-writing",
  SHORTCUTS_FILES_CHANGED: "shortcuts-files-changed",
  SHORTCUTS_CHAPTERS: "shortcuts-chapters",
} as const;

type SettingsSectionKey = (typeof SECTION)[keyof typeof SECTION];

/** Every titled section of every Settings page, in the order the pages draw them. */
const SETTINGS_SECTIONS = {
  [SECTION.PREFERENCES_GENERAL]: {
    found: SECTION_FOUND.ROWS,
    rows: SECTION_ROWS.SCHEMA,
    head: "General",
  },
  [SECTION.PREFERENCES_AGENTS]: {
    found: SECTION_FOUND.ROWS,
    rows: SECTION_ROWS.SCHEMA,
    head: "Agents",
  },
  [SECTION.PRIVACY]: {
    found: SECTION_FOUND.ROWS,
    rows: SECTION_ROWS.SCHEMA,
    head: "Privacy",
  },
  [SECTION.NOTIFICATIONS]: {
    found: SECTION_FOUND.ROWS,
    rows: SECTION_ROWS.SCHEMA,
    head: "Notifications",
  },
  [SECTION.YOUR_SOUNDS]: {
    found: SECTION_FOUND.PAGE,
    head: "Your sounds",
  },
  [SECTION.MEMBERS]: {
    found: SECTION_FOUND.HEAD,
    page: SETTINGS_VIEW.WORKSPACE,
    head: "Members",
    words: "people team remove role",
    drawn: workspaceShown,
  },
  [SECTION.WORKSPACE_CONNECTIONS]: {
    found: SECTION_FOUND.HEAD,
    page: SETTINGS_VIEW.WORKSPACE,
    head: WORKSPACE_CONNECTIONS,
    words: "integrations GitHub repositories connect choose manage disconnect organization",
    drawn: workspaceShown,
  },
  [SECTION.ENVIRONMENT_VARIABLES]: {
    found: SECTION_FOUND.HEAD,
    page: SETTINGS_VIEW.ENVIRONMENT,
    head: "Variables",
    words: `environment variables env vars secrets ${CLOUD_WORDS}`,
    drawn: workspaceShown,
  },
  [SECTION.ENVIRONMENT_INSTALL]: {
    found: SECTION_FOUND.HEAD,
    page: SETTINGS_VIEW.ENVIRONMENT,
    head: "Install software",
    words: `install script sudo apt packages tools ${CLOUD_WORDS}`,
    drawn: workspaceShown,
  },
  [SECTION.ENVIRONMENT_SETUP]: {
    found: SECTION_FOUND.HEAD,
    page: SETTINGS_VIEW.ENVIRONMENT,
    head: "Setup scripts",
    words: `setup script repository checkout ${CLOUD_WORDS}`,
    drawn: workspaceShown,
  },
  [SECTION.ENVIRONMENT_RUN_ACTIONS]: {
    found: SECTION_FOUND.HEAD,
    page: SETTINGS_VIEW.ENVIRONMENT,
    head: "Run actions",
    words: `run action command run menu run button terminal ${CLOUD_WORDS}`,
    drawn: (input) =>
      workspaceShown(input) && experimentOn(input.settings.experiments, EXPERIMENT.RUN_ACTIONS),
  },
  [SECTION.NEW_AGENTS]: {
    found: SECTION_FOUND.ROWS,
    rows: SECTION_ROWS.SCHEMA,
    head: "New agents",
  },
  [SECTION.ADD_HOSTS]: {
    found: SECTION_FOUND.HEAD,
    page: SETTINGS_VIEW.HOSTS,
    head: "Add a machine",
    words: "machines machine hosts host server linux mac install vespin-host",
    drawn: accountDrawn,
  },
  [SECTION.HOSTS]: {
    found: SECTION_FOUND.HEAD,
    page: SETTINGS_VIEW.HOSTS,
    head: MACHINES_WORDS.TITLE,
    words: "machines machine hosts host connected list",
    drawn: accountDrawn,
  },
  [SECTION.INTEGRATIONS_GROUP]: {
    found: SECTION_FOUND.ROWS,
    rows: SECTION_ROWS.INTEGRATIONS,
  },
  [SECTION.MCP_CLIENTS]: {
    found: SECTION_FOUND.HEAD,
    page: SETTINGS_VIEW.MCP,
    head: "MCP",
    label: "Connected apps",
    words: "mcp server clients oauth allowed agents with access revoke disconnect external outside",
    drawn: accountDrawn,
  },
  [SECTION.CLI_SIGN_IN]: {
    found: SECTION_FOUND.HEAD,
    page: SETTINGS_VIEW.MCP,
    head: "CLI",
    label: "CLI sign-in",
    words:
      "sign in from your terminal signed in command-line tool vespin login sign out everywhere logout",
    drawn: accountDrawn,
  },
  [SECTION.SKILLS_FIRST]: {
    found: SECTION_FOUND.HEAD,
    page: SETTINGS_VIEW.SKILLS,
    headFor: (workspace) =>
      workspace.personal === true
        ? { text: SKILLS_LINE.PERSONAL }
        : { text: workspaceGroupTitle(workspace), maskedFrom: 0 },
    label: SKILLS_LINE.ADD_SKILL,
    words: "skills skill install import github repository SKILL.md instructions agents",
    drawn: workspaceShown,
  },
  [SECTION.SKILLS_PERSONAL]: {
    found: SECTION_FOUND.HEAD,
    page: SETTINGS_VIEW.SKILLS,
    head: SKILLS_LINE.PERSONAL,
    words: "skills skill personal mine just me",
    drawn: (input) => input.workspace !== undefined && input.workspace.personal !== true,
  },
  [SECTION.APPEARANCE_GROUP]: {
    found: SECTION_FOUND.ROWS,
    rows: SECTION_ROWS.SCHEMA,
  },
  [SECTION.STARTUP]: {
    found: SECTION_FOUND.ROWS,
    rows: SECTION_ROWS.SCHEMA,
    head: "Startup",
  },
  [SECTION.DICTATION]: {
    found: SECTION_FOUND.ROWS,
    rows: SECTION_ROWS.SCHEMA,
    head: "Dictation",
  },
  [SECTION.EXPERIMENTS_WORKSPACE]: {
    found: SECTION_FOUND.HEAD,
    page: SETTINGS_VIEW.EXPERIMENTAL,
    headFor: (workspace) => ({
      text: `${EXPERIMENTS_WORKSPACE_LABEL}${workspace.name}`,
      maskedFrom: EXPERIMENTS_WORKSPACE_LABEL.length,
    }),
    words: "workspace team everyone members admins experiments",
    drawn: (input) => input.accountDrawn && workspaceShown(input),
  },
  [SECTION.EXPERIMENTS_ACCOUNT]: {
    found: SECTION_FOUND.HEAD,
    page: SETTINGS_VIEW.EXPERIMENTAL,
    head: "Just for you",
    words: "personal only me mine account experiments",
    drawn: accountDrawn,
  },
  [SECTION.SHORTCUTS_GROUP]: {
    found: SECTION_FOUND.ROWS,
    rows: SECTION_ROWS.SHORTCUTS,
  },
  [SECTION.SHORTCUTS_WRITING]: {
    found: SECTION_FOUND.ROWS,
    rows: SECTION_ROWS.SHORTCUTS,
    head: WRITING_GROUP_TITLE,
  },
  [SECTION.SHORTCUTS_FILES_CHANGED]: {
    found: SECTION_FOUND.ROWS,
    rows: SECTION_ROWS.SHORTCUTS,
    head: FILES_CHANGED_GROUP_TITLE,
  },
  [SECTION.SHORTCUTS_CHAPTERS]: {
    found: SECTION_FOUND.ROWS,
    rows: SECTION_ROWS.SHORTCUTS,
    head: CHAPTERS_GROUP_TITLE,
  },
} as const satisfies Record<SettingsSectionKey, SectionDeclaration>;

type Sections = typeof SETTINGS_SECTIONS;

/**
 * What a page names a section's head by beyond its key: the workspace a head
 * named for one is named by, or the name of the group a section found row by
 * row draws for each of its rows' groups.
 */
interface SectionNaming {
  readonly workspace?: Workspace;
  readonly group?: string | undefined;
}

/** What a section's head asks of the page beyond its key, as its declaration says. */
type HeadArguments<Key extends SettingsSectionKey> = Sections[Key] extends {
  readonly headFor: (workspace: Workspace) => SectionWords;
}
  ? [naming: { readonly workspace: Workspace }]
  : Sections[Key] extends { readonly head: string }
    ? []
    : [naming: { readonly group: string | undefined }];

/** A section's head as a Settings page spreads it onto its `SettingsSection`. */
export interface SettingsSectionHeadProps {
  readonly title: ReactNode;
  readonly anchor?: string;
}

const NO_NAMING: SectionNaming = {};

/** Words drawn as a head, a workspace's name in them masked in a screen recording. */
function drawnWords(words: SectionWords): ReactNode {
  if (words.maskedFrom === undefined) return words.text;

  return (
    <>
      {words.text.slice(0, words.maskedFrom)}
      <ReplayMask>{words.text.slice(words.maskedFrom)}</ReplayMask>
    </>
  );
}

/** The words a section found by its head is named by, read for the workspace it names. */
function headWords(section: HeadSection, workspace: Workspace | undefined): SectionWords {
  if (section.headFor === undefined) return { text: section.head };

  if (workspace === undefined) throw new Error("A workspace's section is named without one");

  return section.headFor(workspace);
}

/**
 * A section's head, which a Settings page spreads onto its `SettingsSection`:
 * its title, and for a section found by its head the anchor its result lands on.
 */
export function settingsSectionHead<Key extends SettingsSectionKey>(
  key: Key,
  ...given: HeadArguments<Key>
): SettingsSectionHeadProps;
export function settingsSectionHead(
  key: SettingsSectionKey,
  naming: SectionNaming = NO_NAMING,
): SettingsSectionHeadProps {
  const section: SectionDeclaration = SETTINGS_SECTIONS[key];

  if (section.found !== SECTION_FOUND.HEAD) return { title: section.head ?? naming.group };

  return { title: drawnWords(headWords(section, naming.workspace)), anchor: key };
}

/** Whether the page draws a section found by its head right now, judged as the search judges it. */
export function settingsSectionDrawn(key: SettingsSectionKey, input: SettingsSearchInput): boolean {
  const section: SectionDeclaration = SETTINGS_SECTIONS[key];

  return section.found !== SECTION_FOUND.HEAD || section.drawn(input);
}

/** The search's result for each section found by its head that the pages draw right now, in the order they draw them. */
export function settingsSectionEntries(input: SettingsSearchInput): readonly SettingsSearchEntry[] {
  return Object.entries(SETTINGS_SECTIONS).flatMap(([key, each]): SettingsSearchEntry[] => {
    const section: SectionDeclaration = each;

    if (section.found !== SECTION_FOUND.HEAD || !section.drawn(input)) return [];

    const head = headWords(section, input.workspace);
    const label = section.label === undefined ? head : { text: section.label };

    const entry: SettingsSearchEntry = {
      id: key,
      label: label.text,
      page: section.page,
      haystack: [label.text, ...(head.text === label.text ? [] : [head.text]), section.words],
    };

    if (label.maskedFrom !== undefined) entry.replayMaskedFrom = label.maskedFrom;

    return [entry];
  });
}
