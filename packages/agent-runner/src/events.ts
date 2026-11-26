/**
 * events.ts -- the runner's way out: every message numbered in the order it was emitted, and posted to the service in batches, in order, retried until the service takes it.
 *
 * One sender fiber posts one batch at a time, so a batch never overtakes the
 * one before it, and a batch that fails is posted again whole with the same
 * numbers, which the service applies at most once. Everything emitted while a post
 * is in flight waits in the queue and goes in the next batch, so a stream of
 * partial messages costs a post per round trip rather than per token. A batch
 * whose body would pass what the service takes (`RUNNER_EVENTS_MAX_BYTES`)
 * goes as several posts, in order. No event carries a picture's bytes: each
 * picture is kept apart at the service's pictures route and named in its
 * place (`RUNNER_KEPT_PICTURE_KEY`), and no event carries more words than one
 * post may (`EVENT_WORDS_MAX`), so no answer, however large, ends the launch;
 * a batch the service still refuses as too large or unreadable is logged
 * and skipped, and the launch goes on. Beside
 * the sender, a heartbeat posts a batch with no events every
 * `RUNNER_HEARTBEAT` for as long as the launch runs, once each, since the
 * next is never far, so the service touches the sandbox through a harness's
 * long silence; it stops as the sink drains.
 */

import { WireValueSchema } from "@repo/wire";
import {
  Cause,
  Data,
  Duration,
  Effect,
  Fiber,
  Option,
  Predicate,
  Queue,
  Redacted,
  Schedule,
  Schema,
  type Scope,
} from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import {
  RUNNER_EVENTS_MAX_BYTES,
  RUNNER_HEARTBEAT,
  RUNNER_KEPT_PICTURE_KEY,
  type RunnerEvent,
  type RunnerMessage,
  type RunnerPictureAnswer,
} from "./protocol.js";

/** The most events one post carries. */
const BATCH_MAX = 256;

/**
 * How long the sender waits after a post the service did not take: the first wait,
 * doubling on each failure, up to the longest, each spread by jitter so the
 * launches an outage cut off together do not all post again in step. There is
 * no count after which it gives up: a launch that holds its run posts for as
 * long as it runs, and only the service refusing it (a status that never changes by
 * waiting) or the device stopping it ends it.
 */
const POST_RETRY = {
  FIRST: Duration.millis(250),
  LONGEST: Duration.seconds(30),
} as const;

const POST_BACKOFF = Schedule.exponential(POST_RETRY.FIRST).pipe(
  Schedule.jittered,
  Schedule.modifyDelay(({ duration }) =>
    Effect.succeed(Duration.min(duration, POST_RETRY.LONGEST)),
  ),
);

/**
 * How long one post waits on the service's answer before it is let go as a failure
 * to retry: the heartbeat's own bound, so a connection a sleep or a network
 * change left half open cannot hold the sender for good.
 */
const POST_TIMEOUT = Duration.millis(RUNNER_HEARTBEAT.TIMEOUT_MS);

/**
 * How long `drain` waits for the last events after the launch was stopped
 * before it lets them go: one post's own bound, so a Stop ends the runner
 * promptly through an outage rather than after it.
 */
const STOP_DRAIN = POST_TIMEOUT;

/** The statuses that say the service may take the same batch later: its own failure, a timeout, or a limit. */
const TRANSIENT_STATUS = new Set([408, 429]);
const SERVER_ERROR = 500;

/**
 * The statuses that say the service will never take this batch, though it
 * would take the next: its body is past the route's bound, or not a batch
 * it can read. Such a batch is skipped, never the launch ended for it.
 */
const BATCH_REFUSED_STATUS = new Set([400, 413]);

const HTTP_OK = 200;

/** A post the service did not take. `transient` is whether posting it again may succeed; `batchRefused` is whether the service refused this batch alone (`BATCH_REFUSED_STATUS`). */
export class EventsUndelivered extends Data.TaggedError("EventsUndelivered")<{
  readonly transient: boolean;
  readonly batchRefused?: boolean;
  readonly detail: string;
}> {}

/**
 * Where a launch's events go, as whom, from which number, the secrets no
 * event may carry, and where its pictures are kept apart: none where the
 * service named no pictures route, and every picture's bytes are left out.
 */
interface SinkOptions {
  readonly url: string;
  readonly bearer: Redacted.Redacted;
  readonly firstSequence: number;
  readonly secrets: readonly Redacted.Redacted[];
  readonly picturesUrl?: string | undefined;
}

export interface EventSink {
  /** Numbers a message and queues it for the service. */
  readonly emit: (message: RunnerMessage) => Effect.Effect<void>;
  /** Takes no more messages and waits until every queued one is posted, or the service refused them for good. */
  readonly drain: Effect.Effect<void, EventsUndelivered>;
  /** `drain` for a launch the service stopped: waits at most one post's bound for the last events, then lets them go. */
  readonly drainStopped: Effect.Effect<void, EventsUndelivered>;
  /** Settles only if the service refuses a post for good, with why: it will not hear anything more from this launch. */
  readonly undelivered: Effect.Effect<EventsUndelivered>;
  /** Adds a secret the launch came to hold, such as a refreshed token, to those no batch from now on carries. */
  readonly withhold: (secret: Redacted.Redacted) => Effect.Effect<void>;
}

/** What a secret is replaced with wherever an event carried it. */
const REDACTED = "[redacted]";

/** What inline bytes are replaced with in an event where they were not kept apart. */
const BYTES_LEFT_OUT = "";

/**
 * The most bytes of words one event carries, so an event alone always fits
 * a post with room to spare for its keys and JSON's escapes
 * (`RUNNER_EVENTS_MAX_BYTES`). The words past it are cut, in the order the
 * event holds them, so a tool's answer as the model read it is kept ahead
 * of the harness's own copy beside it.
 */
const EVENT_WORDS_MAX = RUNNER_EVENTS_MAX_BYTES / 2;

/** The longest words never cut, so the short words that say what an event is (its `type`, an id) always stand as they were. */
const WORDS_KEPT_WHOLE = 1024;

/** A value as it crosses to the service: JSON's own shapes. */
type Json = string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json };

type JsonObject = { readonly [key: string]: Json };

/** A block that carries bytes inline: the block with them left out, and its picture's base64 where it is a picture. */
interface InlineBytes {
  readonly leftOut: JsonObject;
  readonly picture?: string;
}

/** What keeps a picture apart from the events: what the service kept, to name in its place, or nothing where it kept none. */
type KeepPicture = (data: string) => Effect.Effect<Option.Option<Json>>;

/** The `type` of an image or document block's source that carries its bytes inline, as the Messages API spells it. */
const BASE64_SOURCE = "base64";

const isImageMediaType = (value: Json | undefined): boolean =>
  Predicate.isString(value) && value.startsWith("image/");

const isJsonObject = (value: Json | undefined): value is JsonObject =>
  Predicate.isObject(value) && !Array.isArray(value);

/**
 * Every block shape a harness carries bytes inline in, as one list: the
 * picture to keep apart where the block is a picture, and the block with its
 * bytes left out in every case. Note that a block's bytes are left out
 * however large they are, because the service reads none of them.
 * - The Messages API's image and document blocks, as Claude Code's answers
 *   carry them (`{ type, source: { type: "base64", media_type, data } }`).
 * - MCP's image content, as Codex's MCP results carry it (`{ type: "image", data, mimeType }`).
 * - Codex's generated image (`{ type: "imageGeneration", result }`).
 * - Claude Code's raw Read result of an image or a whole PDF (`tool_use_result.file`: `{ base64, originalSize, … }`).
 */
function inlineBytesOf(block: JsonObject): InlineBytes | undefined {
  const { source } = block;

  if (isJsonObject(source) && source.type === BASE64_SOURCE && Predicate.isString(source.data)) {
    const leftOut = { ...block, source: { ...source, data: BYTES_LEFT_OUT } };

    return isImageMediaType(source.media_type) ? { leftOut, picture: source.data } : { leftOut };
  }

  if (
    block.type === "image" &&
    Predicate.isString(block.data) &&
    isImageMediaType(block.mimeType)
  ) {
    return { leftOut: { ...block, data: BYTES_LEFT_OUT }, picture: block.data };
  }

  if (block.type === "imageGeneration" && Predicate.isString(block.result)) {
    return { leftOut: { ...block, result: BYTES_LEFT_OUT } };
  }

  if (Predicate.isString(block.base64) && Predicate.isNumber(block.originalSize)) {
    return { leftOut: { ...block, base64: BYTES_LEFT_OUT } };
  }

  return undefined;
}

/** A text with every secret taken out. */
function redactedText(text: string, secrets: readonly string[]): string {
  return secrets.reduce((scrubbing, secret) => scrubbing.replaceAll(secret, REDACTED), text);
}

/** Words cut to `room` bytes, marked with how many were left out. */
function cutWords(text: string, room: number): string {
  const bytes = Buffer.from(text, "utf8");

  // Note that a character the cut splits decodes as a replacement, which is dropped.
  const kept = bytes
    .subarray(0, room)
    .toString("utf8")
    .replace(/\uFFFD$/, "");

  return `${kept}…[${bytes.byteLength - room} bytes left out]`;
}

/**
 * One event's walk: the secrets to take out of it, how its pictures are
 * kept apart, and the bytes of words it may still carry.
 */
class EventWalk {
  room = EVENT_WORDS_MAX;

  constructor(
    readonly secrets: readonly string[],
    readonly keep: KeepPicture,
  ) {}

  /** Words with every secret taken out, cut where they pass the room the event has left. */
  words(text: string): string {
    const scrubbed = redactedText(text, this.secrets);
    const bytes = Buffer.byteLength(scrubbed, "utf8");

    if (bytes <= WORDS_KEPT_WHOLE || bytes <= this.room) {
      this.room = Math.max(0, this.room - bytes);

      return scrubbed;
    }

    const cut = cutWords(scrubbed, this.room);
    this.room = 0;

    return cut;
  }
}

/**
 * A value with every secret taken out of each string in it, keys included,
 * every picture a block carries kept apart and named in the block's place
 * (`{ type, keptPicture }`), every other inline bytes left out
 * (`inlineBytesOf`), and its words cut past what one event carries
 * (`EVENT_WORDS_MAX`). Note that a picture the service kept nothing of, or
 * whose keeping failed, is left out as every other inline bytes are, so the
 * transcript stands in `[image]` for it as it did before pictures were kept.
 */
const redacted = Effect.fnUntraced(function* (
  value: Json,
  walk: EventWalk,
): Effect.fn.Return<Json> {
  if (Predicate.isString(value)) return walk.words(value);

  if (Array.isArray(value)) {
    const each: Json[] = [];

    for (const item of value) each.push(yield* redacted(item, walk));

    return each;
  }

  if (!Predicate.isObject(value)) return value;
  const object: JsonObject = value;
  const inline = inlineBytesOf(object);
  const kept = inline?.picture === undefined ? Option.none() : yield* walk.keep(inline.picture);

  if (Option.isSome(kept)) {
    return { type: object.type ?? "image", [RUNNER_KEPT_PICTURE_KEY]: kept.value };
  }

  const walked: [string, Json][] = [];

  for (const [key, each] of Object.entries(inline?.leftOut ?? object)) {
    walked.push([redactedText(key, walk.secrets), yield* redacted(each, walk)]);
  }

  return Object.fromEntries(walked);
});

/** A batch's body around its events, each already spelled as JSON. */
function bodyOf(events: readonly string[]): string {
  return `{"events":[${events.join(",")}]}`;
}

/** One body to post, and how many of the events it was taken from it holds. */
interface FirstBody {
  readonly body: string;
  readonly count: number;
}

/**
 * The first body of the events given, in order, as many of them as stay
 * within `maxBytes`, each scrubbed as it is taken (`eventText`), and how many
 * it holds. An event that alone passes the bound, which its words' cut
 * leaves only to JSON's escapes, goes in a body of its own.
 */
const firstBodyWithin = Effect.fnUntraced(function* (
  events: readonly RunnerEvent[],
  secrets: readonly Redacted.Redacted[],
  keep: KeepPicture,
  maxBytes: number,
): Effect.fn.Return<FirstBody> {
  const held: string[] = [];
  let bytes = Buffer.byteLength(bodyOf([]));

  for (const event of events) {
    const text = yield* eventText(event, secrets, keep);
    // One more byte for the comma that sets the event apart from the one before it.
    const size = Buffer.byteLength(text) + 1;

    if (held.length > 0 && bytes + size > maxBytes) break;
    held.push(text);
    bytes += size;
  }

  return { body: bodyOf(held), count: held.length };
});

/**
 * An event as the text the service is sent, with every secret the launch holds taken
 * out, its pictures kept apart and its words cut to what one event carries
 * (`redacted`). Note that we scrub every event, the SDK's included, because a tool's
 * output or a CLI's error is text the runner never wrote, and a command the
 * agent runs may print a credential it can read: on a host the credential
 * itself, and in a sandbox its placeholder.
 * Note too that a sandbox's placeholders are scrubbed, because whoever read
 * one in the transcript could present it from inside the sandbox, a
 * Terminal's shell among them, and act as the agent or spend its credential.
 * Note too that we scrub the strings themselves, before they are spelled as
 * JSON, so no escape can hide a secret or be cut in half by its removal.
 */
const eventText = Effect.fnUntraced(function* (
  event: RunnerEvent,
  secrets: readonly Redacted.Redacted[],
  keep: KeepPicture,
): Effect.fn.Return<string> {
  const values = secrets.flatMap((secret) => {
    const value = Redacted.value(secret);

    return value === "" ? [] : [value];
  });

  // Note that the event is JSON already, as the SDK parsed it from the CLI's stdout.
  const json: Json = JSON.parse(JSON.stringify(event));

  return JSON.stringify(yield* redacted(json, new EventWalk(values, keep)));
});

const decodePictureAnswer = Schema.decodeUnknownOption(Schema.Struct({ picture: WireValueSchema }));

/** A picture the service did not answer for, with why: words with no secret in them. */
class PictureUnkept extends Data.TaggedError("PictureUnkept")<{ readonly detail: string }> {}

/**
 * One picture's bytes posted to the service's pictures route, answered as
 * what it kept (`RunnerPictureAnswer`), or nothing where it kept none; it
 * fails where the service did not answer.
 */
const postPicture = Effect.fnUntraced(function* (
  client: HttpClient.HttpClient,
  options: SinkOptions & { readonly picturesUrl: string },
  data: string,
): Effect.fn.Return<Option.Option<Json>, PictureUnkept> {
  const request = HttpClientRequest.post(options.picturesUrl).pipe(
    HttpClientRequest.bearerToken(options.bearer),
    HttpClientRequest.bodyUint8Array(Buffer.from(data, "base64"), "application/octet-stream"),
  );

  // Note that the client's error is not kept, because the request it carries holds the bearer in its headers.
  const response = yield* client.execute(request).pipe(
    Effect.timeout(POST_TIMEOUT),
    Effect.mapError(() => new PictureUnkept({ detail: "the service did not answer" })),
  );

  if (response.status !== HTTP_OK) {
    return yield* new PictureUnkept({ detail: `the service answered ${response.status}` });
  }

  const body = yield* response.json.pipe(
    Effect.mapError(() => new PictureUnkept({ detail: "the service's answer is not JSON" })),
  );

  return Option.map(
    decodePictureAnswer(body),
    (kept): Json => (kept satisfies RunnerPictureAnswer).picture,
  );
});

/**
 * What keeps the pictures of one taken batch apart, at the launch's
 * pictures route: each picture posted once, the same bytes asked again (an
 * event walked again for the next body) answered as before, and none posted
 * at all where the launch was handed no route. Note that a picture is never
 * posted again, and once one goes unanswered the rest of the batch's are
 * left out unasked, because a picture left out costs the transcript that
 * picture alone, while a wait holds back every event behind it.
 */
function batchKeeper(client: HttpClient.HttpClient, options: SinkOptions): KeepPicture {
  const { picturesUrl } = options;
  const kept = new Map<string, Option.Option<Json>>();
  let unanswered = false;

  if (picturesUrl === undefined) return () => Effect.succeed(Option.none());

  return (data) => {
    const known = kept.get(data);

    if (known !== undefined) return Effect.succeed(known);

    if (unanswered) return Effect.succeed(Option.none());

    return postPicture(client, { ...options, picturesUrl }, data).pipe(
      Effect.catch((unkept) =>
        Effect.logWarning(`agent-runner: a picture was left out: ${unkept.detail}`).pipe(
          Effect.andThen(Effect.sync(() => (unanswered = true))),
          Effect.as(Option.none()),
        ),
      ),
      Effect.tap((answer) => Effect.sync(() => kept.set(data, answer))),
    );
  };
}

/** One batch's body, posted once: taken, or why the service did not take it. */
function postOnce(
  client: HttpClient.HttpClient,
  options: SinkOptions,
  body: string,
): Effect.Effect<void, EventsUndelivered> {
  const request = HttpClientRequest.post(options.url).pipe(
    HttpClientRequest.bearerToken(options.bearer),
    HttpClientRequest.bodyText(body, "application/json"),
  );

  return client.execute(request).pipe(
    Effect.timeout(POST_TIMEOUT),
    // Note that the error is not kept as the cause, because the request it
    // carries holds the bearer in its headers.
    Effect.mapError(
      () => new EventsUndelivered({ transient: true, detail: "Service unreachable" }),
    ),
    Effect.flatMap((response) => {
      if (response.status >= 200 && response.status < 300) return Effect.void;
      const transient = response.status >= SERVER_ERROR || TRANSIENT_STATUS.has(response.status);

      return Effect.fail(
        new EventsUndelivered({
          transient,
          batchRefused: BATCH_REFUSED_STATUS.has(response.status),
          detail: `The service answered ${response.status}`,
        }),
      );
    }),
  );
}

/** One batch, posted until the service takes it or answers that it never will. */
const postBatch = Effect.fn("agent-runner/postBatch")(function* (
  client: HttpClient.HttpClient,
  options: SinkOptions,
  body: string,
) {
  return yield* postOnce(client, options, body).pipe(
    Effect.retry({
      schedule: POST_BACKOFF,
      while: (error) => error.transient,
    }),
  );
});

/**
 * The sink for one launch, numbering from `firstSequence`. Its sender runs in
 * the caller's scope; a post the service refuses for good stops it, and `drain`
 * reports that failure.
 */
export const openEventSink = Effect.fn("agent-runner/openEventSink")(function* (
  options: SinkOptions,
): Effect.fn.Return<EventSink, never, HttpClient.HttpClient | Scope.Scope> {
  const client = yield* HttpClient.HttpClient;
  const queue = yield* Queue.unbounded<RunnerEvent, Cause.Done>();
  let next = options.firstSequence;
  let secrets = options.secrets;

  const sendAll = Effect.gen(function* () {
    for (;;) {
      let left: readonly RunnerEvent[] = yield* Queue.takeBetween(queue, 1, BATCH_MAX);
      const keep = batchKeeper(client, options);

      // Note that each body is scrubbed only as it is posted, so a secret withheld while the body before it was in flight is out of it.
      while (left.length > 0) {
        const { body, count } = yield* firstBodyWithin(
          left,
          secrets,
          keep,
          RUNNER_EVENTS_MAX_BYTES,
        );

        yield* postBatch(client, options, body).pipe(
          Effect.catchIf(
            (undelivered) => undelivered.batchRefused === true,
            (refused) =>
              Effect.logWarning(
                `agent-runner: skipped ${count} event(s) the service refused: ${refused.detail}`,
              ),
          ),
        );

        left = left.slice(count);
      }
    }
  }).pipe(Effect.catchIf(Cause.isDone, () => Effect.void));

  const sender = yield* Effect.forkScoped(sendAll);

  // Note that a heartbeat the service did not take, or did not answer within the post's bound, is let go, since the next follows within the interval.
  // Note that `Effect.schedule` waits one interval before the first beat, as the schedule's first step sleeps.
  const heartbeat = yield* Effect.forkScoped(
    Effect.schedule(
      Effect.ignore(Effect.suspend(() => postOnce(client, options, bodyOf([])))),
      Schedule.spaced(Duration.millis(RUNNER_HEARTBEAT.EVERY_MS)),
    ),
  );

  const emit = (message: RunnerMessage) =>
    Effect.suspend(() => {
      const sequence = next;
      next += 1;

      return Queue.offer(queue, { sequence, message });
    }).pipe(Effect.asVoid);

  const drain = Fiber.interrupt(heartbeat).pipe(
    Effect.andThen(Queue.end(queue)),
    Effect.andThen(Fiber.join(sender)),
  );

  // Note that the sender is not joined to its end here, because the scope interrupts it as the launch ends.
  const drainStopped = drain.pipe(Effect.timeoutOption(STOP_DRAIN), Effect.asVoid);

  const undelivered = Fiber.join(sender).pipe(
    Effect.flip,
    Effect.catch(() => Effect.never),
  );

  const withhold = (secret: Redacted.Redacted) =>
    Effect.sync(() => {
      secrets = [...secrets, secret];
    });

  return { emit, drain, drainStopped, undelivered, withhold } satisfies EventSink;
});
