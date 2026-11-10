/**
 * repository-pins.ts -- the repositories an account pinned in the sidebar, read and pinned or unpinned, as every door asks for them.
 *
 * The hosted procedures (`repository-pins-procedures.ts`) and the member MCP
 * server's tools (`../member-mcp/tools.ts`) are doors over these. A pin names
 * a repository and nothing of it, so it asks GitHub nothing: a repository the
 * account no longer reaches groups no task. Every row read or written is the
 * account's own.
 */

import { listRepositoryPins, setRepositoryPin } from "@repo/database/models/repository-pin-store";
import { Effect, Option } from "effect";
import { recordServerEvent, SERVER_EVENT } from "../events/server-events.js";
import { HOSTED_REFUSAL, hostedStoreOrUnavailable } from "../http/http-effect.js";

/** The account's pins, newest pinned first. */
export const readRepositoryPins = Effect.fn("web/readRepositoryPins")(function* (userId: string) {
  return { pins: yield* hostedStoreOrUnavailable(listRepositoryPins(userId)) };
});

/** A repository pinned or unpinned, answered with the pins as they then stand and the transaction that wrote them, where it wrote one. */
export const pinRepository = Effect.fn("web/pinRepository")(function* (
  userId: string,
  repository: string,
  pinned: boolean,
) {
  const set = yield* hostedStoreOrUnavailable(setRepositoryPin(userId, repository, pinned));
  // A pin past the bound is a request the service will not keep, as a name past its bound is.
  if (Option.isNone(set)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  // Counted only where the write changed a row, which is the one that answers a transaction.
  if (set.value.txid !== undefined) {
    yield* recordServerEvent(SERVER_EVENT.REPOSITORY_PIN, { userId }, { pinned });
  }
  return set.value;
});
