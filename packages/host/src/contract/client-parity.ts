/**
 * client-parity.ts -- whether the desktop, the web, and the iOS app each offer what an act does, and why where one does not, so a client's gap is chosen rather than left by accident.
 *
 * The three clients run the one host (`compose-host.ts`) and answer the one
 * act port, but each offers its member a different share of it; the rows
 * below hold what each client offers. Nothing else says which share, so this
 * table is what keeps the gaps known: every kind in `PORT_ACT_KIND` has a
 * row, and a kind added without one, or a row whose act is gone, does not
 * build. A client offers an act where a member can do what the act does
 * there, though the client may reach it another way; a client that does not
 * names why. `NOT_YET` is the backlog, a row a client's next screen
 * replaces; `BY_DESIGN` is a gap the platform makes, such as a shell on the
 * Mac from a phone, which no screen would close. `client-parity.test.ts`
 * holds the iOS column to the platform kinds the iOS host refuses.
 */

import { PORT_ACT_KIND, type PortActKind } from "./kinds.js";

/** Why a client does not offer an act. */
const CLIENT_GAP = {
  /** Not built in that client yet: the screen that offers it would replace the gap. */
  NOT_YET: "not-yet",
  /** The platform has no place for it, or offers it another way than the act. */
  BY_DESIGN: "by-design",
} as const;

type ClientGap = (typeof CLIENT_GAP)[keyof typeof CLIENT_GAP];

/** A client offers the act. */
const YES = { offered: true } as const;

/** A client does not offer the act, and why. */
interface ClientGapCell {
  readonly offered: false;
  readonly gap: ClientGap;
  readonly why: string;
}

type ClientCell = typeof YES | ClientGapCell;

/** One act's row: what each client offers of it. */
interface ClientParityRow {
  readonly desktop: ClientCell;
  readonly web: ClientCell;
  readonly ios: ClientCell;
}

const notYet = (why: string): ClientGapCell => ({ offered: false, gap: CLIENT_GAP.NOT_YET, why });

const byDesign = (why: string): ClientGapCell => ({
  offered: false,
  gap: CLIENT_GAP.BY_DESIGN,
  why,
});

/** The web's gaps, each the reason a browser tab cannot carry the act or carries it its own way. */
const WEB = {
  COMPUTER_USE: byDesign(
    "Agents use apps on the Mac through its own helper, which a tab cannot run",
  ),
  CLI: byDesign(
    "A tab cannot run the install script; the MCP & CLI page shows the command to paste",
  ),
  HANDOFF: byDesign(
    "A browser tab cannot advertise a Handoff activity; Safari hands off its own page",
  ),
  LIVE_VIEW: byDesign(
    "The tab opens a Browser tab's live view socket itself (web-browser-live.ts)",
  ),
  MAC: byDesign("Reaches the Mac's own shells, loopback, or Terminal, which a tab cannot"),
  MACHINE_COMMAND: byDesign("run_on_mac asks the Mac the command runs on, which is the desktop"),
  MAC_PHOTO: byDesign(
    "A tab cannot run sips; Safari decodes a HEIC itself, and another browser says to export it as JPEG",
  ),
  MAC_RESOURCES: byDesign("A tab cannot read the Mac's process table"),
  MENU_BAR: byDesign("A browser has no menu bar to dim"),
  MICROPHONE: byDesign("The browser asks for the microphone and picks its route itself"),
  NOTIFICATIONS: byDesign("The browser's own prompt asks for notifications"),
  TAB_SWITCHER: byDesign("⌃Tab's card previews are the desktop app's"),
  UNSAVED_WORK: byDesign("The tab's own leave prompt holds unsaved work (page-leave.ts)"),
  UPDATER: byDesign("A tab loads the latest deploy itself"),
} as const;

/** The iOS app's gaps, each named for the pull request or wave that would close it, or the reason none will. */
const IOS = {
  ADMIN: byDesign("iOS v1 opens the admin dashboard in Safari"),
  AGENT_TAB_DOT: byDesign(
    "An agent's unseen dot marks the desktop's and the web's tab strip, which the phone has none of; a failed run reaches the phone as a push, and a running one as its Live Activity",
  ),
  RUN_ON_MAC_STANDING: byDesign(
    "Whether run_on_mac is on for an agent is the desktop's Runs on card's to say, about the Mac its commands would run on",
  ),
  AGENT_SESSION: notYet(
    "iOS's agent page leaves a rewind, a fresh session, and a restart of the agent's machine to the desktop and the web for now",
  ),
  AUTOMATIONS: byDesign("iOS v1 leaves Automations to the desktop and the web"),
  COPY_PICTURE: byDesign(
    "iOS copies a picture to the system's pasteboard itself (expo-clipboard), from its long press or the viewer's share button",
  ),
  COPY_RICH: byDesign(
    "iOS copies a draft card's message to the system's pasteboard itself, as rich text and plain words (expo-clipboard)",
  ),
  PASTEBOARD: byDesign("iOS copies to the system's pasteboard itself (expo-clipboard)"),
  SAVE_FILE: byDesign(
    "iOS saves a file from its long press through the system's share sheet (Save to Files), and a picture or a recording to Photos",
  ),
  DESKTOP_ONLY: byDesign("A desktop-only platform concern, refused by the iOS host"),
  DESK_TOOLS: byDesign("iOS v1 leaves the terminal and the live view to the desktop and the web"),
  DICTATION: byDesign("iOS uses the keyboard's own dictation"),
  DIFF: byDesign("iOS v1 opens the diff on GitHub"),
  CHANGELOG: byDesign("iOS opens the changelog in its own Safari sheet (Settings › What's new)"),
  CONTACT_MAIL: byDesign("iOS writes the contact mail itself through openURL (Settings › Email)"),
  LINKS: byDesign("iOS opens a link through the system itself (openURL)"),
  HOSTS_STANDING: byDesign(
    "iOS reads where a machine stands from the hosts read (hostStanding), as the panel's Machines page does",
  ),
  HOVER: byDesign("A finger has no pointer to rest on a link, so no card hangs from one"),
  HANDOFF: byDesign("iOS advertises each screen's activity itself (use-system-activity.ts)"),
  MACHINE_COMMAND: byDesign("run_on_mac asks the Mac the command runs on, which is the desktop"),
  FOLLOWERS: notYet(
    "iOS's Following sheet adds a follower but leaves taking one away to the desktop and the web for now",
  ),
  MENTION_APPS: notYet(
    "iOS's composers offer skills after a `/` and no `@` list yet, so no app is offered to mention",
  ),
  MERGE_QUEUE: notYet("iOS leaves the Merge queue page to the desktop and the web for now"),
  MENU_BAR: byDesign("iOS has no menu bar to dim"),
  NOTIFICATIONS: byDesign("iOS's Settings screen opens the system's settings itself"),
  ONE_SCREEN: byDesign("The app is one screen, with no panel to bring forward or preview"),
  PRESENCE: byDesign("The phone isn't a desk; presence comes from the desktop and the web only"),
  SETTINGS: byDesign("iOS's Settings opens this page on vespin.dev in Safari"),
  SIGN_IN_SHEET: byDesign("The system's authentication sheet cancels its own sign-in"),
  SOUNDS: byDesign("The phone plays only its push sound, never the account's chosen sounds"),
  TASKS: notYet("iOS v1's Tasks tab and task page don't offer this yet"),
  ACTIVE_TASK: byDesign(
    "iOS follows each open task's description by its id (TASKS_DOCUMENT_FOLLOW), so it has no one active task to select or leave",
  ),
  CODE_COLOR: byDesign(
    "iOS's host colors no code (compose-mobile.ts answers plainCodeLines), so a fenced block draws plain in mono",
  ),
  DESCRIPTION_EDIT: byDesign(
    "iOS reads a description and comments on it; editing it, and the pictures an edit adds, stay on the desktop and the web",
  ),
  PAGE_SOURCE: byDesign(
    "iOS draws a page in its sealed view; the page tab's source view is the desktop's and the web's",
  ),
  REPOSITORY_FILES: byDesign(
    "iOS opens a repository's files on GitHub, as it does the diff; it has no File tab",
  ),
  REPOSITORY_PINS: byDesign(
    "iOS's Tasks lists sections, not repositories, so it has no repository list to pin in",
  ),
  UPDATER: byDesign("The App Store updates the app"),
} as const;

/** A phone's own push registration, which a desktop or a browser tab has no APNs token for. */
const PHONE_PUSH = byDesign("Only a phone takes pushes; a desktop or web client has no APNs token");

/** Offered by the iOS app alone, the desktop and the web having no place for it. */
const PHONE_ONLY: ClientParityRow = { desktop: PHONE_PUSH, web: PHONE_PUSH, ios: YES };

/** The panel draws a page in a frame of the service's, so it never reads the page's HTML itself. */
const PANEL_PAGE_FRAME = byDesign("The panel frames a page through the service (pageFrameUrl)");

/** Offered by every client. */
const EVERYWHERE: ClientParityRow = { desktop: YES, web: YES, ios: YES };

/** Offered by the desktop and the web, with the iOS app's gap. */
const panel = (ios: ClientGapCell): ClientParityRow => ({ desktop: YES, web: YES, ios });

/** Offered by the desktop alone, with the web's gap and the iOS app's. */
const desktopOnly = (web: ClientGapCell, ios: ClientGapCell): ClientParityRow => ({
  desktop: YES,
  web,
  ios,
});

/** Each act's row, in the order of `PORT_ACT_KIND`'s spreads. */
export const CLIENT_PARITY = {
  [PORT_ACT_KIND.ACCOUNT_BEGIN_SIGN_IN]: EVERYWHERE,
  [PORT_ACT_KIND.ACCOUNT_SIGN_IN_AGAIN]: panel(
    notYet("iOS v1 signs in again from its sign-in screen"),
  ),
  [PORT_ACT_KIND.ACCOUNT_CANCEL_SIGN_IN]: panel(IOS.SIGN_IN_SHEET),
  [PORT_ACT_KIND.ACCOUNT_SIGN_OUT]: EVERYWHERE,
  [PORT_ACT_KIND.ACCOUNT_DELETE]: EVERYWHERE,
  [PORT_ACT_KIND.ACCOUNT_SUPPORT_ACCESS]: EVERYWHERE,

  [PORT_ACT_KIND.PROVIDER_KEYS_FOLLOW]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.PROVIDER_KEYS_RETRY]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.PROVIDER_KEYS_SAVE]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.PROVIDER_KEYS_REMOVE]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.PROVIDER_KEYS_FOR_AGENTS]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.PROVIDER_KEYS_USE_RESET_CREDIT]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.SUBSCRIPTION_RENAME]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.SUBSCRIPTIONS_REORDER]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.CHATGPT_DEVICE_START]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.CHATGPT_DEVICE_WAIT]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.CHATGPT_DEVICE_CANCEL]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.GITHUB_TOKEN_FOLLOW]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.GITHUB_TOKEN_RETRY]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.GITHUB_TOKEN_SAVE]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.GITHUB_TOKEN_REMOVE]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.ALLOWED_COMMANDS_FOLLOW]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.ALLOWED_COMMANDS_RETRY]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.ALLOWED_COMMANDS_WRITE]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.MEMORIES_FOLLOW]: EVERYWHERE,
  [PORT_ACT_KIND.MEMORIES_RETRY]: EVERYWHERE,
  [PORT_ACT_KIND.MEMORIES_FORGET]: EVERYWHERE,
  [PORT_ACT_KIND.MEMORIES_SAVE]: EVERYWHERE,
  [PORT_ACT_KIND.SOUND_READ]: panel(IOS.SOUNDS),
  [PORT_ACT_KIND.SOUND_ADD]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.SOUND_RENAME]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.SOUND_REMOVE]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.SOUND_CHOOSE]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.DICTATION_TRANSCRIBE]: panel(IOS.DICTATION),
  [PORT_ACT_KIND.ACCOUNT_ACTIVE]: panel(IOS.PRESENCE),
  [PORT_ACT_KIND.PUSH_DEVICE_REGISTER]: PHONE_ONLY,
  [PORT_ACT_KIND.PUSH_DEVICE_UNREGISTER]: PHONE_ONLY,
  [PORT_ACT_KIND.PUSH_DEVICE_STATUS]: PHONE_ONLY,
  [PORT_ACT_KIND.PUSH_DEVICE_NOTIFY]: PHONE_ONLY,
  [PORT_ACT_KIND.LIVE_ACTIVITY_START_TOKEN]: PHONE_ONLY,
  [PORT_ACT_KIND.LIVE_ACTIVITY_TOKEN]: PHONE_ONLY,
  [PORT_ACT_KIND.LIVE_ACTIVITY_ENDED]: PHONE_ONLY,

  [PORT_ACT_KIND.AGENTS_MODELS_FOLLOW]: EVERYWHERE,
  [PORT_ACT_KIND.AGENTS_MODELS_RETRY]: EVERYWHERE,
  [PORT_ACT_KIND.AGENTS_DEFAULT_WRITE]: EVERYWHERE,
  [PORT_ACT_KIND.AGENTS_CHAPTERS_PROVIDER_WRITE]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.AGENTS_PREFERENCES_RETRY]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.HOSTS_FOLLOW]: EVERYWHERE,
  [PORT_ACT_KIND.HOSTS_RETRY]: EVERYWHERE,
  [PORT_ACT_KIND.HOSTS_PRESENCE_FOLLOW]: panel(IOS.HOSTS_STANDING),
  [PORT_ACT_KIND.HOSTS_PRESENCE_REFRESH]: panel(IOS.HOSTS_STANDING),
  [PORT_ACT_KIND.HOSTS_REMOVE]: EVERYWHERE,
  [PORT_ACT_KIND.HOSTS_THIS_MAC_SET]: desktopOnly(
    byDesign("Runs agents on the Mac the app is on, which a tab is not"),
    byDesign("Runs agents on the Mac the app is on, which a phone is not"),
  ),
  [PORT_ACT_KIND.HOSTS_ALLOWED_APPS]: panel(IOS.MENTION_APPS),
  [PORT_ACT_KIND.HOSTS_PAIRING_READ]: EVERYWHERE,
  [PORT_ACT_KIND.HOSTS_PAIRING_APPROVE]: EVERYWHERE,
  [PORT_ACT_KIND.HOSTS_PAIRING_DENY]: EVERYWHERE,
  [PORT_ACT_KIND.AGENTS_LIST]: EVERYWHERE,
  [PORT_ACT_KIND.AGENTS_WORKSPACE_LIST]: panel(IOS.AUTOMATIONS),
  [PORT_ACT_KIND.AGENTS_START]: EVERYWHERE,
  [PORT_ACT_KIND.AGENTS_MESSAGES]: EVERYWHERE,
  [PORT_ACT_KIND.AGENTS_TRANSCRIPT]: EVERYWHERE,
  [PORT_ACT_KIND.AGENTS_TRANSCRIPT_RETRY]: EVERYWHERE,
  [PORT_ACT_KIND.AGENTS_PART]: EVERYWHERE,
  [PORT_ACT_KIND.AGENTS_TRANSCRIPT_OLDER]: EVERYWHERE,
  [PORT_ACT_KIND.AGENTS_MESSAGE]: EVERYWHERE,
  [PORT_ACT_KIND.AGENTS_CHOOSE]: EVERYWHERE,
  [PORT_ACT_KIND.AGENTS_RENAME]: EVERYWHERE,
  [PORT_ACT_KIND.AGENTS_SERVERS]: EVERYWHERE,
  [PORT_ACT_KIND.AGENTS_PERMISSION_MODE]: EVERYWHERE,
  [PORT_ACT_KIND.AGENTS_ANSWER_APPROVAL]: EVERYWHERE,
  [PORT_ACT_KIND.AGENTS_QUEUE]: EVERYWHERE,
  [PORT_ACT_KIND.AGENTS_STOP]: EVERYWHERE,
  [PORT_ACT_KIND.AGENTS_REWIND]: panel(IOS.AGENT_SESSION),
  [PORT_ACT_KIND.AGENTS_CLEAR]: panel(IOS.AGENT_SESSION),
  [PORT_ACT_KIND.AGENTS_BOOT]: panel(IOS.AGENT_SESSION),
  [PORT_ACT_KIND.AGENTS_WARM]: EVERYWHERE,
  [PORT_ACT_KIND.AGENTS_UNSEND]: EVERYWHERE,
  [PORT_ACT_KIND.AGENTS_REPLY_BUTTON]: EVERYWHERE,
  [PORT_ACT_KIND.AGENTS_REPLY_BUTTON_PRESS]: EVERYWHERE,
  [PORT_ACT_KIND.AGENTS_PORTS]: EVERYWHERE,
  [PORT_ACT_KIND.AGENTS_PORT_SHARED]: EVERYWHERE,
  [PORT_ACT_KIND.AGENTS_PORT_SHARE]: EVERYWHERE,
  [PORT_ACT_KIND.AGENTS_PORT_UNSHARE]: EVERYWHERE,
  [PORT_ACT_KIND.AGENTS_RUN_ACTION]: EVERYWHERE,
  [PORT_ACT_KIND.AGENTS_RUN_ACTION_STOP]: EVERYWHERE,
  [PORT_ACT_KIND.AGENTS_ARCHIVE]: EVERYWHERE,
  [PORT_ACT_KIND.AGENTS_PIN]: EVERYWHERE,
  [PORT_ACT_KIND.AGENTS_DELETE]: EVERYWHERE,
  [PORT_ACT_KIND.AGENTS_SHOWN]: panel(IOS.AGENT_TAB_DOT),
  [PORT_ACT_KIND.AGENTS_SEEN]: panel(IOS.AGENT_TAB_DOT),
  [PORT_ACT_KIND.AGENTS_PAGE]: EVERYWHERE,
  [PORT_ACT_KIND.AGENTS_ORIGIN_FOLLOW]: EVERYWHERE,
  [PORT_ACT_KIND.AGENTS_ORIGIN_RETRY]: EVERYWHERE,
  [PORT_ACT_KIND.AGENTS_PULL_REQUEST_PART_FOLLOW]: EVERYWHERE,
  [PORT_ACT_KIND.AGENTS_PULL_REQUEST_PART_RETRY]: EVERYWHERE,
  [PORT_ACT_KIND.AGENTS_CHANGES]: panel(IOS.DIFF),
  [PORT_ACT_KIND.AGENTS_TURN_CHANGES]: panel(IOS.DIFF),
  [PORT_ACT_KIND.AGENTS_WORKSPACE_TOOLS_FOLLOW]: panel(IOS.RUN_ON_MAC_STANDING),
  [PORT_ACT_KIND.AGENTS_WORKSPACE_TOOLS_RETRY]: panel(IOS.RUN_ON_MAC_STANDING),
  [PORT_ACT_KIND.AGENTS_GITHUB_IMAGE]: panel(IOS.DIFF),
  [PORT_ACT_KIND.AGENTS_PULL_REQUEST_ACTION]: EVERYWHERE,

  [PORT_ACT_KIND.AGENTS_INBOX_FOLLOW]: EVERYWHERE,
  [PORT_ACT_KIND.AGENTS_INBOX_RETRY]: EVERYWHERE,
  [PORT_ACT_KIND.AGENTS_INBOX_ITEMS_RETRY]: EVERYWHERE,
  [PORT_ACT_KIND.AGENTS_INBOX_ANSWER]: EVERYWHERE,
  [PORT_ACT_KIND.AGENTS_INBOX_CLOSE]: EVERYWHERE,
  [PORT_ACT_KIND.AGENTS_INBOX_TAKE_BACK]: EVERYWHERE,
  [PORT_ACT_KIND.AGENTS_INBOX_MESSAGE]: EVERYWHERE,
  [PORT_ACT_KIND.AGENTS_INBOX_START]: EVERYWHERE,
  [PORT_ACT_KIND.AGENTS_INBOX_READ_STATE]: EVERYWHERE,
  [PORT_ACT_KIND.AGENTS_INBOX_REMIND]: EVERYWHERE,
  [PORT_ACT_KIND.AGENTS_INBOX_ITEM_HOME]: EVERYWHERE,
  [PORT_ACT_KIND.AGENTS_INBOX_READ_ALL]: EVERYWHERE,
  [PORT_ACT_KIND.AGENTS_INBOX_ATTACHMENT]: EVERYWHERE,
  [PORT_ACT_KIND.AGENTS_PICTURE]: EVERYWHERE,

  [PORT_ACT_KIND.AUTOMATIONS_CREATE]: panel(IOS.AUTOMATIONS),
  [PORT_ACT_KIND.AUTOMATIONS_CHANGE]: panel(IOS.AUTOMATIONS),
  [PORT_ACT_KIND.AUTOMATIONS_DELETE]: panel(IOS.AUTOMATIONS),
  [PORT_ACT_KIND.AUTOMATIONS_RUN]: panel(IOS.AUTOMATIONS),
  [PORT_ACT_KIND.AUTOMATIONS_NEW_WEBHOOK_SECRET]: panel(IOS.AUTOMATIONS),
  [PORT_ACT_KIND.AUTOMATIONS_FOLLOW]: panel(IOS.AUTOMATIONS),
  [PORT_ACT_KIND.AUTOMATIONS_RETRY]: panel(IOS.AUTOMATIONS),

  [PORT_ACT_KIND.BROWSER_LIVE_ATTACH]: desktopOnly(WEB.LIVE_VIEW, IOS.DESK_TOOLS),
  [PORT_ACT_KIND.BROWSER_LIVE_DETACH]: desktopOnly(WEB.LIVE_VIEW, IOS.DESK_TOOLS),

  [PORT_ACT_KIND.CHAPTERS_FOLLOW]: panel(IOS.DIFF),
  [PORT_ACT_KIND.CHAPTERS_RETRY]: panel(IOS.DIFF),
  [PORT_ACT_KIND.CHAPTERS_GENERATE]: panel(IOS.DIFF),

  [PORT_ACT_KIND.CLI_INSTALL]: desktopOnly(WEB.CLI, IOS.DESKTOP_ONLY),

  [PORT_ACT_KIND.INSTALLED_SKILLS_FOLLOW]: EVERYWHERE,
  [PORT_ACT_KIND.INSTALLED_SKILLS_RETRY]: EVERYWHERE,
  [PORT_ACT_KIND.INSTALLED_SKILLS_READ]: EVERYWHERE,
  [PORT_ACT_KIND.INSTALLED_SKILLS_PREVIEW]: EVERYWHERE,
  [PORT_ACT_KIND.INSTALLED_SKILLS_INSTALL]: EVERYWHERE,
  [PORT_ACT_KIND.INSTALLED_SKILLS_REMOVE]: EVERYWHERE,

  [PORT_ACT_KIND.INTEGRATIONS_FOLLOW]: EVERYWHERE,
  [PORT_ACT_KIND.INTEGRATIONS_RETRY]: EVERYWHERE,
  [PORT_ACT_KIND.INTEGRATIONS_CONNECT]: EVERYWHERE,
  [PORT_ACT_KIND.INTEGRATIONS_CANCEL]: EVERYWHERE,
  [PORT_ACT_KIND.INTEGRATIONS_DISCONNECT]: EVERYWHERE,
  [PORT_ACT_KIND.INTEGRATIONS_TOOLS_FOLLOW]: EVERYWHERE,
  [PORT_ACT_KIND.INTEGRATIONS_TOOLS_RETRY]: EVERYWHERE,
  [PORT_ACT_KIND.INTEGRATIONS_RENAME]: EVERYWHERE,
  [PORT_ACT_KIND.MCP_CLIENTS_FOLLOW]: EVERYWHERE,
  [PORT_ACT_KIND.MCP_CLIENTS_RETRY]: EVERYWHERE,
  [PORT_ACT_KIND.MCP_CLIENTS_REVOKE]: EVERYWHERE,

  [PORT_ACT_KIND.MACHINE_COMMAND_ANSWER]: desktopOnly(WEB.MACHINE_COMMAND, IOS.MACHINE_COMMAND),
  [PORT_ACT_KIND.COMPUTER_USE_STATUS]: desktopOnly(WEB.COMPUTER_USE, IOS.DESKTOP_ONLY),
  [PORT_ACT_KIND.COMPUTER_USE_APPS]: desktopOnly(WEB.COMPUTER_USE, IOS.DESKTOP_ONLY),
  [PORT_ACT_KIND.COMPUTER_USE_APP_ICON]: desktopOnly(WEB.COMPUTER_USE, IOS.DESKTOP_ONLY),
  [PORT_ACT_KIND.COMPUTER_USE_ASK_PERMISSIONS]: desktopOnly(WEB.COMPUTER_USE, IOS.DESKTOP_ONLY),

  [PORT_ACT_KIND.MAC_PHOTO_TO_JPEG]: desktopOnly(WEB.MAC_PHOTO, IOS.DESKTOP_ONLY),

  [PORT_ACT_KIND.MAC_RESOURCES_READ]: desktopOnly(WEB.MAC_RESOURCES, IOS.DESKTOP_ONLY),

  [PORT_ACT_KIND.MAC_SHELL_MIRROR]: desktopOnly(WEB.MAC, IOS.DESKTOP_ONLY),
  [PORT_ACT_KIND.MAC_SHELL_OPEN]: desktopOnly(WEB.MAC, IOS.DESKTOP_ONLY),
  [PORT_ACT_KIND.MAC_SHELL_ATTACH]: desktopOnly(WEB.MAC, IOS.DESKTOP_ONLY),
  [PORT_ACT_KIND.MAC_SHELL_CLOSE]: desktopOnly(WEB.MAC, IOS.DESKTOP_ONLY),
  [PORT_ACT_KIND.MAC_SHELL_RUN_ACTION]: desktopOnly(WEB.MAC, IOS.DESKTOP_ONLY),
  [PORT_ACT_KIND.MAC_SHELL_STOP_ACTION]: desktopOnly(WEB.MAC, IOS.DESKTOP_ONLY),
  [PORT_ACT_KIND.MAC_SHELL_ACTIONS]: desktopOnly(WEB.MAC, IOS.DESKTOP_ONLY),

  [PORT_ACT_KIND.MAC_TERMINAL_LOCAL_AGENT]: desktopOnly(WEB.MAC, IOS.DESKTOP_ONLY),

  [PORT_ACT_KIND.MAC_APP_SHOW]: desktopOnly(WEB.COMPUTER_USE, IOS.DESKTOP_ONLY),

  [PORT_ACT_KIND.PORT_FORWARD_SET]: desktopOnly(WEB.MAC, IOS.DESKTOP_ONLY),
  [PORT_ACT_KIND.PORT_SHARE_SET]: desktopOnly(WEB.MAC, IOS.DESKTOP_ONLY),

  [PORT_ACT_KIND.SETTING_UPDATE]: EVERYWHERE,
  [PORT_ACT_KIND.SETTINGS_RESET]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.EXPERIMENT_SET]: panel(IOS.SETTINGS),

  [PORT_ACT_KIND.TASKS_REFRESH]: EVERYWHERE,
  [PORT_ACT_KIND.TASKS_SELECT]: panel(IOS.ACTIVE_TASK),
  [PORT_ACT_KIND.TASKS_CLOSE]: panel(IOS.ACTIVE_TASK),
  [PORT_ACT_KIND.TASKS_OFFLINE_REFUSED_CLEAR]: EVERYWHERE,
  [PORT_ACT_KIND.TASKS_START]: EVERYWHERE,
  [PORT_ACT_KIND.TASKS_DELETE]: EVERYWHERE,
  [PORT_ACT_KIND.TASKS_RENAME]: EVERYWHERE,
  [PORT_ACT_KIND.TASKS_PIN]: EVERYWHERE,
  [PORT_ACT_KIND.TASKS_MARK_READ]: EVERYWHERE,
  [PORT_ACT_KIND.TASKS_PIN_REPOSITORY]: panel(IOS.REPOSITORY_PINS),
  [PORT_ACT_KIND.TASKS_WRITE_SECTION]: EVERYWHERE,
  [PORT_ACT_KIND.TASKS_REPOSITORIES_FOLLOW]: EVERYWHERE,
  [PORT_ACT_KIND.TASKS_REPOSITORIES_RETRY]: EVERYWHERE,
  [PORT_ACT_KIND.TASKS_SET_REPOSITORY]: EVERYWHERE,
  [PORT_ACT_KIND.TASKS_MOVE]: EVERYWHERE,
  [PORT_ACT_KIND.TASKS_BLOCK]: EVERYWHERE,
  [PORT_ACT_KIND.TASKS_SET_PARENT]: EVERYWHERE,
  [PORT_ACT_KIND.TASKS_CHANGE_RELATION]: EVERYWHERE,
  [PORT_ACT_KIND.TASKS_EDIT]: panel(IOS.DESCRIPTION_EDIT),
  [PORT_ACT_KIND.TASKS_FOLLOW]: EVERYWHERE,
  [PORT_ACT_KIND.TASKS_UNFOLLOW]: EVERYWHERE,
  [PORT_ACT_KIND.TASKS_SET_FOLLOWER_MACHINES]: EVERYWHERE,
  [PORT_ACT_KIND.TASKS_ADD_FOLLOWER]: EVERYWHERE,
  [PORT_ACT_KIND.TASKS_REMOVE_FOLLOWER]: panel(IOS.FOLLOWERS),
  [PORT_ACT_KIND.GITHUB_OPEN]: panel(IOS.LINKS),
  [PORT_ACT_KIND.WEB_OPEN]: panel(IOS.LINKS),
  [PORT_ACT_KIND.GITHUB_CONNECT]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.ADMIN_OPEN]: panel(IOS.ADMIN),
  [PORT_ACT_KIND.ADMIN_READ]: panel(IOS.ADMIN),
  [PORT_ACT_KIND.ADMIN_FAVORITE]: panel(IOS.ADMIN),
  [PORT_ACT_KIND.GITHUB_DISCONNECT]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.TASKS_SET_STANDING]: EVERYWHERE,
  [PORT_ACT_KIND.TASKS_FILE]: panel(IOS.REPOSITORY_FILES),
  [PORT_ACT_KIND.TASKS_TREE]: panel(IOS.REPOSITORY_FILES),
  [PORT_ACT_KIND.TASKS_SKILLS]: EVERYWHERE,
  [PORT_ACT_KIND.TASKS_LINK_STANDING_FOLLOW]: EVERYWHERE,
  [PORT_ACT_KIND.TASKS_LINK_PREVIEW]: panel(IOS.HOVER),
  [PORT_ACT_KIND.TASKS_BROWSER_TAB_OPEN]: panel(IOS.DESK_TOOLS),
  [PORT_ACT_KIND.TASKS_BROWSER_TABS_FOLLOW]: panel(IOS.DESK_TOOLS),
  [PORT_ACT_KIND.TASKS_COLOR_CODE]: panel(IOS.CODE_COLOR),
  [PORT_ACT_KIND.TASKS_FIND]: EVERYWHERE,
  [PORT_ACT_KIND.TASKS_REVISIONS]: EVERYWHERE,
  [PORT_ACT_KIND.TASKS_REVISION]: EVERYWHERE,
  [PORT_ACT_KIND.TASKS_RESTORE]: EVERYWHERE,
  [PORT_ACT_KIND.TASKS_PAGE_SOURCE]: panel(IOS.PAGE_SOURCE),
  [PORT_ACT_KIND.TASKS_PAGE_HTML]: {
    desktop: PANEL_PAGE_FRAME,
    web: PANEL_PAGE_FRAME,
    ios: YES,
  },
  [PORT_ACT_KIND.TASKS_PAGES_FOLLOW]: EVERYWHERE,
  [PORT_ACT_KIND.TASKS_DOCUMENT_FOLLOW]: EVERYWHERE,
  [PORT_ACT_KIND.TASKS_DOCUMENT_RETRY]: EVERYWHERE,
  [PORT_ACT_KIND.TASKS_HISTORY_FOLLOW]: EVERYWHERE,
  [PORT_ACT_KIND.TASKS_HISTORY_RETRY]: EVERYWHERE,
  [PORT_ACT_KIND.TASKS_PICTURE_READ]: EVERYWHERE,
  [PORT_ACT_KIND.TASKS_PICTURE_KEEP]: panel(IOS.DESCRIPTION_EDIT),
  [PORT_ACT_KIND.TASKS_COMMENTS_FOLLOW]: EVERYWHERE,
  [PORT_ACT_KIND.TASKS_COMMENTS_RETRY]: EVERYWHERE,
  [PORT_ACT_KIND.TASKS_COMMENT_START]: EVERYWHERE,
  [PORT_ACT_KIND.TASKS_COMMENT_ACT]: EVERYWHERE,

  [PORT_ACT_KIND.TERMINAL_LIST]: panel(IOS.DESK_TOOLS),
  [PORT_ACT_KIND.TERMINAL_CREATE]: panel(IOS.DESK_TOOLS),
  [PORT_ACT_KIND.TERMINAL_RENAME]: panel(IOS.DESK_TOOLS),
  [PORT_ACT_KIND.TERMINAL_KILL]: panel(IOS.DESK_TOOLS),
  [PORT_ACT_KIND.TERMINAL_RESUME]: panel(IOS.DESK_TOOLS),
  [PORT_ACT_KIND.TERMINAL_ATTACH]: panel(IOS.DESK_TOOLS),

  [PORT_ACT_KIND.UPDATE_CHECK]: desktopOnly(WEB.UPDATER, IOS.UPDATER),
  [PORT_ACT_KIND.UPDATE_INSTALL]: desktopOnly(WEB.UPDATER, IOS.UPDATER),
  [PORT_ACT_KIND.UPDATE_MOVE_TO_APPLICATIONS]: desktopOnly(WEB.UPDATER, IOS.UPDATER),
  [PORT_ACT_KIND.UPDATE_OPEN_RELEASE]: desktopOnly(WEB.UPDATER, IOS.UPDATER),
  [PORT_ACT_KIND.UPDATE_OPEN_CHANGELOG]: desktopOnly(WEB.UPDATER, IOS.CHANGELOG),

  [PORT_ACT_KIND.MICROPHONE_REQUEST]: desktopOnly(WEB.MICROPHONE, IOS.DICTATION),
  [PORT_ACT_KIND.MICROPHONE_ROUTE]: desktopOnly(WEB.MICROPHONE, IOS.DICTATION),
  [PORT_ACT_KIND.MICROPHONE_OPEN_SETTINGS]: desktopOnly(WEB.MICROPHONE, IOS.DICTATION),
  [PORT_ACT_KIND.NOTIFICATIONS_OPEN_SETTINGS]: desktopOnly(WEB.NOTIFICATIONS, IOS.NOTIFICATIONS),
  [PORT_ACT_KIND.LOGIN_ITEMS_OPEN_SETTINGS]: desktopOnly(
    byDesign("Allows the host the app carries on the Mac it is on, which a tab is not"),
    byDesign("Allows the host the app carries on the Mac it is on, which a phone is not"),
  ),
  [PORT_ACT_KIND.CONTACT_EMAIL]: panel(IOS.CONTACT_MAIL),
  [PORT_ACT_KIND.WINDOW_FOCUS_PANEL]: panel(IOS.ONE_SCREEN),
  [PORT_ACT_KIND.WINDOW_COPY_TEXT]: panel(IOS.PASTEBOARD),
  [PORT_ACT_KIND.WINDOW_COPY_IMAGE]: panel(IOS.COPY_PICTURE),
  [PORT_ACT_KIND.WINDOW_COPY_RICH]: panel(IOS.COPY_RICH),
  [PORT_ACT_KIND.WINDOW_SAVE_FILE]: panel(IOS.SAVE_FILE),
  [PORT_ACT_KIND.WINDOW_CAPTURE]: desktopOnly(WEB.TAB_SWITCHER, IOS.ONE_SCREEN),
  [PORT_ACT_KIND.WINDOW_UNSAVED_WORK]: desktopOnly(
    WEB.UNSAVED_WORK,
    notYet("iOS v1 has no editor to hold unsaved work"),
  ),
  [PORT_ACT_KIND.WINDOW_MENU_OFFERS]: desktopOnly(WEB.MENU_BAR, IOS.MENU_BAR),
  [PORT_ACT_KIND.WINDOW_HANDOFF]: desktopOnly(WEB.HANDOFF, IOS.HANDOFF),
  [PORT_ACT_KIND.FEEDBACK_SEND]: EVERYWHERE,

  [PORT_ACT_KIND.WORKSPACE_CREATE]: EVERYWHERE,
  [PORT_ACT_KIND.WORKSPACE_RENAME]: EVERYWHERE,
  [PORT_ACT_KIND.WORKSPACE_EXPERIMENT_SET]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.WORKSPACE_INVITE]: EVERYWHERE,
  [PORT_ACT_KIND.WORKSPACE_INVITATION_CANCEL]: EVERYWHERE,
  [PORT_ACT_KIND.WORKSPACE_GITHUB_CONNECT]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.WORKSPACE_GITHUB_DISCONNECT]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.WORKSPACE_SENTRY_INSTALL]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.WORKSPACE_SENTRY_DISCONNECT]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.WORKSPACE_SLACK_BOT_CONNECT]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.WORKSPACE_SLACK_BOT_DISCONNECT]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.WORKSPACE_SLACK_BOT_NOTIFICATIONS]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.WORKSPACE_SLACK_BOT_REPOSITORY]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.WORKSPACE_SLACK_BOT_CHANNEL]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.WORKSPACE_MEMBERS_FOLLOW]: EVERYWHERE,
  [PORT_ACT_KIND.WORKSPACE_MEMBERS_RETRY]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.WORKSPACE_INTEGRATIONS_FOLLOW]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.WORKSPACE_INTEGRATIONS_RETRY]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.WORKSPACE_SLACK_CHANNELS_FOLLOW]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.WORKSPACE_SLACK_CHANNELS_RETRY]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.WORKSPACE_INVITATIONS_FOLLOW]: EVERYWHERE,
  [PORT_ACT_KIND.WORKSPACE_INVITATIONS_RETRY]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.WORKSPACE_MEMBER_REMOVE]: EVERYWHERE,
  [PORT_ACT_KIND.WORKSPACE_MEMBER_ROLE]: EVERYWHERE,
  [PORT_ACT_KIND.WORKSPACE_TRANSFER]: EVERYWHERE,
  [PORT_ACT_KIND.WORKSPACE_LEAVE]: EVERYWHERE,
  [PORT_ACT_KIND.WORKSPACE_DELETE]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.WORKSPACE_PHOTO_SET]: EVERYWHERE,
  [PORT_ACT_KIND.WORKSPACE_SLUG_SET]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.WORKSPACE_TOKEN_REPOSITORIES_FOLLOW]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.WORKSPACE_TOKEN_REPOSITORIES_RETRY]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.WORKSPACE_TOKEN_REPOSITORY_SET]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.WORKSPACE_ENVIRONMENT_LIST]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.WORKSPACE_ENVIRONMENT_PUT]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.WORKSPACE_ENVIRONMENT_DELETE]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.WORKSPACE_SANDBOX_SETUP_READ]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.WORKSPACE_INSTALL_SCRIPT_PUT]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.WORKSPACE_REPOSITORY_SETUP_PUT]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.WORKSPACE_RUN_ACTIONS_PUT]: panel(IOS.SETTINGS),
  [PORT_ACT_KIND.WORKSPACE_MERGE_QUEUE_READ]: panel(IOS.MERGE_QUEUE),
} as const satisfies Record<PortActKind, ClientParityRow>;
