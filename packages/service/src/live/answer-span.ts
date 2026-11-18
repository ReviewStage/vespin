/**
 * answer-span.ts -- what a live read's answer carried, said on the span the read is answered under: how many rows, their bytes, and whether they were the read's whole, never a row, an id, or a txid.
 *
 * Every live read runs under its procedure's span (`live.<name>`), but a
 * whole read and a held poll answered with nothing moved stand alike there
 * by name and length alone, so a slow first read can't be told from a poll
 * that waited. These attributes tell them apart. They're said only on a span
 * Sentry samples (`observability/sentry.ts`'s `tracesSampler`), since
 * measuring an answer's bytes writes its rows out as text.
 */

import type { SealedLiveQueryWire } from "@repo/features/live-wire";
import { Effect } from "effect";

/** The attributes an answer's span carries. */
export const LIVE_ANSWER_ATTRIBUTE = {
  ROWS: "live.answer.rows",
  BYTES: "live.answer.bytes",
  WHOLE: "live.answer.whole",
} as const;

/**
 * The span the answer is read under, annotated with the rows its parts
 * carry, their bytes as JSON text, and whether any part answered its rows
 * whole rather than past a sync id; a held poll that ended unmoved carries
 * no rows, and says so. Nothing where no span stands or Sentry drops it.
 */
export const answerSpanAnnotated = (
  queries: Readonly<Record<string, SealedLiveQueryWire>>,
): Effect.Effect<void> =>
  Effect.currentSpan.pipe(
    Effect.flatMap((span) =>
      Effect.sync(() => {
        if (!span.sampled) return;
        const carried = Object.values(queries).filter(({ rows }) => rows !== undefined);

        span.attribute(
          LIVE_ANSWER_ATTRIBUTE.ROWS,
          carried.reduce((total, { rows }) => total + (rows?.length ?? 0), 0),
        );

        if (carried.length === 0) return;
        span.attribute(
          LIVE_ANSWER_ATTRIBUTE.BYTES,
          carried.reduce((total, { rows }) => total + Buffer.byteLength(JSON.stringify(rows)), 0),
        );
        span.attribute(
          LIVE_ANSWER_ATTRIBUTE.WHOLE,
          carried.some(({ sync }) => sync?.past === undefined),
        );
      }),
    ),
    Effect.ignore,
  );
