/**
 * node-link-reach.ts -- how the deployment's link previews reach the web: one hop over Node's HTTPS client through an agent that refuses any socket to an address inside a network.
 *
 * The agent (`request-filtering-agent`) checks the address a socket is
 * about to be made to, a literal host as it stands and a name as the
 * resolver answers it inside the connection, and refuses every address
 * that is not a public unicast one: private, loopback, link-local (the
 * cloud metadata address among it), carrier-grade NAT, unique-local,
 * multicast, reserved, unspecified, and an IPv4 carried inside an IPv6
 * address. Because the check is the connection's own, a resolver that
 * answers one address to a check and another to the connection (DNS
 * rebinding) has nothing to rebind. Note that the global `fetch` is not
 * used, because it takes no agent. The hop follows no redirect itself,
 * sends no cookie, and reads the body only up to the bound asked, ending
 * the response there. An interrupted hop, as a deadline ends one,
 * destroys its request.
 */

import type { IncomingMessage } from "node:http";
import { request } from "node:https";
import { Effect } from "effect";
import { RequestFilteringHttpsAgent } from "request-filtering-agent";
import { HOP_FAILURE, type HopAnswer, type HopTransport } from "./link-preview-read.js";

/** The one agent every hop goes through, refusing every address but a public unicast one. */
const agent = new RequestFilteringHttpsAgent({ keepAlive: false });

/** What the agent says of an address it refused, which no other failure of a request says. */
const REFUSED_BY_AGENT = /is not allowed/u;

/** The response's body up to `maxBytes`, the response ended there, with whether more stood past them. */
function boundedBody(
  response: IncomingMessage,
  maxBytes: number,
  done: (answer: HopAnswer | typeof HOP_FAILURE.UNREAD) => void,
): void {
  const chunks: Buffer[] = [];
  let total = 0;
  let settled = false;
  const settle = (cut: boolean) => {
    if (settled) return;
    settled = true;
    const whole = Buffer.concat(chunks, Math.min(total, maxBytes));
    done({
      status: response.statusCode ?? 0,
      headers: Object.fromEntries(
        Object.entries(response.headers).map(([name, value]): [string, string | undefined] => [
          name,
          Array.isArray(value) ? value.join(", ") : value,
        ]),
      ),
      bytes: new Uint8Array(whole.buffer, whole.byteOffset, whole.byteLength),
      cut,
    });
  };
  response.on("data", (chunk: Buffer) => {
    total += chunk.byteLength;
    chunks.push(chunk);
    if (total > maxBytes) {
      settle(true);
      response.destroy();
    }
  });
  response.on("end", () => settle(false));
  response.on("error", () => {
    if (!settled) {
      settled = true;
      done(HOP_FAILURE.UNREAD);
    }
  });
}

/** One hop sent over Node's HTTPS client through the filtering agent: its answer, refused where the agent refused the address, unread where anything else failed. */
export const nodeLinkReach: HopTransport = ({ url, headers, maxBytes }) =>
  Effect.callback<HopAnswer | typeof HOP_FAILURE.REFUSED | typeof HOP_FAILURE.UNREAD>((resume) => {
    const sent = request(url, { method: "GET", headers, agent }, (response) =>
      boundedBody(response, maxBytes, (answer) => resume(Effect.succeed(answer))),
    );
    sent.on("error", (error: Error) =>
      resume(
        Effect.succeed(
          REFUSED_BY_AGENT.test(error.message) ? HOP_FAILURE.REFUSED : HOP_FAILURE.UNREAD,
        ),
      ),
    );
    sent.end();
    return Effect.sync(() => sent.destroy());
  });
