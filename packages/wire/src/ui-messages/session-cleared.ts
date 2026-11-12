/** session-cleared.ts -- the durable mark left where a native agent's harness was started on a fresh session in the same agent (`/clear`), the messages above it no longer its session's. */
import { Schema } from "effect";

export const SESSION_CLEARED_PART = "data-session-cleared";

export const SessionClearedMarkSchema = Schema.Struct({
  /** When the session was let go, in epoch milliseconds. */
  at: Schema.Number,
});

export type SessionClearedMark = typeof SessionClearedMarkSchema.Type;
