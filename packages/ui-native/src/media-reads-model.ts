// media-reads-model.ts -- the pictures and recordings a page shows, each read once into what it is drawn from, a failed read tried again on its own a few times, then let go until it is asked for again.

/** How many times one read is tried, the first among them, before it is let go until it is asked for again. */
const MEDIA_READ_TRIES = 4;

/** How long a failed read waits before it is tried again, in milliseconds. */
const MEDIA_READ_PAUSE_MS = 2_000;

/** What a page's media reads through, and where each answer goes. */
export interface MediaReadSeams {
  /** Reads one picture or recording, by its id, into what it is drawn from. */
  readonly read: (id: string) => Promise<string>;
  /** Hands on one read. */
  readonly landed: (id: string, source: string) => void;
  /** Says one read that failed, and whether it is tried again on its own. */
  readonly failed: (id: string, cause: unknown, again: boolean) => void;
  /** Waits out a pause, in milliseconds. */
  readonly pause: (ms: number) => Promise<void>;
}

/** One page's media reads. */
export interface MediaReads {
  /** Asks for each id not asked for yet, or let go after its tries failed. */
  readonly ask: (ids: readonly string[]) => void;
  /** Lets every read go, so none that answers after lands and none is tried again. */
  readonly stop: () => void;
}

/**
 * One page's media reads through `seams`. Each id is read once however
 * often it is asked for while its read stands. Note that a read that fails
 * is tried again on its own after a pause, up to `MEDIA_READ_TRIES` in all,
 * because a page whose transcript never moves, such as the fixture's, would
 * otherwise never ask again; and that one whose every try failed is let go,
 * so the page's next ask reads it afresh.
 */
export function mediaReads(seams: MediaReadSeams): MediaReads {
  const asked = new Set<string>();
  let stopped = false;

  const tryRead = (id: string, tried: number) => {
    // Note that the read is begun on a later turn, so one that throws as it is called fails as one that rejects does.
    Promise.resolve()
      .then(() => seams.read(id))
      .then(
        (source) => {
          if (!stopped) seams.landed(id, source);
        },
        async (cause: unknown) => {
          if (stopped) return;
          const again = tried < MEDIA_READ_TRIES;
          seams.failed(id, cause, again);

          if (!again) {
            asked.delete(id);

            return;
          }

          await seams.pause(MEDIA_READ_PAUSE_MS);

          if (!stopped) tryRead(id, tried + 1);
        },
      );
  };

  return {
    ask: (ids) => {
      if (stopped) return;

      for (const id of ids) {
        if (asked.has(id)) continue;
        asked.add(id);
        tryRead(id, 1);
      }
    },
    stop: () => {
      stopped = true;
    },
  };
}
