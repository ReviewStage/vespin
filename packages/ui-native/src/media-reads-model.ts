// media-reads-model.ts -- the pictures and recordings a page shows, each read once into what it is drawn from, a read that failed or hung past its deadline tried again on its own a few times, then let go until it is asked for again.

/** How many times one read is tried, the first among them, before it is let go until it is asked for again. */
export const MEDIA_READ_TRIES = 4;

/** How long a failed read waits before it is tried again, in milliseconds. */
export const MEDIA_READ_PAUSE_MS = 2_000;

/** How long one try may go unanswered before it counts as failed, in milliseconds. */
export const MEDIA_READ_DEADLINE_MS = 10_000;

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

/** Why a try that never answered counts as failed. */
class MediaReadDeadline extends Error {
  constructor() {
    super(`The read did not answer within ${MEDIA_READ_DEADLINE_MS} ms.`);
    this.name = "MediaReadDeadline";
  }
}

/**
 * One page's media reads through `seams`. Each id is read once however
 * often it is asked for while its read stands. Note that a try that fails,
 * or goes unanswered past `MEDIA_READ_DEADLINE_MS`, is tried again on its
 * own after a pause, up to `MEDIA_READ_TRIES` in all, because a page whose
 * transcript never moves, such as the fixture's, would otherwise never ask
 * again, and a native write that hangs would never fail; that a try that
 * answers after its deadline still lands, since the first answer of any try
 * is as good as another's; and that one whose every try failed is let go,
 * so the page's next ask reads it afresh.
 */
export function mediaReads(seams: MediaReadSeams): MediaReads {
  const asked = new Set<string>();
  const shown = new Set<string>();
  let stopped = false;

  const land = (id: string, source: string) => {
    if (stopped || shown.has(id)) return;
    shown.add(id);
    seams.landed(id, source);
  };

  const tryRead = (id: string, tried: number) => {
    let settled = false;

    const fail = async (cause: unknown) => {
      if (settled || stopped || shown.has(id)) return;
      settled = true;
      const again = tried < MEDIA_READ_TRIES;
      seams.failed(id, cause, again);

      if (!again) {
        asked.delete(id);

        return;
      }

      await seams.pause(MEDIA_READ_PAUSE_MS);

      if (!stopped && !shown.has(id)) tryRead(id, tried + 1);
    };

    // Note that the read is begun on a later turn, so one that throws as it is called fails as one that rejects does.
    Promise.resolve()
      .then(() => seams.read(id))
      .then((source) => {
        settled = true;
        land(id, source);
      }, fail);

    void seams.pause(MEDIA_READ_DEADLINE_MS).then(() => fail(new MediaReadDeadline()));
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
