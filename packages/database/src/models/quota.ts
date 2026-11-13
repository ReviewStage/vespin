import { sql } from "drizzle-orm";
import { type Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { hostedUsage } from "../schemas/usage.js";

/** The UTC day a moment falls on, as the usage table's YYYY-MM-DD key. */
export function utcDayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * The day's count as the conflicting row already has it, counted up. This is
 * the one conflicting update that cannot set what the insert carried: the new
 * value is a function of the standing row rather than of the values offered,
 * so the column is named through the builder's own reference to it and the
 * increment is a fragment inside the one rendered statement.
 */
const ONE_MORE_CALL = sql`${hostedUsage.calls} + 1`;

const DictationUsageWriteSchema = Schema.Struct({
  userId: Schema.String,
  day: Schema.String,
  seconds: Schema.Number,
});

/**
 * One dictated clip on the account's day: one more call, and its seconds
 * added to the day's dictated seconds. Both are functions of the standing
 * row, so the conflicting update names each column through the builder's
 * own reference, as `ONE_MORE_CALL` does.
 */
const spendDictationUsage = SqlSchema.void({
  Request: DictationUsageWriteSchema,
  execute: (write) =>
    Database.use((db) =>
      db
        .insert(hostedUsage)
        .values({ userId: write.userId, day: write.day, calls: 1, dictationSeconds: write.seconds })
        .onConflictDoUpdate({
          target: [hostedUsage.userId, hostedUsage.day],
          set: {
            calls: ONE_MORE_CALL,
            dictationSeconds: sql`${hostedUsage.dictationSeconds} + ${write.seconds}`,
          },
        }),
    ),
});

/**
 * Counts one transcribed clip against the account's UTC day: a call, as
 * every hosted operation is, and its seconds of audio beside it. It is taken
 * once the transcription answered, since the seconds are what the model
 * billed, and nothing is refused on it, as nothing is on the calls.
 */
export function spendDictationMeter(input: {
  readonly userId: string;
  readonly seconds: number;
  readonly now: number;
}): Effect.Effect<void, StoreFailure, DatabaseServices> {
  return spendDictationUsage({
    userId: input.userId,
    day: utcDayKey(input.now),
    seconds: input.seconds,
  });
}

const VoiceUsageWriteSchema = Schema.Struct({
  userId: Schema.String,
  day: Schema.String,
  seconds: Schema.Number,
});

/** One finished voice call on the account's day: one more call, and its seconds added to the day's voice seconds, each counted up as `spendDictationUsage` counts its own. */
const spendVoiceUsage = SqlSchema.void({
  Request: VoiceUsageWriteSchema,
  execute: (write) =>
    Database.use((db) =>
      db
        .insert(hostedUsage)
        .values({ userId: write.userId, day: write.day, calls: 1, voiceSeconds: write.seconds })
        .onConflictDoUpdate({
          target: [hostedUsage.userId, hostedUsage.day],
          set: {
            calls: ONE_MORE_CALL,
            voiceSeconds: sql`${hostedUsage.voiceSeconds} + ${write.seconds}`,
          },
        }),
    ),
});

/**
 * Counts one finished voice call against the account's UTC day: a call, and
 * its seconds beside it, as the caller's panel timed them, since the call ran
 * between the panel and OpenAI and never through the service. Nothing is
 * refused on it, as nothing is on dictation's.
 */
export function spendVoiceMeter(input: {
  readonly userId: string;
  readonly seconds: number;
  readonly now: number;
}): Effect.Effect<void, StoreFailure, DatabaseServices> {
  return spendVoiceUsage({
    userId: input.userId,
    day: utcDayKey(input.now),
    seconds: input.seconds,
  });
}
