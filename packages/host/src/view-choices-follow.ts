import type { ViewChoiceWriteParams, ViewChoiceWrittenView } from "@repo/features/agent-view";
import { type LIVE_READ, LIVE_SIGNED_OUT } from "@repo/features/live-wire";
import {
  VIEW_CHOICES_READ,
  type ViewChoiceLiveRow,
  type ViewChoicesLiveAnswer,
} from "@repo/features/view-choice-live";
import {
  type EntityPool,
  type FieldChange,
  fieldKind,
  ROW_GONE,
  type RowKind,
  type WriteDeclaration,
} from "@repo/sync";
import { Effect, Equal, Predicate, type Scope } from "effect";
import { type AppViewChoices, NO_KEYS_HELD } from "./app-state.js";
import { type HeldSlice, heldSlice } from "./live-collection.js";
import { followLiveRead } from "./live-read-follow.js";

/**
 * view-choices-follow.ts -- the account's view choices (a sort, a filter, a fold), followed over the service's held poll into the sync engine's pool by their ids, told whole on their app-state slice, and each one kept or forgotten drawn over them the moment it is asked.
 *
 * A window holds them while it draws a surface that reads one, so a choice
 * made on any device draws on every open window within the service's
 * coalesce window. Only the account's own choices are read, never a
 * teammate's (`VIEW_CHOICES_READ`).
 */

/** Plain rows keyed by their ids, whose changes and removals are drawn as `fieldKind` draws them. */
const PLAIN = fieldKind((row: ViewChoiceLiveRow) => row.id);

/**
 * A view choice as the pool holds it, by its id. Note that a row made is
 * drawn over the row standing under its id too, as the value it keeps,
 * because a choice is kept whether or not one stood in its place: the
 * window names the standing row's id where one stands, and an id of its
 * own where none does (`ViewChoiceWriteParams`).
 */
const VIEW_CHOICE_ROW: RowKind<ViewChoiceLiveRow, FieldChange<ViewChoiceLiveRow>> = {
  key: PLAIN.key,
  drawn: (change, row) => {
    if (Predicate.isFunction(change) || row === undefined) return PLAIN.drawn(change, row);

    return Equal.equals(row.value, change.made.value)
      ? undefined
      : { ...row, value: change.made.value };
  },
};

/** A read the service did not answer, as the client and the gate tell it. */
interface ViewChoicesUnanswered {
  readonly failure: string;
}

export interface ViewChoicesFollowDependencies {
  /** The account's view choices sealed for `userId`, their rows inline at the poll address where it polls, held past `after` where it names one. */
  readonly seal: (
    userId: string,
    poll: boolean,
    after?: string,
  ) => Effect.Effect<ViewChoicesLiveAnswer | ViewChoicesUnanswered>;
  /** The account signed in, which every seal names; none while nobody is. */
  readonly accountId: () => string | undefined;
  /** Whether the account gate stands open, so a follow may read. */
  readonly gate: () => boolean;
  /** The sync engine's pool, which the account's view choices stand in while they are followed. */
  readonly pool: EntityPool;
  readonly tell: (held: AppViewChoices) => void;
}

/** The held lifetime over the account's view choices the windows hold, keyed by the account, as `heldMachines` holds the machines. */
export function heldViewChoices(
  dependencies: ViewChoicesFollowDependencies,
): Effect.Effect<HeldSlice<string>, never, Scope.Scope> {
  return heldSlice<typeof LIVE_READ.VIEW_CHOICES, string>({
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
          rows: VIEW_CHOICES_READ.rows,
          part: "choices",
          pool: dependencies.pool,
          kind: VIEW_CHOICE_ROW,
          // Note that no refusal ends the follow but another account's session, which every follow ends on.
          endsFollow: () => false,
          draw: (rows) => rows,
          // Note that a choice made in a place none stood in is the account's, whose read this is, so it is drawn before the read carries it.
          adopts: () => true,
        },
        answers,
      ),
    tell: dependencies.tell,
  });
}

/**
 * One of the account's view choices kept, drawn at once under the id the
 * window names, or forgotten, drawn gone at once; sent as `send` asks,
 * standing until the read carries the transaction it committed in, and
 * taken back where the service refused it.
 */
export function viewChoiceWritten(
  send: (write: ViewChoiceWriteParams) => Effect.Effect<ViewChoiceWrittenView>,
): WriteDeclaration<
  ViewChoiceLiveRow,
  FieldChange<ViewChoiceLiveRow>,
  ViewChoiceWriteParams,
  ViewChoiceWrittenView
> {
  return {
    kind: VIEW_CHOICE_ROW,
    keys: (write) => [write.id],
    change: ({ id, key, workspaceId, value }) =>
      value === null ? () => ROW_GONE : { made: { id, key, workspaceId, value } },
    send: (write) =>
      Effect.map(send(write), (answer) =>
        "failure" in answer ? { refused: answer } : { answer, txid: answer.txid },
      ),
  };
}
