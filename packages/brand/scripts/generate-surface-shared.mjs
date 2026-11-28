#!/usr/bin/env node
// Shared surface vocabulary — the single source for the tokens, marks, labels,
// and window-layout sizes both the desktop renderer and the marketing mock
// draw from.
//
//   node packages/brand/scripts/generate-surface-shared.mjs
//
// It writes six committed outputs into packages/brand/src/generated, five
// into @repo/ui's tokens, and four into @repo/ui-native's, all from the
// tables further down and in task-status-marks.mjs:
//
//   src/motion-tokens.ts        the same durations and sizes, as numbers
//   src/provider-mark-paths.ts  SVG path data for the sign-in provider marks
//   src/brand-palette.ts        the brand's colors as plain values
//   src/lucide-symbols.ts       Lucide's glyphs as SF Symbols templates, outlined
//   src/task-status-marks.ts    a task's status and priority marks, as @repo/ui draws them
//   src/task-status-symbols.ts  the same marks as SF Symbols templates
//   src/product-mark-symbol.ts  the Keel as an SF Symbols template, seated as a line glyph
//   ui/src/tokens/motion-tokens.css  the --ui-* motion tokens the shared
//                               components read, imported by @repo/ui/tokens.css
//   ui/src/tokens/geist.css     Geist's steps as --geist-* properties
//   ui/src/tokens/brand.css     the brand's colors on the --ui-color-* roles
//   ui/src/tokens/identity.css  the identity hues on --ui-color-identity-*
//   ui/src/tokens/file-icon.css  the file tree's palette on --file-icon-*
//   ui/src/tokens/manager-face.css  a Manager's face fills on --ui-color-manager-face-*
//   ui-native/src/tokens/brand-colors.ts  the iOS app's share of those
//                               colors, as values SwiftUI is handed
//   ui-native/src/tokens/identity-hues.ts  the same identity hues, as values
//   ui-native/src/tokens/file-icon-inks.ts  the same file tree palette, as values
//   ui-native/src/tokens/lucide-symbols.ts  the names the iOS app's asset
//                               catalog holds those templates under
//   ui-native/src/tokens/every-lucide-symbol.ts  every Lucide glyph's name,
//                               whose templates the app's config outlines at
//                               prebuild (every-lucide-symbol.mjs)
//   ui-native/src/tokens/task-status-symbols.ts  the names it holds the
//                               status and priority marks' templates under
//   ui-native/src/tokens/product-mark-symbol.ts  the name it holds the Keel's under
//
// The React that traces the marks, and the rules that consume the tokens, stay
// in each app: a shared component would pull desktop-only code into the web
// bundle. Emitting the data from here keeps the second copy from being a
// second source. `--check` reports drift when run by hand.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BRAND, FILE_ICON, IDENTITY, MANAGER_FACE } from "./brand-palette.mjs";
import { everyLucideName, lucideAssetName } from "./every-lucide-symbol.mjs";
import { GEIST } from "./geist.mjs";
import { MARK } from "./keel-mark.mjs";
import { markTemplate, symbolTemplate } from "./lucide-symbols.mjs";
import {
  TASK_MARK_BOX,
  TASK_MARK_ELEMENT,
  TASK_MARK_LAYER,
  TASK_MARK_LINE_WIDTH,
  TASK_MARK_ROLE,
  TASK_PRIORITY_MARK,
  TASK_PRIORITY_UNLIT_OPACITY,
  TASK_STATUS_MARK,
  UNASSIGNED_MARK,
  UNASSIGNED_MARK_BOX,
  UNASSIGNED_MARK_LINE_WIDTH,
  UNASSIGNED_RING_PATH_LENGTH,
  UNASSIGNED_SEAT_OPACITY,
} from "./task-status-marks.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SURFACE = join(HERE, "..", "src", "generated");
const UI_TOKENS = join(HERE, "..", "..", "ui", "src", "tokens");
const UI_NATIVE_TOKENS = join(HERE, "..", "..", "ui-native", "src", "tokens");
const UI_MANIFEST = join(HERE, "..", "..", "ui", "package.json");

// ---------- Motion tokens ----------
// Sampled damped springs, one duration. A real spring's motion is a property
// of the spring, not of how far it is asked to travel, which is why the same
// samples serve a short travel and a long one.
const SPRING = [
  0, 0.0285, 0.0993, 0.1943, 0.3005, 0.4083, 0.5115, 0.6061, 0.69, 0.7623, 0.8229, 0.8727, 0.9125,
  0.9437, 0.9674, 0.9848, 0.9972, 1.0056, 1.0109, 1.0138, 1.015, 1.015, 1.0142, 1.0129, 1.0114,
  1.0098, 1,
];

// The same damping ratio; only the frequency changes, which is what a smaller
// and lighter element wants.
const SPRING_FAST = [
  0, 0.0288, 0.1002, 0.1961, 0.3029, 0.4113, 0.5149, 0.6097, 0.6935, 0.7656, 0.826, 0.8755, 0.9149,
  0.9457, 0.969, 0.9861, 0.9982, 1.0063, 1.0113, 1.014, 1.0151, 1.015, 1.0141, 1.0127, 1.0112,
  1.0095, 1,
];

const MOTION_DURATION_MS = {
  FAST: 280,
  SPRING: 460,
  EXIT: 90,
  QUICK: 140,
  HOVER: 70,
  PANE: 240,
  // Motion a reader watches rather than waits on, as the landing's hero
  // plays the Inbox: long enough to follow, eased in as well as out.
  SHOWCASE: 1000,
};

const MOTION_DELAY_MS = {
  // How long a pointer rests on a control before its hover hint shows.
  HINT: 500,
  // How long a state that often heals at once (a dropped connection being
  // made again) holds before it is shown, so a blip is never seen.
  LATE: 1000,
  // How long a confirmation that a write landed (an autosave's Saved)
  // stands before it fades.
  CONFIRM: 1200,
  // How long a flash over a video answering a key (an arrow's jump, a
  // speed change) stands before it fades: shorter than a confirmation,
  // because keys pressed in a run each start it over.
  FLASH: 800,
  // A beat to see whether a state settles before it is acted on: a hover
  // card standing after the pointer leaves it, a spinner's ring waiting to see
  // whether a read lands at once.
  SETTLE: 180,
};

const MOTION_EXIT = "cubic-bezier(0.4, 0, 0.6, 1)";

// The desktop window's panes (the sidebar, the side panel) open and close on
// a plain ease-out rather than the spring: a pane stands on the window's own
// edge, and a spring's overshoot would part the two for a frame.
const MOTION_PANE = "cubic-bezier(0.2, 0, 0, 1)";

// ---------- Brand palette ----------
// The brand's colors live in brand-palette.mjs, which the asset generator
// reads too; this script writes them onto @repo/ui's roles and as values.

// The roles the iOS app draws with: the accent, the grounds a screen, a list,
// and a sidebar stand on, the raised fill a grouped form's rows stand in
// (OVERLAY) and the light ground under them (CHIP_HOVER), the strong fill the
// member's own message sits on (FILL_STRONG), the gray a neutral swipe
// action fills with under white words (ACTION_FILL) and the red a swipe that
// takes something away fills with under them (DANGER_FILL), the inks, the
// status inks, and a chip's face and strong edge, which a Mermaid diagram's
// boxes are drawn in as the panel's are (CHIP, CHIP_EDGE_STRONG).
// The rest (a focus ring, a chip's selection) are the desktop's and the
// site's, which SwiftUI's own control states stand in for on iOS.
const NATIVE_ROLES = [
  "ACCENT",
  "ON_ACCENT",
  "ACCENT_TEXT",
  "GROUND",
  "SURFACE",
  "OVERLAY",
  "CHIP_HOVER",
  "SIDEBAR",
  "SIDEBAR_INK",
  "WELL",
  "CHIP_EDGE",
  "CHIP",
  "CHIP_EDGE_STRONG",
  "FILL_STRONG",
  "ACTION_FILL",
  "DANGER_FILL",
  "TEXT",
  "TEXT_BODY",
  "TEXT_MUTED",
  "DANGER",
  "DANGER_TEXT",
  "ATTENTION",
  "ATTENTION_FILL",
  "WORKING",
  "COMPLETE",
  "MERGED",
  "AVATAR_TILE",
  "AVATAR_INK",
];

// ---------- Provider mark paths ----------
// Each is the provider's own mark, reproduced rather than redrawn. Attribution
// lives with the React that traces them; this table is only the geometry.
const MARK_PATHS = {
  /*
   * GitHub's Octocat mark, verbatim from the invertocat GitHub publishes, on
   * its 16-unit canvas. Drawn wherever a GitHub sign-in names itself: the
   * account row and the loopback landing page.
   */
  /*
   * Claude's spark, verbatim from `Claude Spark - Clay.svg` in Anthropic's
   * press kit (anthropic.com/press-kit), on its 94-unit
   * canvas, filled in its own clay, #D97757. Drawn wherever Claude names
   * itself: an agent on it, its models, and the plans and keys that pay for
   * it, in the panel and the iOS app alike.
   */
  CLAUDE:
    "M18.7657 62.4437L37.1822 52.1167L37.4857 51.2122L37.1822 50.7085H36.2715L33.1852 50.5208L22.6615 50.2391L13.5545 49.8636L4.70044 49.3942L2.47428 48.9248L0.399902 46.1553L0.602281 44.794L2.47428 43.5266L5.15579 43.7613L11.0754 44.1837L19.98 44.794L26.4055 45.1695L35.9679 46.1553H37.4857L37.6881 45.545L37.1822 45.1695L36.7774 44.794L27.5692 38.5508L17.6021 31.9791L12.3908 28.1769L9.60812 26.2524L8.19147 24.4686L7.58433 20.5256L10.1141 17.7091L13.5545 17.9438L14.4146 18.1785L17.9056 20.8542L25.343 26.6279L35.0572 33.7629L36.4739 34.9364L37.0443 34.5514L37.1316 34.2792L36.4739 33.1996L31.212 23.6706L25.596 13.9539L23.0663 9.91695L22.4086 7.52296C22.1538 6.51831 22.0038 5.68714 22.0038 4.65957L24.8877 0.716544L26.5067 0.200195L30.4025 0.716544L32.0215 2.12477L34.4501 7.66379L38.3458 16.3478L44.4172 28.1769L46.188 31.6975L47.1493 34.9364L47.5035 35.9222H48.1106V35.3589L48.6166 28.6933L49.5273 20.5256L50.438 10.0108L50.7415 7.05356L52.2088 3.48605L55.1433 1.56148L57.42 2.64112L59.292 5.31674L59.039 7.05356L57.926 14.2824L55.7504 25.5952L54.3337 33.1996H55.1433L56.1046 32.2138L59.9497 27.1442L66.3752 19.0704L69.2085 15.8784L72.5478 12.3579L74.6728 10.668H78.7203L81.6548 15.0804L80.3394 19.6337L76.1906 24.8911L72.7502 29.3504L67.8172 35.9595L64.7562 41.2734L65.0307 41.7118L65.7681 41.6489L76.8989 39.255L82.9197 38.1753L90.1041 36.9549L93.3422 38.457L93.6963 40.006L92.4315 43.151L84.7411 45.0287L75.7353 46.8594L62.3244 50.0164L62.1759 50.1358L62.3512 50.3958L68.399 50.9432L70.9794 51.084H77.3037L89.0922 51.9759L92.1785 53.9944L93.9999 56.4822L93.6963 58.4068L88.9404 60.8008L82.5655 59.2987L67.6401 55.7312L62.5301 54.4638H61.8217V54.8862L66.0717 59.064L73.9139 66.1051L83.6786 75.2116L84.1845 77.4648L82.9197 79.2485L81.6042 79.0608L73.0032 72.5829L69.6639 69.6726L62.1759 63.3356H61.67V63.9928L63.3902 66.5276L72.5478 80.2812L73.0032 84.5059L72.3454 85.8672L69.9675 86.7121L67.3871 86.2427L61.9735 78.6852L56.4587 70.2359L52.0064 62.6315L51.4687 62.971L48.8189 91.2654L47.6047 92.7206L44.7714 93.8002L42.3934 92.0164L41.1286 89.1061L42.3934 83.3324L43.9113 75.8219L45.1255 69.8604L46.2386 62.4437L46.9184 59.9661L46.8583 59.8003L46.3153 59.8916L40.7238 67.5603L32.2239 79.0608L25.4948 86.2427L23.8758 86.8999L21.0931 85.4447L21.3461 82.863L22.9145 80.5629L32.2239 68.7338L37.8399 61.3641L41.4594 57.1337L41.4242 56.5218L41.2244 56.5048L16.489 72.6299L12.0873 73.1932L10.1647 71.4094L10.4176 68.4991L11.3283 67.5603L18.7657 62.4437Z",
  /*
   * Cursor's cube, from Simple Icons' `cursor.svg` (CC0), on its 24-unit
   * canvas, one ink. Drawn wherever an agent on Cursor names itself: the
   * panel's harness mark and the iOS app's agent tile, in the ink of the
   * row it leads.
   */
  CURSOR:
    "M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23",
  /*
   * OpenAI's blossom, verbatim from the standalone blossom in `Blossom_Light.svg`
   * on OpenAI's brand page (openai.com/brand), framed by `OPENAI_VIEW_BOX`, one
   * ink. Drawn wherever Codex names itself: an agent on it, OpenAI's models,
   * and the plans and keys that pay for it, in the ink of the row it leads.
   */
  OPENAI:
    "M872.176 325.027V299.869C872.176 297.751 872.971 296.161 874.825 295.102L925.406 265.974C932.29 262.002 940.5 260.148 948.973 260.148C980.75 260.148 1000.88 284.777 1000.88 310.992C1000.88 312.845 1000.88 314.963 1000.61 317.083L948.178 286.364C945.001 284.512 941.822 284.512 938.645 286.364L872.176 325.027ZM990.283 423.008V362.894C990.283 359.185 988.694 356.538 985.516 354.684L919.048 316.023L940.763 303.575C942.617 302.517 944.206 302.517 946.058 303.575L996.639 332.705C1011.2 341.179 1021 359.185 1021 376.662C1021 396.788 1009.09 415.325 990.283 423.005V423.008ZM856.553 370.045L834.838 357.334C832.986 356.277 832.19 354.688 832.19 352.568V294.311C832.19 265.975 853.905 244.525 883.301 244.525C894.423 244.525 904.748 248.234 913.49 254.853L861.321 285.042C858.146 286.896 856.555 289.544 856.555 293.252V370.048L856.553 370.045ZM903.292 397.055L872.176 379.578V342.506L903.292 325.029L934.407 342.506V379.578L903.292 397.055ZM923.286 477.561C912.163 477.561 901.837 473.852 893.097 467.233L945.264 437.042C948.441 435.19 950.03 432.541 950.03 428.832V352.037L972.011 364.748C973.865 365.805 974.66 367.395 974.66 369.515V427.772C974.66 456.107 952.679 477.558 923.286 477.558V477.561ZM860.525 418.507L809.944 389.377C795.378 380.903 785.582 362.897 785.582 345.42C785.582 325.029 797.763 306.757 816.563 299.077V359.454C816.563 363.163 818.154 365.81 821.33 367.664L887.535 406.06L865.82 418.507C863.967 419.565 862.377 419.565 860.525 418.507ZM857.614 461.936C827.689 461.936 805.71 439.426 805.71 411.621C805.71 409.503 805.976 407.385 806.238 405.265L858.405 435.456C861.582 437.308 864.763 437.308 867.938 435.456L934.407 397.058V422.215C934.407 424.335 933.612 425.924 931.758 426.982L881.179 456.112C874.293 460.084 866.083 461.936 857.611 461.936H857.614ZM923.286 493.447C955.329 493.447 982.073 470.674 988.167 440.485C1017.83 432.804 1036.89 404.999 1036.89 376.665C1036.89 358.128 1028.95 340.122 1014.65 327.145C1015.97 321.584 1016.77 316.023 1016.77 310.463C1016.77 272.596 986.048 244.259 950.562 244.259C943.413 244.259 936.528 245.316 929.644 247.702C917.725 236.049 901.307 228.635 883.301 228.635C851.258 228.635 824.513 251.408 818.42 281.597C788.761 289.278 769.694 317.083 769.694 345.417C769.694 363.955 777.638 381.961 791.938 394.937C790.613 400.498 789.819 406.06 789.819 411.62C789.819 449.487 820.538 477.824 856.024 477.824C863.172 477.824 870.058 476.766 876.943 474.38C888.859 486.033 905.278 493.447 923.286 493.447Z",
  GITHUB:
    "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z",
};

const GOOGLE_MARK_LAYERS = [
  {
    fill: "#4285F4",
    path: "M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z",
  },
  {
    fill: "#34A853",
    path: "M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z",
  },
  {
    fill: "#FBBC05",
    path: "M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z",
  },
  {
    fill: "#EA4335",
    path: "M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z",
  },
];

// ---------- Lucide symbols ----------
// Every glyph the iOS app draws itself is the panel's own Lucide glyph for
// the same place (the developer, Nov 12, 2026), written into the app's asset
// catalog as a custom symbol under its Lucide name: the icons `@repo/ui-native`'s
// `GLYPH` table names, by Lucide's own name for each. Only iOS's own chrome
// (the back chevron, the share sheet, the search field) stays an SF Symbol.
// An alias of Lucide's (`trash-2`) re-exports no drawing, so the table names
// the icon it stands for (`trash`).
const LUCIDE_SYMBOLS = {
  ALARM_CLOCK_CHECK: "alarm-clock-check",
  ALARM_CLOCK_OFF: "alarm-clock-off",
  APP_WINDOW: "app-window",
  APP_WINDOW_MAC: "app-window-mac",
  ARCHIVE: "archive",
  ARCHIVE_RESTORE: "archive-restore",
  ARROW_DOWN: "arrow-down",
  ARROW_UP: "arrow-up",
  AUDIO_LINES: "audio-lines",
  BELL: "bell",
  BOLD: "bold",
  BOOKMARK: "bookmark",
  BOOK_OPEN: "book-open",
  BRIEFCASE: "briefcase",
  BUG: "bug",
  BUILDING_COMPLEX: "building-complex",
  CALENDAR: "calendar",
  CALENDAR_CHECK: "calendar-check",
  CALENDAR_CLOCK: "calendar-clock",
  CALENDAR_COG: "calendar-cog",
  CALENDAR_PLUS: "calendar-plus",
  CALENDAR_X: "calendar-x",
  CHECK: "check",
  CHECK_CHECK: "check-check",
  CHEVRON_DOWN: "chevron-down",
  CHEVRON_RIGHT: "chevron-right",
  CHEVRON_UP: "chevron-up",
  CIRCLE: "circle",
  CIRCLE_ALERT: "circle-alert",
  CIRCLE_ARROW_UP: "circle-arrow-up",
  CIRCLE_CHECK: "circle-check",
  CIRCLE_DASHED: "circle-dashed",
  CIRCLE_DOT: "circle-dot",
  CIRCLE_PLUS: "circle-plus",
  CIRCLE_QUESTION_MARK: "circle-question-mark",
  CIRCLE_SLASH: "circle-slash",
  CIRCLE_STOP: "circle-stop",
  CLOCK: "clock",
  CLOUD: "cloud",
  CLOUD_COG: "cloud-cog",
  CODE: "code",
  COPY: "copy",
  CORNER_DOWN_RIGHT: "corner-down-right",
  CORNER_LEFT_UP: "corner-left-up",
  CPU: "cpu",
  CROWN: "crown",
  DOWNLOAD: "download",
  ELLIPSIS: "ellipsis",
  EXTERNAL_LINK: "external-link",
  EYE: "eye",
  EYE_OFF: "eye-off",
  FACE_SLIGHTLY_SMILING_PLUS: "face-slightly-smiling-plus",
  FILE: "file",
  FILE_DIFF: "file-diff",
  FILE_PEN: "file-pen",
  FILE_PLUS: "file-plus",
  FILE_TEXT: "file-text",
  FLAG: "flag",
  FLASK_CONICAL: "flask-conical",
  FOLDER: "folder",
  FOLDER_GIT: "folder-git",
  FOLDER_INPUT: "folder-input",
  FOLDER_MINUS: "folder-minus",
  FOLDER_PLUS: "folder-plus",
  FOLDER_X: "folder-x",
  GIT_BRANCH: "git-branch",
  GIT_MERGE: "git-merge",
  GIT_PULL_REQUEST: "git-pull-request",
  GIT_PULL_REQUEST_CLOSED: "git-pull-request-closed",
  GIT_PULL_REQUEST_DRAFT: "git-pull-request-draft",
  GLOBE: "globe",
  HAND: "hand",
  HARD_HAT: "hard-hat",
  HEADING: "heading",
  HEADING_1: "heading-1",
  HEADING_2: "heading-2",
  HEADING_3: "heading-3",
  HEART: "heart",
  HOURGLASS: "hourglass",
  HOUSE: "house",
  IMAGE: "image",
  INBOX: "inbox",
  INFO: "info",
  ITALIC: "italic",
  LAPTOP: "laptop",
  LAYERS: "layers",
  LAYOUT_LIST: "layout-list",
  LIGHTBULB: "lightbulb",
  LINK: "link",
  LIST: "list",
  LIST_CHECKS: "list-checks",
  LIST_END: "list-end",
  LIST_INDENT_DECREASE: "list-indent-decrease",
  LIST_INDENT_INCREASE: "list-indent-increase",
  LIST_ORDERED: "list-ordered",
  LIST_TODO: "list-todo",
  LIST_TREE: "list-tree",
  LOG_OUT: "log-out",
  MAIL: "mail",
  MAIL_OPEN: "mail-open",
  MAXIMIZE_2: "maximize-2",
  MESSAGES_SQUARE: "messages-square",
  MESSAGE_SQUARE: "message-square",
  MESSAGE_SQUARE_PLUS: "message-square-plus",
  MESSAGE_SQUARE_WARNING: "message-square-warning",
  MIC: "mic",
  MIC_OFF: "mic-off",
  MINUS: "minus",
  MOUSE_POINTER_CLICK: "mouse-pointer-click",
  NETWORK: "network",
  OCTAGON_MINUS: "octagon-minus",
  PANEL_LEFT: "panel-left",
  PAUSE: "pause",
  PAPERCLIP: "paperclip",
  PENCIL: "pencil",
  PENCIL_LINE: "pencil-line",
  PEN_LINE: "pen-line",
  PHONE_OFF: "phone-off",
  PIN: "pin",
  PIN_OFF: "pin-off",
  PLAY: "play",
  PLUG: "plug",
  PLUS: "plus",
  ROCKET: "rocket",
  ROTATE_CCW: "rotate-ccw",
  ROTATE_CCW_CLOCK: "rotate-ccw-clock",
  ROTATE_CW: "rotate-cw",
  SCROLL_TEXT: "scroll-text",
  SEARCH: "search",
  SEARCH_X: "search-x",
  SEND: "send",
  SERVER: "server",
  SETTINGS: "settings",
  SHIELD_ALERT: "shield-alert",
  SHIELD_ELLIPSIS: "shield-ellipsis",
  SHIELD_USER: "shield-user",
  SLIDERS_HORIZONTAL: "sliders-horizontal",
  SPLIT: "split",
  SQUARE_CHECK: "square-check",
  SQUARE_CODE: "square-code",
  SQUARE_PEN: "square-pen",
  STAR: "star",
  STRIKETHROUGH: "strikethrough",
  SUNRISE: "sunrise",
  TERMINAL: "terminal",
  TEXT_QUOTE: "text-quote",
  TIMER: "timer",
  TRASH: "trash",
  TRIANGLE_ALERT: "triangle-alert",
  TYPE: "type",
  UNDO_2: "undo-2",
  UNLINK: "unlink",
  USER: "user",
  USERS: "users",
  USER_PLUS: "user-plus",
  VOLUME_2: "volume-2",
  VOLUME_OFF: "volume-off",
  WIFI_OFF: "wifi-off",
  WRENCH: "wrench",
  X: "x",
  ZAP: "zap",
};

// Note that the drawings are read from the lucide-react @repo/ui resolves,
// so the phone's glyphs are the panel's at the very version it pins, and
// brand declares no second copy beside it.
const lucideFrom = createRequire(UI_MANIFEST);

// The asset's name: Lucide's own component name, "git-merge" as "GitMerge".
const assetName = lucideAssetName;

const lucideSymbols = await Promise.all(
  Object.entries(LUCIDE_SYMBOLS).map(async ([key, icon]) => {
    const module = lucideFrom.resolve(`lucide-react/dist/esm/icons/${icon}.mjs`);
    const { __iconData } = await import(pathToFileURL(module).href);

    // Note that an alias of Lucide's (`trash-2`) re-exports the component alone, so the table names the icon it stands for (`trash`).
    if (__iconData === undefined)
      throw new Error(
        `generate-surface-shared: "${icon}" is an alias of a Lucide icon; name the icon it re-exports`,
      );

    return { key, name: assetName(icon), svg: symbolTemplate(__iconData.node) };
  }),
);

// The status marks' symbols, named for the status: "IN_PROGRESS" as "TaskStatusInProgress".
const taskStatusSymbols = Object.entries(TASK_STATUS_MARK).map(([key, parts]) => ({
  key,
  name: `TaskStatus${assetName(key.toLowerCase().replaceAll("_", "-"))}`,
  svg: markTemplate(parts, {
    box: TASK_MARK_BOX,
    lineWidth: TASK_MARK_LINE_WIDTH,
    roles: TASK_MARK_ROLE,
    elements: TASK_MARK_ELEMENT,
  }),
}));

// The Keel's small cut as one symbol, seated as the panel seats it among line
// glyphs (`ProductMark`'s glyph): its 100-unit disc inset 10 units on each
// side of a 120-unit square, so it spans 20 of a line glyph's 24 units, the
// span Lucide's circles draw within. Note that its paths move only by their
// absolute moves, since every other command in them is relative.
const KEEL_GLYPH_INSET = 10;
const KEEL_GLYPH_BOX = 100 + KEEL_GLYPH_INSET * 2;

const insetKeel = (path) =>
  path.replaceAll(
    /M(-?[\d.]+),(-?[\d.]+)/gu,
    (_, x, y) => `M${Number(x) + KEEL_GLYPH_INSET},${Number(y) + KEEL_GLYPH_INSET}`,
  );

const productMarkSymbol = {
  name: "ProductMark",
  svg: markTemplate(
    [{ role: TASK_MARK_ROLE.FILL, element: TASK_MARK_ELEMENT.PATH, d: insetKeel(MARK.SMALL_PATH) }],
    {
      box: KEEL_GLYPH_BOX,
      lineWidth: TASK_MARK_LINE_WIDTH,
      roles: TASK_MARK_ROLE,
      elements: TASK_MARK_ELEMENT,
    },
  ),
};

// A priority mark's parts as one symbol, each in one ink.
const priorityTemplate = (parts) =>
  markTemplate(parts, {
    box: TASK_MARK_BOX,
    lineWidth: TASK_MARK_LINE_WIDTH,
    roles: TASK_MARK_ROLE,
    elements: TASK_MARK_ELEMENT,
  });

// The priority marks' symbols, named for the priority: "URGENT" as "TaskPriorityUrgent", each its lit parts alone. Note that a priority's unlit bars stand in a symbol of their own, which the app draws faint beneath it, rather than as a second layer, since a palette of the two drew the whole symbol black on iOS.
const taskPrioritySymbols = Object.entries(TASK_PRIORITY_MARK).map(([key, parts]) => ({
  key,
  name: `TaskPriority${assetName(key.toLowerCase())}`,
  svg: priorityTemplate(parts.filter(({ layer }) => layer !== TASK_MARK_LAYER.UNLIT)),
}));

// Every bar a priority can light, the faint ground a priority's lit bars stand on.
const taskPriorityBars = {
  name: "TaskPriorityBars",
  svg: priorityTemplate(TASK_PRIORITY_MARK.HIGH),
};

// No one's mark as two symbols, its dashed ring and the seat drawn faint
// under it. Note that the ring's dashes are measured along its path's
// counted length, as the panel's SVG lays them, so they are measured again
// along its circumference here, where the outline is cut.
const unassignedPart = ({ dash, ...part }) =>
  dash === undefined
    ? part
    : {
        ...part,
        dash: dash.map((length) => (length * 2 * Math.PI * part.r) / UNASSIGNED_RING_PATH_LENGTH),
      };

const unassignedTemplate = (parts) =>
  markTemplate(parts.map(unassignedPart), {
    box: UNASSIGNED_MARK_BOX,
    lineWidth: UNASSIGNED_MARK_LINE_WIDTH,
    roles: TASK_MARK_ROLE,
    elements: TASK_MARK_ELEMENT,
  });

const unassignedSymbols = [
  { key: "RING", name: "UnassignedRing", svg: unassignedTemplate(UNASSIGNED_MARK.RING) },
  { key: "SEAT", name: "UnassignedSeat", svg: unassignedTemplate(UNASSIGNED_MARK.SEAT) },
];

// ---------- Emission ----------
const CHECK_ONLY = process.argv.includes("--check");
const written = [];
const stale = [];

function put(path, content) {
  if (CHECK_ONLY) {
    const current = existsSync(path) ? readFileSync(path, "utf8") : undefined;

    if (current !== content) stale.push(path);

    return;
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function linearCss(samples) {
  return `linear(\n    ${samples.join(",\n    ")}\n  )`;
}

function ms(value) {
  return `${value}ms`;
}

// Note that the motion vocabulary is @repo/ui's alone, under its --ui-*
// names: every app that loads its tokens moves a spring, a duration, or a
// delay alike, and there is no second set beside it.
function uiMotionTokensCss() {
  return `/* Generated by packages/brand/scripts/generate-surface-shared.mjs. Do not edit by hand: change
   the tables in that script and re-run it.

   The motion every surface reads: brand's springs, durations, and
   delays under @repo/ui's names, so every app that imports
   @repo/ui/tokens.css moves them alike. motion.css answers reduced motion. */

:root {
  --ui-spring: ${linearCss(SPRING)};
  --ui-spring-fast: ${linearCss(SPRING_FAST)};
  --ui-duration-hover: ${ms(MOTION_DURATION_MS.HOVER)};
  --ui-duration-exit: ${ms(MOTION_DURATION_MS.EXIT)};
  --ui-duration-quick: ${ms(MOTION_DURATION_MS.QUICK)};
  --ui-duration-pane: ${ms(MOTION_DURATION_MS.PANE)};
  --ui-duration-fast: ${ms(MOTION_DURATION_MS.FAST)};
  --ui-duration-shape: ${ms(MOTION_DURATION_MS.SPRING)};
  --ui-duration-showcase: ${ms(MOTION_DURATION_MS.SHOWCASE)};
  --ui-motion-exit: ${MOTION_EXIT};
  --ui-motion-pane: ${MOTION_PANE};
  --ui-hint-delay: ${ms(MOTION_DELAY_MS.HINT)};
  --ui-late-delay: ${ms(MOTION_DELAY_MS.LATE)};
  --ui-confirm-delay: ${ms(MOTION_DELAY_MS.CONFIRM)};
  --ui-flash-delay: ${ms(MOTION_DELAY_MS.FLASH)};
  --ui-settle-delay: ${ms(MOTION_DELAY_MS.SETTLE)};
}
`;
}

function tsRecord(entries, indent = "  ") {
  return entries.map(([key, value]) => `${indent}${key}: ${value},`).join("\n");
}

function motionTokensTs() {
  return `// Generated by packages/brand/scripts/generate-surface-shared.mjs. Do not edit by hand: change
// the tables in that script and re-run it.
//
// Millisecond mirrors of the CSS duration tokens in motion-tokens.css, from the
// same table. A main-process constant that waits on a CSS total names these
// rather than restating the numbers.

export const MOTION_DURATION_MS = {
${tsRecord(Object.entries(MOTION_DURATION_MS).map(([key, value]) => [key, value]))}
} as const;

export const MOTION_DELAY_MS = {
${tsRecord(Object.entries(MOTION_DELAY_MS).map(([key, value]) => [key, value]))}
} as const;
`;
}

function tsStringConst(name, value) {
  const single = `export const ${name} = "${value}";`;

  return single.length <= 100 ? single : `export const ${name} =\n  "${value}";`;
}

function providerMarkPathsTs() {
  const pathConsts = Object.entries(MARK_PATHS)
    .map(([name, path]) => tsStringConst(`${name}_PATH`, path))
    .join("\n\n");

  // One property per line, matching the shape Biome would format these to —
  // the emitted file is committed and linted, so the two must agree exactly.
  const google = GOOGLE_MARK_LAYERS.map(
    (layer) => `  {\n    fill: "${layer.fill}",\n    path: "${layer.path}",\n  },`,
  ).join("\n");

  return `// Generated by packages/brand/scripts/generate-surface-shared.mjs. Do not edit by hand: change
// the tables in that script and re-run it.
//
// SVG path data for the marks a sign-in or an agent's harness names itself by.
// The React that traces them stays in each app.

${pathConsts}

// The boxes Claude's spark and OpenAI's blossom stand in. The blossom stands
// where OpenAI's own file drew it, so its box frames it there, made square.
export const CLAUDE_VIEW_BOX = "0 0 94 94";

export const OPENAI_VIEW_BOX = "769.69 227.44 267.2 267.2";

// Google's "G" sign-in mark, drawn as filled layers in an 18×18 box.
export const GOOGLE_MARK_LAYERS: readonly { fill: string; path: string }[] = [
${google}
];
`;
}

function lucideSymbolsTs() {
  const templates = lucideSymbols
    .map(({ name, svg }) => `  {\n    name: "${name}",\n    svg: '${svg}',\n  },`)
    .join("\n");

  return `// Generated by packages/brand/scripts/generate-surface-shared.mjs. Do not edit by hand: change
// the tables in that script and re-run it.
//
// Lucide's glyphs as SF Symbols custom symbol templates, their strokes
// outlined in three weights iOS interpolates (scripts/lucide-symbols.mjs),
// which the iOS app's config writes into its asset catalog as symbol sets.

export const LUCIDE_SYMBOL_TEMPLATES: readonly { name: string; svg: string }[] = [
${templates}
];
`;
}

function nativeLucideSymbolsTs() {
  return `// Generated by packages/brand/scripts/generate-surface-shared.mjs. Do not edit by hand: change
// the tables in that script and re-run it.
//
// The names the iOS app's asset catalog holds Lucide's glyphs under, as
// symbol sets the app's config writes from @repo/brand's templates.

export const LUCIDE_SYMBOL = {
${tsRecord(lucideSymbols.map(({ key, name }) => [key, `"${name}"`]))}
} as const;
`;
}

// Every Lucide glyph's name, which the app's catalog holds a symbol set of
// each under, as app.config.ts writes them from every-lucide-symbol.mjs.
const everyLucide = await everyLucideName();

function nativeEveryLucideTs() {
  return `// Generated by packages/brand/scripts/generate-surface-shared.mjs. Do not edit by hand: change
// the tables in that script and re-run it.
//
// Every Lucide glyph's name, as the iOS app's asset catalog holds a symbol
// set of each, which its config outlines at prebuild (every-lucide-symbol.mjs),
// so a section may wear any glyph the panel's picker offers.

export const EVERY_LUCIDE_SYMBOL: readonly string[] = [
${everyLucide.map((name) => `  "${name}",`).join("\n")}
];
`;
}

// A mark's part as TypeScript, one property to a line and its dash array on
// one, as Biome formats the committed file.
function tsMarkPart(part, indent) {
  const properties = Object.entries(part).map(
    ([key, item]) =>
      `${indent}  ${key}: ${Array.isArray(item) ? `[${item.join(", ")}]` : JSON.stringify(item)},`,
  );

  return `{\n${properties.join("\n")}\n${indent}}`;
}

// Each mark of a table as TypeScript, its parts in drawing order.
function tsMarks(table) {
  const marks = Object.entries(table).map(
    ([key, parts]) =>
      `  ${key}: [\n${parts.map((part) => `    ${tsMarkPart(part, "    ")},`).join("\n")}\n  ],`,
  );

  return `{\n${marks.join("\n")}\n}`;
}

// A table of names as TypeScript, one to a line.
const tsNames = (table) =>
  `{\n${tsRecord(Object.entries(table).map(([key, name]) => [key, JSON.stringify(name)]))}\n}`;

function taskStatusMarksTs() {
  return `// Generated by packages/brand/scripts/generate-surface-shared.mjs. Do not edit by hand: change
// the tables in task-status-marks.mjs and re-run it.
//
// A task's status and priority as their marks draw them: each part an SVG
// element on a ${TASK_MARK_BOX}-unit square, a line stroked ${TASK_MARK_LINE_WIDTH} wide, a fill, or a
// cut, the stroke drawn in the ground's ink over a fill; a priority's bar is
// lit or unlit, the unlit drawn at ${TASK_PRIORITY_UNLIT_OPACITY} of the lit. @repo/ui draws
// them as SVG, and the iOS app as the custom symbols task-status-symbols.ts holds.

export const TASK_MARK_ROLE = ${tsNames(TASK_MARK_ROLE)} as const;

export const TASK_MARK_ELEMENT = ${tsNames(TASK_MARK_ELEMENT)} as const;

export const TASK_MARK_LAYER = ${tsNames(TASK_MARK_LAYER)} as const;

export const TASK_PRIORITY_UNLIT_OPACITY = ${TASK_PRIORITY_UNLIT_OPACITY};

export const TASK_STATUS_MARK = ${tsMarks(TASK_STATUS_MARK)} as const;

export const TASK_PRIORITY_MARK = ${tsMarks(TASK_PRIORITY_MARK)} as const;

// No one's mark: a ring of dashes measured along a path counted
// ${UNASSIGNED_RING_PATH_LENGTH} long, stroked ${UNASSIGNED_MARK_LINE_WIDTH} wide on a ${UNASSIGNED_MARK_BOX}-unit square, and a seat
// drawn at ${UNASSIGNED_SEAT_OPACITY} of it.

export const UNASSIGNED_MARK_BOX = ${UNASSIGNED_MARK_BOX};

export const UNASSIGNED_MARK_LINE_WIDTH = ${UNASSIGNED_MARK_LINE_WIDTH};

export const UNASSIGNED_RING_PATH_LENGTH = ${UNASSIGNED_RING_PATH_LENGTH};

export const UNASSIGNED_SEAT_OPACITY = ${UNASSIGNED_SEAT_OPACITY};

export const UNASSIGNED_MARK = ${tsMarks(UNASSIGNED_MARK)} as const;
`;
}

// A list of symbol templates as TypeScript, one object to a template.
const tsTemplates = (symbols) =>
  symbols.map(({ name, svg }) => `  {\n    name: "${name}",\n    svg: '${svg}',\n  },`).join("\n");

function taskStatusSymbolsTs() {
  return `// Generated by packages/brand/scripts/generate-surface-shared.mjs. Do not edit by hand: change
// the tables in task-status-marks.mjs and re-run it.
//
// A task's status and priority marks as SF Symbols custom symbol templates,
// each one outline whose cuts are holes, a priority's lit bars apart from
// every bar it can light, in three weights iOS interpolates (scripts/lucide-symbols.mjs),
// which the iOS app's config writes into its asset catalog as symbol sets.

export const TASK_STATUS_SYMBOL_TEMPLATES: readonly { name: string; svg: string }[] = [
${tsTemplates([...taskStatusSymbols, ...unassignedSymbols])}
];

export const TASK_PRIORITY_SYMBOL_TEMPLATES: readonly { name: string; svg: string }[] = [
${tsTemplates([...taskPrioritySymbols, taskPriorityBars])}
];
`;
}

function nativeTaskStatusSymbolsTs() {
  return `// Generated by packages/brand/scripts/generate-surface-shared.mjs. Do not edit by hand: change
// the tables in task-status-marks.mjs and re-run it.
//
// The names the iOS app's asset catalog holds a task's status and priority
// marks under, as symbol sets the app's config writes from @repo/brand's
// templates, the bars a priority's lit ones stand on, and how strongly those
// unlit bars are drawn.

export const TASK_STATUS_SYMBOL = {
${tsRecord(taskStatusSymbols.map(({ key, name }) => [key, `"${name}"`]))}
} as const;

export const TASK_PRIORITY_SYMBOL = {
${tsRecord(taskPrioritySymbols.map(({ key, name }) => [key, `"${name}"`]))}
} as const;

export const TASK_PRIORITY_BARS_SYMBOL = "${taskPriorityBars.name}";

export const TASK_PRIORITY_UNLIT_OPACITY = ${TASK_PRIORITY_UNLIT_OPACITY};

export const UNASSIGNED_SYMBOL = {
${tsRecord(unassignedSymbols.map(({ key, name }) => [key, `"${name}"`]))}
} as const;

export const UNASSIGNED_SEAT_OPACITY = ${UNASSIGNED_SEAT_OPACITY};
`;
}

function productMarkSymbolTs() {
  return `// Generated by packages/brand/scripts/generate-surface-shared.mjs. Do not edit by hand: change
// the mark in keel-mark.mjs and re-run it.
//
// The product's mark, the Keel, as an SF Symbols custom symbol template,
// seated as a line glyph, which the iOS app's config writes into its asset
// catalog as a symbol set.

export const PRODUCT_MARK_SYMBOL_TEMPLATE = {
  name: "${productMarkSymbol.name}",
  svg: '${productMarkSymbol.svg}',
} as const;
`;
}

function nativeProductMarkSymbolTs() {
  return `// Generated by packages/brand/scripts/generate-surface-shared.mjs. Do not edit by hand: change
// the mark in keel-mark.mjs and re-run it.
//
// The name the iOS app's asset catalog holds the product's mark under, as a
// symbol set the app's config writes from @repo/brand's template.

export const PRODUCT_MARK_SYMBOL = "${productMarkSymbol.name}";
`;
}

// The brand's roles under their --ui-color-* names: the desktop writes each
// once as light-dark(), as palettes.css does, and the site a block per theme,
// for browsers older than light-dark().
const roleName = (key) => `--ui-color-${key.toLowerCase().replaceAll("_", "-")}`;

function uiBrandCss() {
  const keys = Object.keys(BRAND.LIGHT);

  const pair = (key) =>
    BRAND.LIGHT[key] === BRAND.DARK[key]
      ? BRAND.LIGHT[key]
      : `light-dark(${BRAND.LIGHT[key]}, ${BRAND.DARK[key]})`;

  const block = (value) => keys.map((key) => `  ${roleName(key)}: ${value(key)};`).join("\n");

  return `/* Generated by packages/brand/scripts/generate-surface-shared.mjs. Do not edit by hand: change
   the tables in that script and re-run it.

   The brand's colors on @repo/ui's roles, both profiles, both themes. The
   roles no brand changes are palettes.css's. */

[data-ui-profile="desktop"] {
${block(pair)}
}

[data-ui-profile="web"],
[data-ui-profile="web"][data-ui-theme="light"] {
${block((key) => BRAND.LIGHT[key])}
}

[data-ui-profile="web"][data-ui-theme="dark"] {
${block((key) => BRAND.DARK[key])}
}

/* The accent over a ground no theme chooses, someone else's page, where the
   agent's pointer is drawn: the light theme's over a light page and the dark
   theme's over a dark one, whatever the window's own theme. */
[data-ui-profile] {
  --ui-color-accent-on-light: ${BRAND.LIGHT.ACCENT};
  --ui-color-accent-on-dark: ${BRAND.DARK.ACCENT};
}
`;
}

// Geist's steps under --geist-<scale>-<step> names, laid out as brand.css
// lays out the brand's: once as light-dark() on the desktop, and a block per
// theme on the site. palettes.css names these rather than writing a hex.
function uiGeistCss() {
  const steps = Object.entries(GEIST).flatMap(([scale, values]) =>
    Object.entries(values).map(([at, colors]) => [
      `--geist-${scale.toLowerCase().replaceAll("_", "-")}-${at}`,
      colors,
    ]),
  );

  const block = (value) => steps.map(([name, colors]) => `  ${name}: ${value(colors)};`).join("\n");

  const pair = (colors) =>
    colors.LIGHT === colors.DARK ? colors.LIGHT : `light-dark(${colors.LIGHT}, ${colors.DARK})`;

  return `/* Generated by packages/brand/scripts/generate-surface-shared.mjs. Do not edit by hand: change
   geist.mjs and re-run it.

   Geist's colors (https://vercel.com/geist/colors), every step of every
   scale, both profiles, both themes. A role names one of these; none is
   drawn with directly. */

[data-ui-profile="desktop"] {
${block(pair)}
}

[data-ui-profile="web"],
[data-ui-profile="web"][data-ui-theme="light"] {
${block((colors) => colors.LIGHT)}
}

[data-ui-profile="web"][data-ui-theme="dark"] {
${block((colors) => colors.DARK)}
}
`;
}

// The identity hues under --ui-color-identity-1 through -6, laid out as
// brand.css lays out the brand's: once as light-dark() on the desktop, and a
// block per theme on the site.
function uiIdentityCss() {
  const block = (value) =>
    [
      ...IDENTITY.LIGHT.map((_, index) => `  --ui-color-identity-${index + 1}: ${value(index)};`),
      `  --ui-color-on-identity: ${IDENTITY.ON};`,
    ].join("\n");

  const pair = (index) =>
    IDENTITY.LIGHT[index] === IDENTITY.DARK[index]
      ? IDENTITY.LIGHT[index]
      : `light-dark(${IDENTITY.LIGHT[index]}, ${IDENTITY.DARK[index]})`;

  return `/* Generated by packages/brand/scripts/generate-surface-shared.mjs. Do not edit by hand: change
   the IDENTITY table in brand-palette.mjs and re-run it.

   A person's disc (\`avatar.tsx\`) and a workspace's tile: six muted hues
   read off an id, each holding its white letter at AA on either ground. None
   is copper, so no one's disc reads as attention's beside a row. The iOS
   app's tile draws the same values (@repo/ui-native's identity-hues.ts). */

[data-ui-profile="desktop"] {
${block(pair)}
}

[data-ui-profile="web"],
[data-ui-profile="web"][data-ui-theme="light"] {
${block((index) => IDENTITY.LIGHT[index])}
}

[data-ui-profile="web"][data-ui-theme="dark"] {
${block((index) => IDENTITY.DARK[index])}
}
`;
}

function brandPaletteTs() {
  const theme = (values) =>
    tsRecord(
      Object.entries(values).map(([key, value]) => [key, `"${value}"`]),
      "    ",
    );

  const managerFaceFills = Object.entries(MANAGER_FACE)
    .map(
      ([name, [light, dark]]) => `  ${name.toLowerCase()}: { LIGHT: "${light}", DARK: "${dark}" },`,
    )
    .join("\n");

  return `// Generated by packages/brand/scripts/generate-surface-shared.mjs. Do not edit by hand: change
// the tables in that script and re-run it.
//
// The brand's colors as plain values, from the table @repo/ui's brand.css
// is written from, for what reads no custom property: an email, a check of
// the palette's contrast.

export const BRAND_PALETTE = {
  LIGHT: {
${theme(BRAND.LIGHT)}
  },
  DARK: {
${theme(BRAND.DARK)}
  },
} as const;

// The fill a Manager's face is drawn in, by the word its color is stored as
// (@repo/features/manager-face's MANAGER_FACE_COLOR), in the light theme and
// the dark: the same values @repo/ui's manager-face.css names
// --ui-color-manager-face-*, which the iOS app's faces are filled with.
export const MANAGER_FACE_FILL = {
${managerFaceFills}
} as const;
`;
}

// Note that iOS reads no custom property, so the app's colors are values in
// either theme, which @repo/ui-native picks between by the color scheme.
function nativeBrandColorsTs() {
  const theme = (values) =>
    tsRecord(
      NATIVE_ROLES.map((key) => [key, `"${values[key]}"`]),
      "    ",
    );

  return `// Generated by packages/brand/scripts/generate-surface-shared.mjs. Do not edit by hand: change
// the tables in that script and re-run it.
//
// The brand's colors the iOS app draws with, from the table @repo/ui's
// brand.css is written from, in the light theme and the dark.

export const BRAND_COLOR = {
  LIGHT: {
${theme(BRAND.LIGHT)}
  },
  DARK: {
${theme(BRAND.DARK)}
  },
} as const;
`;
}

// Note that the hues are kept in @repo/features/workspace-tile's order, so
// identityHue's 1 is the first of each list.
function nativeIdentityHuesTs() {
  const hues = (values) => `[${values.map((value) => `"${value}"`).join(", ")}]`;

  return `// Generated by packages/brand/scripts/generate-surface-shared.mjs. Do not edit by hand: change
// the IDENTITY table in brand-palette.mjs and re-run it.
//
// The six hues a workspace's letter stands on, by the hue
// @repo/features/workspace-tile's identityHue reads off its id, in the light
// theme and the dark: the same values @repo/ui's identity.css names
// --ui-color-identity-1 through -6.

export const IDENTITY_HUE = {
  LIGHT: ${hues(IDENTITY.LIGHT)},
  DARK: ${hues(IDENTITY.DARK)},
} as const;

// The letter's ink on every hue.
export const ON_IDENTITY = "${IDENTITY.ON}";
`;
}

function uiFileIconCss() {
  const inks = Object.entries(FILE_ICON)
    .map(
      ([name, [light, dark]]) =>
        `  --file-icon-${name.toLowerCase()}: light-dark(${light}, ${dark});`,
    )
    .join("\n");

  return `/* Generated by packages/brand/scripts/generate-surface-shared.mjs. Do not edit by hand: change
   the FILE_ICON table in brand-palette.mjs and re-run it.

   A file's type icon in the file tree's own palette (\`@pierre/trees\`),
   which its shadow root keeps to itself, said again for a file drawn outside
   the tree, and the colors a sidebar section's glyph may wear. The iOS app
   draws the same values (@repo/ui-native's file-icon-inks.ts). */

:root {
${inks}
}
`;
}

function uiManagerFaceCss() {
  const fills = Object.entries(MANAGER_FACE)
    .map(
      ([name, [light, dark]]) =>
        `  --ui-color-manager-face-${name.toLowerCase()}: light-dark(${light}, ${dark});`,
    )
    .join("\n");

  return `/* Generated by packages/brand/scripts/generate-surface-shared.mjs. Do not edit by hand: change
   the MANAGER_FACE table in brand-palette.mjs and re-run it.

   A Manager's face (\`manager-face.tsx\`): the soft fill a React Kawaii
   character's body is drawn in, one to each color a face may be. */

:root {
${fills}
}
`;
}

function nativeFileIconInksTs() {
  const inks = (at) =>
    Object.entries(FILE_ICON)
      .map(([name, pair]) => `    ${name}: "${pair[at]}",`)
      .join("\n");

  return `// Generated by packages/brand/scripts/generate-surface-shared.mjs. Do not edit by hand: change
// the FILE_ICON table in brand-palette.mjs and re-run it.
//
// The file tree's palette, which a sidebar section's glyph wears its chosen
// color in, in the light theme and the dark: the same values @repo/ui's
// file-icon.css names --file-icon-*.

export const FILE_ICON_INK = {
  LIGHT: {
${inks(0)}
  },
  DARK: {
${inks(1)}
  },
} as const;
`;
}

const outputs = [
  [join(SURFACE, "motion-tokens.ts"), motionTokensTs()],
  [join(SURFACE, "provider-mark-paths.ts"), providerMarkPathsTs()],
  [join(UI_TOKENS, "motion-tokens.css"), uiMotionTokensCss()],
  [join(SURFACE, "brand-palette.ts"), brandPaletteTs()],
  [join(UI_TOKENS, "geist.css"), uiGeistCss()],
  [join(UI_TOKENS, "brand.css"), uiBrandCss()],
  [join(UI_NATIVE_TOKENS, "brand-colors.ts"), nativeBrandColorsTs()],
  [join(UI_TOKENS, "identity.css"), uiIdentityCss()],
  [join(UI_NATIVE_TOKENS, "identity-hues.ts"), nativeIdentityHuesTs()],
  [join(UI_TOKENS, "file-icon.css"), uiFileIconCss()],
  [join(UI_NATIVE_TOKENS, "file-icon-inks.ts"), nativeFileIconInksTs()],
  [join(UI_TOKENS, "manager-face.css"), uiManagerFaceCss()],
  [join(SURFACE, "lucide-symbols.ts"), lucideSymbolsTs()],
  [join(UI_NATIVE_TOKENS, "lucide-symbols.ts"), nativeLucideSymbolsTs()],
  [join(UI_NATIVE_TOKENS, "every-lucide-symbol.ts"), nativeEveryLucideTs()],
  [join(SURFACE, "task-status-marks.ts"), taskStatusMarksTs()],
  [join(SURFACE, "task-status-symbols.ts"), taskStatusSymbolsTs()],
  [join(UI_NATIVE_TOKENS, "task-status-symbols.ts"), nativeTaskStatusSymbolsTs()],
  [join(SURFACE, "product-mark-symbol.ts"), productMarkSymbolTs()],
  [join(UI_NATIVE_TOKENS, "product-mark-symbol.ts"), nativeProductMarkSymbolTs()],
];

for (const [path, content] of outputs) {
  put(path, content);
  written.push(path);
}

if (!CHECK_ONLY) {
  process.stdout.write(`${written.length} generated files written\n`);
} else if (stale.length > 0) {
  process.stderr.write(
    `${stale.length} generated file(s) no longer match this script:\n${stale.join("\n")}\n` +
      "Run: node packages/brand/scripts/generate-surface-shared.mjs\n",
  );
  process.exit(1);
} else {
  process.stdout.write(`${written.length} generated files are up to date\n`);
}
