/**
 * agent-sandbox-holds.ts -- what a member holds open in a cloud agent's sandbox, which keeps it up: its Terminal tabs, and each holder's heartbeat while its ports are forwarded to a Mac or a Browser view of it is open.
 *
 * A Terminal tab is a row of its own (`agent_sandbox_terminal`), written as
 * its shell starts and deleted as it ends, so a hold is never a counter that
 * drifts: the shells a list reads keep only their own rows. Each holder of
 * a port forward (a Mac) or a Browser view (a socket) beats a row of its
 * own (`agent_sandbox_beat`), written at most every `BEAT_EVERY` and deleted
 * as that holder lets go, so a release takes effect at once and never lets
 * go of another holder's; a holder that quit, crashed, or slept without
 * letting go lapses `FRESH` past its last beat. A release or a discard
 * forgets every hold of the sandbox, since its run ends with it
 * (`./agent-sandboxes.ts`). The minute sweep keeps every LIVE sandbox held
 * up (`heldAgentSandboxes`). A hold names a sandbox, a shell's or a
 * holder's id, and instants alone, never a byte of what a shell or a page
 * shows.
 */

import { and, eq, inArray, lt, notInArray, or, sql } from "drizzle-orm";
import { Duration, Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import {
  AGENT_SANDBOX_BEAT_KIND,
  AGENT_SANDBOX_STATE,
  type AgentSandboxBeatKind,
  agentSandboxBeatTable,
  agentSandboxTable,
  agentSandboxTerminalTable,
} from "../schemas/agent-sandbox.js";

const AGENT_SANDBOX_HOLD = {
  /** How long a heartbeat holds the sandbox: two beats, so one lost on its way never lets it go. */
  FRESH: Duration.minutes(2),
  /** The most often a heartbeat is written: a minute, whatever its caller beats at. */
  BEAT_EVERY: Duration.minutes(1),
} as const;

type HoldEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

/** One holder's beat: what it holds the sandbox for, and its own id (a Mac's for a forward, a socket's for a view). */
export interface AgentSandboxBeat {
  readonly kind: AgentSandboxBeatKind;
  readonly holder: string;
}

const BeatSchema = Schema.Struct({
  sandboxName: Schema.String,
  kind: Schema.Literals(Object.values(AGENT_SANDBOX_BEAT_KIND)),
  holder: Schema.String,
});

/** The instant `bound` before `at`. */
const before = (at: Date, bound: Duration.Duration) =>
  new Date(at.getTime() - Duration.toMillis(bound));

const upsertBeat = SqlSchema.void({
  Request: Schema.Struct({ ...BeatSchema.fields, at: Schema.Date, writtenBefore: Schema.Date }),
  execute: ({ sandboxName, kind, holder, at, writtenBefore }) =>
    Database.use((db) =>
      db
        .insert(agentSandboxBeatTable)
        // Note that a sandbox no open recorded holds nothing, so the row is written only beside its sandbox's.
        .select(
          db
            .select({
              sandboxName: agentSandboxTable.sandboxName,
              kind: sql<AgentSandboxBeatKind>`${kind}`.as("kind"),
              holder: sql<string>`${holder}`.as("holder"),
              beatAt: sql<Date>`${at.toISOString()}::timestamptz`.as("beat_at"),
            })
            .from(agentSandboxTable)
            .where(eq(agentSandboxTable.sandboxName, sandboxName)),
        )
        .onConflictDoUpdate({
          target: [
            agentSandboxBeatTable.sandboxName,
            agentSandboxBeatTable.kind,
            agentSandboxBeatTable.holder,
          ],
          set: { beatAt: at },
          setWhere: sql`${agentSandboxBeatTable.beatAt} <= ${writtenBefore.toISOString()}::timestamptz`,
        }),
    ),
});

const deleteBeats = SqlSchema.void({
  Request: Schema.Struct({
    sandboxName: Schema.String,
    beat: Schema.optional(Schema.Struct({ kind: BeatSchema.fields.kind, holder: Schema.String })),
  }),
  execute: ({ sandboxName, beat }) =>
    Database.use((db) =>
      db
        .delete(agentSandboxBeatTable)
        .where(
          and(
            eq(agentSandboxBeatTable.sandboxName, sandboxName),
            beat === undefined ? undefined : eq(agentSandboxBeatTable.kind, beat.kind),
            beat === undefined ? undefined : eq(agentSandboxBeatTable.holder, beat.holder),
          ),
        ),
    ),
});

const insertTerminal = SqlSchema.void({
  Request: Schema.Struct({
    sandboxName: Schema.String,
    terminalId: Schema.String,
    at: Schema.Date,
  }),
  execute: ({ sandboxName, terminalId, at }) =>
    Database.use((db) =>
      db
        .insert(agentSandboxTerminalTable)
        // Note that a sandbox no open recorded holds nothing, so the row is written only beside its sandbox's.
        .select(
          db
            .select({
              sandboxName: agentSandboxTable.sandboxName,
              terminalId: sql<string>`${terminalId}`.as("terminal_id"),
              openedAt: sql<Date>`${at.toISOString()}::timestamptz`.as("opened_at"),
            })
            .from(agentSandboxTable)
            .where(eq(agentSandboxTable.sandboxName, sandboxName)),
        )
        // Note that a shell started again under its id, as a run action reruns, holds from its restart, so a list begun before it never prunes it.
        .onConflictDoUpdate({
          target: [agentSandboxTerminalTable.sandboxName, agentSandboxTerminalTable.terminalId],
          set: { openedAt: at },
        }),
    ),
});

const deleteTerminals = SqlSchema.void({
  Request: Schema.Struct({
    sandboxName: Schema.String,
    ended: Schema.optional(Schema.Array(Schema.String)),
    kept: Schema.optional(Schema.Array(Schema.String)),
    openedBefore: Schema.optional(Schema.Date),
  }),
  execute: ({ sandboxName, ended, kept, openedBefore }) =>
    Database.use((db) =>
      db
        .delete(agentSandboxTerminalTable)
        .where(
          and(
            eq(agentSandboxTerminalTable.sandboxName, sandboxName),
            ended === undefined
              ? undefined
              : inArray(agentSandboxTerminalTable.terminalId, [...ended]),
            kept === undefined || kept.length === 0
              ? undefined
              : notInArray(agentSandboxTerminalTable.terminalId, [...kept]),
            openedBefore === undefined
              ? undefined
              : lt(agentSandboxTerminalTable.openedAt, openedBefore),
          ),
        ),
    ),
});

/** That the sandbox's row is held at `at`: a Terminal tab open in it, or any holder's beat inside `FRESH`. */
function heldAt(at: Date) {
  const fresh = before(at, AGENT_SANDBOX_HOLD.FRESH).toISOString();

  return or(
    sql`exists (select 1 from ${agentSandboxTerminalTable} where ${agentSandboxTerminalTable.sandboxName} = ${agentSandboxTable.sandboxName})`,
    sql`exists (select 1 from ${agentSandboxBeatTable} where ${agentSandboxBeatTable.sandboxName} = ${agentSandboxTable.sandboxName} and ${agentSandboxBeatTable.beatAt} > ${fresh}::timestamptz)`,
  );
}

const findHeld = SqlSchema.findAll({
  Request: Schema.Struct({ sandboxName: Schema.String, at: Schema.Date }),
  Result: Schema.Struct({ sandboxName: Schema.String }),
  execute: ({ sandboxName, at }) =>
    Database.use((db) =>
      db
        .select({ sandboxName: agentSandboxTable.sandboxName })
        .from(agentSandboxTable)
        .where(and(eq(agentSandboxTable.sandboxName, sandboxName), heldAt(at))),
    ),
});

const findHeldLive = SqlSchema.findAll({
  Request: Schema.Struct({ at: Schema.Date, limit: Schema.Int }),
  Result: Schema.Struct({ sandboxName: Schema.String }),
  execute: ({ at, limit }) =>
    Database.use((db) =>
      db
        .select({ sandboxName: agentSandboxTable.sandboxName })
        .from(agentSandboxTable)
        .where(and(eq(agentSandboxTable.state, AGENT_SANDBOX_STATE.LIVE), heldAt(at)))
        // Note that the order is drawn afresh each sweep, so past the limit no sandbox is left out every minute.
        .orderBy(sql`random()`)
        .limit(limit),
    ),
});

/** One holder's heartbeat on the sandbox at `at`, which holds it until the holder lets go or `FRESH` passes; written only where its last is `BEAT_EVERY` old, and nothing where no open recorded the sandbox. */
export function recordAgentSandboxBeat(
  sandboxName: string,
  beat: AgentSandboxBeat,
  at: Date,
): HoldEffect<void> {
  return upsertBeat({
    sandboxName,
    ...beat,
    at,
    writtenBefore: before(at, AGENT_SANDBOX_HOLD.BEAT_EVERY),
  });
}

/** One holder let go of the sandbox: its forwarding turned off, or its view closed; every other holder's hold stands. */
export function releaseAgentSandboxBeat(
  sandboxName: string,
  beat: AgentSandboxBeat,
): HoldEffect<void> {
  return deleteBeats({ sandboxName, beat });
}

/** A Terminal tab's shell started in the sandbox at `at`, which holds it until the shell ends; nothing where no open recorded the sandbox. */
export function recordAgentSandboxTerminalOpened(
  sandboxName: string,
  terminalId: string,
  at: Date,
): HoldEffect<void> {
  return insertTerminal({ sandboxName, terminalId, at });
}

/** A Terminal tab's shell ended, its hold let go. */
export function recordAgentSandboxTerminalEnded(
  sandboxName: string,
  terminalId: string,
): HoldEffect<void> {
  return deleteTerminals({ sandboxName, ended: [terminalId] });
}

/** The sandbox's shells as a list begun at `listedAt` read them: every tab's hold opened before then whose shell it left out let go, and every one where it listed none; a tab opened since stands, since the list could not have read it. */
export function keepAgentSandboxTerminals(
  sandboxName: string,
  terminalIds: ReadonlyArray<string>,
  listedAt: Date,
): HoldEffect<void> {
  return deleteTerminals({ sandboxName, kept: terminalIds, openedBefore: listedAt });
}

/** Every hold on the sandbox let go, as its run ends: its shells ended with it, and nothing is left to forward or view. */
export function forgetAgentSandboxHolds(sandboxName: string): HoldEffect<void> {
  return Effect.andThen(deleteTerminals({ sandboxName }), deleteBeats({ sandboxName }));
}

/** Whether a member holds the sandbox open at `now`: a Terminal tab open in it, or any holder's beat inside `FRESH`. */
export function agentSandboxHeld(sandboxName: string, now: Date): HoldEffect<boolean> {
  return Effect.map(findHeld({ sandboxName, at: now }), (rows) => rows.length > 0);
}

/** The LIVE sandboxes, among every account's, a member holds open at `now`, at most `limit` of them, drawn in an order of their own each read: the ones the minute sweep keeps up. */
export function heldAgentSandboxes(now: Date, limit: number): HoldEffect<readonly string[]> {
  return Effect.map(findHeldLive({ at: now, limit }), (rows) => rows.map((row) => row.sandboxName));
}
