import assert from "node:assert/strict";
import { test } from "vitest";
import { FAILURE_FACT } from "./failure-facts.js";
import {
  FAILURE_CONDITION,
  FAILURE_KIND,
  FAILURE_SURFACE,
  type ShownFailureSentry,
  sendShownFailure,
} from "./shown-failure.js";

/**
 * shown-failure.test.ts -- a failure nothing named, shown while the machine
 * had no network or whose own facts say its call got no answer, is a log
 * line at `warn` and opens no issue, as a Mac waking from sleep offline shows
 * its task list unread, or a phone that reads online with no signal shows its
 * inbox unread. One shown online whose cause names and says nothing opens an
 * issue titled by where it was shown and its code. A recording SDK stands in
 * for Sentry. Synthetic throughout.
 */

const SIGNED_IN = "signed-in";

/** An SDK that keeps what it is sent. */
function recordingSentry() {
  const warned: string[] = [];
  const errored: string[] = [];
  const captured: Error[] = [];

  const sentry: ShownFailureSentry = {
    captureException: (error) => {
      captured.push(error);

      return "event-fixture";
    },
    logger: { warn: (said) => warned.push(said), error: (said) => errored.push(said) },
    getActiveSpan: () => undefined,
    getCurrentScope: () => ({ getPropagationContext: () => ({ traceId: "trace-fixture" }) }),
  };

  return { sentry, warned, errored, captured };
}

test.each([
  {
    shown: "offline",
    state: { online: false, account: SIGNED_IN },
    cause: FAILURE_CONDITION.UNREAD,
    line: "A failure was shown on home_tasks.read: unread",
  },
  {
    shown: "online, of a call that ended in a network fault",
    state: { online: true, account: SIGNED_IN },
    cause: {
      failure: "unanswered",
      cause: { _tag: FAILURE_FACT.HOSTED_UNANSWERED, fault: "network", errorName: "TypeError" },
    },
    line: "A failure was shown on home_tasks.read: unanswered",
  },
  {
    shown: "online, of a call that ran past its deadline",
    state: { online: true, account: SIGNED_IN },
    cause: {
      failure: "unanswered",
      cause: { _tag: FAILURE_FACT.HOSTED_UNANSWERED, errorName: "TimeoutError" },
    },
    line: "A failure was shown on home_tasks.read: unanswered",
  },
])(
  "an unexpected failure shown $shown sends a warning line and opens no issue",
  ({ state, cause, line }) => {
    const { sentry, warned, errored, captured } = recordingSentry();

    const sent = sendShownFailure(sentry, {
      surface: FAILURE_SURFACE.HOME_TASKS_READ,
      kind: FAILURE_KIND.UNEXPECTED,
      cause,
      about: {},
      state,
    });

    assert.deepEqual(warned, [line]);
    assert.deepEqual(errored, []);
    assert.deepEqual(captured, []);
    assert.deepEqual(sent, { traceId: "trace-fixture" });
  },
);

test("an issue whose cause names and says nothing is titled by where it was shown and its code", () => {
  const { sentry, captured } = recordingSentry();

  sendShownFailure(sentry, {
    surface: FAILURE_SURFACE.AGENT_TURN,
    kind: FAILURE_KIND.UNEXPECTED,
    cause: FAILURE_CONDITION.UNREAD,
    about: {},
    state: { online: true, account: SIGNED_IN },
  });

  // Sentry titles an issue `${name}: ${message}` from the error it captured.
  assert.deepEqual(
    captured.map((error) => `${error.name}: ${error.message}`),
    ["agent.turn: unread"],
  );
});
