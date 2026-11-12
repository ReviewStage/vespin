/**
 * checkout-diff.ts -- the files a coding agent's turn changed, as git tells them apart: the diff between the checkout its runner recorded before the turn and the next one recorded, or the checkout as it stands, whichever machine the checkout stands on.
 *
 * The runner records the checkout before each turn as a commit under a ref
 * of the checkout's own (`@repo/agent-runner`'s `checkout-snapshot.ts`), so
 * what a turn changed is the diff from its snapshot to the next turn's, and
 * for the last turn recorded, to the working tree as it stands, untracked
 * files included and ignored ones left out, read the way a snapshot reads
 * them. The one script here runs in the checkout, in a cloud sandbox through
 * the service (`packages/service`'s `coder-host/checkout-restore.ts`) and on
 * a Mac through its host, with the two commits in its variables, the second
 * empty for the working tree, so neither splices a commit into shell text
 * and the two can never diff differently. It prints git's own unified diff,
 * renames found, bounded in bytes, which `checkoutDiffFiles` reads into the
 * files the Changes view draws (`agent-wire.ts`'s `AgentChangedFile`), as it
 * draws a pull request's files read off GitHub; a secret file's patch is
 * left out by name (`isSecretFile`), as no read carries its lines, since the
 * working tree a turn is diffed against holds the checkout's own `.env`. A
 * snapshot the checkout no longer holds, as after its sandbox was made anew,
 * ends the script with `CHECKOUT_DIFF_EXIT.MISSING` before it diffs anything.
 */

import {
  type AgentChangedFile,
  CHANGED_FILE_STATUS,
  CHANGES_BOUNDS,
  type ChangedFileStatus,
  PATCH_OMITTED,
} from "./agent-wire.js";
import { isSecretFile } from "./task-wire.js";

/** The variables the script reads the two sides from: the commit before the turn, and the commit after it, empty for the working tree as it stands. */
export const CHECKOUT_DIFF_VARIABLE = {
  FROM: "APP_DIFF_FROM",
  TO: "APP_DIFF_TO",
} as const;

/** How the script ends where it diffs nothing: a commit it was handed is not in the checkout. */
export const CHECKOUT_DIFF_EXIT = {
  MISSING: 3,
} as const;

export const CHECKOUT_DIFF_BOUNDS = {
  /** The most bytes of diff the script prints; a diff cut here loses its last file, which the reading says. */
  MAX_BYTES: 4 * 1024 * 1024,
} as const;

const { FROM, TO } = CHECKOUT_DIFF_VARIABLE;

/**
 * The diff, run with the checkout as its working directory. Note that the
 * working tree is read as a snapshot reads it, the index copied and the
 * tree added to the copy, so untracked files are among the changes and
 * ignored ones are not; that the copy and the diff stand in a folder of
 * this run's own, removed as it ends however it ends, so two diffs of one
 * checkout at once never read each other's; and that the diff is written
 * to a file before it is bounded, so a git that fails ends the script
 * rather than printing a diff cut short.
 *
 * What git brought in from upstream during the turn is not the turn's: a
 * snapshot is a commit on the `HEAD` it was taken over, so where the merge
 * base of that `HEAD` with `origin/HEAD` moved between the two sides (a
 * merge, a rebase, or a pull), every path upstream changed between the two
 * bases is taken as the side after the turn holds it, so it drops out of
 * the diff. Note that a file the turn changed too drops out with it, which
 * leaves a turn naming less than it did, never upstream's work as its own,
 * and works on any git a machine has. Note too that
 * where a commit between the two bases was committed by the checkout's own
 * committer, it may be the turn's own work that reached upstream, as an
 * agent's push to the default branch does, and history cannot tell it from
 * upstream's, so the turn is diffed as it stands rather than risk leaving
 * out what it did. A checkout with no `origin/HEAD`, or a side with no
 * `HEAD` under it, is diffed as it stands too.
 */
export const CHECKOUT_DIFF_SCRIPT = [
  "set -eu",
  "umask 0002",
  `if ! git cat-file -e "$${FROM}^{commit}" 2>/dev/null; then exit ${CHECKOUT_DIFF_EXIT.MISSING}; fi`,
  "git_dir=$(git rev-parse --git-dir)",
  'run=$(mktemp -d "$git_dir/vespin-diff.XXXXXX")',
  "trap 'rm -rf \"$run\"' EXIT",
  `from="$${FROM}"`,
  `to="$${TO}"`,
  'if [ -n "$to" ]; then',
  `  if ! git cat-file -e "$to^{commit}" 2>/dev/null; then exit ${CHECKOUT_DIFF_EXIT.MISSING}; fi`,
  '  to_head=$(git rev-parse -q --verify "$to^1^{commit}" 2>/dev/null || true)',
  "else",
  '  if [ -f "$git_dir/index" ]; then cp "$git_dir/index" "$run/index"; fi',
  "  to=$(GIT_INDEX_FILE=\"$run/index\" sh -c 'git add -A -- . >/dev/null && git write-tree')",
  "  to_head=$(git rev-parse -q --verify 'HEAD^{commit}' 2>/dev/null || true)",
  "fi",
  'from_head=$(git rev-parse -q --verify "$from^1^{commit}" 2>/dev/null || true)',
  "upstream=$(git rev-parse -q --verify 'refs/remotes/origin/HEAD^{commit}' 2>/dev/null || true)",
  'if [ -n "$from_head" ] && [ -n "$to_head" ] && [ -n "$upstream" ]; then',
  '  was=$(git merge-base "$from_head" "$upstream" 2>/dev/null || true)',
  '  now=$(git merge-base "$to_head" "$upstream" 2>/dev/null || true)',
  '  if [ -n "$was" ] && [ -n "$now" ] && [ "$was" != "$now" ]; then',
  "    me=$(git var GIT_COMMITTER_IDENT 2>/dev/null | sed -n 's/.*<\\(.*\\)>.*/\\1/p' || true)",
  '    git log --format=%ce "$was..$now" > "$run/committers"',
  '    if [ -n "$me" ] && grep -qxF -- "$me" "$run/committers"; then was="$now"; fi',
  "  fi",
  '  if [ -n "$was" ] && [ -n "$now" ] && [ "$was" != "$now" ]; then',
  '    git diff --name-only -z --no-renames "$was" "$now" > "$run/upstream"',
  '    GIT_INDEX_FILE="$run/before" git read-tree "$from"',
  '    if [ -s "$run/upstream" ]; then',
  '      GIT_INDEX_FILE="$run/before" xargs -0 git update-index --force-remove -- < "$run/upstream"',
  '      xargs -0 git ls-tree -r -z --full-tree "$to" -- < "$run/upstream" > "$run/after"',
  '      GIT_INDEX_FILE="$run/before" git update-index -z --index-info < "$run/after"',
  "    fi",
  '    from=$(GIT_INDEX_FILE="$run/before" git write-tree)',
  "  fi",
  "fi",
  `git -c core.quotepath=false diff --no-color --no-ext-diff --no-textconv --find-renames "$from" "$to" > "$run/out"`,
  `head -c ${CHECKOUT_DIFF_BOUNDS.MAX_BYTES} "$run/out"`,
].join("\n");

/** The two sides a diff stands between, as the turn's rows keep them: the snapshot before the turn, and the one after it, or null for the working tree. */
export interface CheckoutDiffRange {
  readonly from: string;
  readonly to: string | null;
}

/** The script's variables for the range given. */
export function checkoutDiffEnv(range: CheckoutDiffRange) {
  return { [FROM]: range.from, [TO]: range.to ?? "" } satisfies Readonly<Record<string, string>>;
}

/** The files a diff names, as the Changes view draws them, and whether the diff was cut short of some. */
export interface CheckoutDiffFiles {
  readonly files: readonly AgentChangedFile[];
  readonly truncated: boolean;
}

const FILE_HEADER = "diff --git ";
const HUNK_HEADER = "@@";
const NO_SIDE = "/dev/null";

/** The paths a header names where the two sides are the same path: `a/<path> b/<path>`, the path's length what is left once the four marks are taken off. */
function samePathOf(header: string): string {
  const rest = header.slice(FILE_HEADER.length);

  return rest.slice(2, 2 + (rest.length - 5) / 2);
}

/** A side's path off its `--- ` or `+++ ` line, none for no side. Note that git ends a path holding a space with a tab, so patch tells it from a date after it, which is taken off. */
function sideOf(line: string): string | undefined {
  const named = line.slice(4).replace(/\t$/u, "");

  return named === NO_SIDE ? undefined : named.slice(2);
}

/** One file's section of the diff read into a changed file. */
function fileOf(lines: readonly string[]): AgentChangedFile {
  const header = lines[0] ?? "";
  let status: ChangedFileStatus = CHANGED_FILE_STATUS.MODIFIED;
  let path: string | undefined;
  let previousPath: string | null = null;
  let binary = false;
  let additions = 0;
  let deletions = 0;
  const hunks: string[] = [];

  for (const line of lines.slice(1)) {
    if (hunks.length > 0 || line.startsWith(HUNK_HEADER)) {
      hunks.push(line);

      if (line.startsWith("+")) additions += 1;
      else if (line.startsWith("-")) deletions += 1;
      continue;
    }

    if (line.startsWith("new file mode")) status = CHANGED_FILE_STATUS.ADDED;
    else if (line.startsWith("deleted file mode")) status = CHANGED_FILE_STATUS.DELETED;
    else if (line.startsWith("rename from ")) {
      status = CHANGED_FILE_STATUS.RENAMED;
      previousPath = line.slice("rename from ".length);
    } else if (line.startsWith("rename to ")) path = line.slice("rename to ".length);
    else if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) binary = true;
    else if (line.startsWith("--- ")) path ??= sideOf(line);
    else if (line.startsWith("+++ ")) path = sideOf(line) ?? path;
  }

  path ??= samePathOf(header);
  const patch = hunks.join("\n");
  const secret = isSecretFile(path) || (previousPath !== null && isSecretFile(previousPath));

  const omitted = secret
    ? PATCH_OMITTED.SECRET
    : binary
      ? PATCH_OMITTED.BINARY
      : patch.length > CHANGES_BOUNDS.MAX_PATCH_CHARS
        ? PATCH_OMITTED.TOO_LARGE
        : null;

  return {
    path,
    previousPath,
    status,
    additions,
    deletions,
    patch: omitted === null ? patch : null,
    omitted,
  };
}

/**
 * The files the script's output names, each as the Changes view draws one:
 * its path and the one it was moved from, whether it was added, deleted,
 * renamed, or changed in place, its lines added and removed, and its hunks
 * as its patch, left out as a secret file's, as binary where git printed
 * none, or as too large past the Changes view's bound. The last file of an output cut at the
 * script's bound is left out, since it may be cut mid-hunk, and the files
 * past the view's bound are too, either said as cut short.
 */
export function checkoutDiffFiles(output: string): CheckoutDiffFiles {
  const sections: string[][] = [];

  for (const line of output.split("\n")) {
    if (line.startsWith(FILE_HEADER)) sections.push([line]);
    else sections.at(-1)?.push(line);
  }

  // A last line of nothing is the newline the diff ends on, not a line of the last file.
  const last = sections.at(-1);

  if (last !== undefined && last.at(-1) === "") last.pop();
  // The bound is the script's, in bytes, so the output is measured as the bytes it came as.
  const cut = new TextEncoder().encode(output).length >= CHECKOUT_DIFF_BOUNDS.MAX_BYTES;
  const whole = cut ? sections.slice(0, -1) : sections;
  const kept = whole.slice(0, CHANGES_BOUNDS.MAX_FILES);

  return {
    files: kept.map(fileOf),
    truncated: cut || whole.length > kept.length,
  };
}
