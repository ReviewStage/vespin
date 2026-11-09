// host-provider.tsx -- the host started as the app mounts, its document followed into the Query client every screen reads.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Constants from "expo-constants";
import { type ReactNode, useEffect, useState } from "react";
import { HostFailedScreen } from "../screens/host-failed.js";
import { followAppStateInto } from "./app-state-query.js";
import { deviceSeams, hostStateRoot } from "./device-seams.js";
import { launchFixtureProfile } from "./launch-arguments.js";
import { type StandingMobileHost, startMobileHost } from "./mobile-runtime.js";

/** The version a build that names none reports, which no shipped build is. */
const UNVERSIONED = "0.0.0";

/** Where the host's start stands: not yet answered, standing with its document in a client, or failed. */
type Standing = { readonly client: QueryClient } | { readonly failed: true };

/**
 * Starts the host once, follows its document into a Query client of the
 * app's own, and draws the screens once the first reading is in it, so no
 * screen draws an empty document first. A host that cannot stand is said on
 * the console and shown in the screens' place with Retry, which starts it
 * again, rather than drawing an empty Inbox over nothing; a host that stands
 * but refuses its first read is said on the console too, and the screens
 * draw over the empty client, which the next delivery fills. The host is
 * drained as the tree unmounts, which on a device is the app ending.
 */
export function HostProvider({ children }: { readonly children: ReactNode }) {
  const [standing, setStanding] = useState<Standing | undefined>(undefined);
  // Each press of Retry starts the host anew.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    let started: StandingMobileHost | undefined;
    let stopFollowing: (() => void) | undefined;
    setStanding(undefined);
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
        try {
          await following.written;
        } catch (error) {
          console.error(
            "The host's document could not be read; the next delivery asks again.",
            error,
          );
        }
        if (live) setStanding({ client });
        else void host.close();
      },
      (error: unknown) => {
        console.error("The app's host could not start.", error);
        if (live) setStanding({ failed: true });
      },
    );
    return () => {
      live = false;
      stopFollowing?.();
      void started?.close();
    };
  }, [attempt]);
  if (standing === undefined) return null;
  if ("failed" in standing) {
    return <HostFailedScreen onRetry={() => setAttempt((count) => count + 1)} />;
  }
  return <QueryClientProvider client={standing.client}>{children}</QueryClientProvider>;
}
