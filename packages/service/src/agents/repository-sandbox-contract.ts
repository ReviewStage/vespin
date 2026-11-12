/**
 * repository-sandbox-contract.ts -- where a repository's checkout stands in a sandbox and the variables its scripts read.
 *
 * A leaf of its own, importing only the state folder's leaf and the
 * checkout's (`@repo/features/checkout-path`, which the transcript reads a
 * path into the checkout by), because the coding agent's bounds
 * (`coder-host/bounds.ts`) name the checkout's path and every tool file of
 * the agent reads those bounds: kept in `repository-shell.ts`, the path
 * reached GitHub's App and the auth service with it, and each tool's own
 * bundle carried them.
 */

import { CLOUD_CHECKOUT_PATH } from "@repo/features/checkout-path";
import { SANDBOX_STATE_FOLDER } from "./sandbox-state-folder.js";

/**
 * What the shell hands the sandbox, which is the whole of what a sandbox
 * sees of it: where the checkout stands and the file beside it naming
 * which repository it is of, and the variables each script reads, so
 * nothing of the repository's name or the model's command is spliced into
 * shell text. A test's sandbox double answers from this contract.
 */
export const REPOSITORY_SANDBOX_CONTRACT = {
  PATH: {
    WORKSPACE: "/workspace",
    CHECKOUT: CLOUD_CHECKOUT_PATH,
    CHECKOUT_RECORD: `${SANDBOX_STATE_FOLDER}/repository`,
    /** What the workspace's cloud setup scripts printed as the sandbox was created, and how they exited. */
    SETUP_LOG: "/tmp/vespin-setup.log",
  },
  VARIABLE: {
    /** The repository the call is about, `owner/name`, read by the probe and the checkout. */
    REPOSITORY: "APP_REPOSITORY",
    /** The branch the checkout is of: the default branch, or the one a coding agent was started on. */
    BRANCH: "APP_BRANCH",
    /** The clone's URL, which carries no credential; its presence is what makes a run the checkout. */
    URL: "APP_CLONE_URL",
    /** The model's command, which bash reads from the variable and never from shell text. */
    COMMAND: "APP_COMMAND",
    /** The folder under the workspace a workspace drive's repository stands in. */
    FOLDER: "APP_CHECKOUT_FOLDER",
    /** The folders a workspace drive keeps, one `owner/name` a line; its presence is what makes a run the drive's prune. */
    KEEP: "APP_KEEP_FOLDERS",
    /** A workspace drive's batch: one line per repository, its folder, branch, and clone address. */
    SYNC_LIST: "APP_SYNC_LIST",
    /** The script that syncs one repository of a batch, which the batch runs for each line. */
    SYNC_ONE: "APP_SYNC_ONE",
  },
} as const;
