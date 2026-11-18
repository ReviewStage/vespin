import assert from "node:assert/strict";
import { createORPCClient } from "@orpc/client";
import { os } from "@orpc/server";
import { Context } from "effect";
import { afterEach, it } from "vitest";
import type { ActPortContext } from "./base.js";
import { type InProcessChannel, inProcessChannel, sameProcessLink } from "./in-process-channel.js";
import { ACT_PORT_CROSSING, actPortHandlerOf } from "./index.js";

/**
 * The act port as the iOS app opens it, both ends in one process and each
 * message handed across as the object itself: a call carrying a photo's
 * worth of base64 reaches the host whole, and an answer carrying one comes
 * back whole, as a reply's photo goes out and a thread's picture is read,
 * each as the plain objects reading it back from text made.
 */

/** A photo's bytes as a reply carries them, about 3 MB of base64. */
const PHOTO = "/9j/".padEnd(3_000_000, "A");

const opened: InProcessChannel[] = [];

afterEach(() => {
  for (const channel of opened.splice(0)) {
    channel.port1.close();
    channel.port2.close();
  }
});

/** What the echo answers: the input it held, and whether it was a plain object. */
interface Echoed {
  readonly held: { readonly base64: string };
  readonly plain: boolean;
}

/** A port whose one procedure answers with what it was handed, and whether it was handed a plain object, so a call and its answer both cross. */
const echo = os.$context<ActPortContext<symbol>>().handler(({ input }) => ({
  held: input,
  plain: Object.getPrototypeOf(input) === Object.prototype,
}));

it("a call and its answer each carry a photo's base64 whole across the app's act port, as plain objects", async () => {
  const channel = inProcessChannel();
  opened.push(channel);

  actPortHandlerOf({ echo }, ACT_PORT_CROSSING.SAME_PROCESS).upgrade(channel.port2, {
    context: () => ({
      actor: { sender: Symbol("screens"), panel: true },
      trusted: true,
      "effect/context": Context.empty(),
    }),
  });

  channel.port2.start();
  const link = sameProcessLink(channel.port1);
  channel.port1.start();

  const client = createORPCClient<{
    echo: (input: { readonly base64: string }) => Promise<Echoed>;
  }>(link);

  const answer = await client.echo({ base64: PHOTO });

  // Note that a strict deep equal holds each object's prototype to a plain object's too, as reading the answer back from text made it.
  assert.deepEqual(answer, { held: { base64: PHOTO }, plain: true });
});
