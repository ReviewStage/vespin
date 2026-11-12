/**
 * checkout-diff.ts -- the one script that diffs a coding agent's turn where its checkout stands, and the reading of its counts into the turn's summary.
 *
 * The runner records the checkout before each turn as a commit
 * (`checkout-snapshot.ts`), so what a turn changed is the diff from its
 * snapshot to the next turn's, or to the working tree as it stands, untracked
 * files included and ignored ones left out, read the way a snapshot reads
 * them. The script runs in the checkout wherever it is: by the runner as a
 * turn ends, for the turn's summary of files (`TurnFilesSummary`); in a
 * cloud sandbox through the service, and on a Mac through its host, for the
 * patch the Changes view draws (`@repo/features/checkout-diff`'s
 * `checkoutDiffFiles`). One script for all of them, so a turn's summary and
 * its Changes tab can never name different files. Its sides ride in its
 * variables, so no caller splices a commit into shell text. A snapshot the
 * checkout no longer holds ends it with `CHECKOUT_DIFF_EXIT.MISSING` before
 * it diffs anything. It imports nothing that reaches Node, so every caller's
 * bundle may hold it.
 */

import { TURN_FILES_BOUNDS, type TurnFile, type TurnFilesSummary } from "./protocol.js";

/** The variables the script reads the two sides from: the commit before the turn, and the commit after it, empty for the working tree as it stands. */
export const CHECKOUT_DIFF_VARIABLE = {
  FROM: "APP_DIFF_FROM",
  TO: "APP_DIFF_TO",
  FORMAT: "APP_DIFF_FORMAT",
} as const;

/** What the script prints: git's unified patch, which the Changes view reads, or its counts alone, a line a file, which a turn's summary reads. */
export const CHECKOUT_DIFF_FORMAT = {
  PATCH: "patch",
  NUMSTAT: "numstat",
} as const;

export type CheckoutDiffFormat = (typeof CHECKOUT_DIFF_FORMAT)[keyof typeof CHECKOUT_DIFF_FORMAT];

/** How the script ends where it diffs nothing: a commit it was handed is not in the checkout. */
export const CHECKOUT_DIFF_EXIT = {
  MISSING: 3,
} as const;

export const CHECKOUT_DIFF_BOUNDS = {
  /** The most bytes of diff the script prints; a diff cut here loses its last file, which the reading says. */
  MAX_BYTES: 4 * 1024 * 1024,
} as const;

const { FROM, TO, FORMAT } = CHECKOUT_DIFF_VARIABLE;

/**
 * The diff, run with the checkout as its working directory. Note that the
 * working tree is read as a snapshot reads it, the index copied and the
 * tree added to the copy, so untracked files are among the changes and
 * ignored ones are not; that the copy and the diff stand in a folder of
 * this run's own, removed as it ends however it ends, so two diffs of one
 * checkout at once never read each other's; and that the diff is written
 * to a file before it is bounded, so a git that fails ends the script
 * rather than printing a diff cut short. It prints git's patch, or, where
 * `CHECKOUT_DIFF_FORMAT.NUMSTAT` is asked, git's counts a file alone, so the
 * Changes view and a turn's summary always name the same files.
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
  `if [ "$${FORMAT}" = "${CHECKOUT_DIFF_FORMAT.NUMSTAT}" ]; then`,
  '  git -c core.quotepath=false diff --no-color --no-ext-diff --numstat -z --find-renames "$from" "$to" > "$run/out"',
  "else",
  '  git -c core.quotepath=false diff --no-color --no-ext-diff --no-textconv --find-renames "$from" "$to" > "$run/out"',
  "fi",
  `head -c ${CHECKOUT_DIFF_BOUNDS.MAX_BYTES} "$run/out"`,
].join("\n");

/** The two sides a diff stands between, as the turn's rows keep them: the snapshot before the turn, and the one after it, or null for the working tree. */
export interface CheckoutDiffRange {
  readonly from: string;
  readonly to: string | null;
}

/** The script's variables for the range given, printing `format`, the patch where none is named. */
export function checkoutDiffEnv(
  range: CheckoutDiffRange,
  format: CheckoutDiffFormat = CHECKOUT_DIFF_FORMAT.PATCH,
) {
  return { [FROM]: range.from, [TO]: range.to ?? "", [FORMAT]: format } satisfies Readonly<
    Record<string, string>
  >;
}

/** One file's counts as `git diff --numstat -z` prints them: binary files count no lines. */
function countOf(field: string): number {
  const count = Number(field);

  return Number.isInteger(count) && count >= 0 ? count : 0;
}

/**
 * The turn's summary read off the script's counts (`CHECKOUT_DIFF_FORMAT.NUMSTAT`):
 * each file's path, where a rename names it where it moved to, and its lines
 * added and removed, the first `TURN_FILES_BOUNDS.MAX_FILES` kept, with how
 * many files and lines the turn changed over all of them. None where the
 * turn changed no file.
 */
export function turnFilesSummary(output: string): TurnFilesSummary | undefined {
  const fields = output.split("\0");
  const files: TurnFile[] = [];
  let total = 0;
  let additions = 0;
  let deletions = 0;

  for (let at = 0; at < fields.length; at += 1) {
    const [added, removed, named] = (fields[at] ?? "").split("\t");

    if (added === undefined || removed === undefined || named === undefined) continue;
    // A rename names no path on its counts' line, but the two after it, the second where it moved to.
    const path = named === "" ? fields[at + 2] : named;

    if (named === "") at += 2;

    if (path === undefined || path === "") continue;
    const file = { path, additions: countOf(added), deletions: countOf(removed) };
    total += 1;
    additions += file.additions;
    deletions += file.deletions;

    if (files.length < TURN_FILES_BOUNDS.MAX_FILES) files.push(file);
  }

  return total === 0 ? undefined : { files, total, additions, deletions };
}
