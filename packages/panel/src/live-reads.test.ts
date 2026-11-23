import assert from "node:assert/strict";
import { LIVE_READ } from "@repo/features/live-wire";
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
 * Synthetic account.
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
