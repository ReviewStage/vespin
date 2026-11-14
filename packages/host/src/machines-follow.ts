import type { HostDoneAnswerView, MachineChangeParams } from "@repo/features/agent-view";
import { type LIVE_READ, LIVE_SIGNED_OUT } from "@repo/features/live-wire";
import {
  MACHINES_READ,
  type MachineLiveRow,
  type MachinesLiveAnswer,
  machinesOfLiveRows,
} from "@repo/features/machine-live";
import {
  type EntityPool,
  type FieldChange,
  fieldKind,
  ROW_GONE,
  type WriteDeclaration,
} from "@repo/sync";
import { Effect, type Scope } from "effect";
import { type AppMachines, NO_KEYS_HELD } from "./app-state.js";
import { type HeldSlice, heldSlice } from "./live-collection.js";
import { followLiveRead } from "./live-read-follow.js";

/**
 * machines-follow.ts -- the account's machines the windows hold, followed over the service's held poll into the sync engine's pool by their ids, told whole on their app-state slice, and a change or a removal drawn over them the moment it is asked.
 *
 * Settings › Machines holds the account's machines, and the host follows
 * them while any window holds them and a while after (`heldSlice`), so a
 * machine joining, its app coming or going, or its settings changed on it
 * or from any other device draws on every open page within the service's
 * coalesce window. Each machine is one row of the pool (`@repo/sync`), by
 * its id, drawn as the held read answers them
 * (`@repo/features/machine-live`), followed as every pool read is
 * (`followLiveRead`). A change is drawn over its machine at once
 * (`machineChange`), and a removal draws it gone (`machineRemove`), each
 * standing until the read carries its transaction, and taken back where
 * the service refused it. A read the service did not answer is asked for
 * again; one under another account's session ends unsaid, and the next
 * sign-in follows it again.
 */

/** A machine as the pool holds it, by its id, the key its part declares, every write to it a change of its fields or its removal. */
const MACHINE = fieldKind((row: MachineLiveRow) => row.id);

/** A read the service did not answer, as the client and the gate tell it. */
interface MachinesUnanswered {
  readonly failure: string;
}

export interface MachinesFollowDependencies {
  /** The account's machines sealed for `userId`, their rows inline at the poll address where it polls, held past `after` where it names one. */
  readonly seal: (
    userId: string,
    poll: boolean,
    after?: string,
  ) => Effect.Effect<MachinesLiveAnswer | MachinesUnanswered>;
  /** The account signed in, which every seal names; none while nobody is. */
  readonly accountId: () => string | undefined;
  /** Whether the account gate stands open, so a follow may read. */
  readonly gate: () => boolean;
  /** The sync engine's pool, which the account's machines stand in while they are followed. */
  readonly pool: EntityPool;
  readonly tell: (held: AppMachines) => void;
}

/**
 * The held lifetime over the account's machines the windows hold
 * (`heldSlice`), keyed by the account, told whole on their slice: the read
 * as its follow last told it, kept where a later read does not answer, and
 * failed where it never answered.
 */
export function heldMachines(
  dependencies: MachinesFollowDependencies,
): Effect.Effect<HeldSlice<string>, never, Scope.Scope> {
  return heldSlice<typeof LIVE_READ.MACHINES, string>({
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
          rows: MACHINES_READ.rows,
          part: "machines",
          pool: dependencies.pool,
          kind: MACHINE,
          // Note that no refusal ends the follow but another account's session, which every follow ends on.
          endsFollow: () => false,
          draw: (rows) => machinesOfLiveRows(rows),
        },
        answers,
      ),
    tell: dependencies.tell,
  });
}

/** A write's answer as the pool waits on it: the transaction the service wrote in, or the refusal that puts the machine back. */
const awaited = (answer: HostDoneAnswerView) =>
  "done" in answer ? { answer, txid: answer.txid } : { refused: answer };

/**
 * One of the account's machines changed as Settings › Machines asks, drawn
 * over its row at once, sent as `send` asks: each setting named, and an app
 * taken back from those it always allows. Note that a change the service
 * took answers the transaction it was written in, which the read is waited
 * on; a refusal puts the machine back as the read holds it.
 */
export function machineChange(
  send: (change: MachineChangeParams) => Effect.Effect<HostDoneAnswerView>,
): WriteDeclaration<
  MachineLiveRow,
  FieldChange<MachineLiveRow>,
  MachineChangeParams,
  HostDoneAnswerView
> {
  return {
    kind: MACHINE,
    keys: (change) => [change.id],
    change: (change) => (row) => ({
      ...(change.commandMode === undefined ? undefined : { commandMode: change.commandMode }),
      ...(change.computerUse === undefined ? undefined : { computerUse: change.computerUse }),
      ...(change.removeApp === undefined || row.alwaysAllowedApps === null
        ? undefined
        : { alwaysAllowedApps: row.alwaysAllowedApps.filter((app) => app !== change.removeApp) }),
    }),
    send: (change) => Effect.map(send(change), awaited),
  };
}

/** One of the account's machines removed, gone at once from its held read, sent as `send` asks; a refusal puts it back where the read still holds it. */
export function machineRemove(
  send: (id: string) => Effect.Effect<HostDoneAnswerView>,
): WriteDeclaration<MachineLiveRow, FieldChange<MachineLiveRow>, string, HostDoneAnswerView> {
  return {
    kind: MACHINE,
    keys: (id) => [id],
    change: () => () => ROW_GONE,
    send: (id) => Effect.map(send(id), awaited),
  };
}
