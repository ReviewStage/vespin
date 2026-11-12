/**
 * port-forward-tunnel.ts -- one cloud port forwarded to this machine's `127.0.0.1`: its loopback listener, and each connection it accepts carried over the service's tunnel.
 *
 * The port is listened on at `127.0.0.1` (the `ListenOnLoopback` seam the
 * platform hands over `node:net`), on the same port where it is free and on
 * the next free one where it is not, or on the one local port the caller
 * names and none other; the scope it is forwarded in holds the listener, and
 * its close lets the port go, its connections with it.
 *
 * Its tunnel is one relay socket (`sandbox-tunnel-wire.ts`) opened under the
 * account's credential (`relay-credential.ts`) when the first connection is
 * accepted, every later connection a channel on it. A socket that closes,
 * idle, the sandbox stopped, or the relay function's bound, closes the
 * connections it carried; the listener stays, and the next connection it
 * accepts opens the socket again. That lazy open is the whole of
 * reconnecting: nothing is retried on a schedule. No byte a connection
 * carries is read beyond its channel's frame, kept, logged, or counted.
 *
 * The desktop host forwards an agent's ports through this as its windows
 * ask (`@repo/host`'s `compose-port-forwards.ts`), and the CLI as its
 * command asks; which ports, and how the forward is told, are theirs.
 */

import { EXCESS_KEYS, unparsedWire } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { Deferred, Effect, Result, Schema, type Scope, Stream } from "effect";
import { Base64 } from "effect/encoding";
import type { CallCredential } from "./account-call.js";
import { portForwardAddress } from "./agent-ports-client.js";
import { openedUnderCredential } from "./relay-credential.js";
import type {
  ListenOnLoopback,
  LoopbackConnection,
  OpenTerminalSocket,
  TerminalSocket,
} from "./relay-socket.js";
import {
  FORWARD_PORT,
  TUNNEL_FRAME,
  type TunnelFrame,
  tunnelFrameSchema,
} from "./sandbox-tunnel-wire.js";

/** How many local ports, from the sandbox's own up, are tried before a port is given up. */
const LOCAL_PORT_TRIES = 20;

/** What a port's forward is carried over: the service's socket origin, the account's credential, and the platform's socket and listener. */
export interface PortForwardTunnelDependencies {
  /** The service's socket origin; none where the service has none, so no tunnel opens. */
  readonly socketOrigin: string | undefined;
  readonly credential: CallCredential;
  readonly openSocket: OpenTerminalSocket;
  readonly listen: ListenOnLoopback;
}

/** The sandbox port to forward, and the one local port to listen on where the caller names it rather than taking the next free. */
export interface ForwardTarget {
  readonly agentId: string;
  readonly port: number;
  readonly localPort?: number;
}

/** One port forwarded: the local port it is listened on, if any, and whether its tunnel stands open now. */
export interface ForwardedPort {
  readonly port: number;
  readonly localPort: number | undefined;
  readonly connected: boolean;
}

/** One port's open tunnel: its socket, and the connections it carries, by channel. */
interface Tunnel {
  readonly socket: TerminalSocket;
  readonly channels: Map<number, LoopbackConnection>;
  nextChannel: number;
}

/** A forward as it moves: its tunnel, open or opening, where it has one. */
interface Forward {
  readonly agentId: string;
  readonly port: number;
  readonly scope: Scope.Scope;
  tunnel: Deferred.Deferred<Tunnel | undefined> | undefined;
  connected: boolean;
}

const readFrame = readEither(Schema.fromJsonString(tunnelFrameSchema), {
  excess: EXCESS_KEYS.DROP,
});

/** A channel frame as the text the relay reads, its bytes base64-encoded. */
function frameText(frame: TunnelFrame): string {
  return JSON.stringify(
    frame.type === TUNNEL_FRAME.DATA ? { ...frame, data: Base64.encode(frame.data) } : frame,
  );
}

/** A text frame the relay sent: a channel's bytes written to its connection, or its close ending it. */
function heard(tunnel: Tunnel, text: string): Effect.Effect<void> {
  const frame = Result.getOrUndefined(readFrame(unparsedWire(text)));
  const connection = frame === undefined ? undefined : tunnel.channels.get(frame.channel);

  if (frame === undefined || connection === undefined) return Effect.void;

  if (frame.type === TUNNEL_FRAME.DATA) return connection.write(frame.data);

  if (frame.type !== TUNNEL_FRAME.CLOSE) return Effect.void;
  tunnel.channels.delete(frame.channel);

  return connection.close;
}

/** The local port named, or else the first from the sandbox's own up, that listens, and what it accepts; nothing where none tried is free. */
function listened(listen: ListenOnLoopback, target: ForwardTarget) {
  return Effect.gen(function* () {
    const first = target.localPort ?? target.port;

    const last =
      target.localPort === undefined
        ? Math.min(first + LOCAL_PORT_TRIES - 1, FORWARD_PORT.MAX)
        : first;

    for (let localPort = first; localPort <= last; localPort++) {
      const accepted = yield* listen(localPort);

      if (accepted !== undefined) return { localPort, accepted };
    }

    return undefined;
  });
}

/**
 * One port of the agent's sandbox forwarded for the scope's life: listened
 * on locally, and each connection accepted carried on a channel of its
 * tunnel. `moved` runs each time the tunnel opens or closes, so the caller
 * can tell how the forward stands.
 */
export function forwardPort(
  dependencies: PortForwardTunnelDependencies,
  target: ForwardTarget,
  moved: Effect.Effect<void>,
): Effect.Effect<ForwardedPort, never, Scope.Scope> {
  const { socketOrigin, credential, openSocket, listen } = dependencies;

  /** One port's socket from its open until it closes, every connection it carried closed with it. */
  const tunneled = (forward: Forward, opened: Deferred.Deferred<Tunnel | undefined>) => {
    let tunnel: Tunnel | undefined;

    const ended = Effect.suspend(() => {
      forward.tunnel = undefined;
      forward.connected = false;
      const held = [...(tunnel?.channels.values() ?? [])];
      tunnel?.channels.clear();

      return Effect.andThen(
        Deferred.succeed(opened, undefined),
        Effect.andThen(
          Effect.forEach(held, (connection) => connection.close, { discard: true }),
          moved,
        ),
      );
    });

    const open = Effect.gen(function* () {
      if (socketOrigin === undefined) return;

      const address = portForwardAddress(socketOrigin, {
        agentId: forward.agentId,
        port: forward.port,
      });

      const opening = yield* openedUnderCredential(credential, openSocket, address);

      if (!("socket" in opening)) return;
      const standing: Tunnel = { socket: opening.socket, channels: new Map(), nextChannel: 0 };
      tunnel = standing;
      forward.connected = true;
      yield* moved;
      yield* Deferred.succeed(opened, standing);
      yield* Stream.runForEach(opening.socket.arrivals, (arrival) =>
        "text" in arrival ? heard(standing, arrival.text) : Effect.void,
      );
    });

    return Effect.ensuring(Effect.scoped(open), ended);
  };

  /** The port's tunnel: the one open or opening, or one opened now; nothing where it would not open. */
  const tunnelOf = (forward: Forward) =>
    Effect.suspend(() => {
      if (forward.tunnel !== undefined) return Deferred.await(forward.tunnel);
      const opened = Deferred.makeUnsafe<Tunnel | undefined>();
      forward.tunnel = opened;

      return Effect.andThen(
        Effect.forkIn(tunneled(forward, opened), forward.scope),
        Deferred.await(opened),
      );
    });

  /** One accepted connection carried on a channel of its port's tunnel until either side ends it. */
  const carry = (forward: Forward, connection: LoopbackConnection) =>
    Effect.gen(function* () {
      const tunnel = yield* tunnelOf(forward);

      if (tunnel === undefined) return yield* connection.close;
      const channel = tunnel.nextChannel++;
      tunnel.channels.set(channel, connection);
      const send = (frame: TunnelFrame) => tunnel.socket.send({ text: frameText(frame) });
      yield* send({ type: TUNNEL_FRAME.OPEN, channel });
      yield* Stream.runForEach(connection.received, (data) =>
        tunnel.channels.has(channel)
          ? send({ type: TUNNEL_FRAME.DATA, channel, data })
          : Effect.void,
      );

      // Note that a channel the relay closed first is gone already, so nothing more is said of it.
      if (tunnel.channels.delete(channel)) yield* send({ type: TUNNEL_FRAME.CLOSE, channel });
    });

  return Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const bound = yield* listened(listen, target);

    const forward: Forward = {
      agentId: target.agentId,
      port: target.port,
      scope,
      tunnel: undefined,
      connected: false,
    };

    if (bound !== undefined) {
      yield* Effect.forkIn(
        Stream.runForEach(bound.accepted, (connection) =>
          Effect.forkIn(carry(forward, connection), scope),
        ),
        scope,
      );
    }

    return {
      port: target.port,
      localPort: bound?.localPort,
      get connected() {
        return forward.connected;
      },
    };
  });
}
