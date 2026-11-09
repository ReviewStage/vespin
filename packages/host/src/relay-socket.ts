import type { Effect, Scope, Stream } from "effect";

/**
 * relay-socket.ts -- the sockets the host's relays carry bytes over: a relay socket the terminals, port forwards, mirrors, and browser live view open, and a connection a loopback listener accepts.
 *
 * Each composer opens these through a seam the platform provides
 * (`effect/seams.ts`), so their shapes stand below every composer and seam
 * that names them rather than in the one composer that first needed them.
 */

/** What one relay socket hands up: a binary frame's bytes, a text frame, or the close code that ended it, last. */
export type TerminalSocketArrival =
  | { readonly bytes: Uint8Array }
  | { readonly text: string }
  | { readonly close: number };

/** What the host sends on a relay socket: typed bytes, or a text frame. */
export type TerminalSocketFrame = { readonly bytes: Uint8Array } | { readonly text: string };

/** An open relay socket: what arrives on it, ending with its close, and what the host does with it. */
export interface TerminalSocket {
  readonly arrivals: Stream.Stream<TerminalSocketArrival>;
  send(frame: TerminalSocketFrame): Effect.Effect<void>;
  /** Stops reading the network until `resume`, so the far side holds what it has not sent. */
  readonly pause: Effect.Effect<void>;
  readonly resume: Effect.Effect<void>;
}

/** How an open ended: the socket, the status the upgrade was refused with, or nothing that answered. */
export type TerminalSocketOpening =
  | { readonly socket: TerminalSocket }
  | { readonly refused: number }
  | { readonly unreachable: true };

/** Opens one relay socket with the handshake headers given; the scope's close closes it. */
export type OpenTerminalSocket = (
  url: string,
  headers: Readonly<Record<string, string>>,
) => Effect.Effect<TerminalSocketOpening, never, Scope.Scope>;

/** One TCP connection a loopback listener accepted. */
export interface LoopbackConnection {
  /** What the connection's far side sent, ending once it closes. */
  readonly received: Stream.Stream<Uint8Array>;
  write(bytes: Uint8Array): Effect.Effect<void>;
  /** Ends the connection once what was written is flushed. */
  readonly close: Effect.Effect<void>;
}

/** Listens on this Mac's `127.0.0.1` at the port given for the scope's life: the connections it accepts, or nothing where the port is taken. */
export type ListenOnLoopback = (
  port: number,
) => Effect.Effect<Stream.Stream<LoopbackConnection> | undefined, never, Scope.Scope>;
