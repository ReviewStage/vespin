// host-provider.tsx -- the host started as the app mounts, its document followed into the Query client every screen reads.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Constants from "expo-constants";
import { type ReactNode, useEffect, useState } from "react";
import { followAppStateInto } from "./app-state-query.js";
import { deviceSeams, hostStateRoot } from "./device-seams.js";
import { launchFixtureProfile } from "./launch-arguments.js";
import { type StandingMobileHost, startMobileHost } from "./mobile-runtime.js";

/** The version a build that names none reports, which no shipped build is. */
const UNVERSIONED = "0.0.0";

/**
 * Starts the host once, follows its document into a Query client of the
 * app's own, and draws the screens once the first reading is in it, so no
 * screen draws an empty document first. A host that cannot stand is said
 * on the console, and the screens draw over an empty client, so the shell
 * still shows rather than nothing. The host is drained as the tree
 * unmounts, which on a device is the app ending.
 */
export function HostProvider({ children }: { readonly children: ReactNode }) {
  // The Query client the screens are drawn over, once the document is in it.
  const [client, setClient] = useState<QueryClient | undefined>(undefined);
  useEffect(() => {
    let live = true;
    let started: StandingMobileHost | undefined;
    let stopFollowing: (() => void) | undefined;
    startMobileHost({
      fixture: launchFixtureProfile(),
      appVersion: Constants.expoConfig?.version ?? UNVERSIONED,
      stateRoot: hostStateRoot(),
      device: deviceSeams(),
    }).then(
      async (host) => {
        started = host;
        const client = new QueryClient();
        const following = followAppStateInto(host.bridge, client);
        stopFollowing = following.stop;
        await following.written;
        if (live) setClient(client);
        else void host.close();
      },
      (error: unknown) => {
        console.error("The app's host could not stand; its screens draw nothing of it.", error);
        if (live) setClient(new QueryClient());
      },
    );
    return () => {
      live = false;
      stopFollowing?.();
      void started?.close();
    };
  }, []);
  if (client === undefined) return null;
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
