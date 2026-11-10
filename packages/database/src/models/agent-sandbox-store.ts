/**
 * agent-sandbox-store.ts -- where each cloud agent's sandbox stands, written as the service boots, runs, touches, and discards it.
 *
 * A sandbox's record (`schemas/agent-sandbox.ts`) is the service's alone to
 * write and reads no account: the task list reads it through the rule an
 * agent is read by (`live/reads/tasks.ts`). A boot begins it anew, booting
 * on its first step, which every later step of that boot is appended to; a
 * runner handed its first lines marks it running until `SANDBOX_IDLE` from
 * then; each touch moves that on, though only where it moves by the
 * caller's least step, so a sandbox in use costs about one write a minute;
 * and a discard, or an open that failed, marks the session's sandbox off.
 * Each write reads the clock itself, so every instant is the service's.
 */

import {
  SANDBOX_STATE,
  SANDBOX_STEP,
  type SandboxBootStep,
  type SandboxStep,
} from "@repo/features/agent-sandbox-wire";
import { and, eq, lte, ne, sql } from "drizzle-orm";
import { DateTime, Duration, Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { agentSandbox } from "../schemas/agent-sandbox.js";
import { InstantColumnSchema } from "./columns.js";

type SandboxEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

/** The steps a boot begins with. */
type BootStart = typeof SANDBOX_STEP.CREATING | typeof SANDBOX_STEP.RESUMING;

const STATES = Object.values(SANDBOX_STATE);

const STEPS = Object.values(SANDBOX_STEP);

/** A sandbox's record as its row keeps it. */
const AgentSandboxRowSchema = Schema.Struct({
  conversationId: Schema.String,
  session: Schema.String,
  state: Schema.Literals(STATES),
  steps: Schema.Array(Schema.Struct({ step: Schema.Literals(STEPS), at: Schema.Number })),
  stateAt: InstantColumnSchema,
  runsUntil: Schema.NullOr(InstantColumnSchema),
});

export type AgentSandboxRow = typeof AgentSandboxRowSchema.Type;

const rowColumns = {
  conversationId: agentSandbox.conversationId,
  session: agentSandbox.session,
  state: agentSandbox.state,
  steps: agentSandbox.steps,
  stateAt: agentSandbox.stateAt,
  runsUntil: agentSandbox.runsUntil,
};

/** A step as the row's `steps` holds it, begun at the instant given. */
function stepAt(step: SandboxStep, at: Date): readonly SandboxBootStep[] {
  return [{ step, at: at.getTime() }];
}

const findSandbox = SqlSchema.findAll({
  Request: Schema.Struct({ conversationId: Schema.String }),
  Result: AgentSandboxRowSchema,
  execute: ({ conversationId }) =>
    Database.use((db) =>
      db
        .select(rowColumns)
        .from(agentSandbox)
        .where(eq(agentSandbox.conversationId, conversationId)),
    ),
});

const upsertBooting = SqlSchema.void({
  Request: Schema.Struct({
    conversationId: Schema.String,
    session: Schema.String,
    step: Schema.Literals([SANDBOX_STEP.CREATING, SANDBOX_STEP.RESUMING]),
    now: Schema.Date,
  }),
  execute: ({ conversationId, session, step, now }) =>
    Database.use((db) => {
      const fresh = {
        session,
        state: SANDBOX_STATE.BOOTING,
        steps: stepAt(step, now),
        stateAt: now,
        runsUntil: null,
      };
      return db
        .insert(agentSandbox)
        .values({ conversationId, ...fresh })
        .onConflictDoUpdate({ target: agentSandbox.conversationId, set: fresh });
    }),
});

const appendStep = SqlSchema.void({
  Request: Schema.Struct({
    conversationId: Schema.String,
    step: Schema.Literals(STEPS),
    now: Schema.Date,
  }),
  execute: ({ conversationId, step, now }) =>
    Database.use((db) =>
      db
        .update(agentSandbox)
        .set({ steps: sql`${agentSandbox.steps} || ${JSON.stringify(stepAt(step, now))}::jsonb` })
        .where(
          and(
            eq(agentSandbox.conversationId, conversationId),
            eq(agentSandbox.state, SANDBOX_STATE.BOOTING),
          ),
        ),
    ),
});

const upsertRunning = SqlSchema.void({
  Request: Schema.Struct({
    conversationId: Schema.String,
    session: Schema.String,
    now: Schema.Date,
    runsUntil: Schema.Date,
  }),
  execute: ({ conversationId, session, now, runsUntil }) =>
    Database.use((db) =>
      db
        .insert(agentSandbox)
        .values({
          conversationId,
          session,
          state: SANDBOX_STATE.RUNNING,
          stateAt: now,
          runsUntil,
        })
        // Note that a boot's steps stay, so a reader can say how long the boot took.
        .onConflictDoUpdate({
          target: agentSandbox.conversationId,
          set: { session, state: SANDBOX_STATE.RUNNING, stateAt: now, runsUntil },
        }),
    ),
});

const moveRunsUntil = SqlSchema.void({
  Request: Schema.Struct({
    conversationId: Schema.String,
    runsUntil: Schema.Date,
    movedBefore: Schema.Date,
  }),
  execute: ({ conversationId, runsUntil, movedBefore }) =>
    Database.use((db) =>
      db
        .update(agentSandbox)
        .set({ runsUntil })
        .where(
          and(
            eq(agentSandbox.conversationId, conversationId),
            eq(agentSandbox.state, SANDBOX_STATE.RUNNING),
            lte(agentSandbox.runsUntil, movedBefore),
          ),
        ),
    ),
});

const markOff = SqlSchema.void({
  Request: Schema.Struct({ session: Schema.String, now: Schema.Date }),
  execute: ({ session, now }) =>
    Database.use((db) =>
      db
        .update(agentSandbox)
        .set({ state: SANDBOX_STATE.OFF, stateAt: now, runsUntil: null })
        .where(and(eq(agentSandbox.session, session), ne(agentSandbox.state, SANDBOX_STATE.OFF))),
    ),
});

/** The sandbox record of the conversation named; none before its first boot. */
export function readAgentSandbox(
  conversationId: string,
): SandboxEffect<AgentSandboxRow | undefined> {
  return Effect.map(findSandbox({ conversationId }), (rows) => rows[0]);
}

/** A boot of the conversation's sandbox, under the session named, begun now on its first step: created anew, or resumed; any earlier boot's steps go. */
export function recordSandboxBooting(
  conversationId: string,
  session: string,
  step: BootStart,
): SandboxEffect<void> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    upsertBooting({ conversationId, session, step, now }),
  );
}

/** A step of the conversation's sandbox's boot begun now; nothing where it is not booting, as for a relaunch in a sandbox already running. */
export function recordSandboxStep(conversationId: string, step: SandboxStep): SandboxEffect<void> {
  return Effect.flatMap(DateTime.nowAsDate, (now) => appendStep({ conversationId, step, now }));
}

/** The conversation's sandbox, under the session named, running from now until `idle` on unless touched again. */
export function recordSandboxRunning(
  conversationId: string,
  session: string,
  idle: Duration.Duration,
): SandboxEffect<void> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    upsertRunning({
      conversationId,
      session,
      now,
      runsUntil: new Date(now.getTime() + Duration.toMillis(idle)),
    }),
  );
}

/**
 * The conversation's running sandbox touched now: its stop moved to `idle`
 * from now, only where that moves it by `least` or more, so touches close
 * together write once; nothing where it is not recorded running.
 */
export function recordSandboxTouch(
  conversationId: string,
  idle: Duration.Duration,
  least: Duration.Duration,
): SandboxEffect<void> {
  return Effect.flatMap(DateTime.nowAsDate, (now) => {
    const runsUntil = now.getTime() + Duration.toMillis(idle);
    return moveRunsUntil({
      conversationId,
      runsUntil: new Date(runsUntil),
      movedBefore: new Date(runsUntil - Duration.toMillis(least)),
    });
  });
}

/** The sandbox of the session named off from now: discarded, or its open failed; nothing where a newer session's record stands, or it is off already. */
export function recordSandboxOff(session: string): SandboxEffect<void> {
  return Effect.flatMap(DateTime.nowAsDate, (now) => markOff({ session, now }));
}
