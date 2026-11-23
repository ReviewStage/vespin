/**
 * events.test.ts -- the runner's event sink against a fake events route that refuses a body past its bound, as the service does: what a turn of large tool answers emits still reaches it, in order.
 */

import assert from "node:assert/strict";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { it } from "@effect/vitest";
import { Effect, Redacted } from "effect";
import { openEventSink } from "./events.js";
import { IMAGE_MEDIA_TYPE, RUNNER_EVENTS_MAX_BYTES } from "./protocol.js";
import { makeFakeService } from "./testing/fake-service.js";

const EVENTS_URL = "https://app.test/runner/events";
const FIRST_SEQUENCE = 1;

/** A third of the route's bound, so three answers of it pass the bound together but not alone. */
const THIRD_OF_BOUND = Math.ceil(RUNNER_EVENTS_MAX_BYTES / 3);

/** A tool's answer as the SDK hands it on: its words, then the pictures it read, as a PDF's pages read. */
function toolAnswer(id: string, text: string, pictures: readonly string[]): SDKUserMessage {
  return {
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: id,
          content: [
            { type: "text", text },
            ...pictures.map((data) => ({
              type: "image" as const,
              source: { type: "base64" as const, media_type: IMAGE_MEDIA_TYPE.JPEG, data },
            })),
          ],
        },
      ],
    },
    parent_tool_use_id: null,
    session_id: "session",
  };
}

/** The messages emitted posted through a sink and drained, and what the fake route applied of them. */
function posted(messages: readonly SDKUserMessage[]) {
  return Effect.gen(function* () {
    const service = makeFakeService({ url: EVENTS_URL, firstSequence: FIRST_SEQUENCE });

    yield* Effect.gen(function* () {
      const sink = yield* openEventSink({
        url: EVENTS_URL,
        bearer: Redacted.make("runner-bearer"),
        firstSequence: FIRST_SEQUENCE,
        secrets: [],
      });

      for (const message of messages) yield* sink.emit(message);
      yield* sink.drain;
    }).pipe(Effect.scoped, Effect.provide(service.layer));

    return service.applied;
  });
}

it.effect("posts events whose batch passes the route's bound, every one in order", () =>
  Effect.gen(function* () {
    const answers = ["a", "b", "c"].map((id) => toolAnswer(id, id.repeat(THIRD_OF_BOUND), []));
    const applied = yield* posted(answers);

    assert.deepEqual(
      applied.map(({ sequence }) => sequence),
      [1, 2, 3],
    );
  }),
);

it.effect("posts a tool's answer whose pictures alone pass the route's bound", () =>
  Effect.gen(function* () {
    const pages = Array.from({ length: 4 }, () => "/9j/".repeat(Math.floor(THIRD_OF_BOUND / 4)));
    const applied = yield* posted([toolAnswer("pdf", "PDF pages extracted: 4 page(s)", pages)]);

    assert.equal(applied.length, 1);
    assert.ok(JSON.stringify(applied[0]?.message).includes("PDF pages extracted"));
  }),
);
