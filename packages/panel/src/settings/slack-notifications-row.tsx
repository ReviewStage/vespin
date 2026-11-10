import type { Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import { useMutation, useQueries } from "@tanstack/react-query";
import { useAccountPreferences } from "../account-choices.js";
import { actMutation } from "../act-mutations.js";
import { workspaceIntegrationsQuery } from "../live-reads.js";
import { refusalToast, rowWrite } from "./row-write.js";
import { SwitchRow } from "./switch-row.js";

/**
 * slack-notifications-row.tsx -- the reader's own Slack notifications, under Preferences › Notifications once a workspace of theirs has our Slack bot connected.
 *
 * One switch, on until they turn it off, which holds in every workspace
 * whose bot is connected. It is their account's preference, which no row of
 * a workspace carries, so it draws the account's preferences row the host
 * holds for the session (`LIVE_READ.ACCOUNT_PREFERENCES`), drawn once that
 * row is read. It stands only where it does anything: once a workspace's
 * integrations, which the host holds while the row shows, read its bot
 * connected, and the write names that workspace, as the service asks of
 * the member that they are in one. The host draws a turn over the row on
 * the press, and a refusal puts it back.
 */

/** A write whose answer only says it was kept, so its error alone refuses it. */
function answeredAll(): undefined {
  return undefined;
}

/** The first of the workspaces whose Slack bot reads connected; none while none does, or before any is read. */
function useSlackWorkspaceId(workspaces: readonly Workspace[]): string | undefined {
  const reads = useQueries({
    queries: workspaces.map((workspace) => workspaceIntegrationsQuery(workspace.id)),
  });
  const at = reads.findIndex((read) => read.data?.slack.team !== undefined);
  return at === -1 ? undefined : workspaces[at]?.id;
}

export function SlackNotificationsRow({
  workspaces,
}: {
  workspaces: readonly Workspace[];
}): React.JSX.Element | null {
  const workspaceId = useSlackWorkspaceId(workspaces);
  const mutation = useMutation({
    ...actMutation(ACT_KIND.WORKSPACE_SLACK_BOT_NOTIFICATIONS),
    onSettled: refusalToast(answeredAll),
  });
  const on = useAccountPreferences().data?.slackNotifications;
  if (workspaceId === undefined || on === undefined) return null;
  return (
    <SwitchRow
      label="Slack notifications"
      labelReplayUnmasked
      checked={on}
      write={rowWrite(mutation, {
        ask: (notifications: boolean) => ({ workspaceId, notifications }),
        refused: answeredAll,
        drawn: (asked) => asked.notifications,
      })}
    />
  );
}
