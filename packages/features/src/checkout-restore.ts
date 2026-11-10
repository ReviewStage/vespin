/**
 * checkout-restore.ts -- a coding agent's checkout put back to the snapshot its runner took before a turn, whichever machine the checkout stands on.
 *
 * The runner records the checkout before each turn as a commit under a ref
 * of the checkout's own (`@repo/agent-runner`'s `checkout-snapshot.ts`),
 * and the turn's row keeps the commit, `HEAD` then, and the branch checked
 * out then. A rewind that restores the files runs this script in the
 * checkout, in a cloud sandbox through the service
 * (`packages/service`'s `coder-host/checkout-restore.ts`) and on a Mac
 * through its host, with the snapshot in these variables, so neither
 * splices a commit into shell text and the two can never restore
 * differently. What it does: puts `HEAD` back on the branch checked out at
 * the snapshot, made again at its commit then only where the agent deleted
 * it, and moves no branch otherwise, so every commit made since stays where
 * it is; then makes the working tree and the index the snapshot's, files
 * the snapshot lacks removed and ignored files left alone, and unstages
 * everything, so what differs from `HEAD` reads as plain uncommitted
 * changes. A snapshot the checkout no longer holds, as after its sandbox
 * was made anew, ends the script with `CHECKOUT_RESTORE_EXIT.MISSING`
 * before it touches anything.
 */

/** The variables the script reads the snapshot from: the commit, `HEAD` then (empty in a repository that had none), and the branch then (empty on a detached `HEAD`). */
export const CHECKOUT_RESTORE_VARIABLE = {
  COMMIT: "APP_SNAPSHOT_COMMIT",
  HEAD: "APP_SNAPSHOT_HEAD",
  BRANCH: "APP_SNAPSHOT_BRANCH",
} as const;

/** How the script ends where it restores nothing: the snapshot's commit is not in the checkout. */
export const CHECKOUT_RESTORE_EXIT = {
  MISSING: 3,
} as const;

const { COMMIT, HEAD, BRANCH } = CHECKOUT_RESTORE_VARIABLE;

/**
 * The restore, run with the checkout as its working directory. Note that
 * the working tree is added to the index first, so `read-tree` sees every
 * file and writes exactly those that differ from the snapshot, and that
 * the index is reset to `HEAD` last, or emptied where `HEAD` is unborn,
 * so nothing stands staged after it.
 */
export const CHECKOUT_RESTORE_SCRIPT = [
  "set -eu",
  "umask 0002",
  `if ! git cat-file -e "$${COMMIT}^{commit}" 2>/dev/null; then exit ${CHECKOUT_RESTORE_EXIT.MISSING}; fi`,
  `if [ -n "$${BRANCH}" ]; then`,
  `  if [ -n "$${HEAD}" ] && ! git show-ref --verify --quiet "refs/heads/$${BRANCH}"; then git branch --quiet "$${BRANCH}" "$${HEAD}"; fi`,
  `  git symbolic-ref HEAD "refs/heads/$${BRANCH}"`,
  `elif [ -n "$${HEAD}" ]; then`,
  `  git update-ref --no-deref HEAD "$${HEAD}"`,
  "fi",
  "git add -A -- .",
  `git read-tree --reset -u "$${COMMIT}"`,
  "if git rev-parse --verify --quiet HEAD >/dev/null 2>&1; then git reset -q; else git rm -r -q --cached -- . >/dev/null 2>&1 || true; fi",
].join("\n");

/** The snapshot a restore puts the checkout back to, as the turn's row keeps it. */
export interface CheckoutRestoreSnapshot {
  readonly commit: string;
  readonly head: string | null;
  readonly branch: string | null;
}

/** The script's variables for the snapshot given. */
export function checkoutRestoreEnv(
  snapshot: CheckoutRestoreSnapshot,
): Readonly<Record<string, string>> {
  return {
    [COMMIT]: snapshot.commit,
    [HEAD]: snapshot.head ?? "",
    [BRANCH]: snapshot.branch ?? "",
  };
}
