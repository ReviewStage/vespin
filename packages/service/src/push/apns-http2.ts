/**
 * apns-http2.ts -- the APNs transport over Node's own HTTP/2 client: one connection per gateway, kept for the life of the layer.
 *
 * Apple serves pushes over HTTP/2 alone, and asks that a connection be kept
 * open and reused rather than opened per notification
 * (https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns),
 * so one session per gateway is held on the layer, which the runtime builds
 * once per function instance, and every send on that instance shares it;
 * the layer's scope closes them. A session Apple ends, by an error, a
 * `GOAWAY`, or a close, leaves the map at once, so the next send opens a
 * fresh one instead of writing into a dead socket. The Web `fetch` a Vercel
 * function carries speaks HTTP/1.1 to an origin, which is why this is
 * `node:http2` rather than the runtime's `HttpClient`; a Vercel Node
 * function may open any outbound connection, HTTP/2 among them.
 *
 * One send is one request on the session, answered with its status and
 * body, or failed with the error's name where the stream errored, the
 * session failing mid-flight among them, or timed out
 * (`APNS_REQUEST_TIMEOUT`), which cancels the stream.
 */

import { type ClientHttp2Session, connect, constants } from "node:http2";
import { Effect, Layer } from "effect";
import {
  APNS_REQUEST_TIMEOUT,
  type ApnsAnswer,
  type ApnsRequest,
  ApnsTransport,
  ApnsTransportFailure,
} from "./apns.js";

const { HTTP2_HEADER_METHOD, HTTP2_HEADER_PATH, HTTP2_HEADER_STATUS, NGHTTP2_CANCEL } = constants;

/** The transport over Node's HTTP/2 client, its sessions closed with the layer. */
export const apnsHttp2Transport: Layer.Layer<ApnsTransport> = Layer.effect(
  ApnsTransport,
  Effect.gen(function* () {
    const sessions = new Map<string, ClientHttp2Session>();

    /** The session to the gateway, the one held while it stands, or a fresh one. */
    const sessionFor = (host: string): ClientHttp2Session => {
      const held = sessions.get(host);

      if (held !== undefined && !held.closed && !held.destroyed) return held;
      const session = connect(`https://${host}:443`);

      const forget = () => {
        if (sessions.get(host) === session) sessions.delete(host);
      };

      session.on("error", forget);
      session.on("goaway", forget);
      session.on("close", forget);
      sessions.set(host, session);

      return session;
    };

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const session of sessions.values()) session.close();
        sessions.clear();
      }),
    );

    const send = (request: ApnsRequest) =>
      Effect.callback<ApnsAnswer, ApnsTransportFailure>((resume) => {
        const stream = sessionFor(request.host).request({
          [HTTP2_HEADER_METHOD]: "POST",
          [HTTP2_HEADER_PATH]: request.path,
          ...request.headers,
        });

        let status = 0;
        const chunks: Buffer[] = [];
        stream.on("response", (headers) => {
          status = Number(headers[HTTP2_HEADER_STATUS] ?? 0);
        });
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", () =>
          resume(Effect.succeed({ status, body: Buffer.concat(chunks).toString("utf8") })),
        );
        // A session failing mid-flight surfaces on its streams as well, so the stream's error is the one place a send fails from.
        stream.on("error", (cause: unknown) =>
          resume(
            Effect.fail(
              new ApnsTransportFailure({
                errorName: cause instanceof Error ? cause.name : undefined,
              }),
            ),
          ),
        );
        stream.end(request.body);

        return Effect.sync(() => stream.close(NGHTTP2_CANCEL));
      }).pipe(
        Effect.timeoutOrElse({
          duration: APNS_REQUEST_TIMEOUT,
          orElse: () => Effect.fail(new ApnsTransportFailure({ errorName: "Timeout" })),
        }),
      );

    return { send };
  }),
);
