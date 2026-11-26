/**
 * fake-service.ts -- a fake of the service's events route for the runner's tests: it applies each sequence at most once, as the real route does, and answers each post as the test scripted; and of its pictures route, which keeps every picture posted to it.
 */

import assert from "node:assert/strict";
import { type FakeResponder, fakeHttpClientLayer } from "@repo/wire/testing";
import { Deferred, Exit } from "effect";
import {
  RUNNER_EVENTS_MAX_BYTES,
  type RunnerEvent,
  type RunnerPictureAnswer,
} from "../protocol.js";

/** How a fake events route answers one post: take it, fail as a server, or fail before answering. */
export const ANSWER = {
  TAKE: "take",
  SERVER_ERROR: "server_error",
  TAKE_THEN_FAIL: "take_then_fail",
  UNREACHABLE: "unreachable",
  REFUSE: "refuse",
} as const;

export type Answer = (typeof ANSWER)[keyof typeof ANSWER];

/**
 * A fake of the service's events route at `url`, numbering from `firstSequence`. A batch
 * posted again changes nothing; each post is answered as the next of
 * `answers` says, then every later one is taken; `seen` settles once an
 * applied message holds `watchFor`. `bodies` keeps every post's body as it
 * crossed the wire, for a test of what the runner never sends. A picture
 * posted to `picturesUrl` is kept, in order, in `pictures`, and answered as
 * the real route answers what it kept, named by its place there.
 */
export function makeFakeService(options: {
  readonly url: string;
  readonly firstSequence: number;
  readonly answers?: readonly Answer[] | undefined;
  readonly watchFor?: string | undefined;
  readonly picturesUrl?: string | undefined;
}) {
  const answers = options.answers ?? [];
  const applied: RunnerEvent[] = [];
  const bearers: (string | null)[] = [];
  const bodies: string[] = [];
  const pictures: Uint8Array[] = [];
  let posts = 0;
  const seen = Deferred.makeUnsafe<void>();

  const respond: FakeResponder = async (url, init) => {
    if (url === options.picturesUrl) {
      const bytes = new Uint8Array(await new Response(init.body).arrayBuffer());
      pictures.push(bytes);
      const picture = { id: `picture-${pictures.length}`, byteCount: bytes.byteLength };

      return Response.json({ picture } satisfies RunnerPictureAnswer);
    }

    assert.equal(url, options.url);
    bearers.push(new Headers(init.headers).get("authorization"));
    const answer = answers[posts] ?? ANSWER.TAKE;
    posts += 1;

    if (answer === ANSWER.UNREACHABLE) throw new Error("connection reset");

    if (answer === ANSWER.REFUSE) return new Response(null, { status: 401 });

    if (answer === ANSWER.SERVER_ERROR) return new Response(null, { status: 503 });
    const body = String(init.body);

    // A body past the route's bound is refused for good, as the real route refuses it.
    if (Buffer.byteLength(body) > RUNNER_EVENTS_MAX_BYTES) {
      return new Response(null, { status: 413 });
    }

    bodies.push(body);
    const batch: { events: RunnerEvent[] } = JSON.parse(body);
    const last = applied.at(-1)?.sequence ?? options.firstSequence - 1;

    for (const event of batch.events) {
      if (event.sequence <= last) continue;
      applied.push(event);
      const watchFor = options.watchFor;

      if (watchFor !== undefined && JSON.stringify(event.message).includes(watchFor)) {
        Deferred.doneUnsafe(seen, Exit.void);
      }
    }

    return new Response(null, { status: answer === ANSWER.TAKE_THEN_FAIL ? 500 : 204 });
  };

  return {
    layer: fakeHttpClientLayer(respond),
    respond,
    applied,
    bearers,
    bodies,
    pictures,
    posts: () => posts,
    seen: Deferred.await(seen),
  };
}
