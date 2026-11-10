/**
 * compose-port-forwards.ts -- a coding agent's cloud ports forwarded to this Mac's `127.0.0.1`, on the window's behalf: forwarding read and turned on or off for one agent at a time, a loopback listener kept for each port the service detects, and each connection it accepts carried over the service's tunnel.
 *
 * How the forwarded agent's forwarding stands is told to the windows as
 * `PORT_FORWARDS_CHANGED` each time it moves, which the client lays in app
 * state (`portForwarding`); nothing reads it on a timer of its own.
 *
 * Turning forwarding on reads the agent's listening ports every few seconds
 * for as long as it is on, forwarding what already listens; nothing is
 * started or woken in the sandbox on its behalf, and a stopped sandbox reads
 * as not running until it runs; once a sandbox seen running stops,
 * forwarding is turned off, so it waits on no agent whose ports are gone.
 * Each port read is forwarded in a scope of its own
 * (`@repo/features/port-forward-tunnel`: its loopback listener, over the
 * `ListenOnLoopback` seam the desktop's launch hands over `node:net`, and
 * its tunnel); a port no longer read is let go by closing that scope, its
 * connections with it. Turning it on for another agent turns it off for the
 * first.
 *
 * The forwarded agent's port shared by public link is read from the service
 * at the first look its sandbox runs, and again at each look while one is
 * shared, so a link gone with its stopped sandbox leaves the menu with it;
 * sharing a port or closing its link sets it at once.
 */

import { type HostedAgentPortsClient, webSocketOrigin } from "@repo/features";
import {
  PORT_FORWARD_STATE,
  type PortForwarding,
  type PortForwardingAnswer,
} from "@repo/features/port-forward-acts";
import { type ForwardedPort, forwardPort } from "@repo/features/port-forward-tunnel";
import type { ListenOnLoopback, OpenTerminalSocket } from "@repo/features/relay-socket";
import { carried, GATEWAY_EVENT } from "@repo/gateway";
import { Duration, Effect, Exit, Schedule, Scope, Semaphore } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import type { PORT_FORWARD_ACTS } from "./contract/index.js";
import { ActRefused, type HostActTable } from "./host-acts.js";
import type { HOST_PLATFORM_CONCERN, PlatformConcernMethods } from "./host-concerns.js";
import type { HostKernel } from "./host-kernel.js";
import type { RunMode } from "./run-mode.js";

export const PORT_FORWARD = {
  /** How often the forwarded agent's listening ports are read while forwarding is on. */
  LOOK_EVERY: Duration.seconds(3),
} as const;

/** The service's side of the forward, as this concern asks it. */
type PortForwardClient = Pick<HostedAgentPortsClient, "list" | "share" | "unshare" | "shared">;

export interface PortForwardsDependencies {
  kernel: Pick<HostKernel, "hostedServiceBaseUrl" | "emit"> & {
    runMode: Pick<RunMode, "sendsNetwork">;
  };
  account: Pick<AccountComposer, "capabilitiesActive" | "credential">;
  client: PortForwardClient;
  openSocket: OpenTerminalSocket;
  listen: ListenOnLoopback;
}

export interface PortForwardsComposer extends Composer {
  readonly acts: HostActTable<typeof PORT_FORWARD_ACTS>;
  /** Forwarding turned off, as a sign-out turns it off. */
  readonly reset: Effect.Effect<void>;
}

/** One port forwarded, and the scope whose close lets it go. */
interface Forward {
  readonly forwarded: ForwardedPort;
  readonly scope: Scope.Closeable;
}

/** A port shared by public link, and its link. */
interface SharedLink {
  readonly port: number;
  readonly url: string;
}

/** Whether the agent's public link has been read yet. */
const SHARE_READ = {
  UNREAD: "unread",
  READ: "read",
} as const;

/** The agent's public link: not yet read, or read, with the port shared where one is. */
type ShareStanding =
  | { readonly read: typeof SHARE_READ.UNREAD }
  | { readonly read: typeof SHARE_READ.READ; readonly shared?: SharedLink };

/** The one agent forwarded, everything it began in its scope. */
interface Forwarding {
  readonly agentId: string;
  readonly scope: Scope.Closeable;
  running: boolean;
  readonly forwards: Map<number, Forward>;
  /** What serves each port, as the last read said. */
  labels: ReadonlyMap<number, string>;
  /** The port shared by public link and its link, as last read or set. */
  share: ShareStanding;
  /** How many times a share or its close set `share`, so a read begun before one does not undo it. */
  shareMoves: number;
}

/** What an agent forwarding is off for answers. */
const OFF: PortForwardingAnswer = { on: false, running: false, ports: [] };

/** The link as read or set: the port shared, or none. */
function shareRead(shared: SharedLink | null): ShareStanding {
  return shared === null ? { read: SHARE_READ.READ } : { read: SHARE_READ.READ, shared };
}

/** The forwarded agent's shared port and link, where one is known. */
function sharedLink(current: Forwarding): SharedLink | undefined {
  return current.share.read === SHARE_READ.READ ? current.share.shared : undefined;
}

export function composePortForwards(
  dependencies: PortForwardsDependencies,
): Effect.Effect<PortForwardsComposer, never, Scope.Scope | HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const { kernel, account, client, openSocket, listen } = dependencies;
    const lifetimeScope = yield* Effect.scope;
    const http = yield* HttpClient.HttpClient;
    const socketOrigin = webSocketOrigin(kernel.hostedServiceBaseUrl);
    const gate = () => kernel.runMode.sendsNetwork && account.capabilitiesActive();
    let forwarding: Forwarding | undefined;
    let toldText = JSON.stringify(null);
    // Note that turning forwarding on or off runs one at a time, because each lets the forwarded agent go across a wait and a second move in that wait would leave a scope no one closes.
    const oneAtATime = (yield* Semaphore.make(1)).withPermits(1);

    /** How the forwarded agent's forwarding stands, told to the windows where it moved since it was last told. */
    const tell = Effect.sync(() => {
      const told: PortForwarding =
        forwarding === undefined
          ? null
          : { agentId: forwarding.agentId, ...standing(forwarding.agentId) };
      const text = JSON.stringify(told);
      if (text === toldText) return;
      toldText = text;
      kernel.emit(GATEWAY_EVENT.PORT_FORWARDS_CHANGED, carried(told));
    });

    const withHttp = <A, E>(call: Effect.Effect<A, E, HttpClient.HttpClient>) =>
      Effect.provideService(call, HttpClient.HttpClient, http);

    /** One port forwarded in a scope of its own under the agent's: its listener, and its tunnel as connections ask for it. */
    const forwarded = (current: Forwarding, port: number) =>
      Effect.gen(function* () {
        const scope = yield* Scope.fork(current.scope);
        const forwarded = yield* Scope.provide(
          forwardPort(
            { socketOrigin, credential: account.credential, openSocket, listen },
            { agentId: current.agentId, port },
            tell,
          ),
          scope,
        );
        return { forwarded, scope } satisfies Forward;
      });

    /** One read of the agent's ports, the forwards made to follow it: each port read forwarded, and each no longer read let go. */
    const look = (current: Forwarding) =>
      Effect.gen(function* () {
        const answer = yield* withHttp(client.list(current.agentId));
        if ("failure" in answer) return;
        // Note that a sandbox seen running and now stopped ends the forward, so the next agent may take the ports, and the release is forked because it closes the scope this read runs in.
        if (current.running && !answer.running) {
          yield* Effect.forkIn(released(current), lifetimeScope);
          return;
        }
        current.running = answer.running;
        current.labels = new Map((answer.labels ?? []).map(({ port, label }) => [port, label]));
        const read = new Set(answer.ports);
        for (const [port, forward] of current.forwards) {
          if (read.has(port)) continue;
          current.forwards.delete(port);
          yield* Scope.close(forward.scope, Exit.void);
        }
        for (const port of answer.ports) {
          if (!current.forwards.has(port))
            current.forwards.set(port, yield* forwarded(current, port));
        }
        if (
          answer.running &&
          (current.share.read === SHARE_READ.UNREAD || sharedLink(current) !== undefined)
        ) {
          const moves = current.shareMoves;
          const read = yield* withHttp(client.shared(current.agentId));
          if (!("failure" in read) && moves === current.shareMoves)
            current.share = shareRead(read.shared);
        }
        yield* tell;
      });

    /** The ending agent's public link closed, a close the service refuses logged rather than holding forwarding on. */
    const unshared = (ending: Forwarding) =>
      Effect.gen(function* () {
        if (sharedLink(ending) === undefined) return;
        const answer = yield* withHttp(client.unshare(ending.agentId));
        if ("failure" in answer)
          yield* Effect.logWarning(
            `port-forwards: a shared link was not closed (${answer.failure})`,
          );
      });

    /**
     * Forwarding turned off, its public link closed with it only where
     * `closeLink` asks: forwarding turned off keeps the link, which the
     * plug's menu still lists and can stop, while a sign-out closes it,
     * since nothing on this Mac could stop it after.
     */
    const letGo = (closeLink: boolean) =>
      Effect.suspend(() => {
        const ending = forwarding;
        forwarding = undefined;
        return ending === undefined
          ? Effect.void
          : (closeLink ? unshared(ending) : Effect.void).pipe(
              Effect.andThen(Scope.close(ending.scope, Exit.void)),
              Effect.andThen(tell),
            );
      });
    /** Forwarding let go for the agent, unless another agent has taken it since. */
    const turnOff = (agentId: string) =>
      oneAtATime(
        Effect.suspend(() => (forwarding?.agentId === agentId ? letGo(false) : Effect.void)),
      );

    /** Forwarding let go for the forward it was on, unless another has taken it since. */
    const released = (current: Forwarding) =>
      oneAtATime(Effect.suspend(() => (forwarding === current ? letGo(false) : Effect.void)));

    /** Forwarding started for the agent, and whichever agent was forwarded before let go. */
    const turnOn = (agentId: string) =>
      Effect.gen(function* () {
        if (forwarding?.agentId === agentId) return;
        yield* letGo(false);
        const current: Forwarding = {
          agentId,
          scope: yield* Scope.fork(lifetimeScope),
          running: false,
          forwards: new Map(),
          labels: new Map(),
          share: { read: SHARE_READ.UNREAD },
          shareMoves: 0,
        };
        forwarding = current;
        yield* tell;
        yield* Effect.forkIn(
          Effect.repeat(look(current), Schedule.spaced(PORT_FORWARD.LOOK_EVERY)),
          current.scope,
        );
      }).pipe(oneAtATime);

    /** How the agent's forwarding stands, its ports the lowest first. */
    const standing = (agentId: string): PortForwardingAnswer => {
      if (forwarding?.agentId !== agentId) return OFF;
      const forwards = [...forwarding.forwards.values()]
        .map((forward) => forward.forwarded)
        .sort((a, b) => a.port - b.port);
      const { labels } = forwarding;
      const shared = sharedLink(forwarding);
      return {
        on: true,
        running: forwarding.running,
        ...(shared === undefined ? {} : { shared }),
        ports: forwards.map((forward) => {
          const label = labels.get(forward.port);
          const served = label === undefined ? {} : { label };
          if (forward.localPort === undefined) {
            return { port: forward.port, state: PORT_FORWARD_STATE.UNAVAILABLE, ...served };
          }
          const state = forward.connected
            ? PORT_FORWARD_STATE.CONNECTED
            : PORT_FORWARD_STATE.LISTENING;
          return { port: forward.port, localPort: forward.localPort, state, ...served };
        }),
      };
    };

    const methods: PlatformConcernMethods<typeof HOST_PLATFORM_CONCERN.PORT_FORWARDS> = {};
    const acts: HostActTable<typeof PORT_FORWARD_ACTS> = {
      PORT_FORWARD_SET: ({ agentId, on }) =>
        Effect.gen(function* () {
          if (!on) {
            yield* turnOff(agentId);
            return standing(agentId);
          }
          // Note that a signed-out host refuses in the act's own sentence, as the Gateway's refusal of its method was drawn.
          if (!gate()) return yield* Effect.fail(new ActRefused({}));
          yield* turnOn(agentId);
          return standing(agentId);
        }),
      PORT_SHARE_SET: ({ agentId, port }) =>
        Effect.gen(function* () {
          const current = forwarding;
          if (current?.agentId !== agentId || !gate())
            return yield* Effect.fail(new ActRefused({}));
          if (port === null) {
            const answer = yield* withHttp(client.unshare(agentId));
            if ("failure" in answer) return yield* Effect.fail(new ActRefused({}));
            current.share = shareRead(null);
          } else {
            const answer = yield* withHttp(client.share(agentId, port));
            if ("failure" in answer) return yield* Effect.fail(new ActRefused({}));
            current.share = shareRead({ port, url: answer.url });
          }
          current.shareMoves++;
          yield* tell;
          return standing(agentId);
        }),
    };

    return { methods, acts, lifetime: Effect.void, reset: oneAtATime(letGo(true)) };
  });
}
