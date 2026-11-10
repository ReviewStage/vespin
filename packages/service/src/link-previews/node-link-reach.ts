/**
 * node-link-reach.ts -- how the deployment's link previews reach the web: the system resolver for the check, and a connection pinned to the checked addresses for the fetch.
 *
 * The resolver answers every address a name resolves to, so the guard sees
 * the whole set rather than the one a connection would take; a name that
 * resolves to nothing, or a resolver that fails, answers none, which the
 * guard refuses as it refuses a private address. The transport sends one
 * hop over Node's own HTTP client with a `lookup` of its own that answers
 * the checked addresses and never asks the resolver, so the socket goes
 * where the check looked and nowhere else, while the name stays the
 * server's: its TLS server name and its `Host` header are the address's
 * own host. Note that the global `fetch` is not used, because it resolves
 * the name again on its own and exposes no way to hand it a resolver. The
 * hop follows no redirect itself, sends no cookie, and reads the body
 * only up to the bound asked, ending the response there. An interrupted
 * hop, as a deadline ends one, destroys its request.
 */

import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIPv6, type LookupFunction } from "node:net";
import { Effect } from "effect";
import type { AddressResolver, HopAnswer, HopTransport } from "./link-preview-read.js";

/** The system resolver's answer for a host name, every address of it. */
const nodeAddressResolver: AddressResolver = (hostname) =>
  Effect.tryPromise(() => lookup(hostname, { all: true, verbatim: true })).pipe(
    Effect.map((found) => found.map((each) => each.address)),
    Effect.orElseSucceed((): readonly string[] => []),
  );

/** A `lookup` that answers the checked addresses alone, whatever name it is asked, as the family each is. */
function pinnedLookup(addresses: readonly string[]): LookupFunction {
  const answered = addresses.map((address) => ({ address, family: isIPv6(address) ? 6 : 4 }));
  return (_hostname, options, callback) => {
    const first = answered[0];
    if (first === undefined) {
      callback(new Error("no checked address to connect to"), "", undefined);
      return;
    }
    if (options.all === true) callback(null, answered);
    else callback(null, first.address, first.family);
  };
}

/** The response's body up to `maxBytes`, the response ended there, with whether more stood past them. */
function boundedBody(
  response: IncomingMessage,
  maxBytes: number,
  done: (answer: HopAnswer | undefined) => void,
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
        Object.entries(response.headers).map(([name, value]) => [
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
      done(undefined);
    }
  });
}

/** One hop sent over Node's HTTP client, its socket pinned to the checked addresses. */
const nodeHopTransport: HopTransport = ({ url, addresses, headers, maxBytes }) =>
  Effect.callback<HopAnswer | undefined>((resume) => {
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const request = send(
      url,
      { method: "GET", headers, lookup: pinnedLookup(addresses), servername: url.hostname },
      (response) => boundedBody(response, maxBytes, (answer) => resume(Effect.succeed(answer))),
    );
    request.on("error", () => resume(Effect.succeed(undefined)));
    request.end();
    return Effect.sync(() => request.destroy());
  });

/** How the deployment's link previews reach the web. */
export const nodeLinkReach = { resolve: nodeAddressResolver, connect: nodeHopTransport } as const;
