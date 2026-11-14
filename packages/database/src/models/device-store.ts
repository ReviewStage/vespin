/**
 * device-store.ts -- an account's devices that can run its local agents or take its agents' commands: registered, beaten with where a host's update stands, read for the ones there now, joined with their own settings for commands, those settings changed from anywhere, marked away as their app stops listening, and listed to the workspace's members.
 *
 * Every function is an effect over the ambient `SqlClient`, keyed by the
 * account, so no account moves, beats, or reads another's Mac, bar a
 * workspace's machines, which name only what each machine is and whose,
 * read through a workspace the reader and the owner both stand in
 * (`workspaceMachinesOf`). A register
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
  type AllowedAppLook,
  allowedAppLookSchema,
  type MachineCommandMode,
  type MachineDeviceJoinRequest,
  type MachineDeviceSettings,
  machineCommandModeSchema,
} from "@repo/features/machine-command-wire";
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  type SQL,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, queryBuilder, type StoreFailure } from "../core/query.js";
import { TXID_RETURNING, TxidRowSchema } from "../core/txid.js";
import { member } from "../schemas/auth.js";
import { device } from "../schemas/device.js";
import { machineCommandDeviceListener } from "../schemas/machine-command.js";
import { workspaceReachableBy } from "./workspace-store.js";

type DeviceEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

const DeviceKeySchema = Schema.Struct({ userId: Schema.String, id: Schema.String });

/** A machine's settings as its row keeps them, the apps switch null where it never carried one up. */
const StoredSettingsSchema = Schema.Struct({
  commandMode: machineCommandModeSchema,
  alwaysAllowedApps: Schema.Array(Schema.String),
  computerUse: Schema.NullOr(Schema.Boolean),
});

/** A machine's settings as the wire carries them, the apps switch left out where the row holds none. */
function settingsOfStored(stored: typeof StoredSettingsSchema.Type): MachineDeviceSettings {
  return {
    commandMode: stored.commandMode,
    alwaysAllowedApps: stored.alwaysAllowedApps,
    ...(stored.computerUse === null ? undefined : { computerUse: stored.computerUse }),
  };
}

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
    ...MachineColumnsSchema.fields,
    commandMode: machineCommandModeSchema,
    alwaysAllowedApps: Schema.Array(Schema.String),
    computerUse: Schema.NullOr(Schema.Boolean),
    now: Schema.Date,
  }),
  Result: StoredSettingsSchema,
  execute: ({
    userId,
    id,
    name,
    platform,
    arch,
    machineId,
    model,
    commandMode,
    alwaysAllowedApps,
    computerUse,
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
          commandMode,
          alwaysAllowedApps,
          computerUse,
          lastSeenAt: now,
          commandsAwayAt: now,
        })
        .onConflictDoUpdate({
          target: device.id,
          set: {
            ...machineColumns({ machineId, model }),
            // Note that a Mac whose host was removed still takes commands as the app, so its join stands the row again, as an enroll does; it is listed as a host only once a host keys it again.
            removedAt: null,
            commandMode: sql`coalesce(${device.commandMode}, excluded.command_mode)`,
            alwaysAllowedApps: sql`coalesce(${device.alwaysAllowedApps}, excluded.always_allowed_apps)`,
            computerUse: sql`coalesce(${device.computerUse}, excluded.computer_use)`,
            // Note that a machine joins before it listens, so it reads away until its first listen clears the mark, which wakes the machines read as a listen alone could not.
            commandsAwayAt: now,
          },
          setWhere: sql`${device.userId} = ${userId}`,
        })
        .returning({
          commandMode: sql<MachineCommandMode>`${device.commandMode}`,
          alwaysAllowedApps: sql<readonly string[]>`${device.alwaysAllowedApps}`,
          computerUse: device.computerUse,
        }),
    ),
});

const writeAppLooks = SqlSchema.findAll({
  Request: Schema.Struct({
    ...DeviceKeySchema.fields,
    looks: Schema.Array(allowedAppLookSchema),
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, id, looks }) =>
    Database.use((db) =>
      db
        .update(device)
        .set({ allowedAppLooks: looks })
        .where(and(eq(device.id, id), eq(device.userId, userId)))
        .returning({ id: device.id }),
    ),
});

const writeSettings = SqlSchema.findAll({
  Request: Schema.Struct({
    ...DeviceKeySchema.fields,
    commandMode: machineCommandModeSchema,
    alwaysAllowedApps: Schema.Array(Schema.String),
    computerUse: Schema.UndefinedOr(Schema.Boolean),
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, id, commandMode, alwaysAllowedApps, computerUse }) =>
    Database.use((db) =>
      db
        .update(device)
        // Note that a desktop older than the apps switch writes none, which leaves the service's as it stands.
        .set({
          commandMode,
          alwaysAllowedApps,
          ...(computerUse === undefined ? undefined : { computerUse }),
        })
        .where(and(eq(device.id, id), eq(device.userId, userId)))
        .returning({ id: device.id }),
    ),
});

/**
 * One of the account's machines changed as a member asked from any of
 * their devices: each setting named written, and an app taken back from
 * those it always allows, answering the transaction it was written in.
 * Note that a machine whose app never joined holds no settings to change,
 * and a removed one is no longer the member's to change, so neither is
 * written.
 */
const changeSettings = SqlSchema.findAll({
  Request: Schema.Struct({
    ...DeviceKeySchema.fields,
    commandMode: Schema.UndefinedOr(machineCommandModeSchema),
    computerUse: Schema.UndefinedOr(Schema.Boolean),
    removeApp: Schema.UndefinedOr(Schema.String),
    addApp: Schema.UndefinedOr(Schema.String),
  }),
  Result: TxidRowSchema,
  execute: ({ userId, id, commandMode, computerUse, removeApp, addApp }) =>
    Database.use((db) =>
      db
        .update(device)
        .set({
          // Note that the row is written even where nothing is named, so the answer still says it stands.
          commandMode: commandMode ?? sql`${device.commandMode}`,
          ...(computerUse === undefined ? undefined : { computerUse }),
          // Note that jsonb's `-` takes every element equal to the string out of the array, and leaves an array without it as it was.
          ...(removeApp === undefined
            ? undefined
            : { alwaysAllowedApps: sql`${device.alwaysAllowedApps} - ${removeApp}::text` }),
          // Note that an app the machine already allows is kept once.
          ...(addApp === undefined
            ? undefined
            : {
                alwaysAllowedApps: sql`(coalesce(${device.alwaysAllowedApps}, '[]'::jsonb) - ${addApp}::text) || jsonb_build_array(${addApp}::text)`,
              }),
        })
        .where(
          and(
            eq(device.id, id),
            eq(device.userId, userId),
            isNull(device.removedAt),
            isNotNull(device.commandMode),
          ),
        )
        .returning(TXID_RETURNING),
    ),
});

/** The account's machines read beside the one asked after, to find which of them is the default. */
const accountMachine = alias(device, "account_machine");

/**
 * Whether the machine is its account's default machine, where an agent's
 * call goes that names no machine and whose agent has no pick of its own:
 * the one the member picked, else the one of theirs whose app joined
 * first, so a member with one machine has it as their default and keeps it
 * as they add another, until they pick. Note that a removed machine and
 * one whose app never joined, such as a Linux box that only runs agents,
 * take no call, so neither is ever the default. The one statement every
 * reader of the default asks, the routing and Settings › Machines alike;
 * false for every machine of an account none of whose apps joined.
 */
export const isDefaultMachine: SQL<boolean> = sql<boolean>`coalesce(${device.id} = (${queryBuilder
  .select({ id: accountMachine.id })
  .from(accountMachine)
  .where(
    and(
      eq(accountMachine.userId, device.userId),
      isNull(accountMachine.removedAt),
      isNotNull(accountMachine.commandMode),
    ),
  )
  .orderBy(desc(accountMachine.isDefault), asc(accountMachine.createdAt), asc(accountMachine.id))
  .limit(1)}), false)`;

/** Every other machine of the account no longer its default, so the one picked next can be. */
const clearDefault = SqlSchema.void({
  Request: DeviceKeySchema,
  execute: ({ userId, id }) =>
    Database.use((db) =>
      db
        .update(device)
        .set({ isDefault: false })
        .where(and(eq(device.userId, userId), eq(device.isDefault, true), ne(device.id, id))),
    ),
});

/** The account's machine of the id picked as its default. */
const markDefault = SqlSchema.void({
  Request: DeviceKeySchema,
  execute: ({ userId, id }) =>
    Database.use((db) =>
      db
        .update(device)
        .set({ isDefault: true })
        .where(and(eq(device.id, id), eq(device.userId, userId))),
    ),
});

/** The account's machine of the id stamped removed and its secret cleared, answering the transaction it was removed in; none where the account holds no such machine standing. */
const stampMachineRemoved = SqlSchema.findAll({
  Request: Schema.Struct({ ...DeviceKeySchema.fields, now: Schema.Date }),
  Result: TxidRowSchema,
  execute: ({ userId, id, now }) =>
    Database.use((db) =>
      db
        .update(device)
        .set({ removedAt: now, secretHash: null })
        .where(and(eq(device.id, id), eq(device.userId, userId), isNull(device.removedAt)))
        .returning(TXID_RETURNING),
    ),
});

/**
 * Every standing machine whose app last listened for its commands before
 * `staleBefore` and is not marked away yet, marked away at `now`; a listen
 * clears the mark (`markMachineListening`).
 */
const markCommandsAway = SqlSchema.findAll({
  Request: Schema.Struct({ now: Schema.Date, staleBefore: Schema.Date }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ now, staleBefore }) =>
    Database.use((db) =>
      db
        .update(device)
        .set({ commandsAwayAt: now })
        .where(
          and(
            isNull(device.commandsAwayAt),
            isNull(device.removedAt),
            exists(
              db
                .select({ one: sql`1` })
                .from(machineCommandDeviceListener)
                .where(
                  and(
                    eq(machineCommandDeviceListener.deviceId, device.id),
                    lt(machineCommandDeviceListener.seenAt, staleBefore),
                  ),
                ),
            ),
          ),
        )
        .returning({ id: device.id }),
    ),
});

const findAllowedApps = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String }),
  Result: Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    alwaysAllowedApps: Schema.Array(Schema.String),
    allowedAppLooks: Schema.NullOr(Schema.Array(allowedAppLookSchema)),
  }),
  execute: ({ userId }) =>
    Database.use((db) =>
      db
        .select({
          id: device.id,
          name: device.name,
          alwaysAllowedApps: sql<readonly string[]>`${device.alwaysAllowedApps}`,
          allowedAppLooks: device.allowedAppLooks,
        })
        .from(device)
        .where(
          and(
            eq(device.userId, userId),
            isNotNull(device.alwaysAllowedApps),
            isNull(device.removedAt),
          ),
        )
        .orderBy(device.name, device.id),
    ),
});

/**
 * Whether a machine is there now: its app listened for commands as the
 * device at or after the instant given, as routing reads a machine
 * reachable, or it runs agents as a host and still beats (`away_at`).
 */
function machineOnline(listenedSince: Date) {
  const listened = exists(
    queryBuilder
      .select({ one: sql`1` })
      .from(machineCommandDeviceListener)
      .where(
        and(
          eq(machineCommandDeviceListener.deviceId, device.id),
          gte(machineCommandDeviceListener.seenAt, listenedSince),
        ),
      ),
  );

  return sql<boolean>`(${listened} or (${device.home} is not null and ${device.awayAt} is null))`;
}

const findWorkspaceMachines = SqlSchema.findAll({
  Request: Schema.Struct({
    readerId: Schema.String,
    workspaceId: Schema.String,
    memberId: Schema.NullOr(Schema.String),
    listenedSince: Schema.Date,
  }),
  Result: Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    platform: Schema.Literals(Object.values(DEVICE_PLATFORM)),
    userId: Schema.String,
    online: Schema.Boolean,
    commandMode: Schema.NullOr(machineCommandModeSchema),
    computerUse: Schema.NullOr(Schema.Boolean),
  }),
  execute: ({ readerId, workspaceId, memberId, listenedSince }) =>
    Database.use((db) =>
      db
        .select({
          id: device.id,
          name: device.name,
          platform: device.platform,
          userId: device.userId,
          online: machineOnline(listenedSince),
          commandMode: device.commandMode,
          computerUse: device.computerUse,
        })
        .from(device)
        .innerJoin(
          member,
          and(eq(member.userId, device.userId), eq(member.organizationId, workspaceId)),
        )
        .where(
          and(
            isNull(device.removedAt),
            workspaceReachableBy(readerId, workspaceId),
            memberId === null ? undefined : eq(device.userId, memberId),
          ),
        )
        .orderBy(asc(device.name), asc(device.id)),
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
  joining: MachineDeviceJoinRequest,
): DeviceEffect<Option.Option<MachineDeviceSettings>> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(
      joinDevice({
        userId,
        id: joining.deviceId,
        name: joining.name,
        platform: joining.platform,
        arch: joining.arch,
        ...machineColumns(joining),
        commandMode: joining.settings.commandMode,
        alwaysAllowedApps: joining.settings.alwaysAllowedApps,
        computerUse: joining.settings.computerUse ?? null,
        now,
      }),
      (rows) => Option.map(Option.fromUndefinedOr(rows[0]), settingsOfStored),
    ),
  );
}

/** One of the account's machines by its id and name, the apps on it the member always allows, by bundle id, and how the machine names and draws each it posted a look for. */
export interface MachineAllowedApps {
  readonly deviceId: string;
  readonly name: string;
  readonly apps: readonly string[];
  readonly looks: readonly AllowedAppLook[];
}

/**
 * The account's own machines that always allow an app, each with those
 * apps and the looks it posted for them, by the machine's name; a machine removed, or one that allows none
 * or never carried its list up, is left out. Note that the read is keyed by
 * the account, so a teammate's machines are never among them.
 */
export function allowedAppsOf(userId: string): DeviceEffect<readonly MachineAllowedApps[]> {
  return Effect.map(findAllowedApps({ userId }), (rows) =>
    rows.flatMap((row) =>
      row.alwaysAllowedApps.length === 0
        ? []
        : [
            {
              deviceId: row.id,
              name: row.name,
              apps: row.alwaysAllowedApps,
              // Note that a look of an app the machine no longer allows is left out, as one posted before a change the service took from elsewhere.
              looks: (row.allowedAppLooks ?? []).filter((look) =>
                row.alwaysAllowedApps.includes(look.app),
              ),
            },
          ],
    ),
  );
}

/** Keeps how the account's device names and draws the apps it always allows, in place of what it posted before; false where the account holds no such device. */
export function saveDeviceAppLooks(
  userId: string,
  id: string,
  looks: readonly AllowedAppLook[],
): DeviceEffect<boolean> {
  return Effect.map(writeAppLooks({ userId, id, looks }), (rows) => rows.length > 0);
}

/** Keeps the settings the member gave the account's device on it, the apps switch only where it named one; false where the account holds no such device. */
export function saveCommandDeviceSettings(
  userId: string,
  id: string,
  settings: MachineDeviceSettings,
): DeviceEffect<boolean> {
  return Effect.map(
    writeSettings({
      userId,
      id,
      commandMode: settings.commandMode,
      alwaysAllowedApps: settings.alwaysAllowedApps,
      computerUse: settings.computerUse,
    }),
    (rows) => rows.length > 0,
  );
}

/** What a member changed of one of their machines from anywhere: each setting named, an app taken back from those it always allows, and one added, as a late Always allow adds it. */
export interface MachineChange {
  readonly commandMode?: MachineCommandMode | undefined;
  readonly computerUse?: boolean | undefined;
  readonly removeApp?: string | undefined;
  readonly addApp?: string | undefined;
  /** Whether the machine becomes the member's default machine (`isDefaultMachine`). */
  readonly makeDefault?: true | undefined;
}

/**
 * Changes the account's machine as a member asked, from any of their
 * devices, answering the transaction it was written in; none where the
 * account holds no such machine standing, or one whose app never joined,
 * which holds no settings yet. The machine follows the change live, or
 * takes it as it next joins; a machine made the default is the account's
 * one default from then on, every other it held no longer.
 */
export function changeMachine(
  userId: string,
  id: string,
  change: MachineChange,
): DeviceEffect<string | undefined> {
  const write = Effect.gen(function* () {
    const [changed] = yield* changeSettings({
      userId,
      id,
      commandMode: change.commandMode,
      computerUse: change.computerUse,
      removeApp: change.removeApp,
      addApp: change.addApp,
    });

    // Note that the default moves only once the machine is known to stand, so a pick of one gone leaves the default where it was.
    if (changed !== undefined && change.makeDefault === true) {
      yield* clearDefault({ userId, id });
      yield* markDefault({ userId, id });
    }

    return changed?.txid;
  });

  return Effect.flatMap(SqlClient.SqlClient, (client) => client.withTransaction(write));
}

/**
 * Removes the account's machine, as a wiped app state leaves one behind:
 * stamped removed, so no call is routed to it and no list draws it, and its
 * secret refused, answering the transaction it was removed in; none where
 * the account holds no such machine standing. Note that a Mac still running
 * the app stands it again as it next joins.
 */
export function removeMachine(userId: string, id: string): DeviceEffect<string | undefined> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(stampMachineRemoved({ userId, id, now }), ([removed]) => removed?.txid),
  );
}

/**
 * Marks away every standing machine whose app last listened for its
 * commands longer than `freshMs` before `now`, and is not marked yet,
 * answering how many it marked. The scheduled sweep runs it, so the
 * machines read wakes as an app goes quiet; its next listen clears the mark.
 */
export function markCommandsAwayDevices(now: number, freshMs: number): DeviceEffect<number> {
  return Effect.map(
    markCommandsAway({ now: new Date(now), staleBefore: new Date(now - freshMs) }),
    (rows) => rows.length,
  );
}

/** A machine of a workspace's member as the workspace's members see it: its id, name, platform, whose it is, whether it is there now, and, where it carried them up, its terminal commands mode and its apps switch. */
export interface WorkspaceMachine {
  readonly id: string;
  readonly name: string;
  readonly platform: DevicePlatform;
  readonly userId: string;
  readonly online: boolean;
  readonly commandMode?: MachineCommandMode;
  readonly computerUse?: boolean;
}

/**
 * The machines of a workspace's members, none removed, by name, as any
 * member of it sees them: none unless the reader stands in the workspace,
 * and only those of an owner who stands in it too, so a reader never reads
 * the machines of someone who shares no workspace with them; one member's
 * alone where `memberId` names one; each online where its app listened at
 * or after `listenedSince` or it beats as a host (`machineOnline`). Each
 * carries its terminal commands mode and apps switch where its row holds
 * them, so any member can see why a call there would be refused. Note that
 * it selects no secret, folder, or always-allowed app, since a teammate is
 * shown only what each machine is, whose, whether it is there, and what it
 * lets agents do.
 */
export function workspaceMachinesOf(
  readerId: string,
  workspaceId: string,
  listenedSince: Date,
  memberId?: string,
): DeviceEffect<readonly WorkspaceMachine[]> {
  return Effect.map(
    findWorkspaceMachines({
      readerId,
      workspaceId,
      memberId: memberId ?? null,
      listenedSince,
    }),
    (rows) =>
      rows.map(({ commandMode, computerUse, ...machine }) => ({
        ...machine,
        ...(commandMode === null ? undefined : { commandMode }),
        ...(computerUse === null ? undefined : { computerUse }),
      })),
  );
}
