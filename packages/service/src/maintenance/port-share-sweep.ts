/**
 * port-share-sweep.ts -- the scheduled sweep's close of a shared port's link no one has visited for its idle bound, and its touch of the sandbox while visits come.
 *
 * A shared sandbox carries the share's tag (`agents/terminal/port-share.ts`),
 * which the sweep lists by, one page a minute. A running one's last visit is
 * read from its helper's folder: past the idle bound, the share is closed as
 * the developer's own close does; within it, the sandbox is touched, as a
 * forwarded port's traffic touches it. A stopped one is left until it runs again, when its old visit
 * closes it. What is logged of a failure is the sandbox's own words.
 */

import {
  isSandboxError,
  type ListedSandbox,
  SANDBOX_STATUS,
  Sandbox,
  type SandboxService,
  touchSandbox,
} from "@repo/sandbox";
import { Duration, Effect, Result } from "effect";
import { PORT_SHARE, readSharedPort, unsharePort } from "../agents/terminal/port-share.js";

/** How many shared sandboxes are read at once. */
const CONCURRENCY = 5;

/** One shared sandbox swept: its share closed where it went idle, answering whether it was, or its sandbox touched. */
const sweptShare = (api: SandboxService, sandbox: ListedSandbox, now: Date) =>
  Effect.gen(function* () {
    if (sandbox.status !== SANDBOX_STATUS.RUNNING || sandbox.running === undefined) return false;
    const running = { name: sandbox.name, running: sandbox.running };
    const visitedAt = (yield* readSharedPort(api, running))?.visitedAt ?? 0;
    if (now.getTime() - visitedAt >= Duration.toMillis(PORT_SHARE.IDLE)) {
      yield* unsharePort(api, sandbox, running);
      return true;
    }
    yield* touchSandbox(sandbox.name);
    return false;
  }).pipe(
    Effect.catchIf(isSandboxError, (failure) =>
      Effect.as(Effect.logWarning(`a shared port was not swept: ${failure.message}`), false),
    ),
  );

/** Closes the shared ports' links idle past the bound and touches the rest, answering how many closed. */
export const sweepPortShares = /* @__PURE__ */ Effect.fn("web/sweepPortShares")(function* (
  now: Date,
): Effect.fn.Return<number, never, Sandbox> {
  const api = yield* Sandbox;
  const listed = yield* Effect.result(api.listTagged(PORT_SHARE.TAG, PORT_SHARE.TAG_ON));
  if (Result.isFailure(listed)) {
    yield* Effect.logWarning(`the shared sandboxes were not listed: ${listed.failure.message}`);
    return 0;
  }
  const closed = yield* Effect.forEach(listed.success, (sandbox) => sweptShare(api, sandbox, now), {
    concurrency: CONCURRENCY,
  });
  return closed.filter(Boolean).length;
});
