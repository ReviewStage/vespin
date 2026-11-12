/**
 * device-store.ts -- an account's devices that can run its local agents or take its agents' commands: registered, beaten with where a host's update stands, read for the ones there now, and joined with their own settings for commands.
 *
 * Every function is an effect over the ambient `SqlClient`, keyed by the
 * account, so no account moves, beats, or reads another's Mac. A register
 * under an id another account holds writes nothing and answers false, so a
 * desktop cannot take over a Mac by naming its id (`../schemas/device.ts`).
 */

import {
  DEVICE_ARCH,
  DEVICE_CAPABILITY,
  DEVICE_PLATFORM,
  DEVICE_SETUP,
  type DeviceArch,
  type DeviceCapability,
  type DeviceMachine,
  type DevicePlatform,
  type DeviceSetup,
  deviceSetupSchema,
  HOST_UPDATE,
  type HostUpdate,
  hostUpdateSchema,
} from "@repo/features/device-agent-wire";
import {
  type MacCommandMode,
  type MacDeviceJoinRequest,
  type MacDeviceSettings,
  macCommandModeSchema,
  macDeviceSettingsSchema,
} from "@repo/features/mac-command-wire";
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { device } from "../schemas/device.js";

type DeviceEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

const DeviceKeySchema = Schema.Struct({ userId: Schema.String, id: Schema.String });

/** One device as Start reads it: its id, the account it is, its name and platform, which machine it runs on and its model, none where its host never said, when it last beat, the Codex it checked, where it has one, and where its setup stands, none once it is ready. */
const DeviceSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  name: Schema.String,
  platform: Schema.Literals(Object.values(DEVICE_PLATFORM)),
  machineId: Schema.NullOr(Schema.String),
  model: Schema.NullOr(Schema.String),
  lastSeenAt: Schema.Date,
  codexExecutable: Schema.NullOr(Schema.String),
  setup: Schema.NullOr(deviceSetupSchema),
  setupFailure: Schema.NullOr(Schema.String),
});

export type Device = typeof DeviceSchema.Type;

/** Where a Mac keeps what its local agents need: its home folder, the folder its agents stand in where its host named one, the folders their shared files and attachments stand in, the CLI it bundles, and the Codex it checked, none where it has none. */
const DeviceLayoutSchema = Schema.Struct({
  home: Schema.String,
  agentsFolder: Schema.NullOr(Schema.String),
  tempFolder: Schema.String,
  attachmentsFolder: Schema.String,
  claudeExecutable: Schema.String,
  codexExecutable: Schema.NullOr(Schema.String),
});

/** A Mac's layout and what its follower takes beyond the first lines, as a local agent's launch reads them. */
const DeviceStandingSchema = Schema.Struct({
  ...DeviceLayoutSchema.fields,
  capabilities: Schema.Array(Schema.Literals(Object.values(DEVICE_CAPABILITY))),
});

/** A Mac's standing as a launch reads it, with the host version it last called with, which names the runner its release bundled; null for one that never enrolled. */
const DeviceLaidOutSchema = Schema.Struct({
  ...DeviceStandingSchema.fields,
  version: Schema.NullOr(Schema.String),
});

type DeviceLaidOut = typeof DeviceLaidOutSchema.Type;

type DeviceLayout = typeof DeviceLayoutSchema.Type;

/** Which machine a call names, each part absent where it named none. */
export const MachineColumnsSchema = Schema.Struct({
  machineId: Schema.optionalKey(Schema.String),
  model: Schema.optionalKey(Schema.String),
});

/**
 * The machine columns a call writes: each part of the machine it named,
 * and none it left out, so a call naming none, from a host older than the
 * field or one whose read failed, leaves what an earlier call wrote.
 */
export function machineColumns(machine: {
  readonly machineId?: string | undefined;
  readonly model?: string | undefined;
}): DeviceMachine {
  return {
    ...(machine.machineId === undefined ? undefined : { machineId: machine.machineId }),
    ...(machine.model === undefined ? undefined : { model: machine.model }),
  };
}

/** What a Mac registers with beside its id and name: its platform and architecture, which machine it runs on where its host read it, its layout, the folder its agents stand in where its host names one, its Codex where it checked one, what its follower takes beyond the first lines, none where it names none, and where its setup stands and why it failed, none once it is ready. */
export type DeviceRegistration = Omit<DeviceLayout, "agentsFolder" | "codexExecutable"> &
  DeviceMachine & {
    readonly platform: DevicePlatform;
    readonly arch: DeviceArch;
    readonly agentsFolder?: string | undefined;
    readonly codexExecutable?: string | undefined;
    readonly capabilities?: readonly DeviceCapability[] | undefined;
    readonly setup?: DeviceSetup | undefined;
    readonly setupFailure?: string | undefined;
  };

const upsertDevice = SqlSchema.findAll({
  Request: Schema.Struct({
    ...DeviceKeySchema.fields,
    ...DeviceStandingSchema.fields,
    name: Schema.String,
    platform: Schema.Literals(Object.values(DEVICE_PLATFORM)),
    arch: Schema.Literals(Object.values(DEVICE_ARCH)),
    ...MachineColumnsSchema.fields,
    setup: Schema.NullOr(deviceSetupSchema),
    setupFailure: Schema.NullOr(Schema.String),
    now: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({
    userId,
    id,
    name,
    platform,
    arch,
    machineId,
    model,
    home,
    agentsFolder,
    tempFolder,
    attachmentsFolder,
    claudeExecutable,
    codexExecutable,
    capabilities,
    setup,
    setupFailure,
    now,
  }) =>
    Database.use((db) =>
      db
        .insert(device)
        .values({
          id,
          userId,
          name,
          platform,
          arch,
          ...machineColumns({ machineId, model }),
          home,
          agentsFolder,
          tempFolder,
          attachmentsFolder,
          claudeExecutable,
          codexExecutable,
          capabilities: [...capabilities],
          setup,
          setupFailure,
          lastSeenAt: now,
          awayAt: null,
        })
        .onConflictDoUpdate({
          target: device.id,
          set: {
            name,
            platform,
            arch,
            ...machineColumns({ machineId, model }),
            home,
            agentsFolder,
            tempFolder,
            attachmentsFolder,
            claudeExecutable,
            codexExecutable,
            capabilities: [...capabilities],
            setup,
            setupFailure,
            lastSeenAt: now,
            awayAt: null,
          },
          // Moved only where the account registering it is the one holding it.
          setWhere: eq(device.userId, userId),
        })
        .returning({ id: device.id }),
    ),
});

const touchDevice = SqlSchema.findAll({
  Request: Schema.Struct({
    ...DeviceKeySchema.fields,
    now: Schema.Date,
    updating: Schema.UndefinedOr(
      Schema.Struct({
        phase: Schema.NullOr(hostUpdateSchema),
        failure: Schema.NullOr(Schema.String),
      }),
    ),
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, id, now, updating }) =>
    Database.use((db) =>
      db
        .update(device)
        .set({
          lastSeenAt: now,
          awayAt: null,
          ...(updating === undefined
            ? undefined
            : { updatePhase: updating.phase, updateFailure: updating.failure }),
        })
        .where(and(eq(device.id, id), eq(device.userId, userId)))
        .returning({ id: device.id }),
    ),
});

const markAway = SqlSchema.findAll({
  Request: Schema.Struct({ now: Schema.Date, staleBefore: Schema.Date }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ now, staleBefore }) =>
    Database.use((db) =>
      db
        .update(device)
        .set({ awayAt: now })
        .where(
          and(
            isNull(device.awayAt),
            isNull(device.removedAt),
            isNotNull(device.home),
            lt(device.lastSeenAt, staleBefore),
          ),
        )
        .returning({ id: device.id }),
    ),
});

const findSeen = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, since: Schema.Date }),
  Result: DeviceSchema,
  execute: ({ userId, since }) =>
    Database.use((db) =>
      db
        .select({
          id: device.id,
          userId: device.userId,
          name: device.name,
          platform: device.platform,
          machineId: device.machineId,
          model: device.model,
          lastSeenAt: device.lastSeenAt,
          codexExecutable: device.codexExecutable,
          setup: device.setup,
          setupFailure: device.setupFailure,
        })
        .from(device)
        .where(
          and(
            eq(device.userId, userId),
            gte(device.lastSeenAt, since),
            // Note that a host that has not registered yet, or registered no temp or attachments folder, or was removed, takes no agent.
            isNotNull(device.home),
            isNotNull(device.tempFolder),
            isNotNull(device.attachmentsFolder),
            isNull(device.removedAt),
          ),
        )
        .orderBy(desc(device.lastSeenAt)),
    ),
});

const findNamed = SqlSchema.findAll({
  Request: Schema.Struct({ ids: Schema.Array(Schema.String) }),
  Result: DeviceSchema,
  execute: ({ ids }) =>
    Database.use((db) =>
      db
        .select({
          id: device.id,
          userId: device.userId,
          name: device.name,
          platform: device.platform,
          machineId: device.machineId,
          model: device.model,
          lastSeenAt: device.lastSeenAt,
          codexExecutable: device.codexExecutable,
          setup: device.setup,
          setupFailure: device.setupFailure,
        })
        .from(device)
        .where(inArray(device.id, [...ids])),
    ),
});

const findLayout = SqlSchema.findOneOption({
  Request: DeviceKeySchema,
  Result: DeviceLaidOutSchema,
  execute: ({ userId, id }) =>
    Database.use((db) =>
      db
        .select({
          home: device.home,
          agentsFolder: device.agentsFolder,
          tempFolder: device.tempFolder,
          attachmentsFolder: device.attachmentsFolder,
          claudeExecutable: device.claudeExecutable,
          codexExecutable: device.codexExecutable,
          capabilities: device.capabilities,
          version: device.version,
        })
        .from(device)
        .where(
          and(
            eq(device.id, id),
            eq(device.userId, userId),
            isNotNull(device.home),
            isNotNull(device.claudeExecutable),
            // Note that a host from before its temp and attachments folders lays no agent out until it registers them.
            isNotNull(device.tempFolder),
            isNotNull(device.attachmentsFolder),
            isNull(device.removedAt),
          ),
        ),
    ),
});

/**
 * The account's device of the id, created where no row holds it, with the
 * settings given kept only where it holds none yet, answering the settings
 * it keeps. Note that a row standing is otherwise left as it is, its name
 * and when it was last seen among it, since a host's own register and beat
 * write those, and that another account's device answers no row.
 */
const joinDevice = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    id: Schema.String,
    name: Schema.String,
    platform: Schema.Literals(Object.values(DEVICE_PLATFORM)),
    arch: Schema.Literals(Object.values(DEVICE_ARCH)),
    commandMode: macCommandModeSchema,
    alwaysAllowedApps: Schema.Array(Schema.String),
    now: Schema.Date,
  }),
  Result: macDeviceSettingsSchema,
  execute: ({ userId, id, name, platform, arch, commandMode, alwaysAllowedApps, now }) =>
    Database.use((db) =>
      db
        .insert(device)
        .values({
          id,
          userId,
          name,
          platform,
          arch,
          commandMode,
          alwaysAllowedApps,
          lastSeenAt: now,
        })
        .onConflictDoUpdate({
          target: device.id,
          set: {
            commandMode: sql`coalesce(${device.commandMode}, excluded.command_mode)`,
            alwaysAllowedApps: sql`coalesce(${device.alwaysAllowedApps}, excluded.always_allowed_apps)`,
          },
          setWhere: sql`${device.userId} = ${userId}`,
        })
        .returning({
          commandMode: sql<MacCommandMode>`${device.commandMode}`,
          alwaysAllowedApps: sql<readonly string[]>`${device.alwaysAllowedApps}`,
        }),
    ),
});

const writeSettings = SqlSchema.findAll({
  Request: Schema.Struct({
    ...DeviceKeySchema.fields,
    commandMode: macCommandModeSchema,
    alwaysAllowedApps: Schema.Array(Schema.String),
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, id, commandMode, alwaysAllowedApps }) =>
    Database.use((db) =>
      db
        .update(device)
        .set({ commandMode, alwaysAllowedApps })
        .where(and(eq(device.id, id), eq(device.userId, userId)))
        .returning({ id: device.id }),
    ),
});

/**
 * Registers the Mac under the account, or renames, relocates, and beats it
 * where the account holds it already, with the machine it runs on where it
 * named one (`machineColumns`); false where another account holds the id,
 * and nothing was written.
 */
export function registerDevice(
  userId: string,
  registered: { readonly id: string; readonly name: string } & DeviceRegistration,
): DeviceEffect<boolean> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(
      upsertDevice({
        userId,
        ...registered,
        // Note that a register naming no agents folder clears the last one, as a host moved back to a build from before the field names none.
        agentsFolder: registered.agentsFolder ?? null,
        // Note that a register naming no Codex clears the last one, since the Mac checks it on every start.
        codexExecutable: registered.codexExecutable ?? null,
        // Note that a register naming none clears the last ones, as a desktop moved back to a build without them takes none.
        capabilities: registered.capabilities ?? [],
        // Likewise a register naming no setup is a device ready to take an agent, as every desktop from before the field is.
        setup: registered.setup ?? null,
        setupFailure:
          registered.setup === DEVICE_SETUP.FAILED ? (registered.setupFailure ?? null) : null,
        now,
      }),
      (rows) => rows.length > 0,
    ),
  );
}

/** The account's Mac's home folder, the folder its agents stand in where its host named one, bundled CLI, and capabilities, as it last registered them, and the host version it last called with; nothing where the account holds no such Mac, or one that never registered. */
export function deviceLayout(
  userId: string,
  id: string,
): DeviceEffect<Option.Option<DeviceLaidOut>> {
  return findLayout({ userId, id });
}

/** Where a host's update stands as its own beat says it: its phase, and why it failed where it did; neither while no update is under way. */
export interface DeviceUpdating {
  readonly update?: HostUpdate | undefined;
  readonly updateFailure?: string | undefined;
}

/**
 * Records that the account's Mac is there now, and where its update stands
 * where its own beat says, cleared where that names none; a touch that says
 * nothing of its update, a held read's, leaves it. False where the account
 * holds no such Mac.
 */
export function beatDevice(
  userId: string,
  id: string,
  updating?: DeviceUpdating,
): DeviceEffect<boolean> {
  const update = updating?.update ?? null;

  const said =
    updating === undefined
      ? undefined
      : {
          phase: update,
          // Note that only a failed update keeps its words, as only a failed setup does.
          failure: update === HOST_UPDATE.FAILED ? (updating.updateFailure ?? null) : null,
        };

  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(touchDevice({ userId, id, now, updating: said }), (rows) => rows.length > 0),
  );
}

/**
 * Marks away every registered device whose last beat is older than
 * `freshMs` at `now` and that is not marked already, answering how many it
 * marked; its next beat or register clears the mark. The scheduled sweep
 * runs it, so the hosts read wakes as a host goes quiet.
 */
export function markAwayDevices(now: number, freshMs: number): DeviceEffect<number> {
  return Effect.map(
    markAway({ now: new Date(now), staleBefore: new Date(now - freshMs) }),
    (rows) => rows.length,
  );
}

/** The account's Macs that beat at or after the instant given, the latest first. */
export function devicesSeenSince(userId: string, since: Date): DeviceEffect<readonly Device[]> {
  return findSeen({ userId, since });
}

/**
 * The Macs the local agents a reader was shown are pinned to, by id: each
 * one's name and when it last beat, for the agent's label and its offline
 * state. Note that this read is keyed by the devices alone, not an account,
 * because a local agent's teammates see which Mac it runs on as they see who
 * started it; its caller hands it only the device ids of agents it already
 * read through their workspaces' gate.
 */
export function devicesNamed(ids: readonly string[]): DeviceEffect<ReadonlyMap<string, Device>> {
  if (ids.length === 0) return Effect.succeed(new Map());

  return Effect.map(
    findNamed({ ids: [...new Set(ids)] }),
    (devices) => new Map(devices.map((device) => [device.id, device])),
  );
}

/**
 * Joins a machine of the account as the device its commands are claimed
 * by: the device created where the account never had the id, and the
 * machine's own settings kept only where the service holds none for it
 * yet, so a machine carries them up once and reads the service's from
 * then on. Answers the settings the device keeps; nothing where another
 * account holds the id, and nothing was written.
 */
export function joinCommandDevice(
  userId: string,
  joining: MacDeviceJoinRequest,
): DeviceEffect<Option.Option<MacDeviceSettings>> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(
      joinDevice({
        userId,
        id: joining.deviceId,
        name: joining.name,
        platform: joining.platform,
        arch: joining.arch,
        ...joining.settings,
        now,
      }),
      (rows) => Option.fromUndefinedOr(rows[0]),
    ),
  );
}

/** Keeps the settings the member gave the account's device; false where the account holds no such device. */
export function saveCommandDeviceSettings(
  userId: string,
  id: string,
  settings: MacDeviceSettings,
): DeviceEffect<boolean> {
  return Effect.map(writeSettings({ userId, id, ...settings }), (rows) => rows.length > 0);
}
