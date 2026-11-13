// glyph.ts -- every glyph the app draws, by what it marks: the panel's own Lucide glyph for each place and its own task status marks from the app's asset catalog, and the few iOS draws its own way as SF Symbols.

import {
  TASK_SECTION_GLYPH,
  TASK_SECTION_ICON_KIND,
  type TaskSectionGlyph,
  type TaskSectionIcon,
} from "@repo/features/task-section-wire";
import type { SfSymbol } from "./sf-symbol.js";
import type { StatusTone } from "./tokens/colors.js";
import { LUCIDE_SYMBOL } from "./tokens/lucide-symbols.js";
import { TASK_STATUS_SYMBOL } from "./tokens/task-status-symbols.js";

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

/** A task's status as the panel marks it, cut from `@repo/brand`'s one table into the asset catalog. */
// SAFETY: a symbol set's name is a glyph's name; this table is where glyphs are minted.
const statusMark = (name: (typeof TASK_STATUS_SYMBOL)[keyof typeof TASK_STATUS_SYMBOL]): Glyph =>
  name as Glyph;

/** An SF Symbol, kept where iOS draws the thing its own way, or where the panel draws a mark of its own rather than a Lucide glyph. */
// SAFETY: an SF Symbol's name is a glyph's name; this table is where glyphs are minted.
const system = (name: SfSymbol): Glyph => name as Glyph;

/**
 * Every glyph the app draws, by what it marks. Each is the Lucide glyph the
 * panel draws in the same place (the developer, Nov 12, 2026: the phone's
 * icons are the desktop's), written into the asset catalog as a custom
 * symbol by `@repo/brand`, so it sizes with Dynamic Type and weighs with its
 * words as an SF Symbol does. An SF Symbol stays only where iOS draws the
 * thing its own way (Share, and a sheet's close) or where the panel draws a mark of its own rather
 * than a Lucide glyph (a check box, a face, an MCP server, and the panel's
 * product mark), whose drawings are SF Symbols' nearest. A task's status
 * ring is the panel's own mark, written into the asset catalog from the
 * table `@repo/ui`'s `TaskStatusMark` draws (the developer, Nov 13, 2026).
 */
export const GLYPH = {
  // Places.
  INBOX: lucide(LUCIDE_SYMBOL.INBOX),
  TASK: lucide(LUCIDE_SYMBOL.LIST_TODO),
  SEARCH: lucide(LUCIDE_SYMBOL.SEARCH),
  NEW_TASK: lucide(LUCIDE_SYMBOL.SQUARE_PEN),
  SETTINGS: lucide(LUCIDE_SYMBOL.SETTINGS),
  HOME: lucide(LUCIDE_SYMBOL.HOUSE),
  AUTOMATION: lucide(LUCIDE_SYMBOL.ZAP),
  ADMIN: lucide(LUCIDE_SYMBOL.SHIELD_USER),
  WORKSPACE: lucide(LUCIDE_SYMBOL.BUILDING_COMPLEX),
  MAKE_OWNER: lucide(LUCIDE_SYMBOL.CROWN),
  // Things.
  AGENT: lucide(LUCIDE_SYMBOL.BOT),
  PAGE: lucide(LUCIDE_SYMBOL.APP_WINDOW),
  COMMENT: lucide(LUCIDE_SYMBOL.MESSAGE_SQUARE),
  THREAD: lucide(LUCIDE_SYMBOL.MESSAGES_SQUARE),
  RELATIONS: lucide(LUCIDE_SYMBOL.NETWORK),
  SUB_TASK: lucide(LUCIDE_SYMBOL.LIST_TREE),
  PARENT_TASK: lucide(LUCIDE_SYMBOL.CORNER_LEFT_UP),
  BLOCKED_BY: lucide(LUCIDE_SYMBOL.OCTAGON_MINUS),
  BLOCKS: lucide(LUCIDE_SYMBOL.HAND),
  HEADING: lucide(LUCIDE_SYMBOL.HEADING),
  CHANGES: lucide(LUCIDE_SYMBOL.FILE_DIFF),
  ISSUE: lucide(LUCIDE_SYMBOL.CIRCLE_DOT),
  FILE: lucide(LUCIDE_SYMBOL.FILE),
  FILE_TEXT: lucide(LUCIDE_SYMBOL.FILE_TEXT),
  FOLDER: lucide(LUCIDE_SYMBOL.FOLDER),
  REPOSITORY: lucide(LUCIDE_SYMBOL.FOLDER_GIT),
  NO_REPOSITORY: lucide(LUCIDE_SYMBOL.FOLDER_X),
  SKILL: lucide(LUCIDE_SYMBOL.BOOK_OPEN),
  MEMORY: lucide(LUCIDE_SYMBOL.LIGHTBULB),
  HOST: lucide(LUCIDE_SYMBOL.SERVER),
  MAC: lucide(LUCIDE_SYMBOL.LAPTOP),
  ISSUE_OPEN: lucide(LUCIDE_SYMBOL.CIRCLE_DOT),
  ISSUE_CLOSED: lucide(LUCIDE_SYMBOL.CIRCLE_CHECK),
  ISSUE_NOT_PLANNED: lucide(LUCIDE_SYMBOL.CIRCLE_SLASH),
  COMPUTER: lucide(LUCIDE_SYMBOL.MONITOR),
  PLUG: lucide(LUCIDE_SYMBOL.PLUG),
  GLOBE: lucide(LUCIDE_SYMBOL.GLOBE),
  DATE: lucide(LUCIDE_SYMBOL.CALENDAR),
  PERSON: lucide(LUCIDE_SYMBOL.USER),
  PEOPLE: lucide(LUCIDE_SYMBOL.USERS),
  FOLLOW: lucide(LUCIDE_SYMBOL.EYE),
  UNFOLLOW: lucide(LUCIDE_SYMBOL.EYE_OFF),
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
  TIME: lucide(LUCIDE_SYMBOL.CLOCK),
  QUEUED: lucide(LUCIDE_SYMBOL.LIST_END),
  STATUS: lucide(LUCIDE_SYMBOL.CIRCLE_DASHED),
  CHECK: lucide(LUCIDE_SYMBOL.CHECK),
  CHECK_SKIPPED: lucide(LUCIDE_SYMBOL.CIRCLE_SLASH),
  ASK_FIRST: lucide(LUCIDE_SYMBOL.HAND),
  AUTO_APPROVE: lucide(LUCIDE_SYMBOL.SHIELD_ELLIPSIS),
  FULL_ACCESS: lucide(LUCIDE_SYMBOL.SHIELD_ALERT),
  // Acts.
  ADD: lucide(LUCIDE_SYMBOL.PLUS),
  MORE: lucide(LUCIDE_SYMBOL.ELLIPSIS),
  SEND: lucide(LUCIDE_SYMBOL.ARROW_UP),
  DICTATE: lucide(LUCIDE_SYMBOL.MIC),
  ATTACH: lucide(LUCIDE_SYMBOL.PAPERCLIP),
  OPTIONS: lucide(LUCIDE_SYMBOL.SLIDERS_HORIZONTAL),
  REMOVE: lucide(LUCIDE_SYMBOL.X),
  DELETE: lucide(LUCIDE_SYMBOL.TRASH),
  RENAME: lucide(LUCIDE_SYMBOL.PENCIL),
  EDIT: lucide(LUCIDE_SYMBOL.PENCIL_LINE),
  WRITE: lucide(LUCIDE_SYMBOL.FILE_PEN),
  COPY: lucide(LUCIDE_SYMBOL.COPY),
  SAVE: lucide(LUCIDE_SYMBOL.DOWNLOAD),
  LINK: lucide(LUCIDE_SYMBOL.LINK),
  UNLINK: lucide(LUCIDE_SYMBOL.UNLINK),
  OPEN_EXTERNALLY: lucide(LUCIDE_SYMBOL.EXTERNAL_LINK),
  PIN: lucide(LUCIDE_SYMBOL.PIN),
  UNPIN: lucide(LUCIDE_SYMBOL.PIN_OFF),
  MARK_READ: lucide(LUCIDE_SYMBOL.MAIL_OPEN),
  MARK_UNREAD: lucide(LUCIDE_SYMBOL.MAIL),
  MARK_ALL_READ: lucide(LUCIDE_SYMBOL.CHECK_CHECK),
  SELECT: lucide(LUCIDE_SYMBOL.LIST_CHECKS),
  ARCHIVE: lucide(LUCIDE_SYMBOL.ARCHIVE),
  UNARCHIVE: lucide(LUCIDE_SYMBOL.ARCHIVE_RESTORE),
  MOVE: lucide(LUCIDE_SYMBOL.FOLDER_INPUT),
  SUGGEST: lucide(LUCIDE_SYMBOL.CORNER_DOWN_RIGHT),
  ADD_SECTION: lucide(LUCIDE_SYMBOL.FOLDER_PLUS),
  REMOVE_FROM_SECTION: lucide(LUCIDE_SYMBOL.FOLDER_MINUS),
  FILE_FOR_LATER: lucide(LUCIDE_SYMBOL.BOOKMARK),
  NEW_THREAD: lucide(LUCIDE_SYMBOL.MESSAGE_SQUARE_PLUS),
  NEW_FILE: lucide(LUCIDE_SYMBOL.FILE_PLUS),
  NEW_ISSUE: lucide(LUCIDE_SYMBOL.CIRCLE_PLUS),
  INVITE: lucide(LUCIDE_SYMBOL.USER_PLUS),
  UNDO: lucide(LUCIDE_SYMBOL.UNDO_2),
  RETRY: lucide(LUCIDE_SYMBOL.ROTATE_CW),
  RESTORE: lucide(LUCIDE_SYMBOL.ROTATE_CCW),
  HISTORY: lucide(LUCIDE_SYMBOL.ROTATE_CCW_CLOCK),
  UPDATE: lucide(LUCIDE_SYMBOL.CIRCLE_ARROW_UP),
  RUN: lucide(LUCIDE_SYMBOL.PLAY),
  STOP: lucide(LUCIDE_SYMBOL.CIRCLE_STOP),
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
  SIGN_OUT: lucide(LUCIDE_SYMBOL.LOG_OUT),
  SIDEBAR: lucide(LUCIDE_SYMBOL.PANEL_LEFT),
  SCHEDULES: lucide(LUCIDE_SYMBOL.CALENDAR_CLOCK),
  SCHEDULE_ADD: lucide(LUCIDE_SYMBOL.CALENDAR_PLUS),
  SCHEDULE_EDIT: lucide(LUCIDE_SYMBOL.CALENDAR_COG),
  SCHEDULE_DELETE: lucide(LUCIDE_SYMBOL.CALENDAR_X),
  SCHEDULE_RUN: lucide(LUCIDE_SYMBOL.CALENDAR_CHECK),
  JUMP_DOWN: lucide(LUCIDE_SYMBOL.ARROW_DOWN),
  FOLDED: lucide(LUCIDE_SYMBOL.CHEVRON_RIGHT),
  UNFOLDED: lucide(LUCIDE_SYMBOL.CHEVRON_DOWN),
  // iOS's own: Share is the system's act, a sheet closes with the system's round ✕ (its close role, as Calendar and Reminders close one), a Settings row's chevron is the one iOS draws at a row that goes on, and the composer's Stop is the panel's filled square.
  SHARE: system("square.and.arrow.up"),
  CLOSE: system("xmark"),
  DISCLOSURE: system("chevron.forward"),
  STOP_TURN: system("stop.fill"),
  // A task's status ring, the panel's own mark.
  STATUS_BACKLOG: statusMark(TASK_STATUS_SYMBOL.BACKLOG),
  STATUS_TODO: statusMark(TASK_STATUS_SYMBOL.TODO),
  STATUS_IN_PROGRESS: statusMark(TASK_STATUS_SYMBOL.IN_PROGRESS),
  STATUS_DONE: statusMark(TASK_STATUS_SYMBOL.DONE),
  STATUS_CANCELED: statusMark(TASK_STATUS_SYMBOL.CANCELED),
  // The panel's own marks, which no Lucide glyph draws: a check box and a round one, a check still running, a face and the app's,
  // an MCP server and its tool, the apps that reach the service over MCP (the
  // panel's product mark), and an unassigned task.
  BOX: system("square"),
  BOX_TICKED: system("checkmark.square.fill"),
  ROUND_BOX: system("circle"),
  ROUND_BOX_TICKED: system("checkmark.circle.fill"),
  CHECK_RUNNING: system("circle.dotted"),
  FACE: system("person.crop.circle"),
  UNASSIGNED: system("person.crop.circle.dashed"),
  APP: system("app"),
  MCP_SERVER: system("server.rack"),
  MCP_TOOL: system("wrench.and.screwdriver"),
  MCP_CLIENTS: system("app.connected.to.app.below.fill"),
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

/** Whether a glyph's name is one the section icon picker suggests. */
function isSectionGlyph(name: string): name is TaskSectionGlyph {
  return Object.hasOwn(SECTION_GLYPH, name);
}

/**
 * The glyph a section leads with, as the panel's sidebar draws its icon: the
 * glyph its member chose from the picker's suggestions; the folder, the
 * picker's first, for an emoji, a glyph the app's catalog doesn't hold, or
 * no icon, since a sidebar row always leads with a glyph. Note that a
 * glyph's color is left to the panel, which alone draws it.
 */
export function sectionGlyph(icon: TaskSectionIcon | undefined): Glyph {
  if (icon === undefined || icon.kind === TASK_SECTION_ICON_KIND.EMOJI) return GLYPH.FOLDER;

  return isSectionGlyph(icon.glyph) ? SECTION_GLYPH[icon.glyph] : GLYPH.FOLDER;
}

/** The glyphs the asset catalog holds, Lucide's and the task status marks, rather than the system's symbols. */
const CATALOG_SYMBOLS: ReadonlySet<string> = new Set([
  ...Object.values(LUCIDE_SYMBOL),
  ...Object.values(TASK_STATUS_SYMBOL),
]);

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

/** A mark's glyph and the tone it is drawn in. */
export type MarkLook = { readonly symbol: Glyph; readonly tone: StatusTone };
