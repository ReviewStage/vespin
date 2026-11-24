import { isRecord, isWireNumber, isWireString, type UnparsedWireValue } from "@repo/wire";
import {
  APP_PANEL_TAB,
  APP_SETTING_ID,
  type AppPanelTab,
  type AppSettingId,
} from "@repo/wire/app-settings";
import { Option, Schema } from "effect";
import {
  MIRROR_FAILURE,
  MIRROR_STEP,
  type MirrorFailure,
  type MirrorStep,
} from "../mirror-steps.js";
import { parseReleaseVersion } from "./release-version.js";

/**
 * What the desktop may count about its own use, and the one reader both sides
 * run over it. The rest of `@repo/features` holds the contracts for what our service
 * *answers*; this holds the contract for what the desktop *asks* it to record.
 *
 * The vocabulary is the privacy boundary, not a convention on top of one. An
 * event is a name from this file, and every property value is a member of an
 * `as const` set here, a rung on the session-count ladder, or a release
 * version — so a session title, a branch, a path, a prompt, or an
 * error line has no shape it could travel in. Nothing observed and nothing
 * typed or spoken can be expressed, and the reader below builds its output
 * from the allowlist rather than from the envelope, so a field cannot be
 * smuggled through by naming it.
 */

export const PRODUCT_EVENT = {
  APP_LAUNCH: "app:launch",
  APP_DAY_ACTIVE: "app:day_active",
  ACCOUNT_SIGN_IN: "account:sign_in",
  ACCOUNT_ACTION: "account:action",
  PANEL_TAB_CHANGE: "panel:tab_change",
  SETTINGS_VIEW_OPEN: "settings:view_open",
  SETTINGS_RESET: "settings:reset",
  SEARCH_OPEN: "search:open",
  SURFACE_OPEN: "surface:open",
  UPDATE_ACTION: "update:action",
  /** An update the Updates row drew as failed, a check's or an install's, by the kind of failure and the build it failed on. */
  UPDATE_FAIL: "update:fail",
  FEEDBACK_SEND: "feedback:send",
  VOICE_PERMISSION: "voice:permission",
  SETTING_UPDATE: "setting:update",
  EXPERIMENT_TOGGLE: "experiment:toggle",
  /** A step of a cloud agent's mirror on this Mac failed, counted once each time what failed changes. */
  MIRROR_FAIL: "mirror:fail",
  /** A cloud agent's mirror on this Mac heard its first header since the host started keeping it. */
  MIRROR_READY: "mirror:ready",
  /** A launch drew its first Inbox rows, counted once a launch by how long that took from the app's start, on a rung. */
  APP_READY: "app:ready",
  /** A reply sent on an Inbox thread stood in its thread, counted once a send by how long that took from the press, on a rung, and whether it carried pictures. */
  REPLY_DRAWN: "reply:drawn",
  /** A page pushed open on the iOS app, a thread, a task, or an agent, counted once an open by how long its push took to start and to stand and how long the JS thread was busy before it started, each on a rung of `productOpenMilliseconds`, its kind, whether it was the first of its kind since launch, and whether its data was held as it first drew. */
  OPEN_DRAWN: "open:drawn",
  /** A page an agent showed, opened on the iOS app, counted once an open by how long it took to read its HTML and to draw it, each on a rung of `productOpenMilliseconds`, whether its opener named its version or it waited on the task's pages for the newest, and whether it was the first page since launch. */
  PAGE_SHOWN: "page:shown",
  /** A picture an agent showed, drawn on the iOS app, counted once a read by how long it took from the page asking for it to its file in hand, on a rung of `productOpenMilliseconds`, whether it came from the phone's own copy or was read through the service, its kind, and its size on a rung. */
  PICTURE_SHOWN: "picture:shown",
} as const;

export type ProductEventName = (typeof PRODUCT_EVENT)[keyof typeof PRODUCT_EVENT];

export const ProductEventNameSchema = Schema.Literals(Object.values(PRODUCT_EVENT));

/**
 * The events the renderer may ask the main process to count, and the whole of
 * what the surface channel carries. Everything else is emitted where the action
 * itself happens, in the main process; these are surface motion the main
 * process cannot see — which tab is drawn, which page a row opened, whether a
 * search field was summoned. Keeping the set small and separate is what makes
 * the channel narrow: the handler validates against this union rather than
 * against every name, so a compromised renderer gains no reach into the actions.
 */
export const PRODUCT_SURFACE_EVENT = {
  PANEL_TAB_CHANGE: PRODUCT_EVENT.PANEL_TAB_CHANGE,
  SETTINGS_VIEW_OPEN: PRODUCT_EVENT.SETTINGS_VIEW_OPEN,
  SEARCH_OPEN: PRODUCT_EVENT.SEARCH_OPEN,
  SURFACE_OPEN: PRODUCT_EVENT.SURFACE_OPEN,
  APP_READY: PRODUCT_EVENT.APP_READY,
  REPLY_DRAWN: PRODUCT_EVENT.REPLY_DRAWN,
  OPEN_DRAWN: PRODUCT_EVENT.OPEN_DRAWN,
  PAGE_SHOWN: PRODUCT_EVENT.PAGE_SHOWN,
  PICTURE_SHOWN: PRODUCT_EVENT.PICTURE_SHOWN,
} as const;

export type ProductSurfaceEventName =
  (typeof PRODUCT_SURFACE_EVENT)[keyof typeof PRODUCT_SURFACE_EVENT];

const PRODUCT_SURFACE_EVENT_NAMES: ReadonlySet<string> = new Set(
  Object.values(PRODUCT_SURFACE_EVENT),
);

/** Guards a name arriving from the renderer's own surface-event channel. */
export function isProductSurfaceEventName(
  value: UnparsedWireValue,
): value is ProductSurfaceEventName {
  return isWireString(value) && PRODUCT_SURFACE_EVENT_NAMES.has(value);
}

export const PRODUCT_EVENT_PROPERTY = {
  APP_VERSION: "app_version",
  IMAGE_COUNT: "image_count",
  ACCOUNT_ACTION: "account_action",
  UPDATE_ACTION: "update_action",
  UPDATE_FAILURE: "update_failure",
  PANEL_TAB: "panel_tab",
  SETTINGS_VIEW: "settings_view",
  SEARCH_SURFACE: "search_surface",
  SURFACE: "surface",
  LAYOUT: "layout",
  PERMISSION_RESULT: "permission_result",
  SETTING_ID: "setting_id",
  SETTING_VALUE: "setting_value",
  EXPERIMENT: "experiment",
  EXPERIMENT_SCOPE: "experiment_scope",
  MIRROR_STEP: "mirror_step",
  MIRROR_FAILURE: "mirror_failure",
  ATTEMPT: "attempt",
  ELAPSED_SECONDS: "elapsed_seconds",
  LAUNCH_SECONDS: "launch_seconds",
  DRAWN_MS: "drawn_ms",
  REPLY_KIND: "reply_kind",
  STANDING_SECONDS: "standing_seconds",
  EVALUATED_SECONDS: "evaluated_seconds",
  ACCOUNT_SECONDS: "account_seconds",
  LOCAL_SECONDS: "local_seconds",
  STARTED_SECONDS: "started_seconds",
  INBOX_SECONDS: "inbox_seconds",
  SCREENS_SECONDS: "screens_seconds",
  ACTIVE_SECONDS: "active_seconds",
  DELIVERIES: "deliveries",
  APP_BUILD: "app_build",
  FIRST_ROWS: "first_rows",
  READY_AFTER: "ready_after",
  START_MS: "start_ms",
  STAND_MS: "stand_ms",
  OPEN_ORDER: "open_order",
  BUSY_MS: "busy_ms",
  PAGE_DATA: "page_data",
  READ_MS: "read_ms",
  SHOWN_MS: "shown_ms",
  PAGE_VERSION: "page_version",
  PICTURE_FROM: "picture_from",
  PICTURE_KIND: "picture_kind",
  PICTURE_BYTES: "picture_bytes",
} as const;

type ProductEventProperty = (typeof PRODUCT_EVENT_PROPERTY)[keyof typeof PRODUCT_EVENT_PROPERTY];

/** Where an account stands after an action, never who the account is. */
export const PRODUCT_ACCOUNT_ACTION = {
  SIGN_IN_START: "sign_in_start",
  SIGN_IN_CANCEL: "sign_in_cancel",
  SIGN_OUT: "sign_out",
  DELETE: "delete",
} as const;

export type ProductAccountAction =
  (typeof PRODUCT_ACCOUNT_ACTION)[keyof typeof PRODUCT_ACCOUNT_ACTION];

export const ProductAccountActionSchema = Schema.Literals(Object.values(PRODUCT_ACCOUNT_ACTION));

/**
 * The things the Updates section's buttons ever do, named as what happened: a
 * restart is counted as the install it schedules, `release_open` is the
 * browser trip to the latest release, and `changelog_open` is the Changelog
 * row's own browser trip, to the fixed changelog page rather than the
 * releases one.
 */
export const PRODUCT_UPDATE_ACTION = {
  CHECK: "check",
  INSTALL: "install",
  RELEASE_OPEN: "release_open",
  CHANGELOG_OPEN: "changelog_open",
} as const;

type ProductUpdateAction = (typeof PRODUCT_UPDATE_ACTION)[keyof typeof PRODUCT_UPDATE_ACTION];

/**
 * Why an update failed, as the Updates row names it: an install a read-only
 * volume refused, a build whose signature the installed app's requirement
 * refused, or any other failure, a check's or an install's. The words of
 * the error never travel: a kind here, the build's version beside it, and
 * nothing else, so a path or a volume's name has no shape to ride in.
 */
export const PRODUCT_UPDATE_FAILURE = {
  READ_ONLY_VOLUME: "read_only_volume",
  SIGNATURE: "signature",
  OTHER: "other",
} as const;

export type ProductUpdateFailure =
  (typeof PRODUCT_UPDATE_FAILURE)[keyof typeof PRODUCT_UPDATE_FAILURE];

/** Which half of the panel is drawn, said exactly as `APP_PANEL_TAB` says it. */
const PRODUCT_PANEL_TAB = {
  TASKS: APP_PANEL_TAB.TASKS,
  SETTINGS: APP_PANEL_TAB.SETTINGS,
} as const satisfies Record<string, AppPanelTab>;

type ProductPanelTab = (typeof PRODUCT_PANEL_TAB)[keyof typeof PRODUCT_PANEL_TAB];

/**
 * Which settings page a row of the Settings sidebar opened. It repeats the settings
 * package's own page set rather than importing it, because that package reads
 * this file for a setting's counted value and the edge would close a loop; the
 * desktop closes the gap with a total `Record` bridge, so a new page does not
 * build until this vocabulary answers for it.
 */
export const PRODUCT_SETTINGS_VIEW = {
  ROOT: "root",
  VOICE: "voice",
  APPEARANCE: "appearance",
  SHORTCUTS: "shortcuts",
  CONNECTIONS: "connections",
  MEMORY: "memory",
  AGENTS: "agents",
  HOSTS: "hosts",
  INTEGRATIONS: "integrations",
  MCP: "mcp",
  /** No page since Settings › CLI was folded into the MCP page; an older build still counts a visit to it. */
  CLI: "cli",
  SKILLS: "skills",
  API_KEYS: "api_keys",
  /** No page since Settings › Plan template was removed; an older build still counts a visit to it. */
  PLAN_TEMPLATE: "plan_template",
  WORKSPACE: "workspace",
  ENVIRONMENT: "environment",
  BILLING: "billing",
  /** No page since Settings › Cloud setup was folded into the Environment page; an older build still counts a visit to it. */
  CLOUD_SETUP: "cloud_setup",
  ACCOUNT: "account",
  PREFERENCES: "preferences",
  NOTIFICATIONS: "notifications",
  THIS_MAC: "this_mac",
  EXPERIMENTAL: "experimental",
  ABOUT: "about",
} as const;

export type ProductSettingsView =
  (typeof PRODUCT_SETTINGS_VIEW)[keyof typeof PRODUCT_SETTINGS_VIEW];

/** Which list a search field was summoned over, never what was typed into it. */
export const PRODUCT_SEARCH_SURFACE = {
  SETTINGS: "settings",
} as const;

type ProductSearchSurface = (typeof PRODUCT_SEARCH_SURFACE)[keyof typeof PRODUCT_SEARCH_SURFACE];

/**
 * Which surface of the panel was opened: the kind of page or pane, never which
 * task, agent, file, or person it showed. Where a task's column and its side
 * panel each show a surface, each is opened on its own.
 */
export const PRODUCT_SURFACE = {
  HOME: "home",
  TASK: "task",
  VERSION_HISTORY: "version_history",
  INBOX: "inbox",
  /** Removed with Channels, so no build sends it now; kept because an older Mac's batch still may, and one unread value refuses the batch. */
  CHANNEL: "channel",
  THREAD: "thread",
  AGENT: "agent",
  SUBAGENT: "subagent",
  PERSON: "person",
  AUTOMATIONS: "automations",
  BOARD: "board",
  ADMIN: "admin",
  SETTINGS: "settings",
  COMMENTS: "comments",
  PULL_REQUEST: "pull_request",
  FILES: "files",
  TERMINAL: "terminal",
  BROWSER: "browser",
  PAGE: "page",
} as const;

export type ProductSurface = (typeof PRODUCT_SURFACE)[keyof typeof PRODUCT_SURFACE];

/** How the panel was laid out as a surface opened: panes side by side, or one pane at a time. */
export const PRODUCT_LAYOUT = {
  WIDE: "wide",
  NARROW: "narrow",
} as const;

export type ProductLayout = (typeof PRODUCT_LAYOUT)[keyof typeof PRODUCT_LAYOUT];

/** What the system answered a permission ask with. */
export const PRODUCT_PERMISSION_RESULT = {
  GRANTED: "granted",
  DENIED: "denied",
} as const;

export type ProductPermissionResult =
  (typeof PRODUCT_PERMISSION_RESULT)[keyof typeof PRODUCT_PERMISSION_RESULT];

/**
 * The shape a setting's new value is counted in, never the value itself: a
 * chosen workspace project is a project name, and a hotkey is a chord the
 * developer chose. Whether a switch went on or off, and whether a choice was
 * made or returned to nothing, is the whole of what travels.
 */
export const PRODUCT_SETTING_VALUE = {
  ON: "on",
  OFF: "off",
  SET: "set",
  CLEARED: "cleared",
} as const;

export type ProductSettingValue =
  (typeof PRODUCT_SETTING_VALUE)[keyof typeof PRODUCT_SETTING_VALUE];

export const ProductSettingValueSchema = Schema.Literals(Object.values(PRODUCT_SETTING_VALUE));

/**
 * Which experiment a developer switched on or off in Settings ›
 * Experimental, by its key. It repeats the settings package's own set rather
 * than importing it, because that package reads this file and the edge would
 * close a loop; the settings package closes the gap with a total `Record`
 * bridge, so a new experiment does not build until this set answers for it.
 */
export const PRODUCT_EXPERIMENT = {
  /** Graduated, so no build sends it now; kept because an older Mac's batch still may, and one unread value refuses the batch. */
  BROWSER: "browser",
  /** Removed with Chat, so no build sends it now; kept because an older Mac's batch still may, and one unread value refuses the batch. */
  CHAT: "chat",
  /** Removed with Factory, so no build sends it now; kept because an older Mac's batch still may, and one unread value refuses the batch. */
  FACTORY: "factory",
  /** Graduated, so no build sends it now; kept because an older Mac's batch still may, and one unread value refuses the batch. */
  AUTOMATIONS: "automations",
  /** Removed with the Code review automation, so no build sends it now; kept because an older Mac's batch still may, and one unread value refuses the batch. */
  CODE_REVIEW: "code-review",
  /** Removed with video calls, so no build sends it now; kept because an older Mac's batch still may, and one unread value refuses the batch. */
  VIDEO_CALLS: "video-calls",
  MEMORY: "memory",
  /** Removed with our own issues, so no build sends it now; kept because an older Mac's batch still may, and one unread value refuses the batch. */
  ISSUES: "issues",
  /** Graduated, so no build sends it now; kept because an older Mac's batch still may, and one unread value refuses the batch. */
  SECTIONS: "sections",
  /** Graduated, so no build sends it now; kept because an older Mac's batch still may, and one unread value refuses the batch. */
  GITHUB_TOKEN: "github-token",
  /** Removed with the Inbox-first sidebar, so no build sends it now; kept because an older Mac's batch still may, and one unread value refuses the batch. */
  INBOX_FIRST: "inbox-first",
  /** Graduated, so no build sends it now; kept because an older Mac's batch still may, and one unread value refuses the batch. */
  LOCAL_AGENTS: "local-agents",
  /** Removed with Channels, so no build sends it now; kept because an older Mac's batch still may, and one unread value refuses the batch. */
  CHANNELS: "channels",
  /** Removed with Pilot, so no build sends it now; kept because an older Mac's batch still may, and one unread value refuses the batch. */
  PILOT: "pilot",
  SKILLS: "skills",
  /** Graduated, so no build sends it now; kept because an older Mac's batch still may, and one unread value refuses the batch. */
  BRING_YOUR_OWN_HOST: "bring-your-own-host",
  /** Graduated, so no build sends it now; kept because an older Mac's batch still may, and one unread value refuses the batch. */
  SEVERAL_REPOSITORIES: "several-repositories",
  DESCRIPTIONS: "descriptions",
  REWIND_FILES: "rewind-files",
  /** Removed with Done and follow-ups, so no build sends it now; kept because an older Mac's batch still may, and one unread value refuses the batch. */
  TURN_END: "turn-end",
  /** Renamed to Task descriptions, so no build sends it now; kept because a web tab served before the rename still may, and one unread value refuses the batch. */
  PLANS: "plans",
  /** Removed with Chat on the right, so no build sends it now; kept because an older build's batch still may, and one unread value refuses the batch. */
  CHAT_ON_THE_RIGHT: "chat-on-the-right",
  /** Graduated, so no build sends it now; kept because an older Mac's batch still may, and one unread value refuses the batch. */
  RUN_ACTIONS: "run-actions",
  MERGE_QUEUE: "merge-queue",
  TURN_CHANGES: "turn-changes",
  REPLY_BUTTONS: "reply-buttons",
  /** Graduated, so no build sends it now; kept because an older Mac's batch still may, and one unread value refuses the batch. */
  FOLLOWING: "following",
  COMPUTER_USE: "computer-use",
  /** Graduated, so no build sends it now; kept because an older Mac's batch still may, and one unread value refuses the batch. */
  VOICE: "voice",
  GOALS: "goals",
  MOVE_AGENTS: "move-agents",
  CURSOR: "cursor",
  MANAGERS: "managers",
  /** Graduated, so no build sends it now; kept because an older Mac's batch still may, and one unread value refuses the batch. */
  STARTER_TASKS: "starter-tasks",
} as const;

export type ProductExperiment = (typeof PRODUCT_EXPERIMENT)[keyof typeof PRODUCT_EXPERIMENT];

/**
 * Whose choice an experiment toggled was: a workspace's, which an admin made
 * for everyone in it, or an account's own. It repeats the settings package's
 * own set for the reason `PRODUCT_EXPERIMENT` does.
 */
export const PRODUCT_EXPERIMENT_SCOPE = {
  WORKSPACE: "workspace",
  ACCOUNT: "account",
} as const;

export type ProductExperimentScope =
  (typeof PRODUCT_EXPERIMENT_SCOPE)[keyof typeof PRODUCT_EXPERIMENT_SCOPE];

/**
 * The rungs every count travels on. A raw count is a weak fingerprint —
 * "137 Codex sessions" identifies a machine across days — where a rung says
 * the same thing about adoption and says it about a crowd rather than a
 * person. Each rung is the smallest count that reaches it. The ladder is
 * shared rather than per-property: a second ladder would be a second thing to
 * keep honest, and the question every count answers here is the same one.
 */
const PRODUCT_SESSION_COUNT_BUCKET = {
  NONE: 0,
  ONE: 1,
  FEW: 2,
  SEVERAL: 5,
  MANY: 10,
  CROWD: 25,
} as const;

export type ProductSessionCountBucket =
  (typeof PRODUCT_SESSION_COUNT_BUCKET)[keyof typeof PRODUCT_SESSION_COUNT_BUCKET];

const PRODUCT_SESSION_COUNT_LADDER: readonly ProductSessionCountBucket[] = Object.values(
  PRODUCT_SESSION_COUNT_BUCKET,
).sort((left, right) => right - left);

/** The highest rung a count reaches; anything below the first rung is none. */
export function productSessionCountBucket(count: number): ProductSessionCountBucket {
  if (!Number.isFinite(count)) return PRODUCT_SESSION_COUNT_BUCKET.NONE;

  return (
    PRODUCT_SESSION_COUNT_LADDER.find((rung) => count >= rung) ?? PRODUCT_SESSION_COUNT_BUCKET.NONE
  );
}

/**
 * The rungs a wait travels on, in seconds since what it waited on began,
 * each the shortest wait that reaches it, for the reason counts travel on
 * rungs: a raw duration says no more about a crowd and more about a person.
 */
const PRODUCT_ELAPSED_SECONDS = {
  NONE: 0,
  BLINK: 5,
  MOMENT: 15,
  HALF_MINUTE: 30,
  MINUTE: 60,
  MINUTES: 120,
  FIVE_MINUTES: 300,
  TEN_MINUTES: 600,
  HALF_HOUR: 1800,
  HOUR: 3600,
} as const;

export type ProductElapsedSeconds =
  (typeof PRODUCT_ELAPSED_SECONDS)[keyof typeof PRODUCT_ELAPSED_SECONDS];

const PRODUCT_ELAPSED_LADDER: readonly ProductElapsedSeconds[] = Object.values(
  PRODUCT_ELAPSED_SECONDS,
).sort((left, right) => right - left);

/** The highest rung a wait in milliseconds reaches; anything below the first rung is none. */
export function productElapsedSeconds(milliseconds: number): ProductElapsedSeconds {
  const seconds = milliseconds / 1000;

  if (!Number.isFinite(seconds)) return PRODUCT_ELAPSED_SECONDS.NONE;

  return PRODUCT_ELAPSED_LADDER.find((rung) => seconds >= rung) ?? PRODUCT_ELAPSED_SECONDS.NONE;
}

/**
 * The rungs a launch travels on, in seconds from the app's start to its
 * first Inbox rows, each the shortest launch that reaches it: a fifth of a
 * second apart under one, where the first frame and the first rows aim to
 * land, fine through a few seconds, where a launch feels quick or slow, and
 * coarse past them, for the reason a wait travels on rungs. Note that every
 * rung a released build sends stays, since the service refuses a value it
 * doesn't list.
 */
const PRODUCT_LAUNCH_SECONDS = {
  UNDER_A_FIFTH: 0,
  ONE_FIFTH: 0.2,
  TWO_FIFTHS: 0.4,
  THREE_FIFTHS: 0.6,
  FOUR_FIFTHS: 0.8,
  ONE: 1,
  ONE_AND_A_QUARTER: 1.25,
  ONE_AND_A_HALF: 1.5,
  TWO: 2,
  TWO_AND_A_HALF: 2.5,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
  EIGHT: 8,
  THIRTEEN: 13,
  TWENTY: 20,
} as const;

export type ProductLaunchSeconds =
  (typeof PRODUCT_LAUNCH_SECONDS)[keyof typeof PRODUCT_LAUNCH_SECONDS];

/** Which rows a launch's Inbox first showed: the ones kept on the phone, or the service's answer. */
export const PRODUCT_FIRST_ROWS = {
  KEPT: "kept",
  FEED: "feed",
} as const;

export type ProductFirstRows = (typeof PRODUCT_FIRST_ROWS)[keyof typeof PRODUCT_FIRST_ROWS];

/**
 * What an Inbox first shown waited from: the app's launch, a sign-in's
 * return, which a launch signed out waits through, or the app coming to the
 * front, for a launch that began in the background, as a push's wake does,
 * or went there before the Inbox showed.
 */
export const PRODUCT_READY_AFTER = {
  LAUNCH: "launch",
  SIGN_IN: "sign_in",
  FRONT: "front",
} as const;

export type ProductReadyAfter = (typeof PRODUCT_READY_AFTER)[keyof typeof PRODUCT_READY_AFTER];

const PRODUCT_LAUNCH_LADDER: readonly ProductLaunchSeconds[] = Object.values(
  PRODUCT_LAUNCH_SECONDS,
).sort((left, right) => right - left);

/** The highest rung a launch in milliseconds reaches; anything under a fifth of a second, or a time that is no number, is the first. */
export function productLaunchSeconds(milliseconds: number): ProductLaunchSeconds {
  const seconds = milliseconds / 1000;

  if (!Number.isFinite(seconds)) return PRODUCT_LAUNCH_SECONDS.UNDER_A_FIFTH;

  return (
    PRODUCT_LAUNCH_LADDER.find((rung) => seconds >= rung) ?? PRODUCT_LAUNCH_SECONDS.UNDER_A_FIFTH
  );
}

/**
 * The rungs a reply travels on, in milliseconds from its Send to its standing
 * in its thread, each the shortest wait that reaches it: fine through the
 * first second, where a send feels instant or slow, and coarse past it, for
 * the reason a wait travels on rungs.
 */
const PRODUCT_DRAWN_MS = {
  UNDER_100: 0,
  MS_100: 100,
  MS_200: 200,
  MS_300: 300,
  MS_500: 500,
  MS_800: 800,
  MS_1300: 1300,
  MS_2000: 2000,
  MS_3000: 3000,
  MS_5000: 5000,
} as const;

export type ProductDrawnMilliseconds = (typeof PRODUCT_DRAWN_MS)[keyof typeof PRODUCT_DRAWN_MS];

const PRODUCT_DRAWN_LADDER: readonly ProductDrawnMilliseconds[] = Object.values(
  PRODUCT_DRAWN_MS,
).sort((left, right) => right - left);

/** The highest rung a send's wait in milliseconds reaches; anything under the first rung, or a wait that is no number, is the first. */
export function productDrawnMilliseconds(milliseconds: number): ProductDrawnMilliseconds {
  if (!Number.isFinite(milliseconds)) return PRODUCT_DRAWN_MS.UNDER_100;

  return PRODUCT_DRAWN_LADDER.find((rung) => milliseconds >= rung) ?? PRODUCT_DRAWN_MS.UNDER_100;
}

/** What a reply carried, never what it said: words alone, or pictures, with words or without. */
export const PRODUCT_REPLY_KIND = {
  WORDS: "words",
  PICTURES: "pictures",
} as const;

export type ProductReplyKind = (typeof PRODUCT_REPLY_KIND)[keyof typeof PRODUCT_REPLY_KIND];

/**
 * The rungs a page's open travels on, in milliseconds from its first render
 * to its push starting or standing, each the shortest wait that reaches it:
 * a tenth of a second apart through the first second and a quarter apart
 * through the third, so an open that feels instant, one that drags, and a
 * first open that stalls each land on rungs of their own, and coarse past
 * that.
 */
const PRODUCT_OPEN_MS = {
  UNDER_100: 0,
  MS_100: 100,
  MS_200: 200,
  MS_300: 300,
  MS_400: 400,
  MS_500: 500,
  MS_600: 600,
  MS_700: 700,
  MS_800: 800,
  MS_900: 900,
  MS_1000: 1000,
  MS_1250: 1250,
  MS_1500: 1500,
  MS_1750: 1750,
  MS_2000: 2000,
  MS_2250: 2250,
  MS_2500: 2500,
  MS_2750: 2750,
  MS_3000: 3000,
  MS_4000: 4000,
  MS_5000: 5000,
} as const;

export type ProductOpenMilliseconds = (typeof PRODUCT_OPEN_MS)[keyof typeof PRODUCT_OPEN_MS];

const PRODUCT_OPEN_LADDER: readonly ProductOpenMilliseconds[] = Object.values(PRODUCT_OPEN_MS).sort(
  (left, right) => right - left,
);

/** The highest rung an open's wait in milliseconds reaches; anything under the first rung, or a wait that is no number, is the first. */
export function productOpenMilliseconds(milliseconds: number): ProductOpenMilliseconds {
  if (!Number.isFinite(milliseconds)) return PRODUCT_OPEN_MS.UNDER_100;

  return PRODUCT_OPEN_LADDER.find((rung) => milliseconds >= rung) ?? PRODUCT_OPEN_MS.UNDER_100;
}

/** Whether a page pushed open was the first of its kind since the app launched, which draws kinds it has not drawn before, or a later one. */
export const PRODUCT_OPEN_ORDER = {
  FIRST: "first",
  LATER: "later",
} as const;

export type ProductOpenOrder = (typeof PRODUCT_OPEN_ORDER)[keyof typeof PRODUCT_OPEN_ORDER];

/** Whether a page pushed open drew its first frame from what the app held, its thread, task, or agent already in memory, or had it still to read. */
export const PRODUCT_PAGE_DATA = {
  HELD: "held",
  READ: "read",
} as const;

export type ProductPageData = (typeof PRODUCT_PAGE_DATA)[keyof typeof PRODUCT_PAGE_DATA];

/** Where a page opened learned its version: named by its opener, as a transcript's card or a task's list names it, or read as the newest the task's pages hold, as a link opens it. */
export const PRODUCT_PAGE_VERSION = {
  NAMED: "named",
  NEWEST: "newest",
} as const;

export type ProductPageVersion = (typeof PRODUCT_PAGE_VERSION)[keyof typeof PRODUCT_PAGE_VERSION];

/** Where a picture drawn came from: the copy an earlier read left on the phone, a read through the service downloaded straight into a file, or one read as its bytes. */
export const PRODUCT_PICTURE_FROM = {
  KEPT: "kept",
  DOWNLOADED: "downloaded",
  READ: "read",
} as const;

export type ProductPictureFrom = (typeof PRODUCT_PICTURE_FROM)[keyof typeof PRODUCT_PICTURE_FROM];

/** Whose picture was drawn: one an agent showed, an Inbox thread's, a description's, or a comment's. */
export const PRODUCT_PICTURE_KIND = {
  AGENT: "agent",
  INBOX: "inbox",
  DESCRIPTION: "description",
  COMMENT: "comment",
} as const;

export type ProductPictureKind = (typeof PRODUCT_PICTURE_KIND)[keyof typeof PRODUCT_PICTURE_KIND];

/** The rungs a picture's size travels on, each the largest it stays under, so a small screenshot and a full-screen one are told apart and no size itself travels. */
export const PRODUCT_PICTURE_BYTES = {
  UNDER_100K: "under_100k",
  UNDER_500K: "under_500k",
  UNDER_1M: "under_1m",
  UNDER_3M: "under_3m",
  AT_LEAST_3M: "at_least_3m",
} as const;

export type ProductPictureBytes =
  (typeof PRODUCT_PICTURE_BYTES)[keyof typeof PRODUCT_PICTURE_BYTES];

/** Each rung under its bound in bytes, the smallest first. */
const PRODUCT_PICTURE_BYTES_LADDER: readonly (readonly [number, ProductPictureBytes])[] = [
  [100 * 1024, PRODUCT_PICTURE_BYTES.UNDER_100K],
  [500 * 1024, PRODUCT_PICTURE_BYTES.UNDER_500K],
  [1024 * 1024, PRODUCT_PICTURE_BYTES.UNDER_1M],
  [3 * 1024 * 1024, PRODUCT_PICTURE_BYTES.UNDER_3M],
];

/** The rung a picture of `bytes` stands on; one past the last bound, or a size that is no number, the last. */
export function productPictureBytes(bytes: number): ProductPictureBytes {
  return (
    PRODUCT_PICTURE_BYTES_LADDER.find(([bound]) => bytes < bound)?.[1] ??
    PRODUCT_PICTURE_BYTES.AT_LEAST_3M
  );
}

interface ProductEventPropertyValue {
  [PRODUCT_EVENT_PROPERTY.APP_VERSION]: string;
  [PRODUCT_EVENT_PROPERTY.IMAGE_COUNT]: ProductSessionCountBucket;
  [PRODUCT_EVENT_PROPERTY.ACCOUNT_ACTION]: ProductAccountAction;
  [PRODUCT_EVENT_PROPERTY.UPDATE_ACTION]: ProductUpdateAction;
  [PRODUCT_EVENT_PROPERTY.UPDATE_FAILURE]: ProductUpdateFailure;
  [PRODUCT_EVENT_PROPERTY.PANEL_TAB]: ProductPanelTab;
  [PRODUCT_EVENT_PROPERTY.SETTINGS_VIEW]: ProductSettingsView;
  [PRODUCT_EVENT_PROPERTY.SEARCH_SURFACE]: ProductSearchSurface;
  [PRODUCT_EVENT_PROPERTY.SURFACE]: ProductSurface;
  [PRODUCT_EVENT_PROPERTY.LAYOUT]: ProductLayout;
  [PRODUCT_EVENT_PROPERTY.PERMISSION_RESULT]: ProductPermissionResult;
  [PRODUCT_EVENT_PROPERTY.SETTING_ID]: AppSettingId;
  [PRODUCT_EVENT_PROPERTY.SETTING_VALUE]: ProductSettingValue;
  [PRODUCT_EVENT_PROPERTY.EXPERIMENT]: ProductExperiment;
  [PRODUCT_EVENT_PROPERTY.EXPERIMENT_SCOPE]: ProductExperimentScope;
  [PRODUCT_EVENT_PROPERTY.MIRROR_STEP]: MirrorStep;
  [PRODUCT_EVENT_PROPERTY.MIRROR_FAILURE]: MirrorFailure;
  [PRODUCT_EVENT_PROPERTY.ATTEMPT]: ProductSessionCountBucket;
  [PRODUCT_EVENT_PROPERTY.ELAPSED_SECONDS]: ProductElapsedSeconds;
  [PRODUCT_EVENT_PROPERTY.LAUNCH_SECONDS]: ProductLaunchSeconds;
  [PRODUCT_EVENT_PROPERTY.DRAWN_MS]: ProductDrawnMilliseconds;
  [PRODUCT_EVENT_PROPERTY.REPLY_KIND]: ProductReplyKind;
  [PRODUCT_EVENT_PROPERTY.STANDING_SECONDS]: ProductLaunchSeconds;
  [PRODUCT_EVENT_PROPERTY.EVALUATED_SECONDS]: ProductLaunchSeconds;
  [PRODUCT_EVENT_PROPERTY.ACCOUNT_SECONDS]: ProductLaunchSeconds;
  [PRODUCT_EVENT_PROPERTY.LOCAL_SECONDS]: ProductLaunchSeconds;
  [PRODUCT_EVENT_PROPERTY.STARTED_SECONDS]: ProductLaunchSeconds;
  [PRODUCT_EVENT_PROPERTY.INBOX_SECONDS]: ProductLaunchSeconds;
  [PRODUCT_EVENT_PROPERTY.SCREENS_SECONDS]: ProductLaunchSeconds;
  [PRODUCT_EVENT_PROPERTY.ACTIVE_SECONDS]: ProductLaunchSeconds;
  [PRODUCT_EVENT_PROPERTY.DELIVERIES]: ProductSessionCountBucket;
  [PRODUCT_EVENT_PROPERTY.APP_BUILD]: string;
  [PRODUCT_EVENT_PROPERTY.FIRST_ROWS]: ProductFirstRows;
  [PRODUCT_EVENT_PROPERTY.READY_AFTER]: ProductReadyAfter;
  [PRODUCT_EVENT_PROPERTY.START_MS]: ProductOpenMilliseconds;
  [PRODUCT_EVENT_PROPERTY.STAND_MS]: ProductOpenMilliseconds;
  [PRODUCT_EVENT_PROPERTY.OPEN_ORDER]: ProductOpenOrder;
  [PRODUCT_EVENT_PROPERTY.BUSY_MS]: ProductOpenMilliseconds;
  [PRODUCT_EVENT_PROPERTY.PAGE_DATA]: ProductPageData;
  [PRODUCT_EVENT_PROPERTY.READ_MS]: ProductOpenMilliseconds;
  [PRODUCT_EVENT_PROPERTY.SHOWN_MS]: ProductOpenMilliseconds;
  [PRODUCT_EVENT_PROPERTY.PAGE_VERSION]: ProductPageVersion;
  [PRODUCT_EVENT_PROPERTY.PICTURE_FROM]: ProductPictureFrom;
  [PRODUCT_EVENT_PROPERTY.PICTURE_KIND]: ProductPictureKind;
  [PRODUCT_EVENT_PROPERTY.PICTURE_BYTES]: ProductPictureBytes;
}

/**
 * The properties no set can enumerate. Each gets a named reader instead, and
 * all are narrower than free text by construction: a version is a build's
 * (`isProductBuildVersion`) or nothing, and a count must be a rung of the
 * ladder above.
 */
type EnumeratedProductEventProperty = Exclude<
  ProductEventProperty,
  | typeof PRODUCT_EVENT_PROPERTY.APP_VERSION
  | typeof PRODUCT_EVENT_PROPERTY.IMAGE_COUNT
  | typeof PRODUCT_EVENT_PROPERTY.EXPERIMENT_SCOPE
  | typeof PRODUCT_EVENT_PROPERTY.ATTEMPT
  | typeof PRODUCT_EVENT_PROPERTY.ELAPSED_SECONDS
  | typeof PRODUCT_EVENT_PROPERTY.LAUNCH_SECONDS
  | typeof PRODUCT_EVENT_PROPERTY.DRAWN_MS
  | typeof PRODUCT_EVENT_PROPERTY.START_MS
  | typeof PRODUCT_EVENT_PROPERTY.STAND_MS
  | typeof PRODUCT_EVENT_PROPERTY.BUSY_MS
  | typeof PRODUCT_EVENT_PROPERTY.READ_MS
  | typeof PRODUCT_EVENT_PROPERTY.SHOWN_MS
  | typeof PRODUCT_EVENT_PROPERTY.STANDING_SECONDS
  | typeof PRODUCT_EVENT_PROPERTY.EVALUATED_SECONDS
  | typeof PRODUCT_EVENT_PROPERTY.ACCOUNT_SECONDS
  | typeof PRODUCT_EVENT_PROPERTY.LOCAL_SECONDS
  | typeof PRODUCT_EVENT_PROPERTY.STARTED_SECONDS
  | typeof PRODUCT_EVENT_PROPERTY.INBOX_SECONDS
  | typeof PRODUCT_EVENT_PROPERTY.SCREENS_SECONDS
  | typeof PRODUCT_EVENT_PROPERTY.ACTIVE_SECONDS
  | typeof PRODUCT_EVENT_PROPERTY.DELIVERIES
  | typeof PRODUCT_EVENT_PROPERTY.APP_BUILD
>;

/** Every value each enumerable property may ever hold. */
const PRODUCT_EVENT_PROPERTY_VALUES = {
  [PRODUCT_EVENT_PROPERTY.ACCOUNT_ACTION]: Object.values(PRODUCT_ACCOUNT_ACTION),
  [PRODUCT_EVENT_PROPERTY.UPDATE_ACTION]: Object.values(PRODUCT_UPDATE_ACTION),
  [PRODUCT_EVENT_PROPERTY.UPDATE_FAILURE]: Object.values(PRODUCT_UPDATE_FAILURE),
  [PRODUCT_EVENT_PROPERTY.PANEL_TAB]: Object.values(PRODUCT_PANEL_TAB),
  [PRODUCT_EVENT_PROPERTY.SETTINGS_VIEW]: Object.values(PRODUCT_SETTINGS_VIEW),
  [PRODUCT_EVENT_PROPERTY.SEARCH_SURFACE]: Object.values(PRODUCT_SEARCH_SURFACE),
  [PRODUCT_EVENT_PROPERTY.SURFACE]: Object.values(PRODUCT_SURFACE),
  [PRODUCT_EVENT_PROPERTY.LAYOUT]: Object.values(PRODUCT_LAYOUT),
  [PRODUCT_EVENT_PROPERTY.PERMISSION_RESULT]: Object.values(PRODUCT_PERMISSION_RESULT),
  [PRODUCT_EVENT_PROPERTY.SETTING_ID]: Object.values(APP_SETTING_ID),
  [PRODUCT_EVENT_PROPERTY.SETTING_VALUE]: Object.values(PRODUCT_SETTING_VALUE),
  [PRODUCT_EVENT_PROPERTY.EXPERIMENT]: Object.values(PRODUCT_EXPERIMENT),
  [PRODUCT_EVENT_PROPERTY.MIRROR_STEP]: Object.values(MIRROR_STEP),
  [PRODUCT_EVENT_PROPERTY.MIRROR_FAILURE]: Object.values(MIRROR_FAILURE),
  [PRODUCT_EVENT_PROPERTY.REPLY_KIND]: Object.values(PRODUCT_REPLY_KIND),
  [PRODUCT_EVENT_PROPERTY.FIRST_ROWS]: Object.values(PRODUCT_FIRST_ROWS),
  [PRODUCT_EVENT_PROPERTY.READY_AFTER]: Object.values(PRODUCT_READY_AFTER),
  [PRODUCT_EVENT_PROPERTY.OPEN_ORDER]: Object.values(PRODUCT_OPEN_ORDER),
  [PRODUCT_EVENT_PROPERTY.PAGE_DATA]: Object.values(PRODUCT_PAGE_DATA),
  [PRODUCT_EVENT_PROPERTY.PAGE_VERSION]: Object.values(PRODUCT_PAGE_VERSION),
  [PRODUCT_EVENT_PROPERTY.PICTURE_FROM]: Object.values(PRODUCT_PICTURE_FROM),
  [PRODUCT_EVENT_PROPERTY.PICTURE_KIND]: Object.values(PRODUCT_PICTURE_KIND),
  [PRODUCT_EVENT_PROPERTY.PICTURE_BYTES]: Object.values(PRODUCT_PICTURE_BYTES),
} as const satisfies Record<EnumeratedProductEventProperty, readonly string[]>;

/**
 * Which properties each event may carry. A name without an entry here does
 * not build, the same lever the settings schema uses — so widening the
 * vocabulary is a deliberate edit to this table rather than a call site that
 * quietly started sending more.
 */
const PRODUCT_EVENT_PROPERTIES = {
  [PRODUCT_EVENT.APP_LAUNCH]: [PRODUCT_EVENT_PROPERTY.APP_VERSION],
  [PRODUCT_EVENT.APP_DAY_ACTIVE]: [PRODUCT_EVENT_PROPERTY.APP_VERSION],
  [PRODUCT_EVENT.ACCOUNT_SIGN_IN]: [],
  [PRODUCT_EVENT.ACCOUNT_ACTION]: [PRODUCT_EVENT_PROPERTY.ACCOUNT_ACTION],
  [PRODUCT_EVENT.PANEL_TAB_CHANGE]: [PRODUCT_EVENT_PROPERTY.PANEL_TAB],
  [PRODUCT_EVENT.SETTINGS_VIEW_OPEN]: [PRODUCT_EVENT_PROPERTY.SETTINGS_VIEW],
  [PRODUCT_EVENT.SETTINGS_RESET]: [],
  [PRODUCT_EVENT.SEARCH_OPEN]: [PRODUCT_EVENT_PROPERTY.SEARCH_SURFACE],
  [PRODUCT_EVENT.SURFACE_OPEN]: [PRODUCT_EVENT_PROPERTY.SURFACE, PRODUCT_EVENT_PROPERTY.LAYOUT],
  [PRODUCT_EVENT.UPDATE_ACTION]: [PRODUCT_EVENT_PROPERTY.UPDATE_ACTION],
  [PRODUCT_EVENT.UPDATE_FAIL]: [
    PRODUCT_EVENT_PROPERTY.UPDATE_FAILURE,
    PRODUCT_EVENT_PROPERTY.APP_VERSION,
  ],
  [PRODUCT_EVENT.FEEDBACK_SEND]: [PRODUCT_EVENT_PROPERTY.IMAGE_COUNT],
  [PRODUCT_EVENT.VOICE_PERMISSION]: [PRODUCT_EVENT_PROPERTY.PERMISSION_RESULT],
  [PRODUCT_EVENT.SETTING_UPDATE]: [
    PRODUCT_EVENT_PROPERTY.SETTING_ID,
    PRODUCT_EVENT_PROPERTY.SETTING_VALUE,
  ],
  [PRODUCT_EVENT.EXPERIMENT_TOGGLE]: [
    PRODUCT_EVENT_PROPERTY.EXPERIMENT,
    PRODUCT_EVENT_PROPERTY.SETTING_VALUE,
    PRODUCT_EVENT_PROPERTY.EXPERIMENT_SCOPE,
  ],
  [PRODUCT_EVENT.MIRROR_FAIL]: [
    PRODUCT_EVENT_PROPERTY.MIRROR_STEP,
    PRODUCT_EVENT_PROPERTY.MIRROR_FAILURE,
    PRODUCT_EVENT_PROPERTY.ATTEMPT,
    PRODUCT_EVENT_PROPERTY.ELAPSED_SECONDS,
  ],
  [PRODUCT_EVENT.MIRROR_READY]: [
    PRODUCT_EVENT_PROPERTY.ATTEMPT,
    PRODUCT_EVENT_PROPERTY.ELAPSED_SECONDS,
  ],
  [PRODUCT_EVENT.APP_READY]: [PRODUCT_EVENT_PROPERTY.LAUNCH_SECONDS],
  [PRODUCT_EVENT.REPLY_DRAWN]: [PRODUCT_EVENT_PROPERTY.DRAWN_MS, PRODUCT_EVENT_PROPERTY.REPLY_KIND],
  [PRODUCT_EVENT.OPEN_DRAWN]: [
    PRODUCT_EVENT_PROPERTY.SURFACE,
    PRODUCT_EVENT_PROPERTY.START_MS,
    PRODUCT_EVENT_PROPERTY.STAND_MS,
    PRODUCT_EVENT_PROPERTY.OPEN_ORDER,
  ],
  [PRODUCT_EVENT.PAGE_SHOWN]: [
    PRODUCT_EVENT_PROPERTY.READ_MS,
    PRODUCT_EVENT_PROPERTY.SHOWN_MS,
    PRODUCT_EVENT_PROPERTY.PAGE_VERSION,
    PRODUCT_EVENT_PROPERTY.OPEN_ORDER,
  ],
  [PRODUCT_EVENT.PICTURE_SHOWN]: [
    PRODUCT_EVENT_PROPERTY.READ_MS,
    PRODUCT_EVENT_PROPERTY.PICTURE_FROM,
    PRODUCT_EVENT_PROPERTY.PICTURE_KIND,
  ],
} as const satisfies { [Name in ProductEventName]: readonly ProductEventProperty[] };

/**
 * The properties an event may carry beyond those it must, each read where it
 * came and left off where it didn't. Note that a property added to an event
 * a released build already sends goes here, because one it must carry would
 * refuse that build's events, and with them its whole batch, until every
 * phone has updated.
 */
const PRODUCT_EVENT_OPTIONAL_PROPERTIES = {
  [PRODUCT_EVENT.APP_READY]: [
    PRODUCT_EVENT_PROPERTY.STANDING_SECONDS,
    PRODUCT_EVENT_PROPERTY.EVALUATED_SECONDS,
    PRODUCT_EVENT_PROPERTY.ACCOUNT_SECONDS,
    PRODUCT_EVENT_PROPERTY.LOCAL_SECONDS,
    PRODUCT_EVENT_PROPERTY.STARTED_SECONDS,
    PRODUCT_EVENT_PROPERTY.INBOX_SECONDS,
    PRODUCT_EVENT_PROPERTY.SCREENS_SECONDS,
    PRODUCT_EVENT_PROPERTY.ACTIVE_SECONDS,
    PRODUCT_EVENT_PROPERTY.DELIVERIES,
    PRODUCT_EVENT_PROPERTY.APP_BUILD,
    PRODUCT_EVENT_PROPERTY.FIRST_ROWS,
    PRODUCT_EVENT_PROPERTY.READY_AFTER,
  ],
  [PRODUCT_EVENT.OPEN_DRAWN]: [
    PRODUCT_EVENT_PROPERTY.APP_BUILD,
    PRODUCT_EVENT_PROPERTY.BUSY_MS,
    PRODUCT_EVENT_PROPERTY.PAGE_DATA,
  ],
  [PRODUCT_EVENT.PAGE_SHOWN]: [PRODUCT_EVENT_PROPERTY.APP_BUILD],
  [PRODUCT_EVENT.PICTURE_SHOWN]: [
    PRODUCT_EVENT_PROPERTY.PICTURE_BYTES,
    PRODUCT_EVENT_PROPERTY.APP_BUILD,
  ],
} as const satisfies { readonly [Name in ProductEventName]?: readonly ProductEventProperty[] };

/** The properties `Name` may leave off; none for an event with no entry. */
type OptionalPropertyOf<Name extends ProductEventName> =
  Name extends keyof typeof PRODUCT_EVENT_OPTIONAL_PROPERTIES
    ? (typeof PRODUCT_EVENT_OPTIONAL_PROPERTIES)[Name][number]
    : never;

/** Exactly the properties one event carries, each with its own value type: those it must, and those it may. */
export type ProductEventPropertiesFor<Name extends ProductEventName> = {
  readonly [Property in (typeof PRODUCT_EVENT_PROPERTIES)[Name][number]]: ProductEventPropertyValue[Property];
} & {
  readonly [Property in OptionalPropertyOf<Name>]?: ProductEventPropertyValue[Property];
};

/** Any event's properties, as a validated event holds them. */
type ProductEventProperties = {
  readonly [Property in ProductEventProperty]?: ProductEventPropertyValue[Property];
};

/** One counted event: what happened, when, and the properties it may carry. */
export interface ProductEvent {
  name: ProductEventName;
  /** When it happened on the desktop's clock, as epoch milliseconds. */
  at: number;
  properties: ProductEventProperties;
}

export type ProductEventBatch = readonly ProductEvent[];

/**
 * What the service answers a batch it took: how many of its events it
 * recorded, which a batch of nothing but retired names makes none.
 */
export const productEventsAnswerSchema = Schema.Struct({
  accepted: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

/**
 * How many events one request may carry. A flush past this is a desktop bug
 * rather than a busy day, so the endpoint refuses the batch whole.
 */
export const PRODUCT_EVENT_BATCH_LIMIT = 50;

/**
 * How far back an event's own `at` may date it when the service records it.
 * The service clamps an older instant into this window ending at its own
 * clock, so a Mac set to the wrong year cannot scatter counts across the
 * timeline; the desktop's hold drops an event it would otherwise post to be
 * re-dated, so the two sides read one number.
 */
export const PRODUCT_EVENT_MAXIMUM_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Event names this vocabulary once held and no build since 0.8.0 emits. A
 * batch from a 0.7.1 or older build may still carry one, and the batch reader
 * refuses a batch whole on any name it does not know, so it skips these items
 * instead and keeps the rest of that build's counts. A name that was never in
 * the vocabulary is still refused. Delete this set once no build at or below
 * 0.7.1 is active.
 */
const RETIRED_PRODUCT_EVENT = {
  PROVIDER_CONNECT: "provider:connect",
  PROVIDER_DISCONNECT: "provider:disconnect",
  CALENDAR_CONNECT: "calendar:connect",
  CALENDAR_DISCONNECT: "calendar:disconnect",
  SESSION_OBSERVE: "session:observe",
  SESSION_ACTION_SEND: "session:action_send",
  PANEL_OPEN: "panel:open",
  INTRODUCTION_COMPLETE: "introduction:complete",
  VOICE_ANNOUNCEMENT_SPEAK: "voice:announcement_speak",
  VOICE_FIRST_ANNOUNCEMENT: "voice:first_announcement",
  CONVERSATION_RATED: "conversation:rated",
  VOICE_CALL_START: "voice:call_start",
  VOICE_EXCHANGE: "voice:exchange",
} as const;

const RETIRED_PRODUCT_EVENT_NAMES: ReadonlySet<string> = new Set(
  Object.values(RETIRED_PRODUCT_EVENT),
);

function isRetiredProductEvent(value: UnparsedWireValue): boolean {
  return isRecord(value) && isWireString(value.name) && RETIRED_PRODUCT_EVENT_NAMES.has(value.name);
}

type PropertyReader = {
  [Property in ProductEventProperty]: (
    value: UnparsedWireValue,
  ) => ProductEventPropertyValue[Property] | undefined;
};

function memberReader(values: readonly string[]): (value: UnparsedWireValue) => string | undefined {
  const members: ReadonlySet<string> = new Set(values);

  return (value: UnparsedWireValue) =>
    isWireString(value) && members.has(value) ? value : undefined;
}

const isProductSessionCountBucket = Schema.is(
  Schema.Literals(Object.values(PRODUCT_SESSION_COUNT_BUCKET)),
);

const isProductExperimentScope = Schema.is(
  Schema.Literals(Object.values(PRODUCT_EXPERIMENT_SCOPE)),
);

/**
 * An experiment toggle's scope, an account's where none is named. Note that
 * a build from before workspace experiments sends a toggle with no scope,
 * and every toggle it sends is an account's, so reading the missing scope
 * as the account's keeps its whole batch rather than refusing it.
 */
function experimentScopeReader(value: UnparsedWireValue): ProductExperimentScope | undefined {
  if (value === undefined) return PRODUCT_EXPERIMENT_SCOPE.ACCOUNT;

  return isProductExperimentScope(value) ? value : undefined;
}

const isProductElapsedSeconds = Schema.is(Schema.Literals(Object.values(PRODUCT_ELAPSED_SECONDS)));

function elapsedReader(value: UnparsedWireValue): ProductElapsedSeconds | undefined {
  return isProductElapsedSeconds(value) ? value : undefined;
}

const isProductLaunchSeconds = Schema.is(Schema.Literals(Object.values(PRODUCT_LAUNCH_SECONDS)));

function launchReader(value: UnparsedWireValue): ProductLaunchSeconds | undefined {
  return isProductLaunchSeconds(value) ? value : undefined;
}

const isProductDrawnMilliseconds = Schema.is(Schema.Literals(Object.values(PRODUCT_DRAWN_MS)));

function drawnReader(value: UnparsedWireValue): ProductDrawnMilliseconds | undefined {
  return isProductDrawnMilliseconds(value) ? value : undefined;
}

const isProductOpenMilliseconds = Schema.is(Schema.Literals(Object.values(PRODUCT_OPEN_MS)));

function openReader(value: UnparsedWireValue): ProductOpenMilliseconds | undefined {
  return isProductOpenMilliseconds(value) ? value : undefined;
}

/** A build number as `CFBundleVersion` holds one: a whole number of up to six digits and nothing else, which has no room for a word. */
const BUILD_NUMBER_PATTERN = /^[1-9][0-9]{0,5}$/;

function buildNumberReader(value: UnparsedWireValue): string | undefined {
  return isWireString(value) && BUILD_NUMBER_PATTERN.test(value) ? value : undefined;
}

function bucketReader(value: UnparsedWireValue): ProductSessionCountBucket | undefined {
  return isProductSessionCountBucket(value) ? value : undefined;
}

/**
 * How each property's value is read. Every enumerable property's reader comes
 * from that property's own declared set rather than from a second list, so the
 * two can never disagree; the two no set can enumerate are named here, beside
 * an experiment's scope, which reads a missing one as the account's, which
 * is what makes "no free text" a property of the type rather than a promise
 * about call sites: a version that names no build and a count that is not a
 * rung are both discarded.
 */
/** A deployment's commit, as the web app names the build it is: forty hex digits and nothing else. */
const DEPLOYMENT_COMMIT_PATTERN = /^[0-9a-f]{40}$/;

/**
 * Whether a string names a build: a release version, `x.y.z`, as the desktop
 * and the iPhone app are named, or a deployment's commit, as the web app is,
 * which is deployed from `main` on every merge and has no version of its own.
 * Either shape has no room for a word, which is what keeps the property out
 * of free text.
 */
function isProductBuildVersion(value: string): boolean {
  return parseReleaseVersion(value) !== undefined || DEPLOYMENT_COMMIT_PATTERN.test(value);
}

const PRODUCT_EVENT_PROPERTY_READER: PropertyReader = {
  // SAFETY: the source is keyed by exactly the enumerable properties, and each
  // reader answers a member of the set filed under the key it lands on, which
  // is that property's own value type; the cast restores what `Object.entries`
  // and `Object.fromEntries` widen away.
  ...(Object.fromEntries(
    Object.entries(PRODUCT_EVENT_PROPERTY_VALUES).map(([property, values]) => [
      property,
      memberReader(values),
    ]),
  ) as Pick<PropertyReader, EnumeratedProductEventProperty>),
  [PRODUCT_EVENT_PROPERTY.APP_VERSION]: (value) =>
    isWireString(value) && isProductBuildVersion(value.trim()) ? value.trim() : undefined,
  [PRODUCT_EVENT_PROPERTY.IMAGE_COUNT]: bucketReader,
  [PRODUCT_EVENT_PROPERTY.ATTEMPT]: bucketReader,
  [PRODUCT_EVENT_PROPERTY.ELAPSED_SECONDS]: elapsedReader,
  [PRODUCT_EVENT_PROPERTY.LAUNCH_SECONDS]: launchReader,
  [PRODUCT_EVENT_PROPERTY.DRAWN_MS]: drawnReader,
  [PRODUCT_EVENT_PROPERTY.START_MS]: openReader,
  [PRODUCT_EVENT_PROPERTY.STAND_MS]: openReader,
  [PRODUCT_EVENT_PROPERTY.BUSY_MS]: openReader,
  [PRODUCT_EVENT_PROPERTY.READ_MS]: openReader,
  [PRODUCT_EVENT_PROPERTY.SHOWN_MS]: openReader,
  [PRODUCT_EVENT_PROPERTY.STANDING_SECONDS]: launchReader,
  [PRODUCT_EVENT_PROPERTY.EVALUATED_SECONDS]: launchReader,
  [PRODUCT_EVENT_PROPERTY.ACCOUNT_SECONDS]: launchReader,
  [PRODUCT_EVENT_PROPERTY.LOCAL_SECONDS]: launchReader,
  [PRODUCT_EVENT_PROPERTY.STARTED_SECONDS]: launchReader,
  [PRODUCT_EVENT_PROPERTY.INBOX_SECONDS]: launchReader,
  [PRODUCT_EVENT_PROPERTY.SCREENS_SECONDS]: launchReader,
  [PRODUCT_EVENT_PROPERTY.ACTIVE_SECONDS]: launchReader,
  [PRODUCT_EVENT_PROPERTY.DELIVERIES]: bucketReader,
  [PRODUCT_EVENT_PROPERTY.APP_BUILD]: buildNumberReader,
  [PRODUCT_EVENT_PROPERTY.EXPERIMENT_SCOPE]: experimentScopeReader,
};

/** Whether `name` is an event `PRODUCT_EVENT_OPTIONAL_PROPERTIES` names properties it may leave off for. */
function hasOptionalProperties(
  name: ProductEventName,
): name is keyof typeof PRODUCT_EVENT_OPTIONAL_PROPERTIES {
  return Object.hasOwn(PRODUCT_EVENT_OPTIONAL_PROPERTIES, name);
}

/** The properties an event may leave off; none for an event the table doesn't name. */
function optionalPropertiesOf(name: ProductEventName): readonly ProductEventProperty[] {
  return hasOptionalProperties(name) ? PRODUCT_EVENT_OPTIONAL_PROPERTIES[name] : [];
}

const readsProductEventName = Schema.is(ProductEventNameSchema);

function isProductEventName(value: UnparsedWireValue): value is ProductEventName {
  return readsProductEventName(value);
}

/**
 * Reads one event out of an untrusted envelope, or nothing. The result is
 * assembled from the event's own allowlist rather than copied from what
 * arrived, so a `distinct_id`, an `$ip`, an `email`, or a `$set` on the way in
 * has nowhere to land — naming a field is not a way to send one. A missing or
 * unreadable property discards the whole event rather than being repaired: the
 * desktop only sends what it built from this same table, so anything else is a
 * bug that should be loud.
 */
export function productEventFromWire(value: UnparsedWireValue): ProductEvent | undefined {
  if (!isRecord(value) || !isProductEventName(value.name)) return undefined;
  const at = value.at;

  if (!isWireNumber(at) || !Number.isFinite(at) || at < 0) return undefined;
  const source = isRecord(value.properties) ? value.properties : undefined;
  const allowed: readonly ProductEventProperty[] = PRODUCT_EVENT_PROPERTIES[value.name];
  const properties: Record<string, string | number> = {};

  for (const property of allowed) {
    const read = PRODUCT_EVENT_PROPERTY_READER[property](source?.[property]);

    if (read === undefined) return undefined;
    properties[property] = read;
  }

  const optional = optionalPropertiesOf(value.name);

  // Note that an optional property left off is skipped, while one sent unreadable still refuses the event, as a must's does.
  for (const property of optional) {
    if (source?.[property] === undefined) continue;
    const read = PRODUCT_EVENT_PROPERTY_READER[property](source[property]);

    if (read === undefined) return undefined;
    properties[property] = read;
  }

  // SAFETY: every key came from this event's allowlist and every value from
  // that property's own reader, which is exactly the declared shape.
  return { name: value.name, at, properties };
}

/**
 * Reads a whole batch, or nothing. One unreadable event refuses the batch
 * rather than trimming it: a partial acceptance would let a desktop bug show
 * up as a quiet gap in the counts instead of a refusal somebody notices. The
 * one exception is a retired name, which an older build still sends and which
 * is skipped, so a batch of nothing but retired names reads as empty.
 */
export function productEventBatchFromWire(value: UnparsedWireValue): ProductEventBatch | undefined {
  if (!isRecord(value) || !Array.isArray(value.events)) return undefined;

  if (value.events.length === 0 || value.events.length > PRODUCT_EVENT_BATCH_LIMIT) {
    return undefined;
  }

  const events: ProductEvent[] = [];

  for (const candidate of value.events) {
    if (isRetiredProductEvent(candidate)) continue;
    const event = productEventFromWire(candidate);

    if (!event) return undefined;
    events.push(event);
  }

  return events;
}

/**
 * Which of our shells something came from, under the `platform` property:
 * the desktop's panel window or the web app's tab, for the counted events and
 * the session replay alike, so one filter separates both. A client names
 * itself in its batch's `build`; the service's own counts are `server`, which
 * no client may claim.
 */
export const PRODUCT_PLATFORM = {
  DESKTOP: "desktop",
  WEB: "web",
  IOS: "ios",
  SERVER: "server",
} as const;

export type ProductPlatform = (typeof PRODUCT_PLATFORM)[keyof typeof PRODUCT_PLATFORM];

/** The platforms a client batch may name for itself. */
export type ProductClientPlatform = Exclude<ProductPlatform, typeof PRODUCT_PLATFORM.SERVER>;

/** The fields of a batch's `build`, which the service stamps on every event the batch carries. */
export const PRODUCT_EVENT_BUILD_FIELD = {
  APP_VERSION: PRODUCT_EVENT_PROPERTY.APP_VERSION,
  PACKAGED: "packaged",
  PLATFORM: "platform",
} as const;

/**
 * What the desktop says about the build a whole batch came from: its release
 * version, read as strictly as an event's own, and whether it runs from a
 * packaged bundle rather than a development checkout. It rides beside the
 * events rather than inside each one, because it is a fact of the sender and
 * not of anything counted, and one place on the request keeps it out of every
 * event's allowlist.
 */
const ProductEventBuildSchema = Schema.Struct({
  [PRODUCT_EVENT_BUILD_FIELD.APP_VERSION]: Schema.optionalKey(
    Schema.String.check(
      Schema.makeFilter((value) => value === value.trim() && isProductBuildVersion(value)),
    ),
  ),
  [PRODUCT_EVENT_BUILD_FIELD.PACKAGED]: Schema.optionalKey(Schema.Boolean),
  [PRODUCT_EVENT_BUILD_FIELD.PLATFORM]: Schema.optionalKey(
    Schema.Literals([PRODUCT_PLATFORM.DESKTOP, PRODUCT_PLATFORM.WEB, PRODUCT_PLATFORM.IOS]),
  ),
});

export type ProductEventBuild = typeof ProductEventBuildSchema.Type;

const decodeProductEventBuild = Schema.decodeUnknownOption(ProductEventBuildSchema);

/**
 * Reads a batch's `build`, which is never a reason to refuse it. Note that a
 * missing or unreadable `build` is left off whole rather than refusing the
 * batch, because builds 0.7 to 0.17 send none at all and their counts still
 * have to land; an event then carries no claim about its build rather than a
 * wrong one. A field the schema does not name is not copied forward.
 */
export function productEventBuildFromWire(value: UnparsedWireValue): ProductEventBuild {
  if (!isRecord(value)) return {};

  return Option.getOrElse(decodeProductEventBuild(value.build), () => ({}));
}

/** What every emitter is handed: a name, and exactly that name's properties. */
export type RecordProductEvent = <Name extends ProductEventName>(
  name: Name,
  properties: ProductEventPropertiesFor<Name>,
) => void;
