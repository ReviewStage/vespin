import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ARCHIVE_WRITE_GUARD_RULE, namesArchiveWrite } from "./shared/archive-write-guard.ts";
import { ARROW_KEY_GUARD_RULE, NAMES_ARROW_KEY } from "./shared/arrow-key-guard.ts";
import { BUSY_GUARD_RULE } from "./shared/busy-guard.ts";
import { HEADING_GUARD_RULE } from "./shared/heading-guard.ts";
import { HOST_READ_GUARD_RULE, isWatchedSource } from "./shared/host-read-guard.ts";
import { KEPT_GUARD_RULE } from "./shared/kept-guard.ts";
import { LIVE_REGION_GUARD_RULE } from "./shared/live-region-guard.ts";
import { LUCIDE_GUARD_RULE } from "./shared/lucide-guard.ts";
import { MESSAGE_BOX_GUARD_RULE, namesBoxPart } from "./shared/message-box-guard.ts";
import { isOutsideUiNative, NATIVE_PRESS_GUARD_RULE } from "./shared/native-press-guard.ts";
import { OPEN_PAGE_GUARD_RULE } from "./shared/open-page-guard.ts";
import { namesEllipsisPlaceholder, PLACEHOLDER_GUARD_RULE } from "./shared/placeholder-guard.ts";
import {
  configWeakensGuard,
  guardSuppressionLines,
  ignoredFiles,
  isOutsideUi,
  JSX_SOURCE,
  PRESS_GUARD_RULE,
} from "./shared/press-guard.ts";
import { PRESS_LISTENER_GUARD_RULE } from "./shared/press-listener-guard.ts";
import { TYPESCRIPT_SOURCE } from "./shared/repository-path.ts";
import { namesRetired, RETIRED_GUARD_RULE } from "./shared/retired.ts";
import { ROW_BEHAVIOR_GUARD_RULE } from "./shared/row-behavior-guard.ts";
import { namesSandboxDelete, SANDBOX_DELETE_GUARD_RULE } from "./shared/sandbox-delete-guard.ts";
import { SETTINGS_ROW_END_GUARD_RULE } from "./shared/settings-row-end-guard.ts";
import { SHADCN_FOCUS_GUARD_RULE, SHADCN_SOURCE } from "./shared/shadcn-focus-guard.ts";
import { callsSubjectBuilder, SHORTCUT_FLAG_GUARD_RULE } from "./shared/shortcut-flag-guard.ts";
import { SKELETON_GUARD_RULE } from "./shared/skeleton-guard.ts";
import {
  isWatchedTest,
  SKIPPED_TEST_GUARD_RULE,
  SOURCE_READ_GUARD_RULE,
  TEST_SOURCE,
} from "./shared/test-guard.ts";

/**
 * The design system's guards have no escape hatch: oxlint honors every
 * inline disable and has no flag to refuse one, so `pnpm lint` runs this
 * after it. It fails on a JSX-capable file outside `@repo/ui` holding a
 * directive that would silence `no-raw-press-outside-ui`, on one outside
 * `@repo/ui-native` holding one that would silence
 * `no-raw-press-outside-ui-native`, on any JSX-capable
 * file holding one that would silence `skeleton-through-components`,
 * `settings-row-end`, `row-behavior-in-row`, whose list of row components
 * is the only way past it, on any TypeScript file holding one that would
 * silence `one-message-box`, whose list of builders is the only way past it, or
 * `sandbox-delete-in-one-place`, whose list of deleters is the only way past it, or `async-press-needs-busy`, whose baseline is the
 * only way past it, on a
 * JSX-capable file outside `@repo/ui` holding one that would silence
 * `no-open-page-from-button`, `no-raw-heading-outside-ui` or
 * `no-hand-written-live-region`, on any TypeScript file outside `@repo/ui`
 * that names an arrow key and holds one that would silence
 * `no-hand-written-arrow-keys`, on any TypeScript file holding one that would
 * silence `no-lucide-outside-door` or, where it adds a listener,
 * `no-document-press-listener` or, where it names the window's storage or
 * its helpers, `no-direct-view-storage`, whose baselines are the only way past
 * them, on any TypeScript file that names a placeholder and words ending in
 * an ellipsis and holds one that would silence `no-placeholder-ellipsis`,
 * which has no way past it, on any of the panel's or the design system's own
 * TypeScript files
 * holding one that would silence `no-follow-outside-host-read`, which has no
 * way past it, on any TypeScript file that spells
 * a retired name and holds one that would silence `retired`, whose retired
 * file's baseline is the only way past it, on a vendored shadcn component
 * holding one that would silence `no-shadcn-focus-ring`, on any TypeScript
 * file calling a menu-item builder that takes the menu's subject and holding
 * one that would silence `no-shortcut-flag`, which has no way past it, on any
 * TypeScript file holding one that would silence `archive-through-agent-change`,
 * whose allowed list is the only way past it, on any test file
 * holding one that would silence `no-focused-or-skipped-test` or
 * `no-source-read-in-test`, which hold rules
 * root AGENTS.md's "Testing" says never bend, and on an `.oxlintrc.json` that
 * leaves any of them short of an error anywhere or whose `ignorePatterns`
 * hide a file one of them watches.
 */
const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

/** Tracked files and new ones git does not ignore, so a local run sees a file not yet added. */
function sourceFiles(): readonly string[] {
  const listed = spawnSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
    },
  );
  if (listed.status !== 0) throw new Error(`git ls-files failed:\n${listed.stderr}`);
  return listed.stdout.split("\0").filter((file) => file.length > 0);
}

/** A press listener on the whole window, as far as the text says: the only file that has anything to silence. */
const PRESS_LISTENER =
  /(?:document|window|globalThis|ownerDocument|defaultView)\s*\.\s*addEventListener\(\s*["'`](?:pointerdown|mousedown|touchstart|click|auxclick)/u;

/** A file that touches the window's storage or imports the helpers over it, as far as the text says: the only file that has anything to silence. */
const KEPT_STORAGE = /\b(?:localStorage|sessionStorage)\b|kept-storage/u;

/** Each guard, the files it watches, and what to do instead of silencing it. */
const GUARDS = [
  {
    rule: PRESS_GUARD_RULE,
    sources: JSX_SOURCE,
    watches: (absolute: string) => isOutsideUi(absolute),
    remedy: "Move the press onto a @repo/ui component or variant instead",
  },
  {
    rule: NATIVE_PRESS_GUARD_RULE,
    sources: JSX_SOURCE,
    watches: (absolute: string) => isOutsideUiNative(absolute),
    remedy: "Move the press onto a @repo/ui-native component or variant instead",
  },
  {
    rule: SETTINGS_ROW_END_GUARD_RULE,
    sources: JSX_SOURCE,
    watches: () => true,
    remedy:
      "Stand the ⋯, chevron, or other glyph-wide press in the row's `end`, which keeps to the name's line at any width",
  },
  {
    rule: ROW_BEHAVIOR_GUARD_RULE,
    sources: JSX_SOURCE,
    watches: () => true,
    remedy:
      "Build the menu, rename, selection, or muted or unread state inside the row component every list of its kind draws, or name a new row component in tools/oxlint/vespin/row-behavior.json with its reason",
  },
  {
    rule: MESSAGE_BOX_GUARD_RULE,
    sources: TYPESCRIPT_SOURCE,
    // A file that never names a part has nothing to silence; the guards' own tests spell fixtures.
    watches: (absolute: string) =>
      !path.relative(REPOSITORY_ROOT, absolute).startsWith("tools/oxlint/vespin/") &&
      existsSync(absolute) &&
      namesBoxPart(readFileSync(absolute, "utf8")),
    remedy:
      "Draw the box with useMessageBox and MessageBox (or MessageField) from message-box.tsx, adding the slot or option it lacks there, or name a box that differs on purpose in tools/oxlint/vespin/message-box.json with its reason",
  },
  {
    rule: SANDBOX_DELETE_GUARD_RULE,
    sources: TYPESCRIPT_SOURCE,
    // A file that reaches no sandbox and names no helper has nothing to silence; the guards' own tests spell fixtures.
    watches: (absolute: string) =>
      !path.relative(REPOSITORY_ROOT, absolute).startsWith("tools/oxlint/vespin/") &&
      existsSync(absolute) &&
      namesSandboxDelete(readFileSync(absolute, "utf8")),
    remedy:
      "Delete the agent's sandbox through packages/service/src/agents/session-sandboxes.ts, or name a file that must delete one in tools/oxlint/vespin/sandbox-deletes.json with its reason",
  },
  {
    rule: SKELETON_GUARD_RULE,
    sources: JSX_SOURCE,
    watches: () => true,
    remedy:
      "Draw the skeleton in a `*Skeleton` component, through the components the loaded state draws with",
  },
  {
    rule: BUSY_GUARD_RULE,
    sources: JSX_SOURCE,
    watches: () => true,
    remedy:
      "Pass `busy` and `busyLabel` to the button (`useBusyPress` holds them), so a press that waits shows it is working",
  },
  {
    rule: OPEN_PAGE_GUARD_RULE,
    sources: JSX_SOURCE,
    watches: (absolute: string) => isOutsideUi(absolute),
    remedy:
      "Draw a link instead (ButtonLink, TextLink, or Chip's href), so a page opens from a link",
  },
  {
    rule: HEADING_GUARD_RULE,
    sources: JSX_SOURCE,
    watches: (absolute: string) => isOutsideUi(absolute),
    remedy:
      "Draw the heading with Text from @repo/ui (`as` for the element, a type role for the look) instead",
  },
  {
    rule: LIVE_REGION_GUARD_RULE,
    sources: JSX_SOURCE,
    watches: (absolute: string) => isOutsideUi(absolute),
    remedy:
      "Say it with `announce` from @repo/ui, or draw the words in FailureNote, ErrorState, EmptyState or NoteLine, instead",
  },
  {
    rule: ARROW_KEY_GUARD_RULE,
    sources: TYPESCRIPT_SOURCE,
    // A file that never names an arrow key has nothing to silence; the guards' own tests spell fixtures.
    watches: (absolute: string) =>
      isOutsideUi(absolute) &&
      !path.relative(REPOSITORY_ROOT, absolute).startsWith("tools/oxlint/vespin/") &&
      existsSync(absolute) &&
      NAMES_ARROW_KEY.test(readFileSync(absolute, "utf8")),
    remedy: "Step the list with useRovingKeys or List from @repo/ui instead",
  },
  {
    rule: LUCIDE_GUARD_RULE,
    sources: TYPESCRIPT_SOURCE,
    // The guards' own tests spell bare directives as fixtures, and oxlint ignores that tree anyway.
    // A file that never names the library has nothing to silence, so an ignored tree of vendored code is no gap.
    watches: (absolute: string) =>
      !path.relative(REPOSITORY_ROOT, absolute).startsWith("tools/oxlint/vespin/") &&
      existsSync(absolute) &&
      readFileSync(absolute, "utf8").includes("lucide-react"),
    remedy: "Import the icon from @repo/ui/icons instead",
  },
  {
    rule: PLACEHOLDER_GUARD_RULE,
    sources: TYPESCRIPT_SOURCE,
    // A file that names no placeholder, or holds no words ending in an ellipsis, has nothing to silence; the guards' own tests spell fixtures.
    watches: (absolute: string) =>
      !path.relative(REPOSITORY_ROOT, absolute).startsWith("tools/oxlint/vespin/") &&
      existsSync(absolute) &&
      namesEllipsisPlaceholder(readFileSync(absolute, "utf8")),
    remedy:
      "Drop the trailing ellipsis, so the placeholder ends on its last word; a value's shape such as `ghp_…` keeps its own",
  },
  {
    rule: PRESS_LISTENER_GUARD_RULE,
    sources: TYPESCRIPT_SOURCE,
    // A file that never adds a listener has nothing to silence; the guards' own tests spell fixtures.
    watches: (absolute: string) =>
      !path.relative(REPOSITORY_ROOT, absolute).startsWith("tools/oxlint/vespin/") &&
      existsSync(absolute) &&
      PRESS_LISTENER.test(readFileSync(absolute, "utf8")),
    remedy:
      "Close the popover through `onPressAway` on its AnchoredPopover or RectFloat, or `usePressAway`, instead",
  },
  {
    rule: KEPT_GUARD_RULE,
    sources: TYPESCRIPT_SOURCE,
    // A file that names no storage has nothing to silence; the guards' own tests spell fixtures.
    watches: (absolute: string) =>
      !path.relative(REPOSITORY_ROOT, absolute).startsWith("tools/oxlint/vespin/") &&
      existsSync(absolute) &&
      KEPT_STORAGE.test(readFileSync(absolute, "utf8")),
    remedy:
      "Keep the choice through `useKept` (`packages/panel/src/use-kept.ts`) instead, or name storage that is no view choice in tools/oxlint/vespin/kept-storage-allowed.json with its reason",
  },
  {
    rule: HOST_READ_GUARD_RULE,
    sources: TYPESCRIPT_SOURCE,
    watches: (absolute: string) => isWatchedSource(path.relative(REPOSITORY_ROOT, absolute)),
    remedy: "Read server data through a live read's query (packages/panel/src/live-reads.ts)",
  },
  {
    rule: RETIRED_GUARD_RULE,
    sources: TYPESCRIPT_SOURCE,
    // As for Lucide: a file that never spells a retired name has nothing to silence.
    watches: (absolute: string) =>
      !path.relative(REPOSITORY_ROOT, absolute).startsWith("tools/oxlint/vespin/") &&
      existsSync(absolute) &&
      namesRetired(readFileSync(absolute, "utf8")),
    remedy: "Use what the retired file under tools/oxlint/vespin/retired/ names instead",
  },
  {
    rule: SHADCN_FOCUS_GUARD_RULE,
    sources: TYPESCRIPT_SOURCE,
    watches: (absolute: string) => SHADCN_SOURCE.test(path.relative(REPOSITORY_ROOT, absolute)),
    remedy: "Drop the utility, so the window's own ring stands for the control",
  },
  {
    rule: SHORTCUT_FLAG_GUARD_RULE,
    sources: TYPESCRIPT_SOURCE,
    // A file that calls no builder taking a subject has nothing to silence; the guards' own tests spell fixtures.
    watches: (absolute: string) =>
      !path.relative(REPOSITORY_ROOT, absolute).startsWith("tools/oxlint/vespin/") &&
      existsSync(absolute) &&
      callsSubjectBuilder(readFileSync(absolute, "utf8")),
    remedy:
      "Pass the menu's subject (`shortcutSubject`), and say where its keys act from the place that offers them (`useShortcutTarget`)",
  },
  {
    rule: ARCHIVE_WRITE_GUARD_RULE,
    sources: TYPESCRIPT_SOURCE,
    // A file that names no archive writer and writes no archive column has nothing to silence; the guards' own tests spell fixtures.
    watches: (absolute: string) =>
      !path.relative(REPOSITORY_ROOT, absolute).startsWith("tools/oxlint/vespin/") &&
      existsSync(absolute) &&
      namesArchiveWrite(readFileSync(absolute, "utf8")),
    remedy:
      "Archive or bring back the agent through packages/service/src/agents/agent-change.ts, or name a file that must call the store itself in tools/oxlint/vespin/archive-writes.json with its reason",
  },
  {
    rule: SKIPPED_TEST_GUARD_RULE,
    sources: TEST_SOURCE,
    watches: isWatchedTest,
    remedy: "Fix the test or delete it instead",
  },
  {
    rule: SOURCE_READ_GUARD_RULE,
    sources: TEST_SOURCE,
    watches: isWatchedTest,
    remedy:
      "Hold the rule about source text in a lint rule under tools/oxlint/vespin/, and assert behavior through the public export, instead",
  },
] as const;

const config: unknown = JSON.parse(
  readFileSync(path.join(REPOSITORY_ROOT, ".oxlintrc.json"), "utf8"),
);
const files = sourceFiles();
for (const guard of GUARDS) {
  const problems: string[] = [];
  const weakened = configWeakensGuard(config, guard.rule);
  if (weakened !== undefined) problems.push(`.oxlintrc.json: ${weakened}`);
  const watched = files.filter(
    (file) => guard.sources.test(file) && guard.watches(path.join(REPOSITORY_ROOT, file)),
  );
  for (const [pattern, hidden] of ignoredFiles(config, watched)) {
    problems.push(
      `.oxlintrc.json: ignorePatterns entry "${pattern}" hides files it watches, ${hidden[0]} among them`,
    );
  }
  for (const file of files) {
    if (!guard.sources.test(file)) continue;
    const absolute = path.join(REPOSITORY_ROOT, file);
    if (!guard.watches(absolute) || !existsSync(absolute)) continue;
    for (const line of guardSuppressionLines(readFileSync(absolute, "utf8"), guard.rule)) {
      problems.push(`${file}:${line}: a disable directive silences ${guard.rule}`);
    }
  }
  if (problems.length === 0) continue;
  process.stderr.write(
    `error: ${guard.rule} takes no suppression. ${guard.remedy}:\n${problems.map((problem) => `  ${problem}`).join("\n")}\n`,
  );
  process.exitCode = 1;
}
