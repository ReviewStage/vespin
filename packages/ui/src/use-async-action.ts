/**
 * use-async-action.ts -- one press that waits on what it started: idle, running until that settles, or refused with why, its second press while running taken as none.
 */

import { useCallback, useMemo, useRef, useState } from "react";

/** Where one action stands. */
export const ASYNC_ACTION_STAGE = {
  /** Nothing out, and nothing refused. */
  IDLE: "idle",
  /** Pressed, and waiting on what the press started. */
  RUNNING: "running",
  /** The last press was refused; why stands until the next press or a clear. */
  REFUSED: "refused",
} as const;

export type AsyncActionStage = (typeof ASYNC_ACTION_STAGE)[keyof typeof ASYNC_ACTION_STAGE];

/** One action's stage, with why it was refused where it was. */
export type AsyncActionState<Refusal> =
  | { readonly stage: typeof ASYNC_ACTION_STAGE.IDLE }
  | { readonly stage: typeof ASYNC_ACTION_STAGE.RUNNING }
  | { readonly stage: typeof ASYNC_ACTION_STAGE.REFUSED; readonly refusal: Refusal };

/**
 * What a press starts: nothing to wait on, or a promise answering why it was
 * refused, or nothing once it went.
 */
export type AsyncActionAct<Refusal> = () => PromiseLike<Refusal | undefined | void> | void;

/** One action as its surface holds it. */
export interface AsyncAction<Refusal> {
  readonly state: AsyncActionState<Refusal>;
  /** True from the press until what it started settles. */
  readonly running: boolean;
  /** Why the last press was refused, until the next press or a clear. */
  readonly refusal: Refusal | undefined;
  /**
   * Starts `act` unless one is already out, and answers whether it ran and
   * was not refused. A press while one is out runs nothing and answers false.
   */
  readonly run: (act: AsyncActionAct<Refusal>) => Promise<boolean>;
  /** Says a refusal found before anything was sent, such as the input checked. */
  readonly refuse: (refusal: Refusal) => void;
  /** Lets a refusal go, as an edit after it does. */
  readonly clear: () => void;
}

const IDLE = { stage: ASYNC_ACTION_STAGE.IDLE } as const;
const RUNNING = { stage: ASYNC_ACTION_STAGE.RUNNING } as const;

/** The words a rejection says: an `Error`'s message, else the value itself. */
export function rejectionWords(rejected: unknown): string {
  return rejected instanceof Error ? rejected.message : String(rejected);
}

/**
 * One press that waits on what it started, its stage one value rather than a
 * busy flag beside a refusal. Note that what is out is held in a ref as well
 * as drawn, because two presses in one frame both read the state the last
 * draw left, and only the ref is written before the second lands. A press
 * lets the last refusal go, and an act that rejects rather than answering is
 * refused with what `unanswered` makes of the rejection, so a caller never
 * sees one left running.
 */
export function useAsyncAction<Refusal = string>(
  unanswered: (rejected: unknown) => Refusal,
): AsyncAction<Refusal> {
  const [state, setState] = useState<AsyncActionState<Refusal>>(IDLE);
  const out = useRef(false);
  const newestUnanswered = useRef(unanswered);
  newestUnanswered.current = unanswered;

  const run = useCallback((act: AsyncActionAct<Refusal>): Promise<boolean> => {
    if (out.current) return Promise.resolve(false);
    const started = act();
    if (started === undefined) {
      setState(IDLE);
      return Promise.resolve(true);
    }
    out.current = true;
    setState(RUNNING);
    const settle = (refusal: Refusal | undefined): boolean => {
      out.current = false;
      setState(refusal === undefined ? IDLE : { stage: ASYNC_ACTION_STAGE.REFUSED, refusal });
      return refusal === undefined;
    };
    return Promise.resolve(started).then(
      (refusal) => settle(refusal ?? undefined),
      (rejected: unknown) => settle(newestUnanswered.current(rejected)),
    );
  }, []);
  const refuse = useCallback((refusal: Refusal) => {
    if (out.current) return;
    setState({ stage: ASYNC_ACTION_STAGE.REFUSED, refusal });
  }, []);
  const clear = useCallback(() => {
    if (out.current) return;
    setState(IDLE);
  }, []);

  return useMemo(
    () => ({
      state,
      running: state.stage === ASYNC_ACTION_STAGE.RUNNING,
      refusal: state.stage === ASYNC_ACTION_STAGE.REFUSED ? state.refusal : undefined,
      run,
      refuse,
      clear,
    }),
    [state, run, refuse, clear],
  );
}
