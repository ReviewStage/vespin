// host-provider.tsx -- the host started as the app mounts, its document followed into the Query client every screen reads.

import type { AppBridge } from "@repo/host/bridge";
import type { ActPortClient } from "@repo/host/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Effect } from "effect";
import Constants from "expo-constants";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { crashReportsErrorReporting, reportHostFailure } from "../crash-reports.js";
import { HostFailedScreen, HostStartingScreen } from "../screens/host-failed.js";
import { followAppStateInto } from "./app-state-query.js";
import { deviceSeams, hostStateRoot } from "./device-seams.js";
import {
  launchFixtureProfile,
  launchRefusesWrites,
  launchStubsAuthServer,
  launchUpdateNeeded,
} from "./launch-arguments.js";
import {
  type HostFollow,
  type MobileHostStartOptions,
  type StandingMobileHost,
  startMobileHost,
} from "./mobile-runtime.js";
import { standStubAuthServer, stubAuthSession } from "./stub-auth-server.js";

/** The version a build that names none reports, which no shipped build is. */
const UNVERSIONED = "0.0.0";

/** The app's version, as the host and the share sheet name it to the service. */
export const APP_VERSION = Constants.expoConfig?.version ?? UNVERSIONED;

/** How a screen counts a moment of the panel's surface vocabulary, such as a surface opened, through the host's bridge. */
export type HostCount = AppBridge["recordSurfaceEvent"];

/** Where the host's start stands: not yet answered, standing with its document in a client, its act port, and its counts, or failed. */
type Standing =
  | {
      readonly client: QueryClient;
      readonly acts: ActPortClient;
      readonly follow: HostFollow;
      readonly count: HostCount;
    }
  | { readonly failed: true };

/** The act port the screens act through, once the host stands. */
const HostActs = createContext<ActPortClient | undefined>(undefined);

/** The follows a screen holds open on the host, once it stands. */
const HostFollows = createContext<HostFollow | undefined>(undefined);

/** The counts a screen sends through the host, once it stands. */
const HostCounts = createContext<HostCount | undefined>(undefined);

/** The host's act port, for a screen drawn under `HostProvider`. */
export function useHostActs(): ActPortClient {
  const acts = useContext(HostActs);

  if (acts === undefined) throw new Error("A screen acted outside the host's provider.");

  return acts;
}

/** How a screen drawn under `HostProvider` holds a follow open on the host, such as a transcript's, until it lets it go. */
export function useHostFollow(): HostFollow {
  const follow = useContext(HostFollows);

  if (follow === undefined) throw new Error("A screen followed outside the host's provider.");

  return follow;
}

/** How a screen drawn under `HostProvider` counts a moment through the host (`surface-open.ts`). */
export function useHostCount(): HostCount {
  const count = useContext(HostCounts);

  if (count === undefined) throw new Error("A screen counted outside the host's provider.");

  return count;
}

/**
 * What this launch starts the host on: the device, or, where a flow names
 * the stubbed account service, the device with its sign-in sheet and every
 * service call answered by the stub (`standStubAuthServer`) and its socket
 * never reached.
 */
function launchOptions(): MobileHostStartOptions {
  const device = deviceSeams();

  const base = {
    errorReporting: crashReportsErrorReporting,
    fixture: launchFixtureProfile(),
    fixtureUpdateNeeded: launchUpdateNeeded(),
    fixtureRefusesWrites: launchRefusesWrites(),
    appVersion: APP_VERSION,
    stateRoot: hostStateRoot(),
  };

  if (!launchStubsAuthServer()) return { ...base, device };
  standStubAuthServer();

  return {
    ...base,
    device: {
      ...device,
      authSession: stubAuthSession,
      openSocket: () => Effect.succeed({ unreachable: true }),
    },
  };
}

/**
 * Starts the host once, follows its document into a Query client of the
 * app's own, and draws the screens once the first reading is in it, so no
 * screen draws an empty document first. A host that cannot stand is said on
 * the console, reported to Sentry, and shown in the screens' place with Try again, which starts it
 * again, rather than drawing an empty Inbox over nothing; a host that stands
 * but refuses its first read is said on the console too, and the screens
 * draw over the empty client, which the next delivery fills. Until the host
 * stands, the brand's ground stands in the screens' place, since the splash
 * comes down as the root first draws and an empty tree let the window's own
 * black show between the two in dark mode. The host is drained as the tree
 * unmounts, which on a device is the app ending.
 */
export function HostProvider({ children }: { readonly children: ReactNode }) {
  const [standing, setStanding] = useState<Standing | undefined>(undefined);
  // Each press of Try again starts the host anew.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    let started: StandingMobileHost | undefined;
    let stopFollowing: (() => void) | undefined;
    setStanding(undefined);
    startMobileHost(launchOptions()).then(
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

        if (live) {
          setStanding({
            client,
            acts: host.acts,
            follow: host.follow,
            count: host.bridge.recordSurfaceEvent,
          });
        } else void host.close();
      },
      (cause: unknown) => {
        console.error("The app's host could not start.", cause);
        reportHostFailure(cause);

        if (live) setStanding({ failed: true });
      },
    );

    return () => {
      live = false;
      stopFollowing?.();
      void started?.close();
    };
  }, [attempt]);

  if (standing === undefined) return <HostStartingScreen />;

  if ("failed" in standing) {
    return <HostFailedScreen onRetry={() => setAttempt((count) => count + 1)} />;
  }

  return (
    <QueryClientProvider client={standing.client}>
      <HostActs.Provider value={standing.acts}>
        <HostFollows.Provider value={standing.follow}>
          <HostCounts.Provider value={standing.count}>{children}</HostCounts.Provider>
        </HostFollows.Provider>
      </HostActs.Provider>
    </QueryClientProvider>
  );
}
