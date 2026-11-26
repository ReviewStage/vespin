/**
 * hosted-fetch-over-undici.test.ts -- the service's calls on one HTTP/2 connection: a burst answered beside the held reads, a GOAWAY and a dead connection each costing no read and holding up no call, and a call's span told its connection.
 *
 * Over an HTTP/2 server of the test's own on loopback, with a certificate
 * minted for it, as the service's edge speaks: twelve held reads stand open
 * as the desktop's live reads do, and the calls made beside them, the
 * server's GOAWAY, and a connection that stops answering are each read
 * through what the calls answered and the connections the server saw.
 *
 * Note that the certificate is minted by `openssl`, which every CI image and
 * Mac carries, because Node mints keys but no certificates.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import diagnostics from "node:diagnostics_channel";
import { readFileSync } from "node:fs";
import {
  createSecureServer,
  type Http2SecureServer,
  type Http2Session,
  type ServerHttp2Session,
  type ServerHttp2Stream,
} from "node:http2";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { temporaryDirectory } from "@repo/wire/testing";
import { afterEach, test } from "vitest";
import {
  followConnections,
  hostedFetchOverUndici,
  spanWithConnection,
} from "./hosted-fetch-over-undici.js";

/** How many reads the desktop holds open at once, as its live reads stand. */
const HELD_READS = 12;

/** How long a held read waits before the server answers it, unless the server stops answering its connection. */
const HOLD_MS = 600;

/** The server's sessions, in the order the client opened them. */
interface Served {
  readonly origin: string;
  readonly sessions: ServerHttp2Session[];
  /** Stops answering every stream on the sessions open now, as a connection dead across a sleep does. */
  readonly silence: () => void;
  /** Settles once the server has heard `count` streams in all. */
  readonly heard: (count: number) => Promise<void>;
  readonly server: Http2SecureServer;
}

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

/** A certificate for `localhost`, minted into the test's own directory. */
async function certificateFor(t: Parameters<typeof temporaryDirectory>[0]) {
  const directory = await temporaryDirectory(t);
  const [key, cert] = [join(directory, "key.pem"), join(directory, "cert.pem")];

  execFileSync(
    "openssl",
    [
      ...["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1"],
      ...["-keyout", key, "-out", cert, "-subj", "/CN=localhost"],
      ...["-addext", "subjectAltName=DNS:localhost"],
    ],
    { stdio: "ignore" },
  );

  return { key: readFileSync(key), cert: readFileSync(cert) };
}

/** An HTTP/2 server answering `/hold…` after `HOLD_MS` and anything else at once, with its path. */
async function serving(t: Parameters<typeof temporaryDirectory>[0]): Promise<Served> {
  const sessions: ServerHttp2Session[] = [];
  const silenced = new WeakSet<Http2Session>();
  const server = createSecureServer(await certificateFor(t));
  let streams = 0;

  server.on("session", (session) => sessions.push(session));

  server.on("stream", (stream: ServerHttp2Stream, headers) => {
    const path = String(headers[":path"]);
    streams += 1;
    server.emit("heard");
    const { session } = stream;

    if (session === undefined || silenced.has(session)) return;

    const answer = () => {
      if (stream.closed) return;
      stream.respond({ ":status": 200 });
      stream.end(path);
    };

    if (path.startsWith("/hold")) setTimeout(answer, HOLD_MS);
    else answer();
  });

  await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening));
  // SAFETY: a server listening on a TCP port answers its address as one.
  const { port } = server.address() as AddressInfo;

  closers.push(
    () =>
      new Promise((closed) => {
        for (const session of sessions) session.destroy();
        server.close(() => closed());
      }),
  );

  return {
    origin: `https://localhost:${port}`,
    sessions,
    silence: () => {
      for (const session of sessions) silenced.add(session);
    },
    heard: (count) =>
      new Promise((enough) => {
        const check = () => {
          if (streams < count) return;
          server.off("heard", check);
          enough();
        };

        server.on("heard", check);
        check();
      }),
    server,
  };
}

/** The fetch under test, trusting the test's certificate, closed with the test. */
function fetching() {
  const hosted = hostedFetchOverUndici({ rejectUnauthorized: false });
  closers.unshift(() => hosted.close());

  return hosted;
}

/** What one call answered: its body, or the error it failed with, and when it settled. */
async function asked(fetch: typeof globalThis.fetch, url: string) {
  const startedAt = performance.now();

  try {
    const response = await fetch(url);

    return { body: await response.text(), ms: performance.now() - startedAt };
  } catch (error) {
    return { failed: String(error), ms: performance.now() - startedAt };
  }
}

/** Twelve held reads asked at once. */
function holding(fetch: typeof globalThis.fetch, origin: string) {
  return Promise.all(
    Array.from({ length: HELD_READS }, (_, index) => asked(fetch, `${origin}/hold-${index}`)),
  );
}

test("a burst of calls beside twelve held reads is answered at once, every call on one connection", async (t) => {
  const served = await serving(t);
  const { fetch } = fetching();

  const holds = holding(fetch, served.origin);

  const burst = await Promise.all(
    Array.from({ length: 20 }, (_, index) => asked(fetch, `${served.origin}/read-${index}`)),
  );

  assert.deepEqual(
    burst.map((call) => call.body),
    Array.from({ length: 20 }, (_, index) => `/read-${index}`),
  );
  assert.ok(Math.max(...burst.map((call) => call.ms)) < HOLD_MS, "no call waits on the holds");
  assert.equal((await holds).filter((call) => call.body !== undefined).length, HELD_READS);
  assert.equal(served.sessions.length, 1);
});

test("a GOAWAY under twelve held reads lets each finish on the drained connection, and a call after it goes out on a new one at once", async (t) => {
  const served = await serving(t);
  const { fetch } = fetching();

  const holds = holding(fetch, served.origin);
  await served.heard(HELD_READS);
  // The edge drains the connection, saying it will answer every stream it took.
  served.sessions[0]?.goaway(0, 2 ** 31 - 1);
  await new Promise((landed) => setTimeout(landed, 50));
  const after = await asked(fetch, `${served.origin}/after`);

  assert.equal(after.body, "/after");
  assert.ok(after.ms < HOLD_MS, "the call waits on none of the holds");
  assert.deepEqual(
    (await holds).map((call) => call.body),
    Array.from({ length: HELD_READS }, (_, index) => `/hold-${index}`),
  );
  assert.equal(served.sessions.length, 2);
});

test("a connection that stops answering costs no held read once it is replaced: each is asked again on a new one", async (t) => {
  const served = await serving(t);
  const { fetch, reconnect } = fetching();

  await asked(fetch, `${served.origin}/read`);
  // The connection dies across a sleep: the server hears the reads but never answers them.
  served.silence();
  const holds = holding(fetch, served.origin);
  await served.heard(1 + HELD_READS);
  reconnect();

  const answered = await holds;

  assert.deepEqual(
    answered.map((call) => call.body),
    Array.from({ length: HELD_READS }, (_, index) => `/hold-${index}`),
  );
  assert.ok(
    Math.max(...answered.map((call) => call.ms)) < HOLD_MS * 3,
    "no read waits out a timeout",
  );
});

test("a call's span says the protocol of its connection and whether an earlier call opened it", async (t) => {
  const served = await serving(t);
  const { fetch } = fetching();
  const stop = followConnections();
  const told: Array<Record<string, string | boolean>> = [];

  // The hook runs as each answer's headers land, with the call they answer, as Sentry's fetch integration calls it.
  const answered: diagnostics.ChannelListener = (message) => {
    const attributes: Record<string, string | boolean> = {};

    const span = {
      setAttribute: (key: string, value: string | boolean) => {
        attributes[key] = value;
      },
    };

    // SAFETY: undici names each answer's headers with the call they answer, which is all the hook reads.
    spanWithConnection(span, message as { request: object });
    told.push(attributes);
  };

  diagnostics.subscribe("undici:request:headers", answered);
  closers.push(async () => {
    diagnostics.unsubscribe("undici:request:headers", answered);
    stop();
  });

  await asked(fetch, `${served.origin}/first`);
  await asked(fetch, `${served.origin}/second`);

  assert.deepEqual(told, [
    { "network.protocol.version": "2", "http.connection.reused": false },
    { "network.protocol.version": "2", "http.connection.reused": true },
  ]);
});
