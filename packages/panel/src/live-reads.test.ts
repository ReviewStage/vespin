import assert from "node:assert/strict";
import { FAILURE_FACT } from "@repo/features/failure-facts";
import { LIVE_READ } from "@repo/features/live-wire";
import {
  FAILURE_KIND,
  FAILURE_SURFACE,
  type ShownFailureSentry,
  sendShownFailure,
} from "@repo/features/shown-failure";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, test, vi } from "vitest";
import { modelsQuery } from "./live-reads.js";
import { appStateQuery } from "./use-app-state.js";

/**
 * A live read the host could not answer stays failed for every reader until
 * the host says otherwise: a reader that mounts later never sends the read
 * back to pending. Setup gates the window on the models' read, so a failed
 * read that went pending each time the app's surfaces mounted flipped the
 * window between setup and the app forever, for an account with no task.
 * A read that failed because its call got no answer is reported as the
 * network's failure, as a phone waking with a stale connection shows one,
 * rather than opening an issue. Synthetic account.
 */

const ACCOUNT_ID = "account-live-reads-test";

const clients: QueryClient[] = [];

afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
});

test("a failed live read stays failed when another reader mounts", async () => {
  const client = new QueryClient();
  clients.push(client);
  // SAFETY: the models' read reads its own slice of the document alone.
  client.setQueryData(appStateQuery.queryKey, {
    version: 1,
    [LIVE_READ.MODELS]: { [ACCOUNT_ID]: { failed: true } },
  } as never);

  const first = new QueryObserver(client, modelsQuery(ACCOUNT_ID));
  const offFirst = first.subscribe(() => undefined);
  await vi.waitFor(() => assert.equal(first.getCurrentResult().isError, true));

  const later = new QueryObserver(client, modelsQuery(ACCOUNT_ID));
  const offLater = later.subscribe(() => undefined);

  assert.equal(first.getCurrentResult().isError, true, "the first reader still reads it failed");
  assert.equal(later.getCurrentResult().isError, true, "the later reader reads it failed at once");
  offLater();
  offFirst();
});

test("a live read whose call got no answer is reported as a warning, opening no issue", async () => {
  const client = new QueryClient();
  clients.push(client);
  const cause = { _tag: FAILURE_FACT.HOSTED_UNANSWERED, fault: "network" };
  // SAFETY: the models' read reads its own slice of the document alone.
  client.setQueryData(appStateQuery.queryKey, {
    version: 1,
    [LIVE_READ.MODELS]: { [ACCOUNT_ID]: { failed: true, cause } },
  } as never);

  const observer = new QueryObserver(client, modelsQuery(ACCOUNT_ID));
  const off = observer.subscribe(() => undefined);
  await vi.waitFor(() => assert.equal(observer.getCurrentResult().isError, true));
  const warned: string[] = [];
  const captured: Error[] = [];

  const sentry: ShownFailureSentry = {
    captureException: (error) => {
      captured.push(error);

      return "event-fixture";
    },
    logger: { warn: (said) => warned.push(said), error: () => undefined },
    getActiveSpan: () => undefined,
    getCurrentScope: () => ({ getPropagationContext: () => ({ traceId: "trace-fixture" }) }),
  };

  sendShownFailure(sentry, {
    surface: FAILURE_SURFACE.AGENT_TRANSCRIPT_READ,
    kind: FAILURE_KIND.UNEXPECTED,
    cause: observer.getCurrentResult().error,
    about: {},
    state: { online: true, account: "signed-in" },
  });

  assert.deepEqual(captured, []);
  assert.deepEqual(warned, ["A failure was shown on agent_transcript.read: network"]);
  off();
});
