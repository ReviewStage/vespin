// stepped-back.tsx -- a region whose ask cards stand stepped back: what was asked once and is asked no longer, in the muted ink at full strength, as `@repo/ui`'s `SteppedBack` draws it.

import { createContext, type ReactNode, useContext } from "react";

/** Whether the cards drawn inside stand stepped back. */
const SteppedBackContext = createContext(false);

/**
 * Ask cards drawn stepped back, as what was asked and is no longer, such as
 * an ask the agent withdrew or asked again: their words in the muted ink.
 * Note that it fades nothing by opacity, which would leave a row looking
 * half pressable, and the cards inside are the caller's to hold read-only
 * with nothing picked, so none of an answer's tells is drawn there.
 */
export function SteppedBack({ children }: { readonly children: ReactNode }) {
  return <SteppedBackContext.Provider value={true}>{children}</SteppedBackContext.Provider>;
}

/** Whether the card reading it stands stepped back (`SteppedBack`). */
export function useSteppedBack(): boolean {
  return useContext(SteppedBackContext);
}
