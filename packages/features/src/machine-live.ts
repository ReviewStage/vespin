import { Option, Schema } from "effect";
import { DEVICE_PLATFORM, type DevicePlatform } from "./device-agent-wire.js";
import {
  LIVE_MODE,
  LIVE_PARAM,
  type LiveReadAnswer,
  type LiveRowOf,
  liveRead,
  liveRows,
  ORDER,
  orderedLiveRows,
} from "./live-read.js";
import { LIVE_READ, LIVE_USER_QUERY } from "./live-wire.js";
import {
  MACHINE_COMMAND_MODE,
  type MachineCommandMode,
  machineCommandModeSchema,
} from "./machine-command-wire.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";

/**
 * machine-live.ts -- the account's machines as Settings › Machines and each machine itself follow them over the service's held poll: the read declared, and the machines as a reader draws them.
 *
 * The service answers one statement, every machine of the account's that
 * was not removed, by name and then id. Each row says what the page draws:
 * its name, its platform, which machine it is and its model where its host
 * said, whether it runs agents as a host, whether its app listens for
 * commands now, whether it is the member's default machine, and its own
 * say over agents there, the same values its
 * app keeps under Settings › This Mac (`machineDeviceSettingsSchema`): how
 * terminal commands run, whether agents may use its apps, and the apps it
 * lets them use without asking. A machine whose app never joined holds
 * none of them yet. A machine follows its own row, so a change made on
 * another device reaches it as the service carries it, without joining
 * again. A platform or a mode this build does not know is read as none,
 * as the hosts read is read leniently.
 */

/** The account's machines: one part, every machine of the account's not removed, by name and then id. */
export const MACHINES_READ = liveRead({
  name: LIVE_READ.MACHINES,
  path: HOSTED_SERVICE_PATH.LIVE_MACHINES,
  params: { [LIVE_USER_QUERY]: LIVE_PARAM.USER },
  mode: LIVE_MODE.SNAPSHOT,
  parts: {
    machines: liveRows({
      row: Schema.Struct({
        id: Schema.String,
        name: Schema.String,
        platform: Schema.String,
        machineId: Schema.NullOr(Schema.String),
        model: Schema.NullOr(Schema.String),
        /** Whether the machine runs agents as a host, which Settings › Machines removes as a host. */
        host: Schema.Boolean,
        /** Whether its app listens for commands now, as the scheduled sweep last found it. */
        listening: Schema.Boolean,
        commandMode: Schema.NullOr(Schema.String),
        computerUse: Schema.NullOr(Schema.Boolean),
        alwaysAllowedApps: Schema.NullOr(Schema.Array(Schema.String)),
        /** Whether it is the member's default machine, where an agent's call goes that names none and whose agent has no pick of its own. */
        isDefault: Schema.Boolean,
      }),
      key: "id",
      order: [
        ["name", ORDER.ASC],
        ["id", ORDER.ASC],
      ],
    }),
  },
});

export type MachinesLiveAnswer = LiveReadAnswer<typeof MACHINES_READ>;

/** One machine as the statement delivers it. */
export type MachineLiveRow = LiveRowOf<typeof MACHINES_READ.parts.machines>;

/** A machine's own say over agents there, once its app has joined: how commands run, whether agents may use its apps, none where it never said, and the apps it lets them use unasked. */
export interface MachineSettingsLine {
  readonly commandMode: MachineCommandMode;
  readonly computerUse?: boolean;
  readonly alwaysAllowedApps: readonly string[];
}

/** One machine as Settings › Machines draws it: its name and what it is, whether it is a host and listens now, and its settings where its app ever joined. */
export interface MachineLine {
  readonly id: string;
  readonly name: string;
  readonly platform?: DevicePlatform;
  readonly machineId?: string;
  readonly model?: string;
  readonly host: boolean;
  readonly listening: boolean;
  /** Whether it is the member's default machine; one of theirs at most. */
  readonly isDefault: boolean;
  readonly settings?: MachineSettingsLine;
}

const readPlatform = Schema.decodeUnknownOption(Schema.Literals(Object.values(DEVICE_PLATFORM)));
const readMode = Schema.decodeUnknownOption(machineCommandModeSchema);

/** A machine's settings as its row holds them; none before its app joined, or for a mode this build does not know. */
function settingsOf(row: MachineLiveRow): MachineSettingsLine | undefined {
  const mode = readMode(row.commandMode);

  if (Option.isNone(mode)) return undefined;

  return {
    commandMode: mode.value,
    ...(row.computerUse === null ? undefined : { computerUse: row.computerUse }),
    alwaysAllowedApps: row.alwaysAllowedApps ?? [],
  };
}

/** The account's machines as the held read answers them, by name and then id, each field this build does not know left out. */
export function machinesOfLiveRows(rows: readonly MachineLiveRow[]): readonly MachineLine[] {
  return orderedLiveRows(MACHINES_READ.parts.machines, rows).map((row) => {
    const platform = readPlatform(row.platform);
    const settings = settingsOf(row);

    return {
      id: row.id,
      name: row.name,
      ...(Option.isSome(platform) ? { platform: platform.value } : undefined),
      ...(row.machineId === null ? undefined : { machineId: row.machineId }),
      ...(row.model === null ? undefined : { model: row.model }),
      host: row.host,
      listening: row.listening,
      isDefault: row.isDefault,
      ...(settings === undefined ? undefined : { settings }),
    };
  });
}

/**
 * Whether a machine lets agents in at all: its app joined, and it runs
 * their commands or lets them use its apps. Note that a switch a desktop
 * older than it never carried up is read as on, as that desktop's own
 * setting gates it.
 */
export function machineLetsAgents(machine: MachineLine): boolean {
  const settings = machine.settings;

  if (settings === undefined) return false;

  return settings.commandMode !== MACHINE_COMMAND_MODE.NEVER || settings.computerUse !== false;
}
