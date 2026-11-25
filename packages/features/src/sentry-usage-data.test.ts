/**
 * sentry-usage-data.test.ts -- Sentry's own offline transport under the usage data switch: what leaves, what is kept, and what is dropped, over an inner transport that writes down what it would have sent.
 */

import assert from "node:assert/strict";
import {
  createEnvelope,
  type Envelope,
  makeOfflineTransport,
  type OfflineStore,
  type Transport,
} from "@sentry/core";
import { afterEach, beforeEach, it, vi } from "vitest";
import { usageDataTransportOptions } from "./sentry-usage-data.js";

/** The switch as a test sets it, and what the offline transport sent, kept, and was handed. */
interface Fixture {
  readonly device: { shares: boolean | undefined };
  readonly sent: Envelope[];
  readonly kept: Envelope[];
  readonly transport: Transport;
}

/** An error event's envelope, as one a client sends. */
function report(id: string): Envelope {
  return createEnvelope({ event_id: id }, [[{ type: "event" }, { event_id: id }]]);
}

/** The events envelopes carry, by id: a retried envelope is stamped with when it was sent again. */
function ids(envelopes: readonly Envelope[]): unknown[] {
  return envelopes.map(([headers]) => headers.event_id);
}

/** Sentry's offline transport over a store in memory and an inner transport that sends nothing, gated by the switch. */
function fixture(shares: boolean | undefined): Fixture {
  const device = { shares };
  const sent: Envelope[] = [];
  const kept: Envelope[] = [];

  const store: OfflineStore = {
    push: async (envelope) => void kept.push(envelope),
    unshift: async (envelope) => void kept.unshift(envelope),
    shift: async () => kept.shift(),
  };

  const transport = makeOfflineTransport(() => ({
    send: async (envelope) => {
      sent.push(envelope);

      return { statusCode: 200 };
    },
    flush: async () => true,
  }))({
    recordDroppedEvent: () => undefined,
    createStore: () => store,
    ...usageDataTransportOptions(() => device.shares),
  });

  return { device, sent, kept, transport };
}

/** The transport trying what it kept again, as it does on its own timer. */
async function retry(state: Fixture): Promise<void> {
  void state.transport.flush();
  await vi.runAllTimersAsync();
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

it("a report made before the device's choice is read is kept, and sent once it shares", async () => {
  const state = fixture(undefined);

  await state.transport.send(report("launch"));
  assert.deepEqual([state.sent.length, state.kept.length], [0, 1]);

  state.device.shares = true;
  await retry(state);
  assert.deepEqual(ids(state.sent), ["launch"]);
  assert.deepEqual(state.kept, []);
});

it("a device that does not share sends nothing, keeps nothing, and drops what was kept before", async () => {
  const state = fixture(undefined);

  await state.transport.send(report("launch"));
  state.device.shares = false;
  await assert.rejects(Promise.resolve(state.transport.send(report("later"))));
  await retry(state);

  assert.deepEqual(state.sent, []);
  assert.deepEqual(state.kept, []);
});
