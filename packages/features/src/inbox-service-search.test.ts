import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";
import {
  type AgentInboxSearchAnswer,
  type AgentInboxSearchParams,
  INBOX_SEARCH_PAUSE_MILLIS,
  INBOX_SEARCH_PLACE,
  inboxServiceSearch,
} from "./inbox-service-search.js";

/** A host's act whose every ask is kept, each answered only when the test says so. */
function heldAsks() {
  const asks: { params: AgentInboxSearchParams; answer: (to: AgentInboxSearchAnswer) => void }[] =
    [];

  const ask = (params: AgentInboxSearchParams) =>
    new Promise<AgentInboxSearchAnswer>((resolve) => {
      asks.push({ params, answer: resolve });
    });

  return { asks, ask };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test("a run of keys asks once, for its last words, after the pause; one letter asks nothing", () => {
  const { asks, ask } = heldAsks();
  const search = inboxServiceSearch({ place: INBOX_SEARCH_PLACE.INBOX, ask });

  search.type("r");
  vi.advanceTimersByTime(INBOX_SEARCH_PAUSE_MILLIS * 2);
  assert.deepEqual(asks, []);
  assert.equal(search.searching(), false);

  for (const typed of ["ro", "rou", "roun", "round"]) {
    search.type(typed);
    vi.advanceTimersByTime(INBOX_SEARCH_PAUSE_MILLIS - 1);
  }

  assert.deepEqual(asks, []);
  assert.equal(search.searching(), true);
  vi.advanceTimersByTime(1);

  assert.deepEqual(
    asks.map(({ params }) => params),
    [{ place: INBOX_SEARCH_PLACE.INBOX, query: "round" }],
  );
});

test("an answer to older words, replaced or found, leaves the search waiting on the newer ones", async () => {
  const { asks, ask } = heldAsks();
  const search = inboxServiceSearch({ place: INBOX_SEARCH_PLACE.EVERYTHING, ask });

  search.type("cent");
  vi.advanceTimersByTime(INBOX_SEARCH_PAUSE_MILLIS);
  search.type("cents");
  vi.advanceTimersByTime(INBOX_SEARCH_PAUSE_MILLIS);
  asks[0]?.answer({ replaced: true });
  await vi.runAllTimersAsync();

  assert.equal(search.searching(), true);
  asks[1]?.answer({ failure: "unanswered" });
  await vi.runAllTimersAsync();

  assert.equal(search.searching(), false);
});

test("clearing the words lets the place go once, and a search ended starts afresh", async () => {
  const { asks, ask } = heldAsks();
  const search = inboxServiceSearch({ place: INBOX_SEARCH_PLACE.INBOX, ask });

  search.type("half");
  vi.advanceTimersByTime(INBOX_SEARCH_PAUSE_MILLIS);
  search.type("");
  search.end();
  search.type("half");
  vi.advanceTimersByTime(INBOX_SEARCH_PAUSE_MILLIS);

  assert.deepEqual(
    asks.map(({ params }) => params),
    [
      { place: INBOX_SEARCH_PLACE.INBOX, query: "half" },
      { place: INBOX_SEARCH_PLACE.INBOX },
      { place: INBOX_SEARCH_PLACE.INBOX, query: "half" },
    ],
  );
});

test("a search left asks nothing more and lets nothing go, so what it found stands for a thread opened from it", () => {
  const { asks, ask } = heldAsks();
  const search = inboxServiceSearch({ place: INBOX_SEARCH_PLACE.EVERYTHING, ask });

  search.type("ledger");
  vi.advanceTimersByTime(INBOX_SEARCH_PAUSE_MILLIS);
  search.type("ledger close");
  search.leave();
  vi.advanceTimersByTime(INBOX_SEARCH_PAUSE_MILLIS);

  assert.deepEqual(
    asks.map(({ params }) => params),
    [{ place: INBOX_SEARCH_PLACE.EVERYTHING, query: "ledger" }],
  );
  assert.equal(search.searching(), false);
});
