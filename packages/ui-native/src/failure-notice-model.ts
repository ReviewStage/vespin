/**
 * failure-notice-model.ts -- which notice stands: a write refused, in its own words and with a Try again where one is offered, a write that went with its Undo, or the one notice that says the phone is offline, said once however many writes fail under it.
 *
 * The app has one notice at a time, as iOS's own banners stand: the newest
 * refusal replaces the one before it, since the person pressed last for it.
 * The offline notice is said once for the whole time the phone is offline,
 * so the writes that fail while it is offline buzz rather than each say it,
 * until the phone is online and a later stretch offline is said anew.
 * Nothing here draws or times anything; the banner (`failure-notice.tsx`)
 * holds the state this answers and lets each notice go.
 */

/** What a notice says: a write that did not go, that the phone is offline, or a write that went and can be undone, as the panel's Undo toast says it. */
export const NOTICE_KIND = {
  REFUSED: "refused",
  OFFLINE: "offline",
  DONE: "done",
} as const;

export type NoticeKind = (typeof NOTICE_KIND)[keyof typeof NOTICE_KIND];

/** A notice as a write asks for it. */
export interface NoticeAsk {
  readonly kind: NoticeKind;
  /** The refusal's own words, the offline hint, or what the write that went did. */
  readonly words: string;
  /** Sends the write again; no Try again is drawn where none is given. */
  readonly retry?: (() => void) | undefined;
  /** Takes back the write that went; no Undo is drawn where none is given, and Try again stands in its place where both are. */
  readonly undo?: (() => void) | undefined;
}

/** A notice as it stands, counted so a new one is told from the one it replaces, even in the same words. */
export interface ShownNotice extends NoticeAsk {
  readonly serial: number;
}

/** The app's notice: the one standing, how many have been shown, and whether the phone has said it is offline since it was last online. */
export interface NoticeState {
  readonly shown: ShownNotice | undefined;
  readonly serial: number;
  readonly offlineSaid: boolean;
}

/** Nothing shown yet, and the phone taken as online. */
export const NO_NOTICE: NoticeState = { shown: undefined, serial: 0, offlineSaid: false };

/**
 * The notice once `asked` is asked: a refusal stands in place of whatever
 * stood, as the newest, even in the same words; the offline notice stands
 * only where it has not been said since the phone was last online, so
 * however many writes fail while it is offline, it is said once.
 */
export function noticeAsked(state: NoticeState, asked: NoticeAsk): NoticeState {
  if (asked.kind === NOTICE_KIND.OFFLINE && state.offlineSaid) return state;
  const serial = state.serial + 1;

  return {
    shown: { ...asked, serial },
    serial,
    offlineSaid: state.offlineSaid || asked.kind === NOTICE_KIND.OFFLINE,
  };
}

/** The notice once the phone is online again: the offline notice let go, and the next offline stretch said anew. */
export function noticeOnline(state: NoticeState): NoticeState {
  if (!state.offlineSaid) return state;
  const shown = state.shown?.kind === NOTICE_KIND.OFFLINE ? undefined : state.shown;

  return { ...state, shown, offlineSaid: false };
}

/** The notice once the one numbered `serial` has gone, which lets nothing go where a newer one stands. */
export function noticeGone(state: NoticeState, serial: number): NoticeState {
  return state.shown?.serial === serial ? { ...state, shown: undefined } : state;
}
