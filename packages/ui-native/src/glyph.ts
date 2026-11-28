// glyph.ts -- every glyph the app draws, by what it marks: the panel's own Lucide glyph for each place and its own task status marks from the app's asset catalog, and the few iOS draws its own way as SF Symbols.

import {
  AGENT_PERMISSION_MODE,
  type AgentPermissionMode,
} from "@repo/features/agent-approval-wire";
import { DEVICE_PLATFORM, type DevicePlatform } from "@repo/features/device-agent-wire";
import {
  TASK_SECTION_GLYPH,
  TASK_SECTION_ICON_KIND,
  type TaskSectionGlyph,
  type TaskSectionIcon,
} from "@repo/features/task-section-wire";
import {
  WRITING_BLOCK,
  WRITING_INSERT,
  WRITING_MARK,
  type WritingAction,
} from "@repo/settings/shortcuts";
import type { SfSymbol } from "./sf-symbol.js";
import type { StatusTone } from "./tokens/colors.js";
import { EVERY_LUCIDE_SYMBOL } from "./tokens/every-lucide-symbol.js";
import { LUCIDE_SYMBOL } from "./tokens/lucide-symbols.js";
import { PRODUCT_MARK_SYMBOL } from "./tokens/product-mark-symbol.js";
import {
  TASK_PRIORITY_BARS_SYMBOL,
  TASK_PRIORITY_SYMBOL,
  TASK_STATUS_SYMBOL,
  UNASSIGNED_SEAT_OPACITY,
  UNASSIGNED_SYMBOL,
} from "./tokens/task-status-symbols.js";

declare const GLYPH_NAME: unique symbol;

/**
 * A glyph the app draws: one of `GLYPH`'s, which no caller spells for itself.
 * Note that it is a name branded here, so a component that takes a glyph
 * refuses a bare SF Symbol's name, and the one table below stays the one
 * place a glyph is chosen; `apps/mobile`'s tab and toolbar icons, which
 * expo-router types as plain names, are handed `GLYPH`'s too.
 */
export type Glyph = string & { readonly [GLYPH_NAME]: true };

/** One of Lucide's glyphs, by the name the app's asset catalog holds its symbol set under. */
export type LucideSymbol = (typeof LUCIDE_SYMBOL)[keyof typeof LUCIDE_SYMBOL];

/** One of Lucide's glyphs, the panel's own for its place, drawn from the asset catalog. */
// SAFETY: a symbol set's name is a glyph's name; this table is where glyphs are minted.
const lucide = (name: LucideSymbol): Glyph => name as Glyph;

/** A glyph from every Lucide glyph the catalog holds (`EVERY_LUCIDE_SYMBOL`), for one the app's own table names none of; a name the catalog lacks fails as the app loads. */
function catalogLucide(name: string): Glyph {
  if (!EVERY_LUCIDE_SYMBOL.includes(name))
    throw new Error(`The asset catalog holds no Lucide glyph "${name}".`);

  // SAFETY: a name the catalog holds a symbol set of is a glyph's name, minted here as `lucide` mints the table's.
  return name as Glyph;
}

/** A task's status as the panel marks it, cut from `@repo/brand`'s one table into the asset catalog. */
// SAFETY: a symbol set's name is a glyph's name; this table is where glyphs are minted.
const statusMark = (name: (typeof TASK_STATUS_SYMBOL)[keyof typeof TASK_STATUS_SYMBOL]): Glyph =>
  name as Glyph;

/** A task's priority as the panel marks it, cut from the same table: its lit parts, and every bar it can light, which its unlit bars are drawn from. */
// SAFETY: a symbol set's name is a glyph's name; this table is where glyphs are minted.
const priorityMark = (
  name:
    | (typeof TASK_PRIORITY_SYMBOL)[keyof typeof TASK_PRIORITY_SYMBOL]
    | typeof TASK_PRIORITY_BARS_SYMBOL,
): Glyph => name as Glyph;

/** No one's mark as the panel draws it, cut from the same table: its dashed ring, and the seat drawn faint under it. */
// SAFETY: a symbol set's name is a glyph's name; this table is where glyphs are minted.
const unassignedMark = (name: (typeof UNASSIGNED_SYMBOL)[keyof typeof UNASSIGNED_SYMBOL]): Glyph =>
  name as Glyph;

/** The product's mark, the Keel, cut from `@repo/brand`'s one description of it into the asset catalog, seated as a line glyph. */
// SAFETY: a symbol set's name is a glyph's name; this table is where glyphs are minted.
const productMark = (name: typeof PRODUCT_MARK_SYMBOL): Glyph => name as Glyph;

/** An SF Symbol, where iOS has its own symbol for the job, or where the panel draws a mark of its own rather than a Lucide glyph. */
// SAFETY: an SF Symbol's name is a glyph's name; this table is where glyphs are minted.
const system = (name: SfSymbol): Glyph => name as Glyph;

/**
 * Every glyph the app draws, by what it marks. A standard act iOS has its
 * own symbol for (⋯, compose, search, close, add, copy, delete, edit, pin,
 * mark read, archive, the composer's and a call's buttons) is the SF Symbol
 * Apple's own apps draw for the same job, so a bar, a menu, and a swipe
 * read as Mail's and Files' do. Our own places and things (the Inbox,
 * Tasks, Automations and their runs and triggers, an agent, a Manager, a
 * task, a pull request, an ask's kind, a status's and a priority's mark)
 * keep the Lucide glyph the panel draws in the same place, so the brand
 * reads the same on every client (the developer, Nov 27, 2026, refining
 * the Nov 12 rule that the phone's icons are the desktop's); so does an act
 * SF Symbols has no symbol for, such as Unlink. A Lucide glyph is written
 * into the asset catalog as a custom symbol by `@repo/brand`, so it sizes
 * with Dynamic Type and weighs with its words as an SF Symbol does. Where
 * the panel draws a mark of its own rather than a Lucide glyph (a check
 * box, a face, an MCP server), its drawing is SF Symbols' nearest. A task's status ring is the panel's own mark,
 * written into the asset catalog from the table `@repo/ui`'s
 * `TaskStatusMark` draws (the developer, Nov 13, 2026), and so is the
 * product's Keel, where the panel leads its MCP & CLI page with it.
 */
export const GLYPH = {
  // Places.
  /** The Activity tab and place, which the Inbox's threads stand in, under a bell as Slack's Activity stands. */
  ACTIVITY: lucide(LUCIDE_SYMBOL.BELL),
  INBOX: lucide(LUCIDE_SYMBOL.INBOX),
  TASK: lucide(LUCIDE_SYMBOL.LIST_TODO),
  SEARCH: system("magnifyingglass"),
  NEW_TASK: system("square.and.pencil"),
  SETTINGS: system("gear"),
  HOME: lucide(LUCIDE_SYMBOL.HOUSE),
  AUTOMATION: lucide(LUCIDE_SYMBOL.ZAP),
  ADMIN: lucide(LUCIDE_SYMBOL.SHIELD_USER),
  WORKSPACE: lucide(LUCIDE_SYMBOL.BUILDING_COMPLEX),
  MAKE_OWNER: lucide(LUCIDE_SYMBOL.CROWN),
  // Things.
  AGENT: lucide(LUCIDE_SYMBOL.HARD_HAT),
  PAGE: lucide(LUCIDE_SYMBOL.APP_WINDOW),
  COMMENT: lucide(LUCIDE_SYMBOL.MESSAGE_SQUARE),
  /** Add reaction, as the panel's smiley offers GitHub's reactions on a comment. */
  REACT: lucide(LUCIDE_SYMBOL.FACE_SLIGHTLY_SMILING_PLUS),
  THREAD: lucide(LUCIDE_SYMBOL.MESSAGES_SQUARE),
  RELATIONS: lucide(LUCIDE_SYMBOL.NETWORK),
  SUB_TASK: lucide(LUCIDE_SYMBOL.LIST_TREE),
  /** Show work under a Manager's message, as the panel's press beside it offers it. */
  SHOW_WORK: lucide(LUCIDE_SYMBOL.LIST_TREE),
  PARENT_TASK: lucide(LUCIDE_SYMBOL.CORNER_LEFT_UP),
  BLOCKED_BY: lucide(LUCIDE_SYMBOL.OCTAGON_MINUS),
  BLOCKS: lucide(LUCIDE_SYMBOL.HAND),
  HEADING: lucide(LUCIDE_SYMBOL.HEADING),
  CHANGES: lucide(LUCIDE_SYMBOL.FILE_DIFF),
  /** A pull request's checks, as the panel's Checks tab leads with them. */
  CHECKS: catalogLucide("ClipboardCheck"),
  /** A pull request's chapters, as the panel's Chapters tab leads with them. */
  CHAPTERS: catalogLucide("BookBookmark"),
  ISSUE: lucide(LUCIDE_SYMBOL.CIRCLE_DOT),
  FILE: lucide(LUCIDE_SYMBOL.FILE),
  FILE_TEXT: lucide(LUCIDE_SYMBOL.FILE_TEXT),
  FOLDER: lucide(LUCIDE_SYMBOL.FOLDER),
  REPOSITORY: lucide(LUCIDE_SYMBOL.FOLDER_GIT),
  NO_REPOSITORY: lucide(LUCIDE_SYMBOL.FOLDER_X),
  SKILL: lucide(LUCIDE_SYMBOL.BOOK_OPEN),
  MEMORY: lucide(LUCIDE_SYMBOL.LIGHTBULB),
  CLOUD: lucide(LUCIDE_SYMBOL.CLOUD),
  HOST: lucide(LUCIDE_SYMBOL.SERVER),
  MAC: lucide(LUCIDE_SYMBOL.LAPTOP),
  ISSUE_OPEN: lucide(LUCIDE_SYMBOL.CIRCLE_DOT),
  ISSUE_CLOSED: lucide(LUCIDE_SYMBOL.CIRCLE_CHECK),
  ISSUE_NOT_PLANNED: lucide(LUCIDE_SYMBOL.CIRCLE_SLASH),
  COMPUTER_USE: lucide(LUCIDE_SYMBOL.MOUSE_POINTER_CLICK),
  PLUG: lucide(LUCIDE_SYMBOL.PLUG),
  // Settings' pages, each the glyph the panel's Settings sidebar leads it with, and About's rows.
  NOTIFICATIONS: system("bell"),
  ENVIRONMENT: lucide(LUCIDE_SYMBOL.CLOUD_COG),
  WHATS_NEW: lucide(LUCIDE_SYMBOL.SCROLL_TEXT),
  HELP: system("questionmark.circle"),
  FEEDBACK: lucide(LUCIDE_SYMBOL.MESSAGE_SQUARE),
  EMAIL: system("envelope"),
  GLOBE: system("globe"),
  BROWSER: lucide(LUCIDE_SYMBOL.APP_WINDOW_MAC),
  DATE: system("calendar"),
  PERSON: system("person"),
  /** A list's item moved a step deeper, as Tab moves it. */
  INDENT: lucide(LUCIDE_SYMBOL.LIST_INDENT_INCREASE),
  /** A list's item moved a step back out, as Shift-Tab moves it. */
  OUTDENT: lucide(LUCIDE_SYMBOL.LIST_INDENT_DECREASE),
  PEOPLE: system("person.2"),
  FOLLOW: system("eye"),
  UNFOLLOW: system("eye.slash"),
  IMAGE: lucide(LUCIDE_SYMBOL.IMAGE),
  TERMINAL: lucide(LUCIDE_SYMBOL.TERMINAL),
  PULL_REQUEST: lucide(LUCIDE_SYMBOL.GIT_PULL_REQUEST),
  PULL_REQUEST_DRAFT: lucide(LUCIDE_SYMBOL.GIT_PULL_REQUEST_DRAFT),
  PULL_REQUEST_CLOSED: lucide(LUCIDE_SYMBOL.GIT_PULL_REQUEST_CLOSED),
  MERGED: lucide(LUCIDE_SYMBOL.GIT_MERGE),
  BRANCH: lucide(LUCIDE_SYMBOL.GIT_BRANCH),
  // An ask and where it stands.
  DECIDE: lucide(LUCIDE_SYMBOL.SPLIT),
  DO: lucide(LUCIDE_SYMBOL.SQUARE_CHECK),
  ANSWER: lucide(LUCIDE_SYMBOL.PEN_LINE),
  RESOLVED: lucide(LUCIDE_SYMBOL.CIRCLE_CHECK),
  FAILED: lucide(LUCIDE_SYMBOL.CIRCLE_ALERT),
  NOT_FOUND: lucide(LUCIDE_SYMBOL.SEARCH_X),
  OFFLINE: lucide(LUCIDE_SYMBOL.WIFI_OFF),
  TIME: system("clock"),
  /** A reminder for tomorrow morning, as Mail's Remind Me draws its Tomorrow. */
  TOMORROW: system("sunrise"),
  QUEUED: lucide(LUCIDE_SYMBOL.LIST_END),
  STATUS: lucide(LUCIDE_SYMBOL.CIRCLE_DASHED),
  CHECK: lucide(LUCIDE_SYMBOL.CHECK),
  CHECK_SKIPPED: lucide(LUCIDE_SYMBOL.CIRCLE_SLASH),
  ASK_FIRST: lucide(LUCIDE_SYMBOL.HAND),
  AUTO_APPROVE: lucide(LUCIDE_SYMBOL.SHIELD_ELLIPSIS),
  FULL_ACCESS: lucide(LUCIDE_SYMBOL.SHIELD_ALERT),
  // Acts.
  ADD: system("plus"),
  MORE: system("ellipsis"),
  SEND: system("arrow.up"),
  DICTATE: system("mic"),
  // A voice call's presses, as Phone and FaceTime draw them.
  TALK: lucide(LUCIDE_SYMBOL.AUDIO_LINES),
  MICROPHONE: system("mic"),
  MICROPHONE_MUTED: system("mic.slash"),
  SPEAKER: system("speaker.wave.2"),
  SPEAKER_MUTED: system("speaker.slash"),
  END_CALL: system("phone.down"),
  ATTACH: system("paperclip"),
  OPTIONS: lucide(LUCIDE_SYMBOL.SLIDERS_HORIZONTAL),
  REMOVE: system("xmark"),
  DELETE: system("trash"),
  RENAME: system("pencil"),
  // Note that the panel's smile, Lucide's FaceSlightlySmiling, is among every glyph the catalog holds rather than the table the app names, so it is minted from that list.
  CHANGE_FACE: catalogLucide("FaceSlightlySmiling"),
  EDIT: system("pencil"),
  WRITE: lucide(LUCIDE_SYMBOL.FILE_PEN),
  COPY: system("doc.on.doc"),
  /** Reply in thread, which opens a Manager chat message's thread, the panel's Lucide MessageSquareText, among every glyph the catalog holds. */
  REPLY_IN_THREAD: catalogLucide("MessageSquareText"),
  SAVE: system("square.and.arrow.down"),
  LINK: system("link"),
  UNLINK: lucide(LUCIDE_SYMBOL.UNLINK),
  /** A webhook, what fires an automation called at its address, the panel's Lucide Webhook, among every glyph the catalog holds. */
  WEBHOOK: catalogLucide("Webhook"),
  /** Open, which brings a row's lifted preview up to its whole page in the app; the arrow out is kept for what leaves it. */
  OPEN: lucide(LUCIDE_SYMBOL.MAXIMIZE_2),
  OPEN_EXTERNALLY: system("safari"),
  PIN: system("pin"),
  UNPIN: system("pin.slash"),
  MARK_READ: system("envelope.open"),
  MARK_UNREAD: system("envelope.badge"),
  /** A draft's header, by where it goes: an email, and one with no place named. */
  DRAFT_EMAIL: lucide(LUCIDE_SYMBOL.MAIL),
  DRAFT_WRITTEN: lucide(LUCIDE_SYMBOL.PEN_LINE),
  /** A Slack draft's header, where the panel draws Slack's own mark, which no glyph set holds: a message's bubble, the nearest. */
  DRAFT_SLACK: system("bubble.left"),
  MARK_ALL_READ: system("envelope.open"),
  SELECT: system("checkmark.circle"),
  ARCHIVE: system("archivebox"),
  UNARCHIVE: system("tray.and.arrow.up"),
  MOVE: system("folder"),
  SUGGEST: lucide(LUCIDE_SYMBOL.CORNER_DOWN_RIGHT),
  // A queued message's acts, as the panel's queue dock draws Steer; Move Up and Move Down are its drag's reorder as a long press offers it.
  STEER: lucide(LUCIDE_SYMBOL.CORNER_DOWN_RIGHT),
  MOVE_UP: system("arrow.up"),
  MOVE_DOWN: system("arrow.down"),
  ADD_SECTION: system("folder.badge.plus"),
  REMOVE_FROM_SECTION: system("folder.badge.minus"),
  /** A section's Change icon and Add icon, the panel's Lucide SmilePlus, which the catalog's Lucide names FaceSlightlySmilingPlus, among every glyph it holds. */
  CHANGE_ICON: catalogLucide("FaceSlightlySmilingPlus"),
  /** A section's icon's Color, the colors its glyph may wear, Lucide's Palette, among every glyph the catalog holds. */
  ICON_COLOR: catalogLucide("Palette"),
  /** A repository's Keep at top, the panel's arrow to the top rather than a pin so it never reads as Pinned, among every glyph the catalog holds. */
  KEEP_AT_TOP: catalogLucide("ArrowUpToLine"),
  /** A repository's Stop keeping at top, the panel's arrow down from the top, among every glyph the catalog holds. */
  STOP_KEEPING_AT_TOP: catalogLucide("ArrowDownFromLine"),
  NEW_THREAD: lucide(LUCIDE_SYMBOL.MESSAGE_SQUARE_PLUS),
  NEW_FILE: lucide(LUCIDE_SYMBOL.FILE_PLUS),
  NEW_ISSUE: lucide(LUCIDE_SYMBOL.CIRCLE_PLUS),
  INVITE: system("person.badge.plus"),
  UNDO: system("arrow.uturn.backward"),
  RETRY: system("arrow.clockwise"),
  RESTORE: system("arrow.counterclockwise"),
  /** An automation's runs and a page's versions, the panel's own, since Automations is a place of ours (the developer, Nov 27, 2026). */
  HISTORY: lucide(LUCIDE_SYMBOL.ROTATE_CCW_CLOCK),
  // A message's acts, as the panel's message actions draw them: Edit a line of the member's, Rewind conversation to here, and Fork to new agent.
  EDIT_MESSAGE: system("pencil"),
  REWIND: system("arrow.counterclockwise"),
  FORK: lucide(LUCIDE_SYMBOL.SPLIT),
  CONTINUE: lucide(LUCIDE_SYMBOL.CORNER_DOWN_RIGHT),
  UPDATE: lucide(LUCIDE_SYMBOL.CIRCLE_ARROW_UP),
  RUN: lucide(LUCIDE_SYMBOL.PLAY),
  // A sound clip's play and pause, as the system's players draw them.
  PLAY: system("play"),
  PAUSE: system("pause"),
  STOP: system("stop.circle"),
  WAIT: lucide(LUCIDE_SYMBOL.HOURGLASS),
  SLEEP: lucide(LUCIDE_SYMBOL.TIMER),
  WAKE: lucide(LUCIDE_SYMBOL.ALARM_CLOCK_CHECK),
  WAKE_OFF: lucide(LUCIDE_SYMBOL.ALARM_CLOCK_OFF),
  MESSAGE: lucide(LUCIDE_SYMBOL.SEND),
  TODOS: lucide(LUCIDE_SYMBOL.LIST_CHECKS),
  LIST: lucide(LUCIDE_SYMBOL.LAYOUT_LIST),
  READ: lucide(LUCIDE_SYMBOL.SCROLL_TEXT),
  MODELS: lucide(LUCIDE_SYMBOL.CPU),
  TOOL: lucide(LUCIDE_SYMBOL.WRENCH),
  SIGN_OUT: system("rectangle.portrait.and.arrow.right"),
  SIDEBAR: lucide(LUCIDE_SYMBOL.PANEL_LEFT),
  SCHEDULES: lucide(LUCIDE_SYMBOL.CALENDAR_CLOCK),
  /** An automation's schedule as its trigger's mark, the panel's clock, where a reminder's time is the system's. */
  SCHEDULE_TRIGGER: lucide(LUCIDE_SYMBOL.CLOCK),
  SCHEDULE_ADD: lucide(LUCIDE_SYMBOL.CALENDAR_PLUS),
  SCHEDULE_EDIT: lucide(LUCIDE_SYMBOL.CALENDAR_COG),
  SCHEDULE_DELETE: lucide(LUCIDE_SYMBOL.CALENDAR_X),
  SCHEDULE_RUN: lucide(LUCIDE_SYMBOL.CALENDAR_CHECK),
  JUMP_DOWN: lucide(LUCIDE_SYMBOL.ARROW_DOWN),
  FOLDED: lucide(LUCIDE_SYMBOL.CHEVRON_RIGHT),
  UNFOLDED: lucide(LUCIDE_SYMBOL.CHEVRON_DOWN),
  // The Inbox's pager in an open thread's bar, as Mail's message arrows.
  PREVIOUS_ITEM: system("chevron.up"),
  NEXT_ITEM: system("chevron.down"),
  // iOS's own: Share is the system's act, a sheet closes with the system's round ✕ (its close role, as Calendar and Reminders close one), a Settings row's chevron is the one iOS draws at a row that goes on, and the composer's Stop is the panel's filled square.
  SHARE: system("square.and.arrow.up"),
  // Select text is the system's act on a held message, as Messages and ChatGPT draw it.
  SELECT_TEXT: system("selection.pin.in.out"),
  CLOSE: system("xmark"),
  // A split view's expand, which stands the page alone across the window and back, is the system's own, as Mail draws it.
  EXPAND: system("arrow.up.left.and.arrow.down.right"),
  COLLAPSE: system("arrow.down.right.and.arrow.up.left"),
  // A list's View options, the system's bare filter lines (the developer, Nov 24, 2026), never the circled one.
  FILTER: system("line.3.horizontal.decrease"),
  DISCLOSURE: system("chevron.forward"),
  // A sheet's step back to the step before it, the back chevron iOS draws in a navigation bar.
  BACK: system("chevron.backward"),
  // A Settings row that leaves the app ends in iOS's own small arrow out, and a row that opens a menu in its up-and-down chevron, as a menu picker's value does.
  GOES_OUT: system("arrow.up.forward"),
  MENU_OPENS: system("chevron.up.chevron.down"),
  STOP_TURN: system("stop.fill"),
  // A video still's play mark, the system's own, as Messages and Photos mark a video at rest.
  VIDEO_PLAY: system("play.circle.fill"),
  // A sheet's confirm, the system's checkmark in its prominent bar button, as iOS 26's own sheets close on it.
  CONFIRM: system("checkmark"),
  // A task's status ring, the panel's own mark.
  STATUS_BACKLOG: statusMark(TASK_STATUS_SYMBOL.BACKLOG),
  STATUS_TODO: statusMark(TASK_STATUS_SYMBOL.TODO),
  STATUS_IN_PROGRESS: statusMark(TASK_STATUS_SYMBOL.IN_PROGRESS),
  STATUS_DONE: statusMark(TASK_STATUS_SYMBOL.DONE),
  STATUS_CANCELED: statusMark(TASK_STATUS_SYMBOL.CANCELED),
  PRIORITY_NONE: priorityMark(TASK_PRIORITY_SYMBOL.NONE),
  PRIORITY_URGENT: priorityMark(TASK_PRIORITY_SYMBOL.URGENT),
  PRIORITY_HIGH: priorityMark(TASK_PRIORITY_SYMBOL.HIGH),
  PRIORITY_MEDIUM: priorityMark(TASK_PRIORITY_SYMBOL.MEDIUM),
  PRIORITY_LOW: priorityMark(TASK_PRIORITY_SYMBOL.LOW),
  PRIORITY_BARS: priorityMark(TASK_PRIORITY_BARS_SYMBOL),
  // The panel's own marks, which no Lucide glyph draws: a check box and a round one, a check still running, a face and the app's,
  // an MCP server and its tool, the apps that reach the service over MCP (the
  // panel's product mark), and an unassigned task.
  BOX: system("square"),
  BOX_TICKED: system("checkmark.square.fill"),
  ROUND_BOX: system("circle"),
  ROUND_BOX_TICKED: system("checkmark.circle.fill"),
  CHECK_RUNNING: system("circle.dotted"),
  FACE: system("person.crop.circle"),
  /** No one, as the panel's `UnassignedAvatar` draws it: its ring of eight dashes, over its seat drawn faint (`UNASSIGNED_UNDER`). */
  UNASSIGNED: unassignedMark(UNASSIGNED_SYMBOL.RING),
  APP: system("app"),
  MCP_SERVER: system("server.rack"),
  MCP_TOOL: system("wrench.and.screwdriver"),
  PRODUCT: productMark(PRODUCT_MARK_SYMBOL),
} as const;

/**
 * The glyph each kind of an agent's tool call leads its transcript line
 * with, where the call is an act: the panel's own Lucide glyph, as the
 * desktop's transcript draws it (`transcript-blocks.tsx`'s `CALL_ICON`).
 * Note that it is its own table rather than `GLYPH`'s acts, because an
 * agent's record of its work is ours while a menu's act is the system's
 * (the developer, Nov 27, 2026), so turning a menu's act to an SF Symbol
 * never turns a transcript line with it.
 */
export const CALL_GLYPH = {
  SEARCH: lucide(LUCIDE_SYMBOL.SEARCH),
  GLOBE: lucide(LUCIDE_SYMBOL.GLOBE),
  STOP: lucide(LUCIDE_SYMBOL.CIRCLE_STOP),
  ARCHIVE: lucide(LUCIDE_SYMBOL.ARCHIVE),
  UNARCHIVE: lucide(LUCIDE_SYMBOL.ARCHIVE_RESTORE),
  EDIT: lucide(LUCIDE_SYMBOL.PENCIL_LINE),
  WRITE: lucide(LUCIDE_SYMBOL.FILE_PEN),
  ADD_SECTION: lucide(LUCIDE_SYMBOL.FOLDER_PLUS),
  REMOVE_SECTION: lucide(LUCIDE_SYMBOL.FOLDER_MINUS),
  MOVE: lucide(LUCIDE_SYMBOL.FOLDER_INPUT),
  LINK: lucide(LUCIDE_SYMBOL.LINK),
  UNLINK: lucide(LUCIDE_SYMBOL.UNLINK),
  CHECK: lucide(LUCIDE_SYMBOL.CHECK),
  RESOLVED: lucide(LUCIDE_SYMBOL.CIRCLE_CHECK),
  RUN: lucide(LUCIDE_SYMBOL.PLAY),
  WAIT: lucide(LUCIDE_SYMBOL.HOURGLASS),
  SLEEP: lucide(LUCIDE_SYMBOL.TIMER),
  WAKE: lucide(LUCIDE_SYMBOL.ALARM_CLOCK_CHECK),
  WAKE_OFF: lucide(LUCIDE_SYMBOL.ALARM_CLOCK_OFF),
  SUGGEST: lucide(LUCIDE_SYMBOL.CORNER_DOWN_RIGHT),
  MESSAGE: lucide(LUCIDE_SYMBOL.SEND),
  READ: lucide(LUCIDE_SYMBOL.SCROLL_TEXT),
  LIST: lucide(LUCIDE_SYMBOL.LAYOUT_LIST),
  TODOS: lucide(LUCIDE_SYMBOL.LIST_CHECKS),
  NEW_FILE: lucide(LUCIDE_SYMBOL.FILE_PLUS),
  NEW_ISSUE: lucide(LUCIDE_SYMBOL.CIRCLE_PLUS),
  TOOL: lucide(LUCIDE_SYMBOL.WRENCH),
} as const;

/** Each glyph the panel's section icon picker suggests (`TASK_SECTION_GLYPH`), as its Lucide glyph, so a section wears on the phone the icon its member chose. */
const SECTION_GLYPH: Readonly<Record<TaskSectionGlyph, Glyph>> = {
  [TASK_SECTION_GLYPH.FOLDER]: lucide(LUCIDE_SYMBOL.FOLDER),
  [TASK_SECTION_GLYPH.STAR]: lucide(LUCIDE_SYMBOL.STAR),
  [TASK_SECTION_GLYPH.BOOKMARK]: lucide(LUCIDE_SYMBOL.BOOKMARK),
  [TASK_SECTION_GLYPH.FLAG]: lucide(LUCIDE_SYMBOL.FLAG),
  [TASK_SECTION_GLYPH.ROCKET]: lucide(LUCIDE_SYMBOL.ROCKET),
  [TASK_SECTION_GLYPH.ZAP]: lucide(LUCIDE_SYMBOL.ZAP),
  [TASK_SECTION_GLYPH.BUG]: lucide(LUCIDE_SYMBOL.BUG),
  [TASK_SECTION_GLYPH.FLASK]: lucide(LUCIDE_SYMBOL.FLASK_CONICAL),
  [TASK_SECTION_GLYPH.BRIEFCASE]: lucide(LUCIDE_SYMBOL.BRIEFCASE),
  [TASK_SECTION_GLYPH.LAYERS]: lucide(LUCIDE_SYMBOL.LAYERS),
  [TASK_SECTION_GLYPH.HEART]: lucide(LUCIDE_SYMBOL.HEART),
  [TASK_SECTION_GLYPH.CIRCLE]: lucide(LUCIDE_SYMBOL.CIRCLE),
};

/** The glyph each permission mode wears, the panel's own (`MODE_GLYPH`): a hand, a shield round an ellipsis, a shield round a "!". */
export const PERMISSION_MODE_GLYPH = {
  [AGENT_PERMISSION_MODE.ASK]: GLYPH.ASK_FIRST,
  [AGENT_PERMISSION_MODE.AUTO]: GLYPH.AUTO_APPROVE,
  [AGENT_PERMISSION_MODE.FULL_ACCESS]: GLYPH.FULL_ACCESS,
} as const satisfies Record<AgentPermissionMode, Glyph>;

/** Whether a glyph's name is one the section icon picker suggests. */
function isSectionGlyph(name: string): name is TaskSectionGlyph {
  return Object.hasOwn(SECTION_GLYPH, name);
}

/**
 * Where an agent runs, as the panel's runs-on mark draws it (`runs-on.tsx`):
 * the cloud's glyph, a Linux server's, or the laptop for a Mac and for a
 * device whose platform isn't known, as the panel draws a teammate's.
 */
export function runsOnGlyph(place: {
  readonly cloud: boolean;
  readonly platform?: DevicePlatform | undefined;
}): Glyph {
  if (place.cloud) return GLYPH.CLOUD;

  return place.platform === DEVICE_PLATFORM.LINUX ? GLYPH.HOST : GLYPH.MAC;
}

/** Every Lucide glyph the app's catalog holds a symbol set of, by its asset name. */
const EVERY_LUCIDE: ReadonlySet<string> = new Set(EVERY_LUCIDE_SYMBOL);

/** A glyph's name on the wire as its asset's name, Lucide's own component name: "arrow-down01" as "ArrowDown01", as the panel's picker spells it back (`glyphKey`). */
function lucideAssetName(glyph: string): string {
  return glyph.replace(/(?:^|-)([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());
}

/**
 * The glyph a section leads with, as the panel's sidebar draws its icon: the
 * Lucide glyph its member chose from the picker, any of them; the folder, the
 * picker's first, for a name the app's catalog holds no glyph of, such as
 * one newer than the app's Lucide, or no icon, since a sidebar row always
 * leads with a glyph, and for an emoji, which `sectionEmoji` draws in the
 * glyph's place. Its chosen color is `sectionGlyphColor`'s, which the header
 * draws it in.
 */
export function sectionGlyph(icon: TaskSectionIcon | undefined): Glyph {
  if (icon === undefined || icon.kind === TASK_SECTION_ICON_KIND.EMOJI) return GLYPH.FOLDER;

  if (isSectionGlyph(icon.glyph)) return SECTION_GLYPH[icon.glyph];

  const name = lucideAssetName(icon.glyph);

  // SAFETY: a name the catalog holds a symbol set of is a glyph's name, minted here as `lucide` mints the table's.
  return EVERY_LUCIDE.has(name) ? (name as Glyph) : GLYPH.FOLDER;
}

/** The emoji a section leads with, drawn as words in its glyph's place, as the panel's sidebar draws it; none for a glyph or no icon. */
export function sectionEmoji(icon: TaskSectionIcon | undefined): string | undefined {
  return icon?.kind === TASK_SECTION_ICON_KIND.EMOJI ? icon.emoji : undefined;
}

/** The glyphs the asset catalog holds, Lucide's and the task status and priority marks, rather than the system's symbols. */
const CATALOG_SYMBOLS: ReadonlySet<string> = new Set([
  ...EVERY_LUCIDE_SYMBOL,
  ...Object.values(TASK_STATUS_SYMBOL),
  ...Object.values(UNASSIGNED_SYMBOL),
  ...Object.values(TASK_PRIORITY_SYMBOL),
  TASK_PRIORITY_BARS_SYMBOL,
  PRODUCT_MARK_SYMBOL,
]);

/** The letters and digits iOS draws as a filled square of its own (`a.square.fill`), as a workspace's tile reads in a system menu. */
const TILE_LETTER = /^[A-Z0-9]$/u;

/**
 * A workspace's letter as a system menu draws its tile: the system's filled
 * square around the letter, which its menu tints in the tile's hue; the
 * workspace glyph for a first character the system draws no square for,
 * such as an emoji or a letter outside A to Z.
 */
export function letterTileGlyph(letter: string): Glyph {
  // SAFETY: the system draws `<letter>.square.fill` for every letter and digit `TILE_LETTER` takes.
  return TILE_LETTER.test(letter)
    ? system(`${letter.toLowerCase()}.square.fill` as SfSymbol)
    : GLYPH.WORKSPACE;
}

/** A glyph as `@expo/ui`'s `Image` draws it: a custom symbol by its asset's name, an SF Symbol by its own. */
export function glyphImage(
  glyph: Glyph,
): { readonly assetName: string } | { readonly systemName: SfSymbol } {
  // SAFETY: a glyph the asset catalog doesn't hold was minted by `system` from an SF Symbol's name.
  return CATALOG_SYMBOLS.has(glyph) ? { assetName: glyph } : { systemName: glyph as SfSymbol };
}

/**
 * A glyph as `expo-symbols`' `SymbolView` names it, which the app's patch
 * (`patches/expo-symbols@58.0.4.patch`) reads as an SF Symbol or, failing
 * that, as a custom symbol of the asset catalog.
 */
export function glyphSymbol(glyph: Glyph): SfSymbol {
  // SAFETY: the patched `SymbolView` reads a custom symbol's name as well as an SF Symbol's.
  return glyph as SfSymbol;
}

/**
 * A glyph as expo-router's bottom bar and tab bar take an icon: an SF Symbol
 * by `sf`, a custom symbol by its asset's name as `xcasset`, since each
 * loads only the one kind its prop names. Note that an asset is tinted as a
 * template, because a bar handed no tint draws an asset in its artwork's
 * own black, which vanished on a dark bar beside the system's symbols.
 */
export function glyphIcon(
  glyph: Glyph,
): { readonly sf: SfSymbol } | { readonly xcasset: string; readonly renderingMode: "template" } {
  // SAFETY: a glyph the asset catalog doesn't hold was minted by `system` from an SF Symbol's name.
  return CATALOG_SYMBOLS.has(glyph)
    ? { xcasset: glyph, renderingMode: "template" }
    : { sf: glyph as SfSymbol };
}

/** A mark's glyph and the tone it is drawn in. */
export type MarkLook = { readonly symbol: Glyph; readonly tone: StatusTone };

/** A glyph drawn faint under another in the same ink, at `opacity`, as a priority's lit bars stand over every bar it can light. */
export type MarkLayer = { readonly glyph: Glyph; readonly opacity: number };

/** What no one's ring stands over: its seat, fainter, so the outline leads, as the panel's `UnassignedAvatar` draws it. */
export const UNASSIGNED_UNDER: MarkLayer = {
  glyph: unassignedMark(UNASSIGNED_SYMBOL.SEAT),
  opacity: UNASSIGNED_SEAT_OPACITY,
};

/** Each writing action's glyph, as the desktop's format toolbar, Turn into, and `/` menu draw it (`@repo/ui`'s `WritingGlyph`). */
export const WRITING_GLYPH = {
  [WRITING_MARK.BOLD]: lucide(LUCIDE_SYMBOL.BOLD),
  [WRITING_MARK.ITALIC]: lucide(LUCIDE_SYMBOL.ITALIC),
  [WRITING_MARK.STRIKE]: lucide(LUCIDE_SYMBOL.STRIKETHROUGH),
  [WRITING_MARK.CODE]: lucide(LUCIDE_SYMBOL.CODE),
  [WRITING_MARK.LINK]: lucide(LUCIDE_SYMBOL.LINK),
  [WRITING_BLOCK.TEXT]: lucide(LUCIDE_SYMBOL.TYPE),
  [WRITING_BLOCK.HEADING_1]: lucide(LUCIDE_SYMBOL.HEADING_1),
  [WRITING_BLOCK.HEADING_2]: lucide(LUCIDE_SYMBOL.HEADING_2),
  [WRITING_BLOCK.HEADING_3]: lucide(LUCIDE_SYMBOL.HEADING_3),
  [WRITING_BLOCK.BULLETED_LIST]: lucide(LUCIDE_SYMBOL.LIST),
  [WRITING_BLOCK.NUMBERED_LIST]: lucide(LUCIDE_SYMBOL.LIST_ORDERED),
  [WRITING_BLOCK.TODO_LIST]: lucide(LUCIDE_SYMBOL.LIST_CHECKS),
  [WRITING_BLOCK.QUOTE]: lucide(LUCIDE_SYMBOL.TEXT_QUOTE),
  [WRITING_BLOCK.CODE_BLOCK]: lucide(LUCIDE_SYMBOL.SQUARE_CODE),
  [WRITING_INSERT.DIVIDER]: lucide(LUCIDE_SYMBOL.MINUS),
} as const satisfies Record<WritingAction, Glyph>;
