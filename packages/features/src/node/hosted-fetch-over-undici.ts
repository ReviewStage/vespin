/**
 * hosted-fetch-over-undici.ts -- the fetch a Node process's calls to the service go out on: one warm HTTP/2 connection per origin, every call multiplexed on it, moved to a new one at once where the old may be dead.
 *
 * Node's own fetch speaks HTTP/1.1 on a socket a call, keeps an idle one
 * four seconds, and opens another for each call made while the held reads
 * hold the rest, so a call made as a tab opens mostly paid a TCP and TLS
 * handshake, and a large answer TCP's slow start on a cold connection.
 * Here every call to an origin that speaks HTTP/2 shares one connection the
 * held reads keep warm, up to as many streams at once as the origin allows,
 * so a call costs one round trip and a burst never queues behind the holds;
 * an origin that speaks only HTTP/1.1, as behind a proxy that reads TLS, is
 * spoken to as Node's own fetch does, a socket a call.
 *
 * Note that it is undici's own fetch over undici 8, not Node's: Node's
 * bundles undici 7, whose HTTP/2 holds a connection to one stream at a time
 * unless it is told to pipeline, which would pipeline HTTP/1.1 behind the
 * holds too, and which fails every stream open on a connection an edge
 * drains with a GOAWAY, those the frame said it would answer among them.
 * Undici 8 caps HTTP/2 by the origin's own stream limit alone and finishes a
 * drained connection's streams as the frame says.
 *
 * One connection is what every call then waits on, so a connection that
 * died without a word, as one does across a Mac's sleep or a change of
 * network, would hold every call until a timeout: `reconnect` moves every
 * later call to a new connection and fails those on the old one as dropped,
 * and the reads among them are asked again at once on the new (`RETRIED`),
 * as they never got an answer; a write is not, since its caller reads a
 * failed write itself and sends it again under its key.
 *
 * Each call's span says whether it went out on a connection already used
 * and on which protocol (`CONNECTION_ATTRIBUTE`), read from the socket the
 * call's headers were sent on, never from the call itself, so no address,
 * header, or credential reaches it.
 */

import diagnostics from "node:diagnostics_channel";
import { Option, Predicate, Schema } from "effect";
import {
  Agent,
  Dispatcher,
  errors,
  interceptors,
  type RetryHandler,
  fetch as undiciFetch,
} from "undici";

/** The calls asked again where `reconnect` dropped their connection under them: the reads, which change nothing the second time. */
const RETRIED: RetryHandler.RetryOptions = {
  methods: ["GET", "HEAD"],
  /** Only a dropped connection; a status the service answered is the caller's to read. */
  errorCodes: ["UND_ERR_SOCKET", "ECONNRESET", "EPIPE"],
  statusCodes: [],
  maxRetries: 2,
  minTimeout: 0,
  timeoutFactor: 1,
};

/** What a call's span says of the connection it went out on, by the attribute names OpenTelemetry's conventions give them. */
const CONNECTION_ATTRIBUTE = {
  /** The HTTP version the connection speaks: `2` or `1.1`. */
  PROTOCOL_VERSION: "network.protocol.version",
  /** Whether the call went out on a connection an earlier call had already opened. */
  REUSED: "http.connection.reused",
} as const;

/** The protocol a connection negotiated, by its ALPN name. */
const ALPN_HTTP2 = "h2";

/** The diagnostics channel undici names each call's headers on, with the socket they were sent on. */
const SEND_HEADERS_CHANNEL = "undici:client:sendHeaders";

/** What a span is told of a connection: its attributes by name. */
interface AttributedSpan {
  readonly setAttribute: (key: string, value: string | boolean) => void;
}

/** The fetch a process's calls to the service go out on, and its connection's care. */
export interface HostedFetch {
  /** The fetch every call goes out on. */
  readonly fetch: typeof globalThis.fetch;
  /** Moves every later call to a new connection and fails those on the old one as dropped, which the reads among them ask again on the new. */
  readonly reconnect: () => void;
  /** Closes the connections, failing nothing still open. */
  readonly close: () => Promise<void>;
}

/** One origin's connections as they are opened: HTTP/2 where the origin speaks it, one connection carrying every call. */
function connectionOf(connect: Agent.Options["connect"]): Agent {
  return new Agent({ allowH2: true, ...(connect === undefined ? undefined : { connect }) });
}

/** The dispatcher every call goes out through, which hands each to the connection standing and can replace it. */
class ReplaceableDispatcher extends Dispatcher {
  #current: Agent;
  readonly #open: () => Agent;

  constructor(open: () => Agent) {
    super();
    this.#open = open;
    this.#current = open();
  }

  override dispatch(
    options: Dispatcher.DispatchOptions,
    handler: Dispatcher.DispatchHandler,
  ): boolean {
    return this.#current.dispatch(options, handler);
  }

  /** A new connection for every later call, and the old one's calls failed as dropped. */
  replace(): void {
    const old = this.#current;
    this.#current = this.#open();
    void old.destroy(new errors.SocketError("the connection was replaced")).catch(() => undefined);
  }

  override close(): Promise<void> {
    return this.#current.close();
  }

  override destroy(): Promise<void> {
    return this.#current.destroy();
  }
}

/**
 * The fetch a process's calls to the service go out on. `connect` is what
 * a connection's TLS is opened with where it is not the platform's own, as
 * a test's server with a certificate of its own asks.
 */
export function hostedFetchOverUndici(connect?: Agent.Options["connect"]): HostedFetch {
  const connections = new ReplaceableDispatcher(() => connectionOf(connect));
  const dispatcher = connections.compose(interceptors.retry(RETRIED));

  // Note that the HTTP client hands a URL and plain options, never a `Request`, whose own options would be lost here.
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : input;
    // SAFETY: undici's fetch takes the WHATWG options Node's own does, which the DOM's types name apart only by their body and header types.
    const options = { ...(init as Parameters<typeof undiciFetch>[1]), dispatcher };
    const answered: object = await undiciFetch(url, options);

    // SAFETY: undici's fetch answers a WHATWG `Response`, which its own types name apart from the DOM's.
    return answered as Response;
  };

  return { fetch, reconnect: () => connections.replace(), close: () => connections.close() };
}

/** What each call's span is told of its connection, by the call undici sent it as. */
const connectionsOfCalls = new WeakMap<
  object,
  { readonly protocol: string; readonly reused: boolean }
>();

/** The sockets a call has already gone out on. */
const socketsUsed = new WeakSet<object>();

/** What undici names as each call's headers are sent: the call, and the socket it went out on. */
const sentHeadersSchema = Schema.Struct({
  request: Schema.declare(Predicate.isObject),
  socket: Schema.declare(Predicate.isObject),
});

const decodeSentHeaders = Schema.decodeUnknownOption(sentHeadersSchema);

/** A socket that negotiated HTTP/2. */
const speaksHttp2 = Schema.is(Schema.Struct({ alpnProtocol: Schema.Literal(ALPN_HTTP2) }));

/** Notes, as each call's headers are sent, the socket it went out on: its protocol and whether an earlier call used it. */
const noteSentHeaders: diagnostics.ChannelListener = (message) => {
  const sent = decodeSentHeaders(message);

  if (Option.isNone(sent)) return;
  const { request, socket } = sent.value;
  const reused = socketsUsed.has(socket);
  socketsUsed.add(socket);
  connectionsOfCalls.set(request, { protocol: speaksHttp2(socket) ? "2" : "1.1", reused });
};

/**
 * Hears which connection each call goes out on, for `spanWithConnection` to
 * say, until the answer it returns is run.
 */
export function followConnections(): () => void {
  diagnostics.subscribe(SEND_HEADERS_CHANNEL, noteSentHeaders);

  return () => diagnostics.unsubscribe(SEND_HEADERS_CHANNEL, noteSentHeaders);
}

/** Tells a call's span the connection it went out on, as `followConnections` heard it; nothing where it heard none. */
export function spanWithConnection(span: AttributedSpan, info: { readonly request: object }): void {
  const connection = connectionsOfCalls.get(info.request);

  if (connection === undefined) return;
  span.setAttribute(CONNECTION_ATTRIBUTE.PROTOCOL_VERSION, connection.protocol);
  span.setAttribute(CONNECTION_ATTRIBUTE.REUSED, connection.reused);
}
