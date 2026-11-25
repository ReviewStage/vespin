import { namedServers, serversChoiceWords } from "@repo/features/agent-servers-model";
import { INTEGRATION_PROVIDER_LIST, INTEGRATION_STATUS } from "@repo/features/integration-wire";
import type { FailureSurface } from "@repo/features/shown-failure";
import { MCP_SERVER_LABEL } from "@repo/features/words";
import { SETTINGS_VIEW } from "@repo/settings/settings-views";
import {
  ChipName,
  ErrorState,
  SETTINGS_SKELETON_CONTROL,
  SettingsControlSkeleton,
  SettingsRow,
  SkeletonRegion,
} from "@repo/ui";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { unreadShown } from "../failure-report.js";
import { useIntegrationStatuses } from "../integration-statuses.js";
import { useOpenSettings } from "../open-settings.js";
import { AgentServersButton } from "./agent-servers.js";

/**
 * servers-row.tsx -- a settings row choosing which of the reader's connected MCP servers an agent is handed: an automation's run's, and every new agent's.
 *
 * The row's field chip says what is chosen, "All", "None", or how many are
 * on of how many ("3 of 21"), as the popover's Connected heading counts
 * them, and opens the agent box's own servers popover, whose switches,
 * search, and way to Settings › Integrations are the ones a task's Start
 * offers. Under its label it names the few servers that differ from the
 * rest, never the whole list (`serversChoiceWords`). Every server is on
 * until switched off, so a server connected later is on too.
 */

/**
 * The servers row while no read of the owner's connections has answered:
 * a block where the chip will stand, claiming nothing, or the
 * failure and Retry where the read was refused.
 */
function UnreadServersRow({
  failed,
  readFailure,
  onRetry,
}: {
  failed: boolean;
  readFailure: FailureSurface;
  onRetry: () => void;
}): React.JSX.Element {
  if (failed) {
    return (
      <SettingsRow
        label={<ReplayUnmask>{MCP_SERVER_LABEL.many}</ReplayUnmask>}
        below={() => (
          <ReplayUnmask>
            <ErrorState onRetry={onRetry} failure={unreadShown(readFailure)}>
              Your connected MCP servers could not be read.
            </ErrorState>
          </ReplayUnmask>
        )}
      />
    );
  }

  return <ServersRowSkeleton />;
}

/** The servers row while the connections are read: its name, and a block where its field chip will stand, claiming nothing. */
function ServersRowSkeleton(): React.JSX.Element {
  return (
    <SettingsRow label={<ReplayUnmask>{MCP_SERVER_LABEL.many}</ReplayUnmask>}>
      {() => (
        <SkeletonRegion label="Reading your connected MCP servers…">
          <SettingsControlSkeleton control={SETTINGS_SKELETON_CONTROL.SELECT} />
        </SkeletonRegion>
      )}
    </SettingsRow>
  );
}

/**
 * The servers row over the reader's own connections: a field chip saying
 * how many are on, which opens the agent box's own servers popover to
 * switch them, and the few that differ named under its label.
 */
export function OwnServersRow({
  disabled,
  onSwitch,
  readFailure,
}: {
  disabled: readonly string[];
  onSwitch: (disabled: readonly string[]) => void;
  /** The surface a read of the connections that failed is reported under. */
  readFailure: FailureSurface;
}): React.JSX.Element {
  const statuses = useIntegrationStatuses();
  const openSettings = useOpenSettings();
  // Note that no provider standing yet is a read still to answer, so the row claims nothing until one does.
  const read = INTEGRATION_PROVIDER_LIST.some((provider) => statuses.statusOf(provider));

  if (!read) {
    return (
      <UnreadServersRow
        failed={statuses.readFailed}
        readFailure={readFailure}
        onRetry={() => void statuses.read()}
      />
    );
  }

  // Note that each account at a provider is a server of its own, so one of two Notion accounts switched off leaves the other on.
  const connected = namedServers({
    statusOf: statuses.statusOf,
    accountsOf: statuses.accountsOf,
    standing: (status) => status === INTEGRATION_STATUS.CONNECTED,
  });

  const words = serversChoiceWords({
    on: connected
      .filter((server) => !disabled.includes(server.connection))
      .map((server) => server.name),
    off: connected
      .filter((server) => disabled.includes(server.connection))
      .map((server) => server.name),
  });

  return (
    <SettingsRow
      label={<ReplayUnmask>{MCP_SERVER_LABEL.many}</ReplayUnmask>}
      // Note that the words stay masked in a session replay, because they name accounts, which a member labels.
      description={words.note}
    >
      {() => (
        <AgentServersButton
          servers={{
            disabled,
            onSwitch,
            onOpenSettings: () => openSettings({ page: SETTINGS_VIEW.INTEGRATIONS }),
          }}
          statuses={statuses}
          face={
            <ChipName>
              <ReplayUnmask>{words.face}</ReplayUnmask>
            </ChipName>
          }
        />
      )}
    </SettingsRow>
  );
}
