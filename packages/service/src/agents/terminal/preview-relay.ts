/**
 * preview-relay.ts -- the relay a shared port is served through in its sandbox: a small Node server that passes each request on to the port on the sandbox's loopback, its Host header turned to `localhost`.
 *
 * A dev server often answers only the hosts it was told of: Vite refuses
 * any other with "Blocked request. This host is not allowed", and a shared
 * port's preview reaches the sandbox at its route on Vercel's sandbox domain.
 * Every such server answers `localhost`, so the route goes to this relay
 * instead of the port itself, and the relay hands the port each request as
 * if it came from the sandbox's own loopback, a WebSocket's upgrade among
 * them. It runs detached for as long as the share stands, one at a time,
 * found again by the marker its command line carries.
 */

import type { CommandAsk } from "@repo/sandbox";

/** What marks the relay's process, so a new share or a stop ends the one before. */
const RELAY_MARKER = "vespin-preview-relay";

/** How far above the shared port its relay listens: the shared port is below it, the relay at or past it. */
const RELAY_OFFSET = 32_768;

/** The relay as Node runs it, its arguments the marker, the shared port, and the relay's own. */
const RELAY_SOURCE = `"use strict";
const http = require("node:http");
const net = require("node:net");
const port = Number(process.argv[2]);
const listen = Number(process.argv[3]);
const host = "localhost:" + port;
const server = http.createServer((req, res) => {
  const upstream = http.request(
    { host: "127.0.0.1", port, method: req.method, path: req.url, headers: { ...req.headers, host } },
    (answer) => { res.writeHead(answer.statusCode, answer.rawHeaders); answer.pipe(res); },
  );
  upstream.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  req.pipe(upstream);
});
server.on("upgrade", (req, socket, head) => {
  const upstream = net.connect(port, "127.0.0.1", () => {
    const lines = [req.method + " " + req.url + " HTTP/1.1"];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i];
      lines.push(name + ": " + (name.toLowerCase() === "host" ? host : req.rawHeaders[i + 1]));
    }
    upstream.write(lines.join("\\r\\n") + "\\r\\n\\r\\n");
    if (head.length > 0) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
});
server.listen(listen, "0.0.0.0");
`;

/** The port a shared port's relay listens on, which its route serves. */
export function relayPortOf(port: number): number {
  return port + RELAY_OFFSET;
}

/** The shared port a route's port stands for: the relay's port taken back, or the port itself for a route opened before the relay. */
export function sharedPortOf(routePort: number): number {
  return routePort >= RELAY_OFFSET ? routePort - RELAY_OFFSET : routePort;
}

/** Whether a port can be shared through a relay, whose port must be one a socket can take. */
export function relayable(port: number): boolean {
  return port < RELAY_OFFSET;
}

/** Ends whatever relay a share before left running; a sandbox with none ends nothing. */
export const STOP_RELAY: CommandAsk = {
  command: "pkill",
  // Note that the pattern brackets its first letter, so it never matches a shell that runs pkill with it.
  args: ["-f", `[${RELAY_MARKER[0]}]${RELAY_MARKER.slice(1)}`],
};

/** Starts the relay for the port, detached, as the sandbox's default user. */
export function startRelay(port: number): CommandAsk & { readonly sudo: false } {
  return {
    command: "node",
    args: ["-e", RELAY_SOURCE, RELAY_MARKER, String(port), String(relayPortOf(port))],
    sudo: false,
  };
}
