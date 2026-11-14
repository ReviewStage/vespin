import { type LIVE_READ, LIVE_SIGNED_OUT } from "@repo/features/live-wire";
import {
  MACHINE_ASKS_READ,
  type MachineAskLiveRow,
  type MachineAsksLiveAnswer,
  machineAsksOfLiveRows,
} from "@repo/features/machine-ask-live";
import { type EntityPool, fieldKind } from "@repo/sync";
import { Effect, type Scope } from "effect";
import { type AppMachineAsks, NO_KEYS_HELD } from "./app-state.js";
import { type HeldSlice, heldSlice } from "./live-collection.js";
import { followLiveRead } from "./live-read-follow.js";

/**
 * machine-asks-follow.ts -- the asks the account's machines hold for its answer, followed over the service's held poll into the sync engine's pool by their ids, and told whole on their app-state slice.
 *
 * A window holds them while it could draw one, an agent's tab or a row that
 * counts what needs the developer, so an ask a machine posts, answers given
 * on any device, and an ask taken down draw on every open window within the
 * service's coalesce window. Only the account's own asks are read, never a
 * teammate's (`MACHINE_ASKS_READ`).
 */

/** An ask as the pool holds it, by its id. */
const MACHINE_ASK = fieldKind((row: MachineAskLiveRow) => row.id);

export interface MachineAsksFollowDependencies {
  /** The account's asks sealed for `userId`, their rows inline at the poll address where it polls, held past `after` where it names one. */
  readonly seal: (
    userId: string,
    poll: boolean,
    after?: string,
  ) => Effect.Effect<MachineAsksLiveAnswer | { readonly failure: string }>;
  /** The account signed in, which every seal names; none while nobody is. */
  readonly accountId: () => string | undefined;
  /** Whether the account gate stands open, so a follow may read. */
  readonly gate: () => boolean;
  readonly pool: EntityPool;
  readonly tell: (held: AppMachineAsks) => void;
}

/** The held lifetime over the account's asks the windows hold, keyed by the account, as `heldMachines` holds the machines. */
export function heldMachineAsks(
  dependencies: MachineAsksFollowDependencies,
): Effect.Effect<HeldSlice<string>, never, Scope.Scope> {
  return heldSlice<typeof LIVE_READ.MACHINE_ASKS, string>({
    empty: NO_KEYS_HELD,
    path: (userId) => [userId],
    gate: dependencies.gate,
    follow: (userId, answers) =>
      followLiveRead(
        {
          seal: (poll, after) =>
            userId === dependencies.accountId()
              ? dependencies.seal(userId, poll, after)
              : Effect.succeed(LIVE_SIGNED_OUT),
          rows: MACHINE_ASKS_READ.rows,
          part: "asks",
          pool: dependencies.pool,
          kind: MACHINE_ASK,
          endsFollow: () => false,
          draw: (rows) => machineAsksOfLiveRows(rows),
        },
        answers,
      ),
    tell: dependencies.tell,
  });
}
