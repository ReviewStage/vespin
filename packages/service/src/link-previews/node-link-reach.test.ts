import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { HOP_FAILURE } from "./link-preview-read.js";
import { nodeLinkReach } from "./node-link-reach.js";

/**
 * node-link-reach.test.ts -- the deployment's transport refuses a socket
 * to an address inside a network as the socket is made: a loopback,
 * private, link-local, or metadata address, in IPv4 or IPv6, mapped or
 * not, the unspecified address, and a name that resolves to one, each
 * answered as refused with no byte sent. The refusal is the filtering
 * agent's own, so this holds that the library stays in the connection's
 * path and keeps refusing what the guard it replaced refused. Each address
 * is a literal, or `localhost`, which the machine resolves without the
 * network.
 */

/** One hop to `href`, as a page's read would send it. */
function hopTo(href: string) {
  return nodeLinkReach({ url: new URL(href), headers: { accept: "text/html" }, maxBytes: 1_000 });
}

it.effect.each([
  { name: "a loopback name", href: "https://localhost/admin" },
  { name: "a loopback IPv4 address", href: "https://127.0.0.1/" },
  { name: "a loopback IPv6 address", href: "https://[::1]/" },
  { name: "a private IPv4 address", href: "https://10.0.0.5/" },
  { name: "a private IPv4 address in 172.16/12", href: "https://172.31.255.1/" },
  { name: "a private IPv4 address in 192.168/16", href: "https://192.168.1.1/" },
  { name: "a carrier-grade NAT address", href: "https://100.64.0.1/" },
  { name: "the cloud metadata address", href: "https://169.254.169.254/latest/meta-data/" },
  { name: "the cloud metadata address in IPv6", href: "https://[fd00:ec2::254]/latest/meta-data/" },
  { name: "a private IPv4 address mapped into IPv6", href: "https://[::ffff:10.0.0.1]/" },
  { name: "a link-local IPv6 address", href: "https://[fe80::1]/" },
  { name: "the unspecified address", href: "https://0.0.0.0/" },
])("$name is refused as the socket is made", ({ href }) =>
  Effect.gen(function* () {
    const answer = yield* hopTo(href);

    assert.equal(answer, HOP_FAILURE.REFUSED);
  }),
);
