/**
 * phone-step.ts -- a page a tab pushes over itself on a phone, which the phone's header heads in the tab's place.
 *
 * A phone stacks a page's parts as pages of their own where a wider room
 * stands them side by side or behind tabs, as the Pull request tab stands
 * its Checks and Files changed behind rows that push them. The header over
 * the tab is drawn by the page holding the panel (`desktop-tasks.tsx`'s
 * `TaskHead`, `side-panel.tsx`'s `PanelPhoneHead`), so a tab hands it the
 * page it pushed (`useHandedPhoneStep`): the header then names that page
 * and its way back returns to the tab, one screen back, as a phone's Back
 * does. The tab hands none while it shows its own page, and the header
 * heads the tab as it did.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

/** A page a tab pushed over itself: what it is called, and its way back to the tab, named for the tab. */
export interface PhoneStep {
  readonly title: string;
  readonly back: string;
  readonly onBack: () => void;
}

/** Where a tab hands the page it pushed, as the page holding the phone's header holds it; none where no phone's header heads the tab. */
export const PhoneStepContext = createContext<((step: PhoneStep | undefined) => void) | undefined>(
  undefined,
);

/** The page pushed over the tab under the header, and the door the tab hands it through (`PhoneStepContext`). */
interface PhoneStepHeld {
  readonly step: PhoneStep | undefined;
  readonly hand: (step: PhoneStep | undefined) => void;
}

/** Holds the page a tab under the header pushed over itself (`PhoneStepHeld`). */
export function usePhoneStepHeld(): PhoneStepHeld {
  const [step, setStep] = useState<PhoneStep | undefined>(undefined);
  const hand = useCallback((next: PhoneStep | undefined) => setStep(next), []);

  return { step, hand };
}

/**
 * Hands the header `step` while it stands, and none once it is gone or the
 * tab is. Note that the way back is read through a ref, so a tab drawn anew
 * hands nothing anew while its page's words stand.
 */
export function useHandedPhoneStep(step: PhoneStep | undefined): void {
  const hand = useContext(PhoneStepContext);
  const onBack = useRef(step?.onBack);
  onBack.current = step?.onBack;
  const title = step?.title;
  const back = step?.back;

  useEffect(() => {
    if (hand === undefined || title === undefined || back === undefined) return undefined;
    hand({ title, back, onBack: () => onBack.current?.() });

    return () => hand(undefined);
  }, [hand, title, back]);
}
