/**
 * fake-probe.ts -- a scripted provider probe for the runner's tests: it answers after a set number of refusals, or never, and counts what the runner asked of it.
 *
 * It stands at the one door the runner opens a socket through
 * (`reconnect.ts`'s `ProviderProbe`), so a test sees how many times the host
 * was probed and where, and moves the test clock through the waits between
 * probes rather than opening any socket.
 */

import { Effect, Layer } from "effect";
import { type ProbeTarget, ProviderProbe, Unreachable } from "../reconnect.js";

/** What the probe was asked, in the order it was asked. */
interface ProbeRecord {
  readonly targets: ProbeTarget[];
}

/**
 * A probe refused `refusals` times, then answered; one refused for good
 * where `refusals` is `Number.POSITIVE_INFINITY`.
 */
export function fakeProbe(refusals = 0) {
  const record: ProbeRecord = { targets: [] };
  const layer = Layer.succeed(ProviderProbe, {
    reach: (target) =>
      Effect.suspend(() => {
        record.targets.push(target);
        return record.targets.length > refusals
          ? Effect.void
          : Effect.fail(new Unreachable({ target }));
      }),
  });
  return { layer, record };
}
