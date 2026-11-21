import { WORKSPACE_CALL_FAILURE } from "@repo/features";
import type { LIVE_READ } from "@repo/features/live-wire";
import {
  WORKSPACE_MACHINES_READ,
  type WorkspaceMachinesLiveAnswer,
} from "@repo/features/workspace-machine-live";
import {
  nextWorkspaceMachineLapse,
  type WorkspaceMachineDoneView,
  type WorkspaceMachineLiveRow,
  workspaceMachinesOfLiveRows,
} from "@repo/features/workspace-machine-view";
import {
  type EntityPool,
  type FieldChange,
  fieldKind,
  ROW_GONE,
  type WriteDeclaration,
} from "@repo/sync";
import { Effect, type Scope } from "effect";
import { type AppWorkspaceMachines, NO_KEYS_HELD } from "./app-state.js";
import { type HeldSlice, heldSlice } from "./live-collection.js";
import { followLiveRead } from "./live-read-follow.js";

/**
 * workspace-machines-follow.ts -- the machines each workspace owns that the windows hold, followed over the service's held poll into the sync engine's pool by their ids, told on their app-state slice, and a rename or a removal drawn over them the moment it is asked.
 *
 * Settings › Machines holds a workspace's machines, and the Machine picker
 * holds them where it offers them, and the host follows them while any
 * window holds them and a while after (`heldSlice`), so a machine
 * connected, setting up, going away, renamed, or removed draws on every
 * open page within the service's coalesce window. Each machine is one row
 * of the pool (`@repo/sync`), by its id, drawn as the held read answers
 * them (`@repo/features/workspace-machine-view`), followed as every pool
 * read is (`followLiveRead`), and drawn again at the instant an uncollected
 * machine's pairing lapses, so it leaves with no row moving. A rename is
 * drawn over its machine at once (`workspaceMachineRename`), and a removal
 * draws it gone (`workspaceMachineRemove`), each standing until the read
 * carries its transaction, and taken back where the service refused it. A
 * read the service did not answer is asked for again; one of a workspace the
 * account no longer reaches is told unanswered and followed no longer.
 */

/** A machine as the pool holds it, by its id, the key its part declares, every write to it a change of its fields or its removal. */
const WORKSPACE_MACHINE = fieldKind((row: WorkspaceMachineLiveRow) => row.id);

/** A read the service did not answer, as the client and the gate tell it. */
interface WorkspaceMachinesUnanswered {
  readonly failure: string;
}

export interface WorkspaceMachinesFollowDependencies {
  /** One workspace's machines sealed for following, or polled past `after`, for the account signed in; why not otherwise. */
  readonly seal: (
    workspaceId: string,
  ) => (
    poll: boolean,
    after?: string,
  ) => Effect.Effect<WorkspaceMachinesLiveAnswer | WorkspaceMachinesUnanswered>;
  /** Whether the account gate stands open, so a follow may read. */
  readonly gate: () => boolean;
  /** The sync engine's pool, which each held workspace's machines stand in while they are followed. */
  readonly pool: EntityPool;
  readonly tell: (held: AppWorkspaceMachines) => void;
}

/**
 * The held lifetime over the machines of each workspace the windows hold
 * (`heldSlice`), keyed by the workspace, told on their slice: the read as
 * its follow last told it, kept where a later read does not answer, and
 * failed where it never answered.
 */
export function heldWorkspaceMachines(
  dependencies: WorkspaceMachinesFollowDependencies,
): Effect.Effect<HeldSlice<string>, never, Scope.Scope> {
  return heldSlice<typeof LIVE_READ.WORKSPACE_MACHINES, string>({
    empty: NO_KEYS_HELD,
    path: (workspaceId) => [workspaceId],
    gate: dependencies.gate,
    follow: (workspaceId, answers) =>
      followLiveRead(
        {
          seal: dependencies.seal(workspaceId),
          rows: WORKSPACE_MACHINES_READ.rows,
          part: "machines",
          pool: dependencies.pool,
          kind: WORKSPACE_MACHINE,
          // Note that a workspace the account no longer reaches is not found, which ends the follow until a window holds it anew.
          endsFollow: (failure) => failure === WORKSPACE_CALL_FAILURE.NOT_FOUND,
          draw: (rows, _first, now) => workspaceMachinesOfLiveRows(rows, now),
          // Note that a machine whose pairing lapses uncollected leaves at that instant with no row moving.
          edge: nextWorkspaceMachineLapse,
        },
        answers,
      ),
    tell: dependencies.tell,
  });
}

/** A write's answer as the pool waits on it: the transaction the service wrote in, or the refusal that puts the machine back. */
const awaited = (answer: WorkspaceMachineDoneView) =>
  "done" in answer ? { answer, txid: answer.txid } : { refused: answer };

/** What a rename of one of a workspace's machines names. */
export interface WorkspaceMachineRenamed {
  readonly workspaceId: string;
  readonly id: string;
  readonly name: string;
}

/** What a removal of one of a workspace's machines names. */
export interface WorkspaceMachineNamed {
  readonly workspaceId: string;
  readonly id: string;
}

/** One of a workspace's machines renamed, drawn under its new name at once, sent as `send` asks; a refusal puts its name back. */
export function workspaceMachineRename(
  send: (renamed: WorkspaceMachineRenamed) => Effect.Effect<WorkspaceMachineDoneView>,
): WriteDeclaration<
  WorkspaceMachineLiveRow,
  FieldChange<WorkspaceMachineLiveRow>,
  WorkspaceMachineRenamed,
  WorkspaceMachineDoneView
> {
  return {
    kind: WORKSPACE_MACHINE,
    keys: (renamed) => [renamed.id],
    change: (renamed) => () => ({ name: renamed.name }),
    send: (renamed) => Effect.map(send(renamed), awaited),
  };
}

/** One of a workspace's machines removed, gone at once from its held read, sent as `send` asks; a refusal puts it back where the read still holds it. */
export function workspaceMachineRemove(
  send: (named: WorkspaceMachineNamed) => Effect.Effect<WorkspaceMachineDoneView>,
): WriteDeclaration<
  WorkspaceMachineLiveRow,
  FieldChange<WorkspaceMachineLiveRow>,
  WorkspaceMachineNamed,
  WorkspaceMachineDoneView
> {
  return {
    kind: WORKSPACE_MACHINE,
    keys: (named) => [named.id],
    change: () => () => ROW_GONE,
    send: (named) => Effect.map(send(named), awaited),
  };
}
