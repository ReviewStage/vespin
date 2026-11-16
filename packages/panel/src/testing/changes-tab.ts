import type { RepositoryPullRequestParams } from "@repo/features/pull-request-view";
import { type ComponentProps, createElement } from "react";
import { AgentChangesTab, type ChangesReads, useChangesReads } from "../tasks/agent-changes-tab.js";
import { PullRequestSourceProvider, usePullRequestSourceOf } from "../tasks/pull-request-source.js";

/**
 * changes-tab.ts -- the Files changed view reading on its own, as the Pull request tab reads for it.
 *
 * The view is handed its reads by the Pull request tab (`useChangesReads`),
 * which counts the lines left to review from them; a test of the view alone
 * draws it under this, which reads the same way, as the view comes on
 * screen, and is handed the reads (`onReads`) to read them again as the
 * Pull request tab's Refresh does. It reads through the pull request's
 * source, as the Pull request tab does (`pull-request-source.ts`).
 */

/** The view, its reads asked as it is shown, and handed to `onReads` on every draw. */
export function ChangesTabReading({
  onReads,
  pullRequest,
  taskId = null,
  ...props
}: Omit<ComponentProps<typeof AgentChangesTab>, "reads" | "source"> & {
  pullRequest: RepositoryPullRequestParams;
  /** The task holding the tab, through which its files are read whole; none reads none. */
  taskId?: string | null;
  onReads?: ((reads: ChangesReads) => void) | undefined;
}): React.JSX.Element {
  const source = usePullRequestSourceOf(pullRequest, { taskId }, undefined);
  const reads = useChangesReads(source, props.shown);
  onReads?.(reads);

  return createElement(
    PullRequestSourceProvider,
    { value: source },
    createElement(AgentChangesTab, { ...props, source, reads }),
  );
}
