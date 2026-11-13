/**
 * agent-sandbox-holds.ts -- what a member holds open in a cloud agent's sandbox, which keeps it up: its Terminal tabs, and a heartbeat while its ports are forwarded or its Browser view is open.
 *
 * A Terminal tab is a row of its own (`agent_sandbox_terminal`), written as
 * its shell starts and deleted as it ends, so a hold is never a counter that
 * drifts: the shells a list reads keep only their own rows, and a boot or a
 * release forgets every row of the sandbox, since its shells end with the
 * run (`./agent-sandboxes.ts`). A port forward and a Browser view each beat
 * on the sandbox's row (`held_at`), written at most every `BEAT_EVERY`, and
 * hold it for `FRESH` past the last beat, so an app that quit, crashed, or
 * slept lets go on its own. The minute sweep keeps every LIVE sandbox held
 * up (`heldAgentSandboxes`). A hold names a sandbox, a shell's id, and
 * instants alone, never a byte of what a shell or a page shows.
 */

import { and, eq, gt, inArray, isNotNull, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import { Duration, Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import {
  AGENT_SANDBOX_STATE,
  agentSandboxTable,
  agentSandboxTerminalTable,
} from "../schemas/agent-sandbox.js";

export const AGENT_SANDBOX_HOLD = {
  /** How long a heartbeat holds the sandbox: two beats, so one lost on its way never lets it go. */
  FRESH: Duration.minutes(2),
  /** The most often a heartbeat is written: a minute, whatever its caller beats at. */
  BEAT_EVERY: Duration.minutes(1),
} as const;

type HoldEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

/** The instant `bound` before `at`. */
const before = (at: Date, bound: Duration.Duration) =>
  new Date(at.getTime() - Duration.toMillis(bound));

const updateHeld = SqlSchema.void({
  Request: Schema.Struct({
    sandboxName: Schema.String,
    at: Schema.Date,
    writtenBefore: Schema.Date,
  }),
  execute: ({ sandboxName, at, writtenBefore }) =>
    Database.use((db) =>
      db
        .update(agentSandboxTable)
        .set({ heldAt: at })
        .where(
          and(
            eq(agentSandboxTable.sandboxName, sandboxName),
            or(isNull(agentSandboxTable.heldAt), lt(agentSandboxTable.heldAt, writtenBefore)),
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
        .onConflictDoNothing(),
    ),
});

const deleteTerminals = SqlSchema.void({
  Request: Schema.Struct({
    sandboxName: Schema.String,
    ended: Schema.optional(Schema.Array(Schema.String)),
    kept: Schema.optional(Schema.Array(Schema.String)),
  }),
  execute: ({ sandboxName, ended, kept }) =>
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
          ),
        ),
    ),
});

/** That the sandbox's row is held at `at`: a Terminal tab open in it, or a heartbeat inside `FRESH`. */
function heldAt(at: Date) {
  return or(
    and(
      isNotNull(agentSandboxTable.heldAt),
      gt(agentSandboxTable.heldAt, before(at, AGENT_SANDBOX_HOLD.FRESH)),
    ),
    sql`exists (select 1 from ${agentSandboxTerminalTable} where ${agentSandboxTerminalTable.sandboxName} = ${agentSandboxTable.sandboxName})`,
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

/** A member's heartbeat on the sandbox at `at`: its ports forwarded or its Browser view open; written only where the last is `BEAT_EVERY` old, and nothing where no open recorded the sandbox. */
export function recordAgentSandboxHeld(sandboxName: string, at: Date): HoldEffect<void> {
  return updateHeld({ sandboxName, at, writtenBefore: before(at, AGENT_SANDBOX_HOLD.BEAT_EVERY) });
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

/** The sandbox's shells as a list read them: every tab's hold whose shell it left out let go, and every one where it listed none. */
export function keepAgentSandboxTerminals(
  sandboxName: string,
  terminalIds: ReadonlyArray<string>,
): HoldEffect<void> {
  return deleteTerminals({ sandboxName, kept: terminalIds });
}

/** Every Terminal tab's hold on the sandbox let go, as its run ends: its shells ended with it. */
export function forgetAgentSandboxTerminals(sandboxName: string): HoldEffect<void> {
  return deleteTerminals({ sandboxName });
}

/** Whether a member holds the sandbox open at `now`: a Terminal tab open in it, or a heartbeat inside `FRESH`. */
export function agentSandboxHeld(sandboxName: string, now: Date): HoldEffect<boolean> {
  return Effect.map(findHeld({ sandboxName, at: now }), (rows) => rows.length > 0);
}

/** The LIVE sandboxes, among every account's, a member holds open at `now`, at most `limit` of them, drawn in an order of their own each read: the ones the minute sweep keeps up. */
export function heldAgentSandboxes(now: Date, limit: number): HoldEffect<readonly string[]> {
  return Effect.map(findHeldLive({ at: now, limit }), (rows) => rows.map((row) => row.sandboxName));
}
