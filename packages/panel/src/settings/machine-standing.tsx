import { DEVICE_STANDING } from "@repo/features/agent-wire";
import { DEVICE_PLATFORM, type DevicePlatform } from "@repo/features/device-agent-wire";
import { DEVICE_PLATFORM_NAME } from "@repo/features/device-platform";
import { type HostStanding, MACHINE_STANDING_WORDS } from "@repo/features/machines-settings-words";
import {
  SETTINGS_ROW_STATE,
  SettingsRowMark,
  type SettingsRowState,
  SettingsRowStateLine,
} from "@repo/ui";
import { DeviceGlyph } from "../tasks/runs-on.js";

/**
 * machine-standing.tsx -- how Settings › Machines leads each machine's row, whichever list draws it: its platform's glyph, as Runs on draws it, and where it stands after what it is.
 *
 * Your machines and What agents may do draw the same machine the same way,
 * so its mark and its line are written once here. A machine online wears
 * the finished session's dot with its words inside the dot's line, since
 * words after it sit off the dot's baseline; one offline or failed tints its
 * standing alone; one setting up reads plain; and one whose standing cannot
 * be told yet says only what it is.
 */

/** Each standing's words and tint. */
const STANDING_LINE = {
  [DEVICE_STANDING.ONLINE]: {
    words: MACHINE_STANDING_WORDS[DEVICE_STANDING.ONLINE],
    state: SETTINGS_ROW_STATE.CONNECTED,
  },
  [DEVICE_STANDING.OFFLINE]: {
    words: MACHINE_STANDING_WORDS[DEVICE_STANDING.OFFLINE],
    state: SETTINGS_ROW_STATE.ATTENTION,
  },
  [DEVICE_STANDING.SETTING_UP]: {
    words: MACHINE_STANDING_WORDS[DEVICE_STANDING.SETTING_UP],
    state: SETTINGS_ROW_STATE.PLAIN,
  },
  [DEVICE_STANDING.FAILED]: {
    words: MACHINE_STANDING_WORDS[DEVICE_STANDING.FAILED],
    state: SETTINGS_ROW_STATE.ATTENTION,
  },
} as const satisfies Record<
  HostStanding,
  { readonly words: string; readonly state: SettingsRowState }
>;

/** A machine's platform as a list names it; a Linux server where none is known, as a service older than platforms listed only those. */
function platformOf(platform: DevicePlatform | undefined): DevicePlatform {
  return platform ?? DEVICE_PLATFORM.LINUX;
}

/** A machine's mark, by its platform, as Runs on draws it. */
export function MachineMark({
  platform,
}: {
  platform: DevicePlatform | undefined;
}): React.JSX.Element {
  return (
    <SettingsRowMark>
      <DeviceGlyph device={{ platform: platformOf(platform) }} />
    </SettingsRowMark>
  );
}

/** A machine's line under its name: where it stands first, where that can be told, and then what it is. */
export function MachineStandingLine({
  standing,
  platform,
}: {
  standing: HostStanding | undefined;
  platform: DevicePlatform | undefined;
}): React.JSX.Element {
  const kind = DEVICE_PLATFORM_NAME[platformOf(platform)];

  if (standing === undefined) return <>{kind}</>;
  const { words, state } = STANDING_LINE[standing];

  if (state === SETTINGS_ROW_STATE.CONNECTED) {
    return <SettingsRowStateLine state={state}>{`${words} · ${kind}`}</SettingsRowStateLine>;
  }

  return (
    <>
      <SettingsRowStateLine state={state}>{words}</SettingsRowStateLine>
      {` · ${kind}`}
    </>
  );
}
