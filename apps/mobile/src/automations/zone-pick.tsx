// zone-pick.tsx -- the door between the automation editor and the time zone page pushed over it in its sheet: the editor listens through the door, and the page picks through it.

import { createContext, type ReactNode, useContext, useEffect, useState } from "react";

/** What the sheet's pages share: the listener of the editor standing under the page, and the pick that reaches it. */
interface ZonePickDoor {
  readonly listen: (onPick: ((zone: string) => void) | undefined) => void;
  readonly pick: (zone: string) => void;
}

const ZonePickContext = createContext<ZonePickDoor | undefined>(undefined);

/** A door with no listener yet. */
function zonePickDoor(): ZonePickDoor {
  let listener: ((zone: string) => void) | undefined;

  return {
    listen: (onPick) => {
      listener = onPick;
    },
    pick: (zone) => listener?.(zone),
  };
}

/** Holds the door for the sheet's pages, around its stack, made once so nothing under it draws again. */
export function ZonePickProvider({ children }: { readonly children: ReactNode }) {
  const [door] = useState(zonePickDoor);

  return <ZonePickContext value={door}>{children}</ZonePickContext>;
}

/** Listens for a zone picked on the page pushed over the caller, while the caller stands. */
export function useZonePicked(onPick: (zone: string) => void): void {
  const door = useContext(ZonePickContext);

  useEffect(() => {
    door?.listen(onPick);

    return () => door?.listen(undefined);
  }, [door, onPick]);
}

/** Picks a zone for the editor under the caller; nothing where no editor listens. */
export function useZonePick(): (zone: string) => void {
  const door = useContext(ZonePickContext);

  return (zone) => door?.pick(zone);
}
