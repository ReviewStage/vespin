/**
 * tab-switcher-model.ts -- how a press of ⌃Tab, a hold, and a let-go move through the screens the window stood on last.
 *
 * The screens are Back's own steps, most recent first (`places/window-history.ts`'s
 * `recent`), so ⌃Tab and a let-go is the screen before this one wherever it
 * was, as ⌘Tab is the app before this one, and what is one screen, which
 * screens can still be gone to, and how one is stood again are Back's rules
 * alone. This module holds only the switcher's keys over them.
 *
 * The switcher (`tab-switcher.tsx`) shows the first few as cards. A press of
 * ⌃Tab chooses the card after the one the window stands on, and ⌃⇧Tab the
 * last, the choice wrapping around; another press while ⌃ is held moves it
 * one card on, or one back. Letting go of ⌃ goes to the card chosen, so a
 * quick tap flips between two screens and shows nothing. Held a beat, the
 * cards show. Escape lets go of nothing.
 */

/** How many cards the switcher shows, the screen the window stands on among them, as ⌘Tab counts the app in front. */
const SWITCHER_CARDS = 5;

/** Where the switcher stands: let go, or held with its cards, the one chosen, and whether they show. */
export type SwitcherState<Card> =
  | { readonly held: false }
  | {
      readonly held: true;
      readonly cards: readonly Card[];
      /** Whether the first card is the screen the window stands on, which a let-go there leaves as it is. */
      readonly here: boolean;
      readonly chosen: number;
      readonly shown: boolean;
    };

export const SWITCHER_LET_GO = { held: false } as const satisfies SwitcherState<never>;

/** Which way a press steps: on to the next card, or back. */
export const SWITCH_STEP = {
  ON: 1,
  BACK: -1,
} as const;

export type SwitchStep = (typeof SWITCH_STEP)[keyof typeof SWITCH_STEP];

function wrapped(at: number, count: number): number {
  return ((at % count) + count) % count;
}

/**
 * The switcher after a press of ⌃Tab (`ON`) or ⌃⇧Tab (`BACK`). The first
 * press holds it on the screens as they stand, most recent first, choosing
 * the card after the one the window stands on (`here`, the first), or the
 * last; a press while held steps the choice and shows the cards. With
 * nothing to switch to it stays let go.
 */
export function switcherPressed<Card>(
  state: SwitcherState<Card>,
  input: {
    readonly screens: readonly Card[];
    readonly here: boolean;
    readonly step: SwitchStep;
  },
): SwitcherState<Card> {
  if (state.held) {
    return {
      ...state,
      chosen: wrapped(state.chosen + input.step, state.cards.length),
      shown: true,
    };
  }

  const cards = input.screens.slice(0, SWITCHER_CARDS);
  const here = input.here && cards.length > 0;

  if (cards.length < (here ? 2 : 1)) return state;
  const after = here ? 1 : 0;
  const chosen = input.step === SWITCH_STEP.ON ? after : cards.length - 1;

  return { held: true, cards, here, chosen, shown: false };
}

/** The switcher once ⌃ was held long enough to show its cards. */
export function switcherShown<Card>(state: SwitcherState<Card>): SwitcherState<Card> {
  return state.held ? { ...state, shown: true } : state;
}

/** The switcher with the card at `at` chosen, as the pointer resting on it chooses it. */
export function switcherChose<Card>(state: SwitcherState<Card>, at: number): SwitcherState<Card> {
  if (!state.held || at < 0 || at >= state.cards.length) return state;

  return { ...state, chosen: at };
}

/** The card a let-go goes to: the one chosen, or none where it is the screen the window stands on. */
export function switcherTarget<Card>(state: SwitcherState<Card>): Card | undefined {
  if (!state.held || (state.here && state.chosen === 0)) return undefined;

  return state.cards[state.chosen];
}
