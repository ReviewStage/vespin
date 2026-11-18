/**
 * cloud-environment-query.ts -- the reads Settings › Cloud environment asks the host for as it opens, each kept under the account and the workspace, so the page and the sheet that adds a variable draw from one read.
 */

import type { QueryKey } from "@tanstack/react-query";

/** Each read's root key. */
const CLOUD_ENVIRONMENT_QUERY = {
  SIZE: "cloud-environment-size",
  VARIABLES: "cloud-environment-variables",
  SETUP: "cloud-environment-setup",
} as const;

/** The key the workspace's sandbox size is kept under. */
export function sandboxSizeKey(accountId: string, workspaceId: string): QueryKey {
  return [CLOUD_ENVIRONMENT_QUERY.SIZE, accountId, workspaceId];
}

/** The key the workspace's variables are kept under. */
export function variablesKey(accountId: string, workspaceId: string): QueryKey {
  return [CLOUD_ENVIRONMENT_QUERY.VARIABLES, accountId, workspaceId];
}

/** The key the workspace's install and setup scripts are kept under. */
export function cloudSetupKey(accountId: string, workspaceId: string): QueryKey {
  return [CLOUD_ENVIRONMENT_QUERY.SETUP, accountId, workspaceId];
}
