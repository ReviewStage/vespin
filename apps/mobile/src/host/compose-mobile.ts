/**
 * compose-mobile.ts -- the shared host composed inside the Expo app: its seams answered by the device, its account the `ios` OAuth client's, and reached by the screens through the in-process bridge.
 *
 * The host is the desktop's own (`@repo/host`), assembled as the web's is
 * (`apps/web/src/app/web-host.ts`) with one platform concern, an agent's
 * terminals, whose socket the live reads ride: each is opened from the app
 * over React Native's `WebSocket` under the account's bearer
 * (`relay-socket.ts`). What the desktop's seams read from the machine the
 * device answers instead (`device-seams.ts`): the settings file under the
 * app's Documents, ids from `expo-crypto`, the service at its production
 * origin unless a Preview's is built in, and the account from the desktop's
 * OAuth source signed in as the `ios` client, its consent the system's
 * authentication session and its tokens kept in the Keychain.
 *
 * The screens' acts reach the host's own procedures on the act port in this
 * process, over a channel of two ends (`@repo/host/act-port`'s `inProcessChannel`); of the
 * platform kinds the app answers a note's send to the feedback endpoint,
 * and an agent's shells listed and its sandbox resumed, which its run
 * actions ask (`shellReadProcedures`), and every other, a copy, a download,
 * the Mac's own terminal, is refused in its own words, so the table stays
 * total. The composition is a `Layer`,
 * built by the app's one runtime edge (`mobile-runtime.ts`), whose close is
 * the host's drain; `fork` is that runtime's, handed in so no count runs
 * anywhere else. A fixture run (`launch-arguments.ts`) stands the host on
 * the desktop's synthetic data instead of the service (`fixture-host.ts`).
 */

import { createORPCClient } from "@orpc/client";
import { type AccountRenewalWindow, type AuthSession, authSessionConsent } from "@repo/credentials";
import { GITHUB_INSTALL_LANDING } from "@repo/features";
import { PRODUCT_PLATFORM, type ProductLaunchedIn } from "@repo/features/analytics";
import { readerZone } from "@repo/features/date-mention";
import { IOS_OAUTH_CALLBACK_URL } from "@repo/features/ios-sign-in-wire";
import { LINK_ORIGIN } from "@repo/features/link-home";
import type { OpenTerminalSocket } from "@repo/features/relay-socket";
import type { TokenVault } from "@repo/host";
import { runModeFor } from "@repo/host";
import {
  ACT_PORT_CROSSING,
  type ActPortDependencies,
  type AgentProceduresDependencies,
  clientSettingSideEffects,
  createActPortHandler,
  feedbackProcedures,
  inProcessChannel,
  type PlatformActProcedures,
  refusedPlatformProcedures,
  sameProcessLink,
  shellReadProcedures,
  WindowPushes,
} from "@repo/host/act-port";
import { AgentNoticeDoors } from "@repo/host/agent-notices";
import { RUN_PROFILE, type RunProfile } from "@repo/host/app-state";
import type { AppBridge } from "@repo/host/bridge";
import {
  AppStateStore,
  createInProcessBridge,
  createOperatorClient,
  initialAppState,
  linkClientNotices,
  linkNetworkWatch,
  type OperatorClient,
  publishAppStateChanges,
  serviceReachLayer,
} from "@repo/host/client";
import type { ActPortClient } from "@repo/host/contract";
import {
  AppIdentity,
  type DuplicateGatewayMethod,
  type DuplicateHostAct,
  Environment,
  type FileDownloadSeam,
  HOST_PLATFORM_CONCERN,
  HostAssemblyTag,
  type HostTag,
  hostAssemblyLayer,
  hostCapabilities,
  hostKernelLayer,
  hostStandingLayer,
  IdSource,
  issuedTokenAccountSourceLayer,
  type KeepIssuedToken,
  OAUTH_ACCOUNT_CLIENT,
  oauthVaultAccountSourceLayerFor,
  PlatformFileDownload,
  PlatformRenewalWindow,
  PlatformScreensInProcess,
  PlatformTokenVault,
  RunMode,
  reporterLayer,
  ServiceOrigin,
  ShutdownSignal,
  SignInConsent,
  StateRoot,
  TerminalSocket,
} from "@repo/host/effect";
import type { InboxRowsSource } from "@repo/host/inbox-rows";
import { LocalDatabaseDriver, type LocalDatabaseDriverSeam } from "@repo/host/local-database";
import { effectServiceLayer } from "@repo/host/service-layer";
import { plainCodeLines } from "@repo/host/task-code-remote";
import { Cause, ConfigProvider, Context, Effect, Layer, Path, Queue, Stream } from "effect";
import type * as FileSystem from "effect/FileSystem";
import * as HttpClient from "effect/http/HttpClient";
import type * as FixtureHost from "./fixture-host.js";

/**
 * How long the share sheet sends a token after it is issued: ten minutes
 * short of the hour the service's access tokens last (`accessTokenExpiresIn`
 * in `packages/service/src/auth/auth.ts`), so one nearly lapsed is not sent.
 */
const SHARE_TOKEN_LIFETIME_MS = 50 * 60 * 1000;

/**
 * The service the app talks to: production's, or the Preview a build names
 * in `EXPO_PUBLIC_SERVICE_ORIGIN`, which Expo writes into the bundle as it
 * is built, so a production build carries only the origin itself.
 */
export const SERVICE_ORIGIN = process.env.EXPO_PUBLIC_SERVICE_ORIGIN ?? LINK_ORIGIN;

/** The one place every act is from: the app's screens, which stand as the host's one panel. */
const APP_SCREENS = Symbol("app screens");

type MobileSender = typeof APP_SCREENS;

/** What the app's root reads of the host once it stands: the bridge the screens read state through, and the client their acts go out on. */
export interface MobileHost {
  readonly bridge: AppBridge;
  /** The screens' client of the act port, for the acts that ride oRPC (`@repo/host/contract`). */
  readonly acts: ActPortClient;
  /** The pool's Inbox kind, which the screens read through live queries where its items are kept on disk (`@repo/host/inbox-rows`). */
  readonly inboxRows: InboxRowsSource;
}

export class MobileHostTag extends Context.Service<MobileHostTag, MobileHost>()(
  "@repo/mobile/MobileHost",
) {}

/** What the host reads of the device, as the app answers it (`device-seams.ts`) or a test does. */
export interface DeviceSeams {
  /** Where this launch began, in front or woken in the background, as the app read it when its bundle first ran (`launch-state.ts`). */
  readonly launchedIn?: ProductLaunchedIn;
  /** The host's files, which hold the settings store's one file. */
  readonly fileSystem: Layer.Layer<FileSystem.FileSystem>;
  /** The ids the host mints for its own records. */
  readonly createId: () => string;
  /** Opens an address outside the app; a sign-in's in the system's authentication sheet, which closes on the page it names as its landing. */
  readonly openExternal: (url: string, landing?: string) => Promise<void>;
  /** Opens a connection's install in the system's authentication sheet, closed on the page it names as its landing, answering only once the sheet closes. */
  readonly openSheet: (url: string, landing: string) => Promise<void>;
  /** Opens a relay socket, which the terminals and the live reads ride. */
  readonly openSocket: OpenTerminalSocket;
  /** Whether the app is in the foreground, at each change, for as long as the subscription stands. */
  readonly onAppActiveChanged: (listener: (active: boolean) => void) => () => void;
  /** Whether the device has a network: its reading now, then each change, for as long as the subscription stands. */
  readonly onNetworkChanged: (listener: (online: boolean) => void) => () => void;
  /** Where the Keychain keeps the account's tokens (`keychain-tokens.ts`). */
  readonly tokenVault: TokenVault;
  /** When the account may renew: only while the app is in the foreground, held running through the renewal; a device without one renews whenever a call asks. */
  readonly renewalWindow?: AccountRenewalWindow;
  /** Where a sign-in's authorization page is shown and its redirect caught. */
  readonly authSession: AuthSession;
  /** Keeps each access token the account is issued where the share sheet reads it, or removes it, answering whether the Keychain took it (`share-token-module.ts`). */
  readonly keepShareToken: KeepIssuedToken;
  /** The SQLite the account's local database opens on (`expo-sqlite-driver.ts`); a device without one keeps no local database. */
  readonly localDatabaseDriver?: LocalDatabaseDriverSeam;
  /** Where the host's own lines go beside the console: the next crash or error report's trail (`crash-reports.ts`), or nowhere. */
  readonly keepLine?: (message: string) => void;
  /** How a picture is downloaded straight into a file (`native-download.ts`); a device without one reads a picture as its bytes. */
  readonly fileDownload?: FileDownloadSeam;
}

/** What the app hands the composition. */
export interface MobileHostOptions {
  /** The client every service call goes out on: the device's fetch, or a test's. */
  readonly httpClient: Layer.Layer<HttpClient.HttpClient>;
  /** Forks an Effect nobody awaits, a surface event's count, on the app's one runtime. */
  readonly fork: (effect: Effect.Effect<void>) => void;
  /** The profile a fixture run stands on, which the launch argument names; none for a live run. */
  readonly fixture: RunProfile | undefined;
  /** Whether a fixture run stands as the service's refusal of an old build leaves the document, which `-updateNeeded true` asks; never in a live run. */
  readonly fixtureUpdateNeeded?: boolean | undefined;
  /** Whether a fixture run holds an ask of Ada's MacBook for an agent's command, which `-machineAsk true` asks; never in a live run. */
  readonly fixtureMachineAsk?: boolean | undefined;
  /** Whether a fixture run's account stands as one that started setup and hasn't finished it, which `-setupOwed true` asks; never in a live run. */
  readonly fixtureSetupOwed?: boolean | undefined;
  /** Whether a fixture run's account stands with its Inbox turned off, which `-inboxOff true` asks; never in a live run. */
  readonly fixtureInboxOff?: boolean | undefined;
  /** Whether a fixture run's act port refuses the writes a flow presses, which `-refuseWrites true` asks; never in a live run. */
  readonly fixtureRefusesWrites?: boolean | undefined;
  /** This build's version, as the app's config names it. */
  readonly appVersion: string;
  /** Where the host keeps its files: the app's own folder, or a temporary one in a test. */
  readonly stateRoot: string;
  readonly device: DeviceSeams;
}

/** The mobile host as built, with the operator its launch starts beside it. */
interface ComposedMobile extends MobileHost {
  readonly operator: OperatorClient;
  readonly state: AppStateStore;
}

class ComposedMobileTag extends Context.Service<ComposedMobileTag, ComposedMobile>()(
  "@repo/mobile/ComposedMobile",
) {}

/** A line about the host's own running, on the app's console. */
const report = (message: string): void => {
  console.warn(message);
};

/**
 * The account's seams, as the phone answers them: the tokens kept in the
 * Keychain (`keychain-tokens.ts`), and each sign-in shown in the system's
 * authentication session, which returns on the `ios` client's one
 * registered callback (`@repo/features/ios-sign-in-wire`).
 */
function accountSeams(device: DeviceSeams) {
  return Layer.mergeAll(
    Layer.succeed(PlatformTokenVault, device.tokenVault),
    device.renewalWindow === undefined
      ? Layer.empty
      : Layer.succeed(PlatformRenewalWindow, device.renewalWindow),
    Layer.succeed(SignInConsent, {
      open: authSessionConsent({
        callbackUrl: IOS_OAUTH_CALLBACK_URL,
        session: device.authSession,
      }),
    }),
  );
}

/** Every seam the host's kernel and assembly stand on, as the app answers it. */
function seamLayers(options: MobileHostOptions) {
  const { stateRoot, appVersion, fixture, device } = options;

  return Layer.mergeAll(
    Layer.succeed(StateRoot, stateRoot),
    Layer.succeed(RunMode, runModeFor({ capture: false, fixture: fixture !== undefined })),
    Layer.succeed(AppIdentity, {
      appVersion,
      packaged: true,
      platform: PRODUCT_PLATFORM.IOS,
      deviceZone: readerZone,
      ...(device.launchedIn === undefined ? undefined : { launchedIn: device.launchedIn }),
    }),
    // The app has no environment to read an override from.
    Layer.succeed(Environment, ConfigProvider.fromEnv({ env: {} })),
    Layer.succeed(IdSource, { create: device.createId }),
    reporterLayer((message) => {
      report(message);
      device.keepLine?.(message);
    }),
    Layer.succeed(ShutdownSignal, { notify: undefined }),
    Layer.succeed(ServiceOrigin, SERVICE_ORIGIN),
    Layer.succeed(TerminalSocket, device.openSocket),
    device.localDatabaseDriver === undefined
      ? Layer.empty
      : Layer.succeed(LocalDatabaseDriver, device.localDatabaseDriver),
    device.fileDownload === undefined
      ? Layer.empty
      : Layer.succeed(PlatformFileDownload, device.fileDownload),
    // Note that the screens run in this process, so a picture's source may carry the account's header to their image loader (`ACCOUNT_PICTURE_SOURCE`).
    Layer.succeed(PlatformScreensInProcess, true),
  );
}

/**
 * Whether the device has a network, as its seam reads it now and at each
 * change, for the host's network watch, as the web hands it the tab's
 * `online` and the desktop `net.isOnline`; the listener is let go as the
 * stream ends.
 */
const deviceOnline = (device: DeviceSeams): Stream.Stream<boolean> =>
  Stream.callback<boolean>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() =>
        device.onNetworkChanged((online) => {
          Queue.offerUnsafe(queue, online);
        }),
      ),
      (stop) => Effect.sync(stop),
    ),
  );

/**
 * The act port's procedures' dependencies, answered for the app: no keys,
 * so no chord is ever held and no setting has a side effect of the app's,
 * the screens the one window a settings write is reported under, and a
 * fenced block drawn plain, since Shiki stays out of the app (v1 draws code
 * without highlighting).
 */
function portDependencies(
  operator: OperatorClient,
  notices: AgentProceduresDependencies["notices"],
  reporter: string,
  device: DeviceSeams,
): ActPortDependencies {
  const host = operator.host;
  const { openExternal } = device;

  return {
    account: {
      host,
      acts: operator.acts,
      haltSessionReplay: operator.haltSessionReplay,
      resumeSessionReplay: operator.resumeSessionReplay,
    },
    acts: operator.acts,
    agents: { notices },
    // Note that nothing is pushed on the app's port: the screens hear the host
    // through the in-process bridge's own listeners, so its push stream is
    // never opened and this table stays empty.
    pushes: new WindowPushes(),
    settings: {
      host,
      acts: operator.acts,
      reporterOf: (actor) => (actor.sender === APP_SCREENS ? reporter : undefined),
      lastSettings: () => operator.settings(),
      // The app has no login item to open at.
      sideEffects: clientSettingSideEffects({ applyLoginItem: () => {} }),
    },
    tasks: {
      acts: operator.acts,
      colorCode: (_language, code) => Effect.succeed(plainCodeLines(code)),
      openExternal,
      serviceBaseUrl: SERVICE_ORIGIN,
    },
    // GitHub's install opens in the authentication sheet, closed as it lands on the service's page, and answers once the sheet closes, so the screen reads again the repositories it reached.
    workspaces: {
      openExternal: (url, landing) =>
        landing === undefined ? openExternal(url) : device.openSheet(url, landing),
      githubLanding: `${SERVICE_ORIGIN}${GITHUB_INSTALL_LANDING.PATH}`,
    },
  };
}

/**
 * The platform kinds the app answers itself: a note to the people who make
 * the app, carried to the service's feedback endpoint over the host's own
 * HTTP client (`feedbackProcedures`), and an agent's shells listed and its
 * sandbox resumed, which its run actions read (`shellReadProcedures`).
 * Every other platform kind is refused
 * in its own words: a copy or a save the app does through the system's own
 * pasteboard, Photos, and share sheet, and what only the Mac has.
 */
const platformProcedures = (
  http: HttpClient.HttpClient,
  shells: Pick<OperatorClient["host"], "terminalList" | "terminalResume">,
): PlatformActProcedures<MobileSender> => ({
  ...refusedPlatformProcedures<MobileSender>(),
  ...feedbackProcedures<MobileSender>(http, SERVICE_ORIGIN),
  // Note that an agent's shells are listed and its sandbox resumed for its run actions, though no Terminal tab is drawn.
  ...shellReadProcedures<MobileSender>(shells),
});

/**
 * The act port as the app opens it: a channel in the process, the host's end
 * upgraded with the act port's handler and the screens' end linked to the
 * client they act through, as the web's tab opens one over a
 * `MessageChannel`. The screens are the only caller, this build's own, so
 * every call is the panel's and trusted; the procedures' effects run on the
 * app's runtime. Both ends close with the host's scope.
 */
const servedActPort = (
  dependencies: ActPortDependencies,
  shells: Pick<OperatorClient["host"], "terminalList" | "terminalResume">,
  services: Context.Context<never>,
  http: HttpClient.HttpClient,
) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const channel = inProcessChannel();
      // Note that both ends hand each message across as the object itself, since they stand in one process, so a photo's base64 is never written out as text and parsed back on the screens' thread.
      createActPortHandler(
        dependencies,
        platformProcedures(http, shells),
        ACT_PORT_CROSSING.SAME_PROCESS,
      ).upgrade(channel.port2, {
        context: () => ({
          actor: { sender: APP_SCREENS, panel: true },
          trusted: true,
          "effect/context": services,
        }),
      });
      channel.port2.start();
      const link = sameProcessLink(channel.port1);
      channel.port1.start();

      return { channel, acts: createORPCClient<ActPortClient>(link) };
    }),
    ({ channel }) =>
      Effect.sync(() => {
        channel.port1.close();
        channel.port2.close();
      }),
  ).pipe(Effect.map(({ acts }) => acts));

/**
 * A fixture run's data laid over the document once the bootstrap has been
 * read into it, and again on each change the host writes after that, as the
 * panel's fixture run lays its data over each delivery: the host's notices
 * write what waits on the account, which is nothing, over the staged Inbox
 * otherwise. The store drops a patch that says nothing new, so laying the
 * same data twice settles rather than loops.
 */
const stagedFixture = (
  stageFixture: typeof FixtureHost.stageFixture,
  state: AppStateStore,
  updateNeeded: boolean,
  machineAsk: boolean,
  setupOwed: boolean,
  inboxOff: boolean,
) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      stageFixture(state, updateNeeded, machineAsk, setupOwed, inboxOff);
      yield* publishAppStateChanges(
        state,
        () => Effect.sync(() => stageFixture(state, updateNeeded)),
        report,
      );
    }),
  );

/** The host standing in the app, its document, its bridge, and the act port beside it. */
const composedMobile = (options: MobileHostOptions) =>
  Layer.effect(
    ComposedMobileTag,
    Effect.gen(function* () {
      const { fork, appVersion, fixture, device } = options;
      const assembly = yield* HostAssemblyTag;
      const services: Context.Context<never> = yield* Effect.context();
      const runMode = runModeFor({ capture: false, fixture: fixture !== undefined });

      const state = new AppStateStore(
        initialAppState(
          {
            launch: {
              profile: fixture ?? RUN_PROFILE.IDLE,
              captureMode: false,
              fixtureMode: fixture !== undefined,
            },
            runMode,
            appVersion,
            packaged: true,
            platform: PRODUCT_PLATFORM.IOS,
          },
          false,
          hostCapabilities(assembly.concerns, []),
        ),
        services,
      );

      const operator = yield* createOperatorClient({
        report,
        gateway: assembly.gateway,
        acts: assembly.acts,
        nodes: assembly.nodes,
        node: { openExternal: device.openExternal },
        state,
      });

      // Note that the device's network and the service's reach (`serviceReachLayer`) are both followed, so an offline phone is marked at once and its live reads catch up as its network returns.
      yield* linkNetworkWatch({
        state,
        online: deviceOnline(device),
        regained: operator.host.tasksRegained(),
        report,
      });

      // No notification, badge, or chime leaves the app yet: those come with the screens that draw the Inbox.
      const notices = yield* linkClientNotices({
        state,
        host: operator.host,
        taskList: assembly.taskListMoves,
        presenter: { openMachineCommandAsk: () => undefined, openPlace: () => undefined },
        onPanelFocusChanged: device.onAppActiveChanged,
        report,
      }).pipe(
        Effect.provideService(AgentNoticeDoors, {
          post: () => undefined,
          badge: () => undefined,
          chime: () => undefined,
        }),
      );

      const count: AppBridge["recordSurfaceEvent"] = (name, properties) => {
        // A count that fails is said on the console, never left as a rejection nobody hears.
        fork(
          Effect.catchCause(operator.host.recordEvent(name, properties), (cause) =>
            Effect.sync(() => report(`A surface event was not counted: ${Cause.pretty(cause)}`)),
          ),
        );
      };

      const made = yield* createInProcessBridge({
        state,
        windowFacts: () => ({ fullScreen: false }),
        reports: { notifyReady: () => undefined, recordSurfaceEvent: count },
        report,
      });

      const acts = yield* servedActPort(
        portDependencies(operator, notices, device.createId(), device),
        operator.host,
        services,
        yield* HttpClient.HttpClient,
      );

      return { bridge: made.bridge, acts, operator, state, inboxRows: assembly.inboxRows };
    }),
  );

/**
 * The host in the app, composed and started: the assembly over the device's
 * seams, an agent's terminals its one platform concern, then the composers
 * started in the launch's order, then the operator's first bootstrap read
 * into the document, so the screens' first read finds the account already
 * settled; and, in a fixture run, the profile's synthetic data laid over
 * the document, and kept over it. The scope this is built in is the app's;
 * closing it is the host's drain.
 */
export function composeMobile(
  options: MobileHostOptions,
): Layer.Layer<MobileHostTag | HostTag, DuplicateGatewayMethod | DuplicateHostAct> {
  const { httpClient, device } = options;

  // Every call the host makes to the service tells the service's reach beside it, which the network watch follows.
  const assembly = Layer.provide(
    hostAssemblyLayer([HOST_PLATFORM_CONCERN.TERMINALS]),
    Layer.mergeAll(
      Layer.provideMerge(hostKernelLayer, seamLayers(options)),
      device.fileSystem,
      Path.layer,
      httpClient,
      Layer.provide(
        issuedTokenAccountSourceLayer(oauthVaultAccountSourceLayerFor(OAUTH_ACCOUNT_CLIENT.IOS), {
          keep: device.keepShareToken,
          lifetimeMs: SHARE_TOKEN_LIFETIME_MS,
        }),
        accountSeams(device),
      ),
    ),
  ).pipe(Layer.provideMerge(serviceReachLayer));

  const launched = Layer.unwrap(
    Effect.gen(function* () {
      const mobile = yield* ComposedMobileTag;
      const { fixture } = options;

      // Note that a fixture run's host is loaded only on a fixture run, because importing it ran the desktop's whole synthetic Inbox, some 130 KB of it, in every live launch before the first frame.
      const fixtureHost =
        fixture === undefined
          ? undefined
          : yield* Effect.promise(() => import("./fixture-host.js"));

      const standing = Layer.mergeAll(
        Layer.succeed(MobileHostTag, {
          bridge: mobile.bridge,
          inboxRows: mobile.inboxRows,
          acts:
            fixture === undefined || fixtureHost === undefined
              ? mobile.acts
              : fixtureHost.fixtureActs(
                  mobile.acts,
                  fixture,
                  mobile.state,
                  options.fixtureRefusesWrites === true,
                ),
        }),
        effectServiceLayer(mobile.operator, report),
      ).pipe(Layer.provideMerge(hostStandingLayer));

      const staged =
        fixtureHost === undefined
          ? Layer.empty
          : stagedFixture(
              fixtureHost.stageFixture,
              mobile.state,
              options.fixtureUpdateNeeded === true,
              options.fixtureMachineAsk === true,
              options.fixtureSetupOwed === true,
              options.fixtureInboxOff === true,
            );

      return Layer.provideMerge(staged, standing);
    }),
  );

  return launched.pipe(
    Layer.provideMerge(composedMobile(options)),
    Layer.provideMerge(assembly),
    Layer.provide(httpClient),
  );
}
