/**
 * events.test.ts -- the runner's event sink against a fake events route that refuses a body past its bound, as the service does: what a turn of large tool answers emits still reaches it, in order, its pictures kept apart.
 */

import assert from "node:assert/strict";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { it } from "@effect/vitest";
import { Effect, Redacted } from "effect";
import { openEventSink } from "./events.js";
import { IMAGE_MEDIA_TYPE, RUNNER_EVENTS_MAX_BYTES } from "./protocol.js";
import { makeFakeService } from "./testing/fake-service.js";

const EVENTS_URL = "https://app.test/runner/events";
const PICTURES_URL = "https://app.test/runner/pictures";
const FIRST_SEQUENCE = 1;

/** A third of the route's bound, so three answers of it pass the bound together but not alone. */
const THIRD_OF_BOUND = Math.ceil(RUNNER_EVENTS_MAX_BYTES / 3);

/** A tool's answer as the SDK hands it on: its words, then the pictures it read, as a PDF's pages read, from the agent's own turn or a subagent's. */
function toolAnswer(
  id: string,
  text: string,
  pictures: readonly string[],
  parent: string | null = null,
): SDKUserMessage {
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
    parent_tool_use_id: parent,
    session_id: "session",
  };
}

/** The messages emitted posted through a sink and drained, and what the fake route applied of them. */
function posted(messages: readonly SDKUserMessage[]) {
  return Effect.gen(function* () {
    const service = makeFakeService({
      url: EVENTS_URL,
      firstSequence: FIRST_SEQUENCE,
      picturesUrl: PICTURES_URL,
    });

    yield* Effect.gen(function* () {
      const sink = yield* openEventSink({
        url: EVENTS_URL,
        picturesUrl: PICTURES_URL,
        bearer: Redacted.make("runner-bearer"),
        firstSequence: FIRST_SEQUENCE,
        secrets: [],
      });

      for (const message of messages) yield* sink.emit(message);
      yield* sink.drain;
    }).pipe(Effect.scoped, Effect.provide(service.layer));

    return { applied: service.applied, pictures: service.pictures };
  });
}

it.effect("posts events whose batch passes the route's bound, every one in order", () =>
  Effect.gen(function* () {
    const answers = ["a", "b", "c"].map((id) => toolAnswer(id, id.repeat(THIRD_OF_BOUND), []));
    const { applied } = yield* posted(answers);

    assert.deepEqual(
      applied.map(({ sequence }) => sequence),
      [1, 2, 3],
    );
  }),
);

// Cameron's case (STAG-3834): a subagent's Read of a scanned PDF's pages 1-20, twenty JPEG pages of about 4.26 MB in one answer.
it.effect(
  "posts a tool's answer whose pictures alone pass the route's bound, each picture kept apart and named in its place",
  () =>
    Effect.gen(function* () {
      // Each page's base64 is 213,016 characters, its bytes three quarters of that, and no two pages alike.
      const pages = Array.from(
        { length: 20 },
        (_, index) => `/9j/${"A".repeat(213_008)}${String(index).padStart(4, "0")}`,
      );

      const answer = toolAnswer(
        "toolu_read",
        "PDF pages extracted: 20 page(s)",
        pages,
        "toolu_agent",
      );

      const { applied, pictures } = yield* posted([answer]);

      assert.deepEqual(
        pictures.map((bytes) => bytes.byteLength),
        pages.map(() => 159_762),
      );

      assert.deepEqual(
        applied.map(({ message }) => message),
        [
          {
            type: "user",
            message: {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "toolu_read",
                  content: [
                    { type: "text", text: "PDF pages extracted: 20 page(s)" },
                    ...pages.map((_, index) => ({
                      type: "image",
                      keptPicture: { id: `picture-${index + 1}`, byteCount: 159_762 },
                    })),
                  ],
                },
              ],
            },
            parent_tool_use_id: "toolu_agent",
            session_id: "session",
          },
        ],
      );
    }),
);

it.effect("posts a tool's answer whose words alone pass the route's bound, cut short", () =>
  Effect.gen(function* () {
    const words = `build log\n${"x".repeat(RUNNER_EVENTS_MAX_BYTES)}`;
    const { applied } = yield* posted([toolAnswer("toolu_bash", words, [])]);
    const posted0 = JSON.stringify(applied[0]?.message);

    assert.equal(applied.length, 1);
    assert.ok(posted0.includes("build log") && posted0.length < RUNNER_EVENTS_MAX_BYTES);
  }),
);
