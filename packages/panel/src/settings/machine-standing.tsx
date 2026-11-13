import { DEVICE_STANDING } from "@repo/features/agent-wire";
import { DEVICE_PLATFORM, type DevicePlatform } from "@repo/features/device-agent-wire";
import { DEVICE_PLATFORM_NAME } from "@repo/features/device-platform";
import { type HostStanding, MACHINE_STANDING_WORDS } from "@repo/features/machines-settings-words";
import { SETTINGS_ROW_STATE, SettingsRowMark, SettingsRowStateLine } from "@repo/ui";
import { DeviceGlyph, DeviceStandingGlyph } from "../tasks/runs-on.js";

/**
 * machine-standing.tsx -- how Settings › Machines leads each machine's row: its platform's glyph wearing its standing's dot, as Runs on draws it, and what it is.
 *
 * Online and offline are the dot on the glyph alone, as the composer's
 * Runs on menu says them, its words on a rest and to a reader, so the line
 * under the name says what the machine is and what it lets agents do. A
 * machine setting up or failed says so in words first, the second tinted,
 * since each asks something of the member; one whose standing cannot be told
 * yet wears no dot.
 */

/** The standings said in words before what a machine is, each with its tint. */
const STANDING_SAID = {
  [DEVICE_STANDING.SETTING_UP]: SETTINGS_ROW_STATE.PLAIN,
  [DEVICE_STANDING.FAILED]: SETTINGS_ROW_STATE.ATTENTION,
} as const;

/** A machine's platform as a list names it; a Linux server where none is known, as a service older than platforms listed only those. */
function platformOf(platform: DevicePlatform | undefined): DevicePlatform {
  return platform ?? DEVICE_PLATFORM.LINUX;
}

/** A machine's mark, by its platform, as Runs on draws it, wearing its standing's dot where that can be told. */
export function MachineMark({
  platform,
  standing,
}: {
  platform: DevicePlatform | undefined;
  standing?: HostStanding | undefined;
}): React.JSX.Element {
  const device = { platform: platformOf(platform) };

  return (
    <SettingsRowMark>
      {standing === undefined ? (
        <DeviceGlyph device={device} />
      ) : (
        <DeviceStandingGlyph device={device} standing={standing} />
      )}
    </SettingsRowMark>
  );
}

/** A machine's line under its name: a standing that asks something of the member first, then what it is, then `detail`, what it lets agents do. */
export function MachineStandingLine({
  standing,
  platform,
  detail,
}: {
  standing: HostStanding | undefined;
  platform: DevicePlatform | undefined;
  detail?: string | undefined;
}): React.JSX.Element {
  const line = [DEVICE_PLATFORM_NAME[platformOf(platform)], detail].filter(Boolean).join(" · ");

  if (standing !== DEVICE_STANDING.SETTING_UP && standing !== DEVICE_STANDING.FAILED) {
    return <>{line}</>;
  }

  return (
    <>
      <SettingsRowStateLine state={STANDING_SAID[standing]}>
        {MACHINE_STANDING_WORDS[standing]}
      </SettingsRowStateLine>
      {` · ${line}`}
    </>
  );
}
