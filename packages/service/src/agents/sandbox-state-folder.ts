/**
 * sandbox-state-folder.ts -- the folder our own state stands in within a sandbox.
 *
 * Two folders of a sandbox hold what we keep there: the workspace's, beside
 * the checkout (its record), and the sandbox user's home's (the browser's
 * profile and recordings). A leaf importing nothing, since the checkout's
 * contract imports it.
 */

/** The folder our state stands in, under the workspace and under the sandbox user's home. */
export const SANDBOX_STATE_FOLDER = ".agent";
