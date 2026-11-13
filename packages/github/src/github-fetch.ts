/**
 * github-fetch.ts -- the `fetch` Octokit is handed: every request run on the Effect `HttpClient`, following redirects, and conditional where a GET was answered before.
 *
 * Octokit sends through `request.fetch`, so this is the one place a request
 * to GitHub leaves the process, and it leaves on the instance's
 * `HttpClient`: a test's fake answers it, and the client's own span records
 * it under the fiber that asked. Octokit's abort signal interrupts the
 * fiber, so interrupting the caller's Effect aborts the request.
 *
 * GitHub asks a client to follow `301`, `302`, and `307`
 * (https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#follow-redirects),
 * which the client underneath may not do by itself, so it is told to.
 *
 * GitHub also asks for conditional requests, and does not count an
 * authenticated `304` against the primary limit
 * (https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#use-conditional-requests-if-appropriate).
 * So each GET answered with an `etag` or `last-modified` is kept, per
 * identity and URL in the identity's own `Kept` (least recently used first
 * out), and the next identical GET sends `if-none-match` or
 * `if-modified-since`; a `304` is answered from the kept body, with the
 * rate-limit headers GitHub sent on the `304`. Note that what is kept is the
 * instance's alone, and a body past `CONDITIONAL.LARGEST_BODY` is not kept.
 */

import type { Context } from "effect";
import { Effect, Schema, Stream } from "effect";
import * as HttpBody from "effect/http/HttpBody";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

const CONDITIONAL = {
  /** The GET answers one identity keeps. */
  KEPT_PER_IDENTITY: 256,
  /** The largest body kept, in bytes. */
  LARGEST_BODY: 512 * 1024,
} as const;

const STATUS = { OK: 200, NO_CONTENT: 204, NOT_MODIFIED: 304 } as const;

/** Statuses a `Response` may not be built with a body for. */
const BODILESS_STATUSES: ReadonlySet<number> = new Set([STATUS.NO_CONTENT, STATUS.NOT_MODIFIED]);

const HttpMethod = Schema.Literals(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

const RATE_HEADER_PREFIX = "x-ratelimit-";

/** One GET answer kept for its next conditional request. */
interface KeptAnswer {
  readonly etag: string | undefined;
  readonly lastModified: string | undefined;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: ArrayBuffer;
}

/** One identity's kept GET answers, by URL, least recently used first. */
export type Kept = Map<string, KeptAnswer>;

/** A GET answer read whole, as it is kept. */
interface Answer {
  readonly headers: Readonly<Record<string, string>>;
  readonly body: ArrayBuffer;
}

/** A body read up to a bound: whole where it ended within it, else the stream of all of it, the part read included. */
type Bounded =
  | { readonly whole: true; readonly body: ArrayBuffer }
  | { readonly whole: false; readonly body: ReadableStream<Uint8Array> };

/** A header of an answer, whose names the client keeps lowercase. */
function header(headers: Readonly<Record<string, string>>, name: string): string | undefined {
  return headers[name];
}

function recall(kept: Kept, url: string): KeptAnswer | undefined {
  const answer = kept.get(url);

  if (answer === undefined) return undefined;
  // Note that a hit is moved to the back, so the least recently used goes first.
  kept.delete(url);
  kept.set(url, answer);

  return answer;
}

function keep(kept: Kept, url: string, answer: Answer): void {
  const etag = header(answer.headers, "etag");
  const lastModified = header(answer.headers, "last-modified");

  if (etag === undefined && lastModified === undefined) return;
  kept.delete(url);
  kept.set(url, { etag, lastModified, headers: answer.headers, body: answer.body });

  for (const oldest of kept.keys()) {
    if (kept.size <= CONDITIONAL.KEPT_PER_IDENTITY) break;
    kept.delete(oldest);
  }
}

/**
 * The answer as `fetch` would hand it, at the URL it was asked of, as
 * `fetch` names it: a `Response` built here names none, and Octokit's
 * paginator reads the URL of a listing's page that wraps its items.
 */
function at(response: Response, url: string): Response {
  Object.defineProperty(response, "url", { value: url });

  return response;
}

/** The kept answer, with the rate-limit headers and date of the `304` that confirmed it. */
function fromKept(answer: KeptAnswer, confirmed: Readonly<Record<string, string>>): Response {
  const headers = new globalThis.Headers(answer.headers);

  for (const [name, value] of Object.entries(confirmed)) {
    if (name.startsWith(RATE_HEADER_PREFIX) || name === "date") headers.set(name, value);
  }

  return new Response(answer.body.slice(0), { status: STATUS.OK, headers });
}

/**
 * A body read no further than `bound` bytes: whole where it ends within
 * them, so it may be kept; else every byte of it still to be read, the part
 * read first, so a large answer, such as an archive, is never held whole.
 */
async function readUpTo(body: ReadableStream<Uint8Array>, bound: number): Promise<Bounded> {
  const reader = body.getReader();
  const read: Uint8Array[] = [];
  let total = 0;

  while (total <= bound) {
    const next = await reader.read();

    if (next.done) {
      const whole = new Uint8Array(total);
      let at = 0;

      for (const chunk of read) {
        whole.set(chunk, at);
        at += chunk.byteLength;
      }

      return { whole: true, body: whole.buffer };
    }

    read.push(next.value);
    total += next.value.byteLength;
  }

  const rest = new ReadableStream<Uint8Array>({
    start: (controller) => {
      for (const chunk of read) controller.enqueue(chunk);
    },
    pull: async (controller) => {
      const next = await reader.read();

      if (next.done) controller.close();
      else controller.enqueue(next.value);
    },
    cancel: (reason) => reader.cancel(reason),
  });

  return { whole: false, body: rest };
}

/** The request body as the client sends it: Octokit hands a string, or bytes for an upload. */
function bodyOf(init: RequestInit): HttpBody.HttpBody {
  return init.body === undefined || init.body === null ? HttpBody.empty : HttpBody.raw(init.body);
}

/**
 * The `fetch` for one identity's requests: run on `client` under
 * `context`, the fiber context of the call that asked, so its span is that
 * call's child. `kept` is the identity's keep of conditional answers.
 */
export function githubFetch(
  client: HttpClient.HttpClient,
  context: Context.Context<never>,
  kept: Kept,
): (input: string | URL, init?: RequestInit) => Promise<Response> {
  const following = HttpClient.followRedirects(client);
  const run = Effect.runPromiseWith(context);

  return async (input, init = {}) => {
    const url = input.toString();
    const method = Schema.decodeUnknownSync(HttpMethod)(init.method ?? "GET");
    const headers = new globalThis.Headers(init.headers);
    const known = method === "GET" ? recall(kept, url) : undefined;

    if (known?.etag !== undefined && !headers.has("if-none-match")) {
      headers.set("if-none-match", known.etag);
    } else if (known?.lastModified !== undefined && !headers.has("if-modified-since")) {
      headers.set("if-modified-since", known.lastModified);
    }

    const request = HttpClientRequest.make(method)(url, {
      headers: Object.fromEntries(headers),
      body: bodyOf(init),
    });

    const response = await run(
      following.execute(request),
      init.signal === null || init.signal === undefined ? undefined : { signal: init.signal },
    );

    const { status } = response;
    const answered = response.headers;

    if (status === STATUS.NOT_MODIFIED && known !== undefined) {
      return at(fromKept(known, answered), url);
    }

    if (BODILESS_STATUSES.has(status)) {
      return at(new Response(null, { status, headers: answered }), url);
    }

    const body = Stream.toReadableStreamWith(response.stream, context);

    const keepable =
      method === "GET" &&
      status === STATUS.OK &&
      (header(answered, "etag") !== undefined || header(answered, "last-modified") !== undefined);

    // Note that only an answer that may be kept is read here, and only as far as the largest kept, so any other streams through.
    if (!keepable) return at(new Response(body, { status, headers: answered }), url);
    const bounded = await readUpTo(body, CONDITIONAL.LARGEST_BODY);

    if (bounded.whole) keep(kept, url, { headers: answered, body: bounded.body });

    return at(new Response(bounded.body, { status, headers: answered }), url);
  };
}
