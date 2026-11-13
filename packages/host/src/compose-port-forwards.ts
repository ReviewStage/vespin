/**
 * compose-port-forwards.ts -- a coding agent's cloud ports forwarded to this Mac's `127.0.0.1`, on the window's behalf: one port at a time forwarded or let go, for one agent at a time, a loopback listener kept for each such port the service detects, and each connection it accepts carried over the service's tunnel.
 *
 * How the forwarded agent's forwarding stands is told to the windows as
 * `PORT_FORWARDS_CHANGED` each time it moves, which the client lays in app
 * state (`portForwarding`); nothing reads it on a timer of its own.
 *
 * Forwarding a port reads the agent's listening ports at once, so the act
 * answers with the port's local address where it already listens, and
 * every few seconds after for as long as any of the agent's ports is
 * forwarded; nothing is started or woken in the sandbox on its behalf, and a
 * stopped sandbox reads as not running until it runs; once a sandbox seen
 * running stops, forwarding is turned off, so it waits on no agent whose
 * ports are gone. Of the ports read, only the ones the developer asked for
 * are forwarded, each in a scope of its own
 * (`@repo/features/port-forward-tunnel`: its loopback listener, over the
 * `ListenOnLoopback` seam the desktop's launch hands over `node:net`, and
 * its tunnel); the rest are told as `OFF`, and a port let go, or no longer
 * read, is closed with that scope, its connections with it. A chosen port
 * a read no longer lists is no longer chosen, so a server that stops is
 * opened again with Open. Letting the last one go, or a read that leaves
 * none chosen, turns the agent's forwarding off, so it never stands on with
 * nothing forwarded; and forwarding a port of another agent turns it off
 * for the first. Every read and every act runs
 * one at a time, so two never forward one port twice.
 *
 * The forwarded agent's port shared by public link is read from the service
 * at each look while its sandbox runs, so a link shared from elsewhere (the
 * popover's own Share before forwarding began, or another window) shows, and
 * one gone with its stopped sandbox leaves the menu with it; sharing a port
 * or closing its link sets it at once.
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
  /** The ports the developer asked to reach this Mac; only these are forwarded. */
  readonly chosen: Set<number>;
  /** The ports the last read listed, forwarded or not. */
  listed: readonly number[];
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

/** Whether the agent's forwarding should end: its sandbox stopped, or no chosen port is left. */
function ends(current: Forwarding): boolean {
  return !current.running || current.chosen.size === 0;
}

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
    // Note that every read and act runs one at a time, because each moves the forwards across a wait and a second move in that wait would forward a port twice or leave a scope no one closes.
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

    /**
     * One read of the agent's ports, the forwards made to follow it: each
     * chosen port read forwarded, and each no longer read or chosen let go.
     * It answers whether the agent's forwarding should end: its sandbox, seen
     * running, stopped, or no chosen port is left.
     */
    const look = (current: Forwarding) =>
      Effect.gen(function* () {
        const answer = yield* withHttp(client.list(current.agentId));

        if ("failure" in answer) return false;

        // Note that a sandbox seen running and now stopped ends the forward, so the next agent may take the ports.
        if (current.running && !answer.running) {
          current.running = false;

          return true;
        }

        current.running = answer.running;
        current.listed = answer.ports;
        current.labels = new Map((answer.labels ?? []).map(({ port, label }) => [port, label]));
        const read = new Set(answer.ports);

        for (const port of [...current.chosen]) {
          if (!read.has(port)) current.chosen.delete(port);
        }

        for (const port of [...current.forwards.keys()]) {
          if (!read.has(port) || !current.chosen.has(port)) yield* letPortGo(current, port);
        }

        for (const port of answer.ports) {
          if (current.chosen.has(port) && !current.forwards.has(port))
            current.forwards.set(port, yield* forwarded(current, port));
        }

        if (answer.running) {
          const moves = current.shareMoves;
          const read = yield* withHttp(client.shared(current.agentId));

          if (!("failure" in read) && moves === current.shareMoves)
            current.share = shareRead(read.shared);
        }

        yield* tell;

        return ends(current);
      });

    /** One port's forward closed, its connections with it. */
    const letPortGo = (current: Forwarding, port: number) =>
      Effect.suspend(() => {
        const forward = current.forwards.get(port);
        current.forwards.delete(port);

        return forward === undefined ? Effect.void : Scope.close(forward.scope, Exit.void);
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

    const turnOff = letGo(false);

    /**
     * Forwarding let go for the agent it was on, unless another agent has
     * taken it since. Note that it asks again whether the forward ends,
     * because an Open that took the permit first may have forwarded a port
     * of a running sandbox since the read that asked for the release.
     */
    const released = (current: Forwarding) =>
      oneAtATime(
        Effect.suspend(() => (forwarding === current && ends(current) ? turnOff : Effect.void)),
      );

    /**
     * The agent's forwarding, started where it was not, whichever agent was
     * forwarded before let go. Note that its reads repeat after a wait,
     * because the act that started it reads once itself.
     */
    const turnOn = (agentId: string) =>
      Effect.gen(function* () {
        if (forwarding?.agentId === agentId) return forwarding;
        yield* turnOff;

        const current: Forwarding = {
          agentId,
          scope: yield* Scope.fork(lifetimeScope),
          running: false,
          chosen: new Set(),
          listed: [],
          forwards: new Map(),
          labels: new Map(),
          share: { read: SHARE_READ.UNREAD },
          shareMoves: 0,
        };

        forwarding = current;

        // Note that a read ending the forward forks its release, because the release closes the scope this read runs in.
        const followed = oneAtATime(look(current)).pipe(
          Effect.flatMap((ended) =>
            ended ? Effect.asVoid(Effect.forkIn(released(current), lifetimeScope)) : Effect.void,
          ),
        );

        yield* Effect.forkIn(
          Effect.sleep(PORT_FORWARD.LOOK_EVERY).pipe(
            Effect.andThen(Effect.repeat(followed, Schedule.spaced(PORT_FORWARD.LOOK_EVERY))),
          ),
          current.scope,
        );

        return current;
      });

    /** How the agent's forwarding stands, its ports the lowest first, each forwarded or `OFF`. */
    const standing = (agentId: string): PortForwardingAnswer => {
      if (forwarding?.agentId !== agentId) return OFF;
      const { labels, forwards, listed } = forwarding;
      const shared = sharedLink(forwarding);
      const ports = [...new Set([...listed, ...forwards.keys()])].sort((a, b) => a - b);

      return {
        on: true,
        running: forwarding.running,
        ...(shared !== undefined && { shared }),
        ports: ports.map((port) => {
          const label = labels.get(port);
          const served = label === undefined ? {} : { label };
          const forward = forwards.get(port)?.forwarded;

          if (forward === undefined) return { port, state: PORT_FORWARD_STATE.OFF, ...served };

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
      PORT_FORWARD_SET: ({ agentId, port, on }) =>
        oneAtATime(
          Effect.gen(function* () {
            if (!on) {
              const current = forwarding;

              if (current?.agentId !== agentId) return standing(agentId);
              current.chosen.delete(port);
              yield* letPortGo(current, port);
              yield* current.chosen.size === 0 ? turnOff : tell;

              return standing(agentId);
            }

            // Note that a signed-out host refuses in the act's own sentence, as the Gateway's refusal of its method was drawn.
            if (!gate()) return yield* Effect.fail(new ActRefused({}));
            const current = yield* turnOn(agentId);
            current.chosen.add(port);
            yield* look(current);

            // Note that a port the read did not forward is not kept chosen, and a sandbox the read found stopped ends the forward, so forwarding never stands on with nothing to stop or answers an address gone with its sandbox.
            if (!current.forwards.has(port)) current.chosen.delete(port);
            yield* ends(current) ? turnOff : tell;

            return standing(agentId);
          }),
        ),
      PORT_SHARE_SET: ({ agentId, port }) =>
        oneAtATime(
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
        ),
    };

    return { methods, acts, lifetime: Effect.void, reset: oneAtATime(letGo(true)) };
  });
}
