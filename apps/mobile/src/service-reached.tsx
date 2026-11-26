// service-reached.tsx -- hands every screen whether the phone reaches the service, so a read that failed offline says nothing of its own beside the one offline notice.

import { selectLiveMark } from "@repo/host/app-state-reads";
import { ServiceReached } from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { appStateQuery } from "./host/app-state-query.js";
import { OFFLINE_MARKS } from "./use-write.js";

/**
 * Hands every screen under it whether the phone reaches the service
 * (`@repo/ui-native`'s `ServiceReached`), from the same live mark the
 * offline notice reads (`useOfflineNotice`), so while it does not, a place
 * whose read failed keeps what it holds and says nothing of its own, and
 * one with nothing kept says only that it is there once back online.
 */
export function ServiceReachedByPhone({ children }: { readonly children: ReactNode }) {
  const { data: mark } = useQuery({ ...appStateQuery, select: selectLiveMark });

  return <ServiceReached value={!OFFLINE_MARKS.has(mark)}>{children}</ServiceReached>;
}
