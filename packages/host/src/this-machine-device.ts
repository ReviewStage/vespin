import { Effect, Option, Path, Schema, Semaphore } from "effect";
import * as FileSystem from "effect/FileSystem";
import { readHostDevice } from "./host-device-record.js";

/**
 * this-machine-device.ts -- the device this install of the app is to each account signed in on it, by its id: what its commands are claimed by, and what This Mac's host enrolls under.
 *
 * The ids are kept in the app's own state (`mac-device.json`), one per
 * account, so every install on a Mac is a machine of its own, as a
 * development build beside a release is. An account's first id is the one
 * This Mac's host already enrolled under, where its record stands for this
 * app's service, so a Mac enrolled before its commands were claimed by
 * device stays one device; else one minted. Once kept, it is the account's
 * id here until the service refuses it as another account's, when a new
 * one is minted and kept in its place. Two asks at once take turns, so they
 * never mint two ids for one account.
 */

/** The ids' file, in the app's state. */
const DEVICE_IDS_FILE = "mac-device.json";

const DeviceIdsSchema = Schema.fromJsonString(Schema.Record(Schema.String, Schema.String));

const decodeDeviceIds = Schema.decodeUnknownOption(DeviceIdsSchema);
const encodeDeviceIds = Schema.encodeSync(DeviceIdsSchema);

/** This install as a device of each account signed in on it. */
export interface ThisMachineDevice {
  /** The id this install is to the account given: kept, or, where none is, the host's own or one minted, kept from then on. */
  readonly idFor: (userId: string) => Effect.Effect<string>;
  /** A new id minted and kept for the account given, in place of one the service refused as another account's. */
  readonly renewFor: (userId: string) => Effect.Effect<string>;
}

export interface ThisMachineDeviceParts {
  /** The app's own state folder, where the ids are kept. */
  readonly stateRoot: string;
  /** The id This Mac's host enrolled under with this app's service, where it did; none where it never did, or with another service. */
  readonly hostDeviceId: Effect.Effect<Option.Option<string>>;
  readonly createId: () => string;
}

/** The id This Mac's host enrolled under in its state folder, where its record names the service at `serviceOrigin` and was never refused. */
export const enrolledHostDeviceId = (hostStateRoot: string, serviceOrigin: string) =>
  Effect.map(
    readHostDevice(hostStateRoot),
    Option.flatMap((record) =>
      record.refused !== true &&
      URL.canParse(record.serviceOrigin) &&
      new URL(record.serviceOrigin).origin === serviceOrigin
        ? Option.some(record.deviceId)
        : Option.none(),
    ),
  );

/** This install as a device, its ids kept in the state folder given. */
export const openThisMachineDevice = Effect.fnUntraced(function* (parts: ThisMachineDeviceParts) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const oneAtATime = (yield* Semaphore.make(1)).withPermits(1);
  const file = path.join(parts.stateRoot, DEVICE_IDS_FILE);
  /** The ids this run settled on, so one the file could not keep still holds until the app quits. */
  const settled = new Map<string, string>();

  const kept = Effect.map(
    fileSystem.readFileString(file).pipe(Effect.orElseSucceed(() => "")),
    (text): Readonly<Record<string, string>> => Option.getOrElse(decodeDeviceIds(text), () => ({})),
  );

  // Note that the ids are written beside the file and moved over it, so a write cut off leaves the last whole set; one that fails keeps the id for this run alone.
  const keep = (ids: Readonly<Record<string, string>>) =>
    Effect.gen(function* () {
      yield* fileSystem.makeDirectory(parts.stateRoot, { recursive: true });
      const written = `${file}.writing`;
      yield* fileSystem.writeFileString(written, `${encodeDeviceIds(ids)}\n`);
      yield* fileSystem.rename(written, file);
    }).pipe(Effect.ignore);

  const keptOr = (userId: string, fresh: Effect.Effect<string>) =>
    oneAtATime(
      Effect.gen(function* () {
        const known = settled.get(userId);

        if (known !== undefined) return known;
        const ids = yield* kept;
        const id = ids[userId] ?? (yield* fresh);
        settled.set(userId, id);

        if (ids[userId] === undefined) yield* keep({ ...ids, [userId]: id });

        return id;
      }),
    );

  const idFor = (userId: string) =>
    keptOr(userId, Effect.map(parts.hostDeviceId, Option.getOrElse(parts.createId)));

  const renewFor = (userId: string) =>
    oneAtATime(
      Effect.gen(function* () {
        const id = parts.createId();
        settled.set(userId, id);
        yield* keep({ ...(yield* kept), [userId]: id });

        return id;
      }),
    );

  return { idFor, renewFor } satisfies ThisMachineDevice;
});
