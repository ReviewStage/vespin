/**
 * workspace-sandbox-size.ts -- a workspace's cloud sandbox size as the panel reads and chooses it: the vCPUs its agents' sandboxes open with.
 *
 * The size is asked of the service through the host each time a place that
 * draws it opens (`ACT_KIND.WORKSPACE_SANDBOX_SIZE_READ`), since no live
 * read carries it, and a choice answers the size as it then stands, which
 * is laid over that read at once, so every place drawing it agrees.
 */

import type { SandboxVcpus } from "@repo/features/sandbox-size";
import type { WorkspaceSandboxSizeAnswer } from "@repo/features/workspace-sandbox-size-wire";
import { ACT_KIND } from "@repo/host/acts";
import { type QueryClient, queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { askAct, sendAct } from "./act.js";
import { QUERY_ROOT } from "./query-keys.js";

/** The workspace's sandbox size, read as a place drawing it opens and on Try again. */
export function sandboxSizeQuery(workspaceId: string) {
  return queryOptions({
    queryKey: [QUERY_ROOT.WORKSPACE_SANDBOX_SIZE, workspaceId],
    queryFn: () => askAct(ACT_KIND.WORKSPACE_SANDBOX_SIZE_READ, { workspaceId }),
    retry: false,
  });
}

/** A choice's answer drawn over the read, a read still under way canceled first so its older size cannot land over it. */
async function drawAnswer(
  queries: QueryClient,
  workspaceId: string,
  answer: WorkspaceSandboxSizeAnswer,
): Promise<void> {
  const { queryKey } = sandboxSizeQuery(workspaceId);
  await queries.cancelQueries({ queryKey, exact: true });
  queries.setQueryData(queryKey, answer);
}

/** An owner's or admin's choice of the workspace's sandbox size, its answer drawn over the read at once; a member's is refused as not permitted. */
export function useChooseSandboxSize(workspaceId: string) {
  const queries = useQueryClient();

  return useMutation({
    mutationFn: (vcpus: SandboxVcpus) =>
      sendAct(ACT_KIND.WORKSPACE_SANDBOX_SIZE_PUT, { workspaceId, vcpus }),
    onSuccess: (answer) => drawAnswer(queries, workspaceId, answer),
  });
}
