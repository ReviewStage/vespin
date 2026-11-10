/**
 * follow-stream.ts -- one stream a client holds open on its act port, each word it carries handed to a listener until the client lets it go, and opened again when it breaks.
 *
 * A host procedure that follows something streams it (an `eventIterator`):
 * the client opens the stream, reads each word as it lands, and ends it when
 * the place that drew it goes. The host's follow never ends on its own, so a
 * stream that could not be opened, that threw, or that ended before the
 * client let it go is broken, and is opened again after a wait that doubles
 * from a second to thirty, started over once a stream has been heard on. The
 * host answers a stream opened again with where the thing stands, so what
 * changed while it was broken lands then, and the place keeps what it last
 * held meanwhile rather than throwing where it draws. The panel's live reads
 * hold theirs through it (`act-stream.ts`), and the iPhone's agent page its
 * transcript.
 */

import { cappedExponential } from "@repo/wire/effect";
import { Data, Duration, Effect, Schedule } from "effect";

/** How long a broken stream waits before it is opened again. */
const STREAM_REOPEN = {
  /** The first wait after a stream breaks unheard, doubling on each until one is heard on. */
  FIRST: Duration.seconds(1),
  /** The longest wait. */
  LONGEST: Duration.seconds(30),
} as const;

const REOPEN_BACKOFF = cappedExponential(STREAM_REOPEN.FIRST, STREAM_REOPEN.LONGEST);

/** A stream that broke before it was heard on: opened again after the backoff's next wait. */
class StreamUnheard extends Data.TaggedError("StreamUnheard") {}

/** A stream the window opened, as the act port hands it. */
export type OpenedStream<View> = AsyncIteratorObject<View, unknown, unknown>;

/** Lets an opened stream go, whatever its port answers. */
function letGo<View>(stream: OpenedStream<View>): Effect.Effect<void> {
  return Effect.sync(() => {
    stream.return?.(undefined).catch(() => undefined);
  });
}

/**
 * One stream opened and read until it breaks: it succeeds where a word was
 * heard on it first, and fails unheard otherwise. Note that the open is the
 * release's uninterruptible acquire, so a follow let go while its stream
 * opens waits for it and then lets it go, rather than leaving the host
 * following what nobody shows. Note too that the stream is let go in the
 * scope's finalizer without waiting on its port, because a pending read may
 * hold its `return` until the next word lands.
 */
function readOnce<View>(
  open: () => Promise<OpenedStream<View>>,
  take: (view: View) => void,
): Effect.Effect<void, StreamUnheard> {
  return Effect.scoped(
    Effect.gen(function* () {
      const stream = yield* Effect.acquireRelease(
        Effect.tryPromise({ try: open, catch: () => new StreamUnheard() }),
        letGo,
      );
      let heard = false;
      const next = Effect.tryPromise({
        try: () => stream.next(),
        catch: () => new StreamUnheard(),
      }).pipe(
        Effect.flatMap((word) => {
          if (word.done === true) return Effect.fail(new StreamUnheard());
          return Effect.sync(() => {
            heard = true;
            take(word.value);
          });
        }),
      );
      yield* Effect.forever(next).pipe(
        Effect.catch((unheard) => (heard ? Effect.void : Effect.fail(unheard))),
      );
    }),
  );
}

/**
 * A stream followed for as long as the effect runs: each word handed to
 * `take`, and the stream opened again whenever it breaks, on the backoff
 * above. It never ends; interrupting it lets the stream go.
 */
export function followStream<View>(
  open: () => Promise<OpenedStream<View>>,
  take: (view: View) => void,
): Effect.Effect<void> {
  return readOnce(open, take).pipe(
    Effect.retry({ schedule: REOPEN_BACKOFF }),
    Effect.repeat({ schedule: Schedule.spaced(STREAM_REOPEN.FIRST) }),
    Effect.ignore,
  );
}
