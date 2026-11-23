/**
 * viewed-marks.ts -- which of a pull request's files the member marked viewed, as every client reads and sets the marks: GitHub's marks as the last read gave them, each press drawn at once, a file's presses sent to GitHub one at a time, and what a refusal or a read that failed leaves to say.
 *
 * The marks are GitHub's own, the ones its Viewed box sets, read and written
 * on the member's own GitHub sign-in. A read lays GitHub's marks down
 * (`take`); a file marked viewed and changed since (GitHub's dismissed)
 * reads as not viewed, as GitHub unticks it. A press is drawn at once
 * (`toggle`). Each file's marks go to GitHub one at a time, so GitHub
 * settles them in the order pressed: presses made while one is out are
 * folded into the last of them, which is sent once the one out is answered,
 * taken or refused, wherever it still differs from what GitHub holds. Every
 * mark GitHub takes is its word on the file at once, so where GitHub would
 * not take the last press, the mark goes back to what GitHub holds and the
 * refusal stands to be said (`said`). A read never undoes a mark pressed and
 * not yet settled, nor one settled since the read before it landed; a read
 * that does not answer takes the marks away rather than leave ones it can no
 * longer vouch for, until one answers.
 *
 * The marks hold no framework of their own: a client draws them from
 * `snapshot`, told of each change through `subscribe`, as React's
 * `useSyncExternalStore` reads a store, and hands them the door a mark goes
 * to GitHub through.
 */

import {
  FILE_VIEWED_STATE,
  type FileViewedState,
  PULL_REQUEST_WRITE_OUTCOME,
  type PullRequestViewedAnswer,
} from "./pull-request-write-wire.js";

/** A read of the marks as a client hears it: GitHub's answer, or why there is none. */
export type ViewedRead = PullRequestViewedAnswer | { readonly failure: string };

/** What GitHub answered a mark with: taken, or a refusal of some kind, or why there is no answer. */
export type MarkAnswer = { readonly outcome: string } | { readonly failure: string };

/** The marks as a client draws them: GitHub's marks, none until a read answered or since one did not; the presses not yet settled; and the answer whose words stand to be said, if any. */
export interface ViewedMarkSnapshot<Said = ViewedRead | MarkAnswer> {
  readonly states: ReadonlyMap<string, FileViewedState> | undefined;
  readonly pressed: ReadonlyMap<string, boolean>;
  readonly said: Said | undefined;
}

/** A file's marks still to settle: the mark its last press asks for, how many presses there were, and the doors told once it settles. */
interface Pressing {
  readonly wanted: boolean;
  readonly presses: number;
  readonly told: ReadonlyArray<(stood: boolean) => void>;
}

/** Whether an answer is GitHub having done what was asked. */
function done(answer: ViewedRead | MarkAnswer): boolean {
  return "outcome" in answer && answer.outcome === PULL_REQUEST_WRITE_OUTCOME.DONE;
}

/** Whether a snapshot draws `path` viewed: its press not yet settled, else GitHub's mark. */
export function viewedIn(snapshot: ViewedMarkSnapshot<unknown>, path: string): boolean {
  return snapshot.pressed.get(path) ?? snapshot.states?.get(path) === FILE_VIEWED_STATE.VIEWED;
}

/** The member's marks on one pull request's files, read as `Read` answers and sent to GitHub through `send`, which answers what GitHub said as a `Mark` or rejects where nothing answered. */
export class ViewedMarkStore<
  Read extends ViewedRead = ViewedRead,
  Mark extends MarkAnswer = MarkAnswer,
> {
  readonly #send: (path: string, viewed: boolean) => Promise<Mark>;
  readonly #unanswered: Mark;
  readonly #listeners = new Set<() => void>();
  readonly #pressing = new Map<string, Pressing>();
  readonly #settledAt = new Map<string, number>();
  // How many of a file's presses there had been when its mark out now was sent.
  readonly #sentAt = new Map<string, number>();
  #settled = 0;
  // How far the marks had settled as the read before this one was taken.
  #takenAt = 0;
  #snapshot: ViewedMarkSnapshot<Read | Mark> = {
    states: undefined,
    pressed: new Map(),
    said: undefined,
  };

  constructor(
    send: (path: string, viewed: boolean) => Promise<Mark>,
    /** What a mark nothing answered is taken as. */
    unanswered: Mark,
  ) {
    this.#send = send;
    this.#unanswered = unanswered;
  }

  /** The marks as they stand, the same object until they change. */
  readonly snapshot = (): ViewedMarkSnapshot<Read | Mark> => this.#snapshot;

  /** Tells `listener` of every change to the marks; answers the door that stops telling it. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);

    return () => this.#listeners.delete(listener);
  };

  /** Lays a read of GitHub's marks down, keeping each file pressed and not settled, or settled since the read before, as it stands; a read that did not answer takes the marks away. */
  readonly take = (read: Read): void => {
    const asked = this.#takenAt;
    this.#takenAt = this.#settled;
    const said = done(read) ? undefined : read;

    if (!("files" in read)) {
      this.#change({ states: undefined, said });

      return;
    }

    const next = new Map(read.files.map((file) => [file.path, file.state]));

    // A file pressed and not settled, or settled since the read before this one, keeps the mark it has now.
    const since = (path: string) =>
      (this.#settledAt.get(path) ?? 0) > asked || this.#pressing.has(path);

    for (const [path, state] of this.#snapshot.states ?? []) if (since(path)) next.set(path, state);
    this.#change({ states: next, said });
  };

  /** Turns the file's mark over, drawn at once; answers, once its presses settle, whether GitHub took the mark this press asked for. */
  readonly toggle = (path: string): Promise<boolean> => {
    const settles = Promise.withResolvers<boolean>();
    const wanted = !viewedIn(this.#snapshot, path);
    const out = this.#pressing.get(path);

    this.#pressing.set(path, {
      wanted,
      presses: (out?.presses ?? 0) + 1,
      told: [...(out?.told ?? []), settles.resolve],
    });
    this.#change({ pressed: new Map(this.#snapshot.pressed).set(path, wanted), said: undefined });

    if (out === undefined) {
      this.#sendMark(path, wanted, this.#snapshot.states?.get(path) === FILE_VIEWED_STATE.VIEWED);
    }

    return settles.promise;
  };

  /** Lets go of what stands to be said. */
  readonly dismiss = (): void => this.#change({ said: undefined });

  #change(next: Partial<ViewedMarkSnapshot<Read | Mark>>): void {
    this.#snapshot = { ...this.#snapshot, ...next };

    for (const listener of this.#listeners) listener();
  }

  /** Sends one mark for the file, GitHub's last word on it being `confirmed`, and once GitHub answers, sends the last press where it still differs from GitHub's word, else settles the file. */
  #sendMark(path: string, wanted: boolean, confirmed: boolean): void {
    this.#sentAt.set(path, this.#pressing.get(path)?.presses ?? 0);

    void this.#send(path, wanted)
      .catch((): Mark => this.#unanswered)
      .then((answer) => this.#answered(path, wanted, confirmed, answer));
  }

  #answered(path: string, wanted: boolean, confirmed: boolean, answer: Mark): void {
    const now = this.#pressing.get(path);

    if (now === undefined) return;
    const sent = this.#sentAt.get(path) ?? 0;
    const took = done(answer);
    // Every mark GitHub took is GitHub's word at once, so a later refusal shows what GitHub holds.
    const word = took ? wanted : confirmed;

    if (took && this.#snapshot.states !== undefined) {
      const state = wanted ? FILE_VIEWED_STATE.VIEWED : FILE_VIEWED_STATE.UNVIEWED;
      this.#change({ states: new Map(this.#snapshot.states).set(path, state) });
    }

    // A press made since this one was sent is sent, where GitHub does not yet hold what it asks, whatever became of this one.
    if (now.wanted !== word && (now.presses > sent || now.wanted !== wanted)) {
      this.#sendMark(path, now.wanted, word);

      return;
    }

    this.#pressing.delete(path);
    this.#settled += 1;
    this.#settledAt.set(path, this.#settled);
    const stood = now.wanted === word;
    const pressed = new Map(this.#snapshot.pressed);
    pressed.delete(path);
    this.#change(stood ? { pressed } : { pressed, said: answer });

    for (const tell of now.told) tell(stood);
  }
}
