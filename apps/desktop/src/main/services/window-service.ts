import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { APP_LINK_CLAIM, APP_LINK_SCHEME, appLinkClaim } from "@repo/features/app-links";
import { LINK_DESTINATION, type ShownLink } from "@repo/features/link-grammar";
import { PAGE_SCHEME } from "@repo/features/page-frame";
import {
  type StandingCall,
  VOICE_CALL_PRESS,
  type VoiceCallPress,
} from "@repo/features/voice-wire";
import type { AppStateSnapshot, AppWindowFacts } from "@repo/host/app-state";
import { applyThemePreference, NativeTheme, windowMaterialFor } from "@repo/host/appearance";
import type { AppStateStore, OperatorClient } from "@repo/host/client";
import { PUSH } from "@repo/host/contract";
import type { DesktopService } from "@repo/host/desktop-service";
import { APP_SETTING_SCHEMA } from "@repo/settings";
import { devBuildBadge } from "@repo/settings/dev-build";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { Effect } from "effect";
import {
  app,
  type BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  nativeTheme,
  powerMonitor,
  screen,
  session,
  type WebContents,
} from "electron";
import type { BuildLabelMenu } from "../app-menu";
import { whenPageGone } from "../ipc/page-gone";
import { CallWindow } from "../window/call-window";
import { CallWindowPresence } from "../window/call-window-presence";
import { followDockIcon } from "../window/dock-icon";
import { askForNotifications } from "../window/notice-doors";
import { pageResponse } from "../window/page-protocol";
import { PanelManager } from "../window/panel-manager";
import { reportRendererErrors } from "../window/renderer-errors";
import { followResponsiveness } from "../window/renderer-health";
import { grantWindowPermissions } from "../window/window-permissions";
import { windowPushes } from "../window/window-pushes";
import { PanelWindows, zoomFactorOf, zoomSteer } from "../window/zoom";
import type { DesktopConfig } from "./desktop-config";
import { reportUnresponsivePanel } from "./telemetry-service";

/** How long a display change is let settle before the panels are laid out over it. */
const DISPLAY_SETTLE_MS = 100;

export interface WindowServiceDependencies {
  config: DesktopConfig;
  /** What the windows are told from, and where what this service holds of it is written. */
  state: AppStateStore;
  operator: OperatorClient;
  /** Every operator effect this service reads, run on the launch's own runtime. */
  run: <A>(effect: Effect.Effect<A>) => Promise<A>;
  /**
   * Whether the launch this start belongs to still stands. False from the
   * moment a Quit is asked for, which is what every wait below re-checks: a
   * start suspended on one of its own awaits must not resume into opening a
   * window the teardown has already closed.
   */
  launchStanding: () => boolean;
}

export interface WindowService extends DesktopService {
  readonly panels: PanelManager;
  /**
   * One `app:state` per window, each the document as that window is handed
   * it (`appStateFor`). The one place the document becomes a push, so what a
   * window is told and what `app:state-request` answers it are the same
   * document read twice; its stream sends what moved in it.
   */
  publishAppState: () => void;
  /**
   * Steers the app to the theme and the zoom the document holds. Run before
   * every publish, so a window handed new settings already draws under the
   * appearance they name, and a write that failed — which moves no settings —
   * steers nothing.
   */
  applyAppearance: () => Effect.Effect<void>;
  /**
   * The document as one window is handed it: the document, and what the
   * window answers for and the document cannot, whether it stands in full
   * screen.
   */
  appStateFor: (sender: WebContents) => AppStateSnapshot;
  /** A panel has painted and hears the links it is handed: every app link held opens now, and each later one as it comes. */
  panelReady: () => void;
  /** Asks the panels to open Settings: the menu bar's Check for Updates, whose answer is drawn there. */
  showSettings: () => void;
  /** The panel window coming forward or going behind, for as long as the subscription stands. */
  onPanelFocusChanged: (listener: (focused: boolean) => void) => () => void;
  /**
   * The opaque name one window's writes travel to the host under. It names
   * nothing about the window to anyone else, and the host records it beside
   * the change it produced.
   */
  reporterOf: (sender: WebContents) => string;
  /** Keeps the voice call a panel holds, or none once it ends, which the floating call window draws while no panel has the keyboard. */
  tellVoiceCall: (sender: WebContents, call: StandingCall | null) => void;
  /** Hands a press on the floating call window's card on to the panel holding the call, answering false where the asking window is not the call window. */
  pressVoiceCall: (sender: WebContents, press: VoiceCallPress) => boolean;
  /** Only this build's own renderer may reach a bridge entry. */
  trustedSender: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  applyLoginItem: (openAtLogin: boolean) => void;
}

/**
 * Everything this process draws or claims from the machine on the windows'
 * behalf: the panel, the Dock, the login item, the media permissions, the scheme a plan's pages are drawn from, and
 * the display and power changes the panel answers.
 * It is the one concern that opens a window, and it opens none until `start`.
 */
export function createWindowService(dependencies: WindowServiceDependencies): WindowService {
  const { config, state, operator, run, launchStanding } = dependencies;
  const { runMode } = config;

  const reporters = new WeakMap<WebContents, string>();

  function reporterOf(sender: WebContents): string {
    const held = reporters.get(sender);

    if (held) return held;
    const minted = randomUUID();
    reporters.set(sender, minted);

    return minted;
  }

  const preloadPath = path.join(config.resourceDirectory, "preload.js");
  const rendererHtmlPath = path.join(config.resourceDirectory, "renderer", "index.html");
  // A file this build wrote into the resource directory, and the whole of
  // what any window here may navigate to or speak from.
  const rendererUrl = pathToFileURL(rendererHtmlPath).href;
  // The floating call window's document, on the same terms: its own entry, which reaches no host.
  const callHtmlPath = path.join(config.resourceDirectory, "renderer", "call.html");
  const callUrl = pathToFileURL(callHtmlPath).href;

  const panels = new PanelManager({
    runMode,
    material: windowMaterialFor(process.getSystemVersion()),
    instance: config.instance,
    preloadPath,
    rendererHtmlPath,
    rendererUrl,
    zoomFactor: () => zoomFactorOf(state.snapshot().settings?.stored.zoom),
    // A capture run opens at the frame its evidence is measured at, and
    // keeps no place of its own.
    placementPath: runMode.takesFocus ? path.join(config.stateRoot, "main-window.json") : undefined,
    closing: () => !launchStanding(),
    onAllClosed: () => config.quit(),
    // The title bar's buttons move into the traffic lights' place while
    // macOS hides them, so the window is told as its frame changes.
    onFullScreenChanged: () => publishAppState(),
    // Begun rather than waited on: the following ends as the window closes.
    followResponsiveness: (window) => {
      void run(followResponsiveness(window, reportUnresponsivePanel));
    },
    onRendererGone: (reason) => config.report(`Panel renderer gone: ${reason}`),
  });

  const callWindow = new CallWindow({
    runMode,
    preloadPath,
    rendererHtmlPath: callHtmlPath,
    rendererUrl: callUrl,
    placementPath: path.join(config.stateRoot, "call-window.json"),
  });

  const callPresence = new CallWindowPresence(callWindow);
  /** The panel holding the voice call the document carries; none while none does. */
  let callHolder: WebContents | undefined;
  /** The panels whose page going away is already followed, each followed once. */
  const callPagesFollowed = new WeakSet<WebContents>();

  /** What stops a development build's renderer errors reaching the terminal; nothing until the start begins it. */
  let stopRendererErrors = (): void => undefined;

  /** Electron's own `nativeTheme`, the one appearance every window here follows. */
  const withNativeTheme = Effect.provideService(NativeTheme, nativeTheme);

  /** The panel windows standing now, the ones a zoom is applied to. */
  const withPanelWindows = Effect.provideService(PanelWindows, {
    standing: () => panels.windows(),
  });

  /** The stored zoom, applied to the panels only when it moved. */
  const steerZoom = zoomSteer();

  const applyAppearance = (): Effect.Effect<void> =>
    Effect.suspend(() => {
      const stored = state.snapshot().settings?.stored;

      return Effect.andThen(
        applyThemePreference(stored?.theme).pipe(withNativeTheme),
        steerZoom(stored?.zoom).pipe(withPanelWindows),
      );
    });

  function windowFactsFor(sender: WebContents): AppWindowFacts {
    return { fullScreen: panels.fullScreen(sender) };
  }

  /** The document as `sender` is handed it, read and pushed alike. */
  function appStateFor(sender: WebContents): AppStateSnapshot {
    return { ...state.snapshot(), window: windowFactsFor(sender) };
  }

  function publishAppState(): void {
    for (const sender of panels.senders()) windowPushes.pushState(sender, appStateFor(sender));
    const call = callWindow.current();

    if (call !== undefined) windowPushes.pushState(call.webContents, appStateFor(call.webContents));
  }

  /**
   * The voice call a panel holds, kept on the document for the floating
   * window, and that window shown or hidden by it. A call ends with the page
   * that held it, a reload's or a crash's alike, so that page going away
   * lets the call go here too, as its own hang-up cannot be relied on to
   * say. A panel telling of no call lets go only the call it held.
   */
  function tellVoiceCall(sender: WebContents, call: StandingCall | null): void {
    if (call === null && callHolder !== sender) return;
    callHolder = call === null ? undefined : sender;

    if (call !== null && !callPagesFollowed.has(sender)) {
      callPagesFollowed.add(sender);
      whenPageGone(sender, () => {
        callPagesFollowed.delete(sender);
        tellVoiceCall(sender, null);
      });
    }

    state.update({ voiceCall: call });
    callPresence.callChanged(call !== null);
  }

  /**
   * A press on the floating card: the way back brings the holding panel
   * forward on the call's agent, and every other press is handed to that
   * panel, which acts on it as on a press of its own card.
   */
  function pressVoiceCall(sender: WebContents, press: VoiceCallPress): boolean {
    if (!callWindow.owns(sender)) return false;
    const holder = callHolder;
    const call = state.snapshot().voiceCall;

    if (holder === undefined || call === null) return true;

    if (press.press !== VOICE_CALL_PRESS.OPEN) {
      windowPushes.push(holder, PUSH.VOICE_CALL_PRESS, press);

      return true;
    }

    const displayId = panels.displayIdFor(holder);

    if (displayId !== undefined) panels.focusIfExpanded(displayId);
    windowPushes.push(holder, PUSH.SHOW_LINK, {
      workspace: "",
      place: { kind: LINK_DESTINATION.AGENT, planId: call.taskId, agentId: call.agentId },
    });

    return true;
  }

  // Which panel has the keyboard, for the call window: while one does, that panel draws the call itself.
  const panelFocused = (_event: Electron.Event, window: BrowserWindow) => {
    if (panels.owns(window.webContents)) callPresence.panelFocused(window.webContents);
  };

  const panelBlurred = (_event: Electron.Event, window: BrowserWindow) => {
    if (panels.owns(window.webContents)) callPresence.panelBlurred(window.webContents);
  };

  function showSettings(): void {
    panels.broadcast(PUSH.MENU_COMMAND, APP_COMMAND.SETTINGS);
  }

  function onPanelFocusChanged(listener: (focused: boolean) => void): () => void {
    const focused = (_event: Electron.Event, window: BrowserWindow) => {
      if (panels.owns(window.webContents)) listener(true);
    };

    const blurred = (_event: Electron.Event, window: BrowserWindow) => {
      if (panels.owns(window.webContents)) listener(false);
    };

    app.on("browser-window-focus", focused);
    app.on("browser-window-blur", blurred);

    return () => {
      app.removeListener("browser-window-focus", focused);
      app.removeListener("browser-window-blur", blurred);
    };
  }

  /**
   * Every wait this service schedules — the settling a display change waits
   * out — held so the quit can take them back. Each opens a window when it
   * fires, and the teardown runs for seconds with the drain behind it, so
   * one landing afterwards would re-open what the teardown had just given
   * back.
   */
  const pendingWaits = new Set<ReturnType<typeof setTimeout>>();

  function afterDelay(delayMs: number, run: () => void): void {
    // Nothing new is scheduled once a quit has been asked for, so the last
    // act of a wait that was already running cannot arm the next one behind
    // the teardown that just cleared them.
    if (!launchStanding()) return;

    const wait = setTimeout(() => {
      pendingWaits.delete(wait);

      if (!launchStanding()) return;
      run();
    }, delayMs);

    pendingWaits.add(wait);
  }

  function applyLoginItem(openAtLogin: boolean): void {
    if (config.packaged) app.setLoginItemSettings({ openAtLogin });
  }

  function configurePermissions(): void {
    grantWindowPermissions(session.defaultSession, (webContents) => panels.owns(webContents));
  }

  function handleDisplayChange(): void {
    afterDelay(DISPLAY_SETTLE_MS, () => panels.reconcile());
  }

  // A second launch's app link is heard by main itself, from before the windows stand (`../main.ts`).
  const handleSecondInstance = (): void => {
    if (!launchStanding()) return;
    panels.reconcile();
    panels.focusExpanded();
  };

  // An app link's place opens in the panels, the window brought forward.
  const openAppLink = (link: ShownLink): void => {
    panels.focusExpanded();
    panels.broadcast(PUSH.SHOW_LINK, link);
  };

  // The Dock tile pressed: the window comes back, whether it was closed or
  // only behind another app.
  const handleActivate = (): void => {
    panels.focusExpanded();
  };

  // Named one at a time because Electron's `on` is typed per event name.
  const wake = (eventName: "resume" | "unlock-screen" | "user-did-become-active") => () => {
    handleDisplayChange();

    // A terminal's socket may have died in the sleep without a word, and one waiting out a backoff need not wait on.
    if (eventName === "resume") void run(operator.host.terminalWake());

    // The devices' beats a window draws were last read before the sleep, so they are read again rather than at the next poll.
    if (eventName === "resume") void run(operator.acts.HOSTS_PRESENCE_FOLLOW.retry(undefined));

    // So may the task list's follow; a resume and an unlock landing together seal it again once.
    if (eventName !== "user-did-become-active") void run(operator.host.tasksResync());
  };

  const wakeHandlers = {
    resume: wake("resume"),
    "unlock-screen": wake("unlock-screen"),
    "user-did-become-active": wake("user-did-become-active"),
  } as const;

  return {
    name: "windows",
    panels,
    publishAppState,
    applyAppearance,
    appStateFor,
    panelReady: () => config.appLinks.ready(openAppLink),
    showSettings,
    onPanelFocusChanged,
    reporterOf,
    tellVoiceCall,
    pressVoiceCall,
    trustedSender: (event) => {
      const url = event.senderFrame?.url ?? event.sender.getURL();

      return url === rendererUrl || url === callUrl;
    },
    applyLoginItem,
    start: async () => {
      // A development build bands its tile, so builds side by side are told apart.
      const badge = config.packaged
        ? undefined
        : devBuildBadge({ instance: config.instance, commit: config.commit });

      const bandDockIcon = followDockIcon(
        path.join(config.resourceDirectory, "icon"),
        badge,
        config.report,
      );

      // Developer's Show Build Label hides the band and brings it back, so a
      // demo shows no branch.
      const buildLabelMenu = (shown: boolean): BuildLabelMenu => ({
        shown,
        onShow: (next) => {
          if (badge === undefined) return;
          bandDockIcon(next ? badge : undefined);
          config.showMenuBar({ buildLabel: buildLabelMenu(next) });
        },
      });

      const settings = await run(operator.ensureSettings());

      // A Quit landing inside one of the launch's own waits is already tearing
      // this process down; nothing is opened or armed over it. This check sits
      // after every wait that still has a window behind it.
      if (!launchStanding()) return;
      // The theme is steered before any panel opens, so the first frame of
      // every window is already drawn in the appearance it will keep.
      await run(applyThemePreference(settings?.stored.theme).pipe(withNativeTheme));
      applyLoginItem(settings?.stored.openAtLogin ?? APP_SETTING_SCHEMA.openAtLogin.default);

      // macOS is asked now, while the developer is here to answer, rather
      // than as the first agent ends behind the window. Note that it is
      // asked whatever the setting says, because asking posts nothing and
      // macOS asks only once, and a switch turned on later would otherwise
      // leave its first notification to ask, and be refused.
      if (runMode.observesProviders) askForNotifications();
      // A plan's pages are read through the host on the account's bearer, so the frame holds an address alone.
      session.defaultSession.protocol.handle(PAGE_SCHEME, (request) =>
        run(pageResponse(request.url, operator.host.tasksPage)),
      );

      // A development build writes its windows' errors where the run's own
      // lines go, from before the first window opens, and offers their
      // developer tools; the menu bar draws none in a packaged build. Note
      // that a capture run is offered none either, because its windows are
      // opened without them (`hardenedWebPreferences`).
      if (!config.packaged) stopRendererErrors = reportRendererErrors(config.report);

      if (runMode.takesFocus) config.showMenuBar({ developerTools: true });

      if (badge !== undefined) config.showMenuBar({ buildLabel: buildLabelMenu(true) });
      // The menu's New Task and ⌘0 bring the window back where it was
      // closed, since no window's keymap stands to answer them then.
      config.showMenuBar({
        panel: {
          isPanel: (window) => panels.windows().some((panel) => panel === window),
          onReopen: (command) => {
            panels.focusExpanded();

            if (command !== undefined) panels.broadcast(PUSH.MENU_COMMAND, command);
          },
        },
      });
      panels.reconcile();
      configurePermissions();

      // A packaged app asks macOS for its own scheme; a live development run gives back a claim stock Electron holds, which would open a bare Electron.
      const linkClaim = appLinkClaim({ packaged: config.packaged, live: runMode.sendsNetwork });

      if (linkClaim === APP_LINK_CLAIM.CLAIM) app.setAsDefaultProtocolClient(APP_LINK_SCHEME);

      if (linkClaim === APP_LINK_CLAIM.RELEASE) app.removeAsDefaultProtocolClient(APP_LINK_SCHEME);
      app.on("second-instance", handleSecondInstance);
      app.on("activate", handleActivate);
      app.on("browser-window-focus", panelFocused);
      app.on("browser-window-blur", panelBlurred);
      screen.on("display-added", handleDisplayChange);
      screen.on("display-removed", handleDisplayChange);
      screen.on("display-metrics-changed", handleDisplayChange);
      powerMonitor.on("resume", wakeHandlers.resume);
      powerMonitor.on("unlock-screen", wakeHandlers["unlock-screen"]);
      powerMonitor.on("user-did-become-active", wakeHandlers["user-did-become-active"]);
    },
    stop: async () => {
      config.appLinks.close();
      stopRendererErrors();
      app.removeListener("second-instance", handleSecondInstance);
      app.removeListener("activate", handleActivate);
      app.removeListener("browser-window-focus", panelFocused);
      app.removeListener("browser-window-blur", panelBlurred);
      screen.removeListener("display-added", handleDisplayChange);
      screen.removeListener("display-removed", handleDisplayChange);
      screen.removeListener("display-metrics-changed", handleDisplayChange);
      powerMonitor.removeListener("resume", wakeHandlers.resume);
      powerMonitor.removeListener("unlock-screen", wakeHandlers["unlock-screen"]);
      powerMonitor.removeListener("user-did-become-active", wakeHandlers["user-did-become-active"]);

      for (const wait of pendingWaits) clearTimeout(wait);
      pendingWaits.clear();

      if (session.defaultSession.protocol.isProtocolHandled(PAGE_SCHEME)) {
        session.defaultSession.protocol.unhandle(PAGE_SCHEME);
      }

      callWindow.closeForGood();
    },
  };
}
