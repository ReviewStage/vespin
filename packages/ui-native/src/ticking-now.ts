// ticking-now.ts -- the clock, read again each second while something on screen counts by it, such as a countdown or how long a worker has worked.

import { useEffect, useState } from "react";

/** How often a count drawn from the clock is drawn again: each second, as the panel's counts tick. */
const TICK_MS = 1000;

/** The clock, read again each second while `ticking`, so a count drawn from it moves; still otherwise. */
export function useTickingNow(ticking: boolean): number {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (!ticking) return;
    const tick = setInterval(() => setNow(Date.now()), TICK_MS);

    return () => clearInterval(tick);
  }, [ticking]);

  return now;
}
