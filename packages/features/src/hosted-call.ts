/**
 * hosted-call.ts -- one hosted procedure asked, answering its output or how it failed as its domain spells it, never a failure in the error channel.
 *
 * `hostedCall` is `askHosted` (`hosted-link.ts`) with the one translation
 * every domain shares: a refusal the procedure declares read as
 * `{ failure, ...the fields it carries }`, spelled as `hosted-failure.ts`
 * spells it (its slug, or the domain's rename under `as`); a refused bearer
 * read as signed out on a live read (`live`); and everything else, a
 * refusal any procedure may answer that the domain does not rename among
 * it, read as no answer with the facts of what failed beneath it as its
 * cause. A refusal the procedure does not declare never reaches here as a
 * refusal: the link reads it as no answer. The deadline and the idempotency
 * key are `askHosted`'s, handed on as they are.
 *
 * A live read may be polled (`poll`): asked for its rows inline, and, past
 * where they last stood (`after`), held until they move, under the held
 * deadline. `askLiveRead` asks a declared live read (`live-read.ts`) so,
 * past a sync id it names (`LIVE_POLL.SYNC`) under the held deadline too,
 * and a sync-followed read asked whole under the whole deadline, its pages
 * followed to the last and joined into the one whole answer it stands for
 * (`pagesJoined`).
 */

import type { ORPCError } from "@orpc/client";
import type { ORPCErrorFromErrorMap } from "@orpc/contract";
import { Effect, Predicate } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { FailureFacts } from "./failure-facts.js";
import {
  HOSTED_CALL_FAILURE,
  type HostedFailed,
  type HostedReading,
  type HostedRenames,
  type NoRenames,
  spelledFailure,
} from "./hosted-failure.js";
import {
  askHosted,
  HOSTED_DEADLINE,
  type HostedClient,
  type HostedDeadline,
  type HostedFailure,
  type HostedProcedure,
  hostedFailureFacts,
  type LivePollInput,
} from "./hosted-link.js";
import {
  type AnyLiveRead,
  LIVE_MODE,
  type LiveReadAnswer,
  type LiveReadAsked,
} from "./live-read.js";
import { LIVE_POLL, LIVE_SIGNED_OUT, type SealedLiveQueryWire } from "./live-wire.js";
import { HOSTED_API_ERROR, type HostedApiError } from "./service-wire.js";

/**
 * The most pages a whole answer is followed through, so a service that
 * named a next page forever never holds the read: past it the read is
 * answered as no answer, and asked whole again as any failed read is.
 */
const MOST_PAGES = 1_000;

/** How a live read is polled: its rows inline, held until they move past `after` where it names where they last stood. */
export interface HostedPoll {
  readonly after?: string | undefined;
}

/** How one call is asked and its failure read. */
export interface HostedCallOptions<As extends HostedRenames, Live extends boolean, Input = unknown>
  extends HostedReading<As, Live> {
  /** How long its answer may take; the usual deadline where none is named, or the held one for a poll held past `after`. */
  readonly deadline?: HostedDeadline;
  /** The key a write is sent under, on every attempt (`IDEMPOTENCY_KEY`). */
  readonly idempotencyKey?: string;
  /** The poll a live read is asked as; only a procedure whose input names a poll takes one. */
  readonly poll?: Input extends LivePollInput ? HostedPoll : never;
}

/** The refusals a procedure's client says it may fail with, by the slug each is coded as. */
type DeclaredBy<Failure> =
  Failure extends ORPCError<infer Code, infer _Data> ? Code & HostedApiError : never;

/** The input a poll asks with: the rows inline, past `after` where it names one. */
function polledInput<Input>(input: Input, poll: HostedPoll | undefined): Input {
  if (poll === undefined) return input;

  return {
    ...input,
    [LIVE_POLL.QUERY]: LIVE_POLL.ON,
    ...(poll.after === undefined ? undefined : { [LIVE_POLL.AFTER]: poll.after }),
  };
}

type Failed = { readonly failure: string; readonly cause?: FailureFacts };

/** A call's failure as its domain reads it. */
function failedOf(failed: HostedFailure, reading: HostedReading<HostedRenames, boolean>): Failed {
  if (Predicate.isTagged(failed, "HostedRefused")) {
    if (reading.live === true && failed.refusal === HOSTED_API_ERROR.INVALID_TOKEN) {
      return LIVE_SIGNED_OUT;
    }

    const failure = spelledFailure(failed.refusal, reading);

    if (failure !== undefined) return { ...failed.data, failure };
  }

  return { failure: HOSTED_CALL_FAILURE.UNANSWERED, cause: hostedFailureFacts(failed) };
}

/**
 * One procedure asked on the calling fiber's services: its output, or how
 * it failed as its domain spells it (`HostedFailed`), typed from the
 * refusals the procedure's contract declares.
 */
export function hostedCall<
  Input,
  Output,
  Failure,
  const As extends HostedRenames = Readonly<Record<never, never>>,
  Live extends boolean = false,
>(
  procedure: HostedProcedure<Input, Output, Failure>,
  input: Input,
  options: HostedCallOptions<As, Live, Input> = {},
): Effect.Effect<
  Output | HostedFailed<DeclaredBy<Failure>, As, Live>,
  never,
  HttpClient.HttpClient
> {
  const { poll } = options;
  const held = poll?.after === undefined ? undefined : HOSTED_DEADLINE.HELD;

  return Effect.catch(
    askHosted(
      procedure,
      polledInput(input, poll),
      options.deadline ?? held,
      options.idempotencyKey,
    ),
    (failed) =>
      // SAFETY: `failedOf` spells the failure as `HostedFailed` types it, from the refusals the link let through, which are the procedure's declared ones.
      Effect.succeed(failedOf(failed, options) as HostedFailed<DeclaredBy<Failure>, As, Live>),
  );
}

/**
 * A declared live read asked for the params it is bound to, sealed for
 * following, or polled where `poll` asks: its answer, signed out where the
 * session is another account's, or how it failed as its declaration's
 * refusals spell it, each renamed where `as` names it, as a domain that
 * shipped another spelling, or read a refusal any procedure may answer as
 * its own, reads it.
 */
export function askLiveRead<Read extends AnyLiveRead, As extends HostedRenames = NoRenames>(
  live: HostedClient["live"],
  read: Read,
  params: LiveReadAsked<Read>,
  poll?: HostedPoll,
  as?: As,
): Effect.Effect<
  LiveReadAnswer<Read> | HostedFailed<DeclaredBy<ORPCErrorFromErrorMap<Read["errors"]>>, As, true>,
  never,
  HttpClient.HttpClient
> {
  // SAFETY: the live contract's procedure under a declared read's name is `liveProcedure` of that declaration (`contract/live.ts`), which the live reads' contract test holds.
  const procedure = live[read.name as keyof HostedClient["live"]] as HostedProcedure<
    LivePollInput,
    LiveReadAnswer<Read>,
    ORPCErrorFromErrorMap<Read["errors"]>
  >;

  // SAFETY: a read's params are the fields of its input its mode's poll fields stand beside, each as text.
  const input = params as LivePollInput & { readonly [LIVE_POLL.SYNC]?: string };
  const sync = input[LIVE_POLL.SYNC];

  // Note that a read past a sync id is held by the service until something moves, polled or not, so it travels under the held deadline, as a poll past `after` does.
  const past = sync !== undefined && sync !== "";
  // Note that a sync-followed read asked whole, first or after a stall, answers every row the account reaches at once, which for the largest account takes longer than the usual deadline to read and carry.
  const whole = !past && read.mode === LIVE_MODE.DELTA && poll?.after === undefined;
  const deadline = past ? HOSTED_DEADLINE.HELD : whole ? HOSTED_DEADLINE.WHOLE : undefined;

  const asked = hostedCall(procedure, input, {
    live: true,
    ...(poll !== undefined && { poll }),
    ...(deadline !== undefined && { deadline }),
    ...(as !== undefined && { as }),
  });

  // Note that only a polled read carries its rows inline, so only its pages can be joined.
  if (read.mode !== LIVE_MODE.DELTA || poll === undefined) return asked;

  const page = (word: string) =>
    hostedCall(
      procedure,
      { ...input, [LIVE_POLL.PAGE]: word },
      { live: true, poll: {}, ...(as !== undefined && { as }) },
    );

  return Effect.flatMap(asked, (first) =>
    // SAFETY: a delta read's answer is its parts' sealed statements and the fields beside them (`AnswerFields`), as each of its pages is, and a page's failure is one this read declares; `pagesJoined` answers one of those or the two joined.
    isFailed(first)
      ? Effect.succeed(first)
      : (pagesJoined(first as PagedAnswer, page) as typeof asked),
  );
}

/** Whether a live read answered how it failed rather than its rows. */
function isFailed(answered: unknown): answered is { readonly failure: string } {
  return Predicate.isObject(answered) && "failure" in answered;
}

/** A read's answer as its pages are joined: its parts' sealed statements, and the fields beside them. */
type PagedAnswer = { readonly queries: Readonly<Record<string, SealedLiveQueryWire>> };

/** The page an answer names to ask for next: its parts all name the same one; none on an answer that is whole or the last of its pages. */
function nextPageOf(answer: PagedAnswer): string | undefined {
  return Object.values(answer.queries).find((query) => query.sync?.page !== undefined)?.sync?.page;
}

/** Two pages of one whole answer as one: each part's rows of both, in order, and the later page's standing (its sync, its snapshot), so the last page's names where the whole answer stands. */
function joinedPage<Answer extends PagedAnswer>(joined: Answer, page: Answer): Answer {
  const queries = Object.fromEntries(
    Object.entries(page.queries).map(([part, query]) => [
      part,
      { ...query, rows: [...(joined.queries[part]?.rows ?? []), ...(query.rows ?? [])] },
    ]),
  );

  return { ...page, queries };
}

/**
 * A whole answer the service sent in pages (`LIVE_POLL.PAGE`), each page
 * asked for in turn until one names none, joined into the one answer they
 * stand for: every part's rows of every page, and the last page's sync id
 * and snapshot, so a reader takes the rows, and stands at that id, only
 * once it holds them all. A page that fails fails the whole answer, so a
 * reader never takes some pages for the whole and asks again from the
 * start; so does one past `MOST_PAGES`.
 */
function pagesJoined<R>(
  first: PagedAnswer,
  page: (word: string) => Effect.Effect<unknown, never, R>,
): Effect.Effect<unknown, never, R> {
  return Effect.gen(function* () {
    let joined = first;
    let next = nextPageOf(first);

    for (let asked = 1; next !== undefined; asked += 1) {
      if (asked >= MOST_PAGES) return { failure: HOSTED_CALL_FAILURE.UNANSWERED };
      const answered = yield* page(next);

      if (isFailed(answered)) return answered;
      // SAFETY: an answer that is no failure is the read's own, as the first was.
      const paged = answered as PagedAnswer;
      joined = joinedPage(joined, paged);
      next = nextPageOf(paged);
    }

    return joined;
  });
}
