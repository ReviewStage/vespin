import { namedServers } from "@repo/features/agent-servers-model";
import { INTEGRATION_PROVIDER_LIST, INTEGRATION_STATUS } from "@repo/features/integration-wire";
import type { FailureSurface } from "@repo/features/shown-failure";
import { andList, MCP_SERVER_LABEL } from "@repo/features/words";
import { SETTINGS_VIEW } from "@repo/settings/settings-views";
import {
  ChipName,
  ErrorState,
  PROVIDER_MARK_SIZE,
  ProviderMark,
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
 * The row names those switched off under its label and holds the marks of
 * those left on in a field chip like its neighbors', which opens the agent
 * box's own servers popover, whose switches, search, and way to Settings ›
 * Integrations are the ones a task's Start offers. Every server is on until
 * switched off, so a server connected later is on too.
 */

/** The most marks the servers chip holds before it counts the rest, so it stays a picker's width. */
const SERVERS_CHIP_MARKS = 4;

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
 * The servers row over the reader's own connections: those switched off
 * named under its label, and a field chip holding the marks of those left
 * on, which opens the agent box's own servers popover to switch them.
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

  // Note that each account at a provider is a server of its own, so one of two Notion accounts switched off leaves the other's mark on the chip.
  const connected = namedServers({
    statusOf: statuses.statusOf,
    accountsOf: statuses.accountsOf,
    standing: (status) => status === INTEGRATION_STATUS.CONNECTED,
  });

  const on = connected.filter((server) => !disabled.includes(server.connection));
  const off = connected.filter((server) => disabled.includes(server.connection));
  const shown = on.slice(0, SERVERS_CHIP_MARKS);

  // Note that the chip's marks already say which are on, so the words name only what they cannot.
  const note =
    connected.length === 0
      ? "None connected yet."
      : off.length === 0
        ? undefined
        : `${andList(off.map((server) => server.name))} off.`;

  return (
    <SettingsRow
      label={<ReplayUnmask>{MCP_SERVER_LABEL.many}</ReplayUnmask>}
      // Note that the words stay masked in a session replay, because they name the accounts switched off, which a member labels.
      description={note}
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
            on.length === 0 ? (
              <ChipName>
                <ReplayUnmask>None</ReplayUnmask>
              </ChipName>
            ) : (
              <span className="automation-servers inline-flex items-center gap-tight-gap">
                {shown.map((server) => (
                  <ProviderMark
                    key={server.connection}
                    provider={server.provider}
                    size={PROVIDER_MARK_SIZE.ICON}
                  />
                ))}
                {on.length > shown.length ? (
                  <ChipName>{`+${on.length - shown.length}`}</ChipName>
                ) : null}
              </span>
            )
          }
        />
      )}
    </SettingsRow>
  );
}
