/**
 * node-address-resolver.ts -- the addresses a host name resolves to, asked of the system's resolver, for the deployment's link previews.
 *
 * Every address the name resolves to is answered, so the guard sees the
 * whole set rather than the one the connection would take; a name that
 * resolves to nothing, or a resolver that fails, answers none, which the
 * guard refuses as it refuses a private address.
 */

import { lookup } from "node:dns/promises";
import { Effect } from "effect";
import type { AddressResolver } from "./link-preview-read.js";

/** The system resolver's answer for a host name, every address of it. */
export const nodeAddressResolver: AddressResolver = (hostname) =>
  Effect.tryPromise(() => lookup(hostname, { all: true, verbatim: true })).pipe(
    Effect.map((found) => found.map((each) => each.address)),
    Effect.orElseSucceed((): readonly string[] => []),
  );
