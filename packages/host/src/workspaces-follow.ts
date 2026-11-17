import { SIDEBAR_READ, type SidebarRows, sidebarRowsOfLive } from "@repo/features/sidebar-live";
import {
  WORKSPACES_READ,
  type WorkspacesLiveAnswer,
  workspacesOfLiveRows,
} from "@repo/features/workspace-live";
import type { Workspace } from "@repo/features/workspace-wire";
import { type Effect, type Schema, Stream } from "effect";
import {
  decodedLiveRows,
  followTakingRows,
  type LiveBroken,
  type LiveFailure,
  type LiveFollowDependencies,
  type SealedRead,
} from "./live-follow.js";

/**
 * workspaces-follow.ts -- the account's workspaces and sidebar, followed by the host over the service's held poll.
 *
 * The service answers each read's statements (`live/reads/workspaces.ts`
 * and `live/reads/sidebar.ts` on the service) with their rows inline. The host follows them
 * (`live-follow.ts`) and answers each delivery as the held read would, in
 * its order. Only what is built from their rows leaves.
 */

/** A read answered, or why the service answered none, `gone` where it names nothing the account reaches any more. */
type Sealed<Answer> = Answer | LiveFailure;

export interface LiveReadDependencies<Answer> {
  /** The read's rows inline, held until they move past `after`; a failure where the service answered none. */
  readonly poll: (after: string | undefined) => Effect.Effect<Sealed<Answer>>;
}

/**
 * What one live read answers each time its rows change, decoded under
 * `schema` at this boundary and built by `build`, for as long as the
 * caller's scope stands. It fails where the read is gone or a row does not
 * decode, which the caller answers by reading it again.
 */
function liveMoves<Part extends string, Rows, Built>(
  dependencies: LiveReadDependencies<SealedRead<Part>>,
  first: SealedRead<Part>,
  schema: Schema.Decoder<Rows>,
  build: (rows: Rows) => Built,
): Stream.Stream<Built, LiveBroken> {
  return decodedLiveRows({ poll: dependencies.poll }, first, schema).pipe(Stream.map(build));
}

/** The account's workspaces each time their rows change, as the held read would list them. */
export function workspacesMoves(
  dependencies: LiveReadDependencies<WorkspacesLiveAnswer>,
  first: WorkspacesLiveAnswer,
): Stream.Stream<readonly Workspace[], LiveBroken> {
  return liveMoves(dependencies, first, WORKSPACES_READ.rows, workspacesOfLiveRows);
}

/** The sidebar read's parts: its sections, the tasks and the agents in them, and its pinned repositories. */
type SidebarPart = "sections" | "entries" | "agentEntries" | "pins";

/**
 * The account's sidebar followed until it is gone, each answer's rows,
 * every part's, decoded and handed to `take` the moment its poll answers,
 * before the follow carries the answer's txids on to a write waiting for
 * them (`followTakingRows`). So a write confirmed on the sidebar finds its
 * rows already taken (`sidebar-collections.ts`). An answer whose rows do
 * not decode is a failed poll, asked again; a first one fails the follow,
 * which the caller seals again.
 */
export function followSidebarRows(
  dependencies: LiveFollowDependencies<SidebarPart>,
  first: SealedRead<SidebarPart>,
  take: (rows: SidebarRows) => Effect.Effect<void>,
): Effect.Effect<void, LiveBroken> {
  return followTakingRows(dependencies, first, SIDEBAR_READ.rows, (rows) =>
    take(sidebarRowsOfLive(rows)),
  );
}
